# Agent Note: ACP subagent backend (out-of-process delegation)

Status: implemented

## Problem

The subagent seam ([the seam Agent Note](2026-06-21-subagent-capability-seam.md)) was built so multiple backends coexist by name on `ctx.subagents`. The in-process backends (`-spawn`/`-fork`) run a child as a second `Agent` on the SAME cordis context — cheap, but the child shares the parent's process, model client, and tools. The seam's whole point was to also support an OUT-OF-PROCESS child reached over a protocol, proving the abstraction generalizes across a process boundary. This Agent Note adds the first such backend: an Agent Client Protocol (ACP) client.

## Decision

`@deepseek-ai/dsh-subagent-acp` registers a `SubagentProvider` that runs each child agent in a SPAWNED SUBPROCESS, driven over ACP as the *client*. It is the direction-inverted twin of the existing server-side bridge `@deepseek-ai/dsh-acp` (the ACP *agent*): the bridge ANSWERS `initialize`/`newSession`/`prompt`; this backend CALLS them and IMPLEMENTS the `Client` callbacks (`sessionUpdate`, `requestPermission`). Pointing the configured spawn command at the `acp-agent` example makes the harness talk to its own process.

### Fresh process per run

Each `start` spawns a new child, runs exactly one ACP session (`initialize` → `newSession` → `prompt`), and `dispose` kills the subprocess and awaits its exit. This is the simplest lifecycle and mirrors the in-process one-child-per-run shape.

### Minimal client stub

The client advertises NO optional capabilities (no `fs`, no `terminal`): the child self-serves file/terminal access in its own process. `session/update` notifications are consumed — the backend accumulates `agent_message_chunk` text as the result output and ignores the rest (thoughts, tool-call cards) in this cut, which surfaces only the child's final answer. `session/request_permission` is auto-answered by a configured policy (`reject` declines every prompt, `allow` approves via the first allow-shaped option) — the first cut surfaces no prompt to a human. Proxying `fs`/`terminal` back to the parent (a shared-workspace mode) remains future work, as the seam Agent Note noted.

### No start-time capabilities

The provider's `capabilities` are all `false`. An out-of-process child cannot honor the parent's `maxDepth` (it has no access to `parent.options.subagentDepth`) or `toolFilter` (it owns its own tool registry), and the first cut does not implement `outputSchema`. The service rejects a request needing any of them before `start` runs. The backend injects only `subagents` (not `ctx.agents`) and ignores `request.parent`.

### StopReason mapping

ACP `StopReason` → harness `SubagentStopReason`: `end_turn`→`completed`, `max_tokens`→`max-tokens`, `refusal`→`refusal`, `cancelled`→`aborted`, `max_turn_requests`→`error` (no clean equivalent — the task did not finish), unknown→`error`. A spawn/transport/RPC failure resolves `error` (or `aborted` if a cancel was requested); `result` never rejects on a child-level failure, per the seam contract.

### Security: scrubbed child environment

The child is a separate process, so it inherits an environment. Credential-shaped ambient vars (`/KEY|SECRET|TOKEN/i`) are NOT forwarded by default — the parent harness's own secrets must not leak into a spawned process implicitly (the same policy the bash executor applies). The child's OWN credentials (it needs a model key) are supplied EXPLICITLY via `config.env`, layered AFTER the scrub, so an intended `DEEPSEEK_API_KEY` survives while an incidental `AWS_SECRET_ACCESS_KEY` does not. Child stderr is inherited to the parent's stderr (diagnostics surface naturally); a spawn-level `error` event (e.g. ENOENT for a bad command) is captured and raced against the ACP drive, so a bad command settles `error` instead of crashing the parent with an unhandled error.

## Testing

- **Keyless unit/integration:** A scripted ACP subprocess exercises real stdio for prompt/output flow, every stop-reason mapping, signal and disposal cancellation (including pre-abort, pre-session race, and torn-pipe cases), both permission policies, ignored non-message updates, missing-command cleanup, provider reload, and namespace exports.
- **With-key e2e:** The backend spawns the real ACP example; its model answers `PONG`, writes `proof.txt`, and the parent verifies the file.
- **Snapshot gap:** Each ACP child is a separate process with its own replay session, unlike in-process per-session replay. Deterministic mock-server coverage exists, while `TODO(acp-subagent-replay)` tracks parent replay against a replaying child.

## Alternatives considered

### Why stay on SDK 0.25.1?

The backend needs only `ClientSideConnection`, `ndJsonStream`, `PROTOCOL_VERSION`, and the client protocol types, all supported in 0.25.1. The 0.28 fluent API would require migrating both client and server connection classes across the ACP layer without improving this backend, so that upgrade remains a separate change.

### Why not a persistent child process?

Persistent-process pooling (reuse a warm child across runs) is a performance optimization deferred to future work — it adds session-lifecycle and crash-recovery complexity the first cut does not need; each `start` spawning a fresh child mirrors the in-process one-child-per-run shape.

## Consequences

Every run pays a fresh subprocess (spawn + `initialize` + `newSession`). The parent surfaces only the child's final answer: `session/update` thoughts and tool-call cards are consumed and dropped, and permission prompts never reach a human — the configured policy answers them. The child's environment is credential-scrubbed by default, so its own model key is supplied explicitly via `config.env`.

## Future providers

The same out-of-process spawn/prompt/stream/cancel shape generalizes to other transports named in the seam Agent Note — A2A, the Codex app-server, and the Claude Code Agent SDK — each a sibling provider registered by name. The ACP backend is the proof that the seam supports the boundary; those are mechanically similar.
