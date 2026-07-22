# Agent Note: persistent PTY sessions

Status: implemented

English | [中文](2026-07-16-persistent-pty-sessions.zh.md)

## Problem

The harness can run foreground and background commands, edit files, and delegate work, but it cannot continue an interactive terminal conversation across tool calls. Each `bash` foreground run starts a fresh shell, so shell-local cwd, exported variables, virtual-environment activation, functions, job-control state, and interactive child processes end with that call.

That gap excludes workflows whose state lives in a terminal rather than a file: stepping through `gdb`, exploring in a Python or Node REPL, driving a line-oriented editor such as `ed`, or returning to a shell after interrupting its foreground command. The generic [`ctx.tasks`](../../../../packages/tasks/README.md) runtime retains background-operation handles and output, but it does not provide interactive stdin or terminal semantics.

The existing `bash`, `read`, `write`, and `edit` tools remain the reliable default for bounded, auditable operations. A PTY is an additional capability for work that genuinely requires terminal state, not evidence that those tools are defective or candidates for removal.

## Decision

The optional `packages/pty/` capability family exposes agent-owned, persistent, line-oriented PTY sessions. It follows the repository's [capability pattern](../../implemented/architecture/2026-06-13-capability-seams.md), coexists with the existing command and filesystem tools, and does not change `agent-loop`.

The implementation supports interactive shells and line-oriented REPLs on Linux and macOS. Full-screen terminal applications, keystroke sequences, BEL-triggered control flow, session restoration after process loss, and cross-agent session sharing are explicitly deferred.

### Package topology

| Package | Role | ctx key |
|---|---|---|
| `dsh-pty` | `PtyService`, branded `PtySessionId`, backend registry, owner-scoped session contract, and result types | `ctx.pty` |
| `dsh-pty-local` | [`node-pty`](https://github.com/microsoft/node-pty)-based local backend, platform process inspection, bounded terminal buffer, sandbox resolution, and process-tree supervision | registers a backend on `ctx.pty` |
| `dsh-tool-pty` | Six model-facing tools, task-runtime integration for background sends, guidance, and ACP render intents | registers on `ctx.tools` |

Idle detection is backend behavior, not a second public seam. A remote or container backend may have authoritative readiness signals that do not resemble local `/proc` inspection; every `PtyBackend` therefore returns the common send result while owning its detection mechanism internally.

### Agent ownership and identity

`PtyService` stores live sessions process-locally, but every session is owned by the exact `Agent` passed through the tool execution context. The service mints an opaque `PtySessionId`; an optional model-chosen `name` is display metadata and is unique only within that owner. Every operation targets `sessionId`, and `list`/`read`/`signal`/`kill` reject callers other than the owner.

There are no plugin-load auto-start sessions. `terminal_open` creates a session only during an agent tool call, when ownership and the owning event-sourced session are known. A future declarative startup feature must compose through unpublished agent setup rather than create shared global terminals.

Agent-scope disposal closes registrations first, then awaits quiescent teardown of every owned PTY. Backend or tool-plugin reload does not orphan sessions: ownership lives in `PtyService` until the agent ends, following the same service-owned-record pattern as [`ctx.tasks`](../../../../packages/tasks/tasks/README.md).

### Security and process boundary

A registered `shell` backend constrains how a terminal starts; it does not constrain commands typed after startup. `dsh-pty-local` therefore applies two protections before spawning:

- It builds a scrubbed child environment using the same credential-shaped-name policy as `bash-local`, removing ambient `*KEY*`, `*SECRET*`, `*TOKEN*`, and harness-managed variables unless an explicit trusted mapping supplies them.
- It requires `ctx.sandbox` and the shared `ctx.sandboxPolicy`. At spawn, the backend resolves the owner's effective session mode over the deployment default and wraps the shell argv once; that mode and workspace root remain the process boundary for the PTY lifetime. `danger-full-access` is the existing explicit unconfined choice rather than a PTY-specific bypass.

Sandboxing confines local process effects but does not make arbitrary shell input safe: network calls and other external side effects remain governed by deployment policy. Tool descriptions state that PTY sessions are less auditable than one-shot tools and should be used only when persistence or interactive stdin is necessary.

The implementation uses only public `node-pty` capabilities: child PID, `data` and `exit` notifications, `write`, `resize`, and `kill`. It does not assume access to the native master fd or call `waitpid` from TypeScript. Platform process inspectors derive foreground process groups and parent/child identity from `/proc` on Linux and `ps` on macOS.

### Six model-facing tools

| Tool | Purpose | Result |
|---|---|---|
| `terminal_open` | Create an owner-scoped session from a registered backend type | `{ sessionId, name, type, motd }` |
| `terminal_send` | Send text, optionally submit Enter, and wait for readiness or register a background task | bounded viewport plus wait and session status; background also returns `taskId` |
| `terminal_read` | Read a bounded page from retained scrollback | `{ text, totalLines, lineBegin, lineEnd, truncated }` |
| `terminal_signal` | Send one allowed signal to the current foreground process group | `{ delivered, targetPgid }` |
| `terminal_close` | Close one session and await process-tree quiescence | `{ killed }` |
| `terminal_list` | List the caller's live sessions | owner-scoped session summaries |

`terminal_send({ sessionId, text, submit?, run_in_background? })` treats `text` as UTF-8 bytes and resolves `submit` to `true` in the tool implementation. When `submit` is true it writes the platform Enter sequence after the text; when false it writes only the text, allowing control characters and REPL fragments without hidden content heuristics.

Foreground sends return a bounded rendered delta and two independent facts: `waitReason` (`stdin_read | inferred_idle | timeout | session_exit`) and `sessionStatus` (`running` or `exited` with exit code or signal). `session_exit` refers to the PTY's top-level shell process, not an arbitrary foreground command whose status the shell consumes. A timeout never implies process exit.

With `run_in_background: true`, `dsh-tool-pty` registers the in-flight send on `ctx.tasks` and returns immediately with `taskId`. `task_output(wait: true)` waits, reads incremental output, and records the final result; `task_kill` forwards cancellation as `SIGINT` and escalates only through the PTY backend's owned teardown path. If the task surface is absent, background mode fails before writing input. No PTY-specific `sleep` tool or general wake-up seam is added.

`terminal_read` pages backward from the newest retained line. The backend enforces both line and UTF-8 byte caps on retained scrollback and the complete returned value, so one oversized line cannot bypass the bound. `truncated` distinguishes retention loss from an ordinary viewport delta.

`terminal_signal` accepts the closed set `SIGINT | SIGTERM | SIGKILL | SIGTSTP | SIGHUP`. The backend resolves the terminal foreground process group at execution time. `SIGKILL` is rejected when that group is the top-level shell, directing the caller to `terminal_close`; a failed group lookup fails the operation instead of signaling a guessed PID.

### Local readiness detection

The local backend first recognizes a private OSC prompt marker emitted by its controlled bash startup, then runs three bounded fallback tiers. The marker is removed before output reaches the model and avoids a fixed silence delay for ordinary shell commands on both platforms. Unpublished startup does not accept zero-output silence as readiness; timeout rejects the spawn. All timings are validated config fields: `pollIntervalMs`, `exactProbeAfterMs`, `idleSilenceMs`, and `timeoutMs`.

On Linux, the inspector reads the shell's terminal foreground PGID from `/proc/<shellPid>/stat`, enumerates every process and thread in that process group, and probes their current syscalls. A positive Tier 1 result requires an observed stdin wait: direct `read(0)`, a permitted read of a `select`/`pselect6` or `poll`/`ppoll` argument containing fd 0, or an epoll interest list containing fd 0. Unreadable process memory and unrecognized syscalls are misses, never positive guesses. Architecture tables contain only syscall numbers defined by the corresponding Linux UAPI; unsupported architectures skip Tier 1.

On macOS there is no exact syscall tier. Output silence returns `inferred_idle` for any foreground process group, including Python and `gdb`; `ps`-derived terminal PGID is used for signaling, not as proof that only the shell can be idle. Pure process-inspector logic is injectable and unit-tested on Linux, while a macOS CI job exercises the real PTY and process-table path.

Tier 2 returns `inferred_idle` after `idleSilenceMs` without output. A sleeping or network-blocked command can therefore look ready. Tier 3 returns `timeout` after `timeoutMs` so a foreground tool call cannot hold the agent indefinitely. The result preserves the distinction; callers may wait through `ctx.tasks`, signal the foreground group, or inspect from another session.

`node-pty` data notifications feed one streaming decoder and terminal parser. Parser carry state handles UTF-8 and terminal query sequences split across chunks. The implementation normalizes line-oriented output and detects alternate-screen entry, but it does not promise correct interaction with a full-screen application.

### Model-visible output and durability

The existing durable `tool/call` and `tool/result` events are the source of truth for text sent by the model and rendered output returned to it. `terminal_open` returns its MOTD through the logged tool result; foreground `send`/`read`/`list`/`signal`/`close` results are logged the same way. The PTY packages do not duplicate raw byte streams into custom session events.

Background sends use the existing task completion notice and `task_output` result path, so any output that reaches a later model request is likewise durable. Raw terminal bytes remain bounded process-local state and are neither persisted nor restorable. A future opt-in transcript sink would need its own retention, credential, and privacy contract.

### Process-tree teardown

The top-level `node-pty` child is the ownership anchor. On close, the backend stops callbacks, snapshots that PID and its transitive descendants by parent PID in children-first order, sends `SIGTERM`, closes the PTY, waits for quiescence, then sends `SIGKILL` to verified survivors after configurable `disposeGraceMs` and waits for them to leave the process table. Every captured PID includes process-start identity so reuse cannot redirect escalation.

Teardown reports root exit and survivor cleanup independently. It does not claim success merely because the shell exited; disposal resolves only after no captured tree member remains or returns a structured cleanup failure naming the survivors. Service disposal still clears its backend, reservation, and owner-detacher registries when a close fails. It never broadens ownership to every member of the root PID's POSIX session.

### Composition and rollout

The example composition remains opt-in and safe by default:

```yaml
plugins:
  '@deepseek-ai/dsh-sandbox-local':
  '@deepseek-ai/dsh-sandbox-policy':
    config:
      mode: workspace-write
      workspaceRoot: .
  '@deepseek-ai/dsh-pty':
  '@deepseek-ai/dsh-pty-local':
    config:
      scrollbackLines: 10000
      scrollbackMaxBytes: 4194304
      maxReadBytes: 262144
      pollIntervalMs: 50
      exactProbeAfterMs: 150
      idleSilenceMs: 3000
      timeoutMs: 30000
      disposeGraceMs: 3000
  '@deepseek-ai/dsh-tool-pty':
```

The package ships concise tool guidance explaining persistent state, owner isolation, uncertain idle results, cleanup, and the preference for existing one-shot tools when interaction is unnecessary. It does not add a global system-prompt recommendation or mount PTY in shipped defaults; dedicated ACP and headless snapshot overlays exercise the opt-in composition.

### Deferred work

- Full-screen TUI support, named key sequences, BEL interruption, terminal resize tools, and alternate-screen snapshots require a separately proven model-facing contract.
- Declarative per-agent startup requires an agent-setup composition point; plugin-load global sessions remain prohibited.
- Session restoration across harness-process loss requires an out-of-process owner and a versioned protocol.
- Network-egress policy and rollback of external side effects are broader than PTY and remain separate security work.
- Windows/ConPTY support requires a backend with Windows-native process ownership and signaling semantics.

## Alternatives considered

**Replace `bash`, filesystem tools, or task tools with PTY.** Rejected. One-shot tools retain stronger validation, approval, sandbox, output-bound, and replay contracts. PTY is reserved for interactive state.

**Add persistent mode to `bash`.** Rejected. Returning on readiness rather than process exit, retaining a process tree across calls, and exposing interactive stdin create a different ownership and failure contract.

**Require native master-fd access from `node-pty`.** Rejected. Its public API exposes no master fd. The local backend instead derives foreground groups and descendants from supported OS process metadata and treats unreadable metadata as a detector miss.

**Signal every member of the root PID's POSIX session.** Rejected. `node-pty` may expose a helper PID whose session belongs to the launcher, so SID-wide teardown can signal unrelated harness or desktop processes. A PID-identity-fenced descendant tree is narrower and safe by construction.

**Publish `PtyIdleDetector` as a replaceable registry.** Rejected. Only the local backend needs these platform probes, while remote backends may receive readiness over their own protocol. Backend replacement already provides the necessary extension point.

**Add a PTY-specific `sleep` tool.** Rejected. `ctx.tasks` already owns bounded waiting, cancellation, completion notices, and model-facing collection. A second general wake mechanism would cross the agent-loop boundary and duplicate that contract.

**Include TUI sequences and BEL handling.** Rejected. The source prototype treats those paths as timing-sensitive and still records unresolved alternate-screen and interaction failures. Line-oriented PTY use proves the core value without making those unverified behaviors foundational.

**Use an out-of-process daemon immediately.** Rejected for the initial in-process capability because current persistent front doors already keep a Cordis context alive. A daemon becomes justified by cross-process restoration or multi-client attachment, both deferred here.

## Verification

- Per-file coverage pins owner fencing, concurrent reservations, lifecycle cleanup, readiness tiers, sanitizer carry state, UTF-8 bounds, task integration, schemas, and render intents.
- Linux process fixtures cover non-leader and non-main-thread stdin waits, unreadable process state, supported syscall tables, unsupported architectures, and false-positive rejection; macOS inspector logic is injected into the same unit suite.
- Real `node-pty` tests exercise shell state, shared sandbox policy, environment scrubbing, signals, a TERM-ignoring descendant, and immediate post-disposal quiescence on supported hosts.
- A Loader-driven `cordis.yml` test mounts the real three-package composition, while ACP and headless snapshots pin the six schemas, bounded results, error rendering, and terminal/generic cards through opt-in overlays.
- Package contracts, the architecture map, core data structures, generated catalogs, and the website API describe the same shipped surface.
- The repository CI-equivalent sequence owns type, lint, coverage, snapshot, documentation, build, hygiene, demo, and built-entry verification.

## Consequences

**Persistent terminal state is available without weakening one-shot tools.** Shell and REPL state can survive tool calls, while `bash`, `read`, `write`, and `edit` retain their narrower validation, approval, and replay contracts.

**Idle below Linux Tier 1 is heuristic.** Output silence cannot distinguish a prompt from sleep or network I/O. The typed result preserves uncertainty, and bounded timeout plus task waiting and signaling keep control with the model.

**Persistent state can drift from the model's belief.** The model may forget its cwd or active REPL. Session summaries and retained output help recovery, but no prompt can make state persistence deterministic.

**A daemonized descendant can leave the captured tree.** A process that reparents before teardown is no longer discoverable from the `node-pty` root. The implementation accepts that cleanup gap instead of risking SID-wide signals to unrelated processes.

**A shell can cause external side effects.** Session sandboxing and environment scrubbing reduce local exposure but do not undo pushes, API calls, or messages. Deployments that cannot tolerate those effects must omit PTY or add network policy.

**Process loss destroys terminal state.** In-process sessions do not survive a harness crash or restart, and raw scrollback is not durable. Important work must be committed to files or another durable system.

**`node-pty` is a native dependency.** Installation, supported Node versions, prebuild availability, and platform behavior require built-artifact smokes on every supported OS.
