# Agent Note: Workspace context instruction files

Status: implemented

## Problem

Repository guidance such as `AGENTS.md` belongs in a coding session's effective context so project conventions, build commands, and review rules arrive without repeated user pasting. The stdio and ACP products need the same behavior, isolated by session cwd: a global system-prompt section leaks one workspace's files into another live ACP session.

Neighboring products establish useful conventions but differ in details. Codex treats `AGENTS.md` as native, Claude Code uses `CLAUDE.md` and familiar system-reminder-style user context, and opencode supports both names with one winner per directory plus lazy nested discovery. The harness needs cross-tool compatibility without loading duplicate or contradictory files from the same scope.

The lifecycle has two distinct classes of content. The initial applicable chain is stable enough to live in the request prefix and benefit from provider prefix caching. Nested files, edits, candidate switches, and removals happen after the session starts and belong in durable append-only history rather than the frozen prefix.

## Decision

The implementation lives in `packages/context/workspace-context` as `@deepseek-ai/dsh-workspace-context`. It is a request-context extension, not a core service or a filesystem backend. The shared demo spine and Host Runtime mount it from an explicit `{ maxBytes } | false` deployment choice; `dsh web` enables a 65,536-byte budget while the Host Runtime's headless consumer disables it. The plugin consumes `agent/session-prefix`, `tools/post-execute`, and the optional `ctx.fs` capability.

The plugin does not statically inject `fs`. Providerless product trees therefore boot normally and the plugin no-ops until a filesystem provider exists. All production reads go through that provider. Candidate probes resolve each path and stat the result, so a final-component symlink is followed to its target: a link to a regular file loads, while a missing path or a non-file target is a confirmed absence. Following repository-owned links across the trust boundary is a deliberate reversal of the original no-follow probe; the [instruction-symlink follow note](2026-07-21-follow-instruction-symlinks.md) owns that decision and its residual risk. The session-prefix signal and dynamic tool execution signal propagate through resolution, metadata probes, and streaming reads, so cancellation does not wait for an unrelated filesystem scan. A resolve or stat exception is classified as unavailable: it skips only that candidate and is never interpreted as the deletion of an already-loaded scope.

### File Names And Precedence

The default per-directory candidate list is `['AGENTS.md', 'CLAUDE.md']`. The list is configurable as `instructionFileCandidates`, and `AGENTS.md` is an ordinary first candidate rather than a hidden priority. In one directory, only the first existing regular-file candidate loads. With defaults, `AGENTS.md` is native and `CLAUDE.md` is a compatibility fallback. A second list, `localInstructionFileCandidates` (default `['AGENTS.local.md', 'CLAUDE.local.md']`), loads an additive local overlay after the base file in the same directory; the [default local overlay](2026-07-21-local-instruction-overlay.md) owns that decision.

Candidate entries are same-directory file names. Empty entries, `.`/`..`, and entries containing `/` or `\` are ignored. Other same-directory names can be opted into explicitly; rule directories and import semantics are outside this contract.

The user-global file is fixed at `$DSH_HOME/AGENTS.md`, is not affected by either candidate list, and has no local overlay. `$DSH_HOME` defaults to `~/.dsh`, matching the harness-level home role of `~/.codex` or `~/.claude` rather than introducing a plugin-specific home. Tilde expansion and the default live in `dsh-paths` so future harness features share the same convention.

### Baseline Prefix

On the first request of an agent-loop instance, the plugin contributes one user-role message through `agent/session-prefix`. It loads the user-global file first, then finds the project root by walking upward from `agent.session.header.cwd` to a configured root marker (default `.git`), then loads one candidate from each directory from the root to the cwd. A `.git` file and a `.git` directory are both valid markers, covering linked worktrees and submodules. Without a marker, the cwd itself is the root.

The plugin prepends its contribution before `await next()` returns, so session-prefix contributions appear in plugin registration order. In the product spine workspace instructions are registered before a skills catalog and therefore appear first. The loop deep-freezes the composed prefix, logs it in `EpochHeader.messagePrefix`, and reuses it verbatim for that instance. It is request state, not `Session.deriveMessages()` history.

A resumed agent creates a new loop instance and recomposes the baseline from current files, with the new prefix anchored by the resume request header. This permits current baseline content on resume without mutating a prefix already used by an earlier instance.

The baseline is a user-role `<system-reminder>` with `Instructions from: <path>` sections and explicit authority and precedence language. This familiar model-facing frame avoids a harness-specific XML vocabulary. Project paths are root-relative and the user-global path is `~/.dsh/AGENTS.md` for the default home or `$DSH_HOME/AGENTS.md` for a configured home. A literal `</system-reminder>` inside file content is escaped. The package README owns the exact current [prompt shape](../../../../packages/context/workspace-context/README.md#prompt-shape).

### Dynamic Discovery And Refresh

After a successful first-party `read`, `write`, or `edit` call, the `tools/post-execute` listener reconciles the touched descendant chain and every scope already known to the session. A newly reached scope is returned through `additionalContexts` for the next request using an `Additional instructions from: <path>` system-reminder. Under Code Mode, `run_code` defers sub-dispatch contexts onto its outer result, so the same update is appended only after the parent result rather than being injected mid-call.

A content edit appends `Updated instructions from: <path>`, states that the new content replaces the previous content, and includes the complete current file. If precedence changes from one candidate to another, the message also names the previous path and says it no longer applies. If no candidate remains, the plugin appends `Instructions removed: <path>` and states that the previously loaded instructions no longer apply.

Dynamic messages carry their complete system-reminder framing in `content`, and every `context/message` reaches the model verbatim as a user-role message (there is no core wrapper to opt out of). `context/message.meta` carries opaque JSON state that is persisted but never rendered to the model.

Shell commands are not discovery triggers. Local bash calls start fresh shells, and inferring reached paths from arbitrary command strings would require shell semantics the prompt plugin does not own.

### Duplicate Suppression And Change Detection

Every dynamic workspace context event stores versioned metadata with `{ action, scope, path, digest? }`, where `digest` is SHA-1 over the loaded content. The model-facing prompt has no HTML comments, hidden markers, or headings that are parsed back into state.

At reconciliation time the plugin scans plugin-owned `context/message` events and derives the latest state for each visible scope. A short per-session pending map begins only after the immutable top-level `tools/result` proves an `additionalContexts` entry survived every post-execute listener, then covers the interval before the loop appends that context to the log. Each entry records the open `{ turn, step }`: an equal durable `context/message` at or after its sequence boundary confirms and removes it, while a matching `step/end` arriving first means the loop discarded its context buffer, so the plugin removes both the pending entry and its version-cache fast path. A nested Code Mode result stages its changes under the parent's opaque execution token so repeated sub-dispatches in one run do not duplicate them; the parent result rolls that provisional state back and commits only contexts retained by outer policy.

An unchanged path and digest is suppressed. A logged removal is a tombstone, so a reappearing candidate becomes a new `set`. Resume works from persisted metadata. If compaction removes an instruction event from the visible surface, that state no longer suppresses a later load, matching the fact that the model can no longer see it. Only changes actually included under the byte budget enter metadata or pending state, so an omitted file remains eligible on a later touch.

The frozen baseline keeps an in-memory path/digest map for comparison. A later successful filesystem touch appends baseline edits or removals as dynamic messages; it never rewrites the prefix. During resumed prefix composition the plugin also reconciles visible dynamic scopes, so nested changes made while the agent was offline can append an update before the first resumed request.

There is intentionally no watcher. Detection occurs at the next successful structured filesystem touch or resumed prefix composition. A provider failure produces no removal; absence is only accepted when all configured candidates in that scope were probed successfully.

### Byte Budget And Bounded Reads

`maxBytes` is required and applies separately to a rendered baseline or one dynamic reconciliation batch; there is no implicit or unbounded render budget. Non-positive and non-finite values disable loading. When content exceeds the budget, broader files are omitted before the most-specific file is truncated. A visible `Workspace instruction budget ...` notice names omitted and truncated paths and byte counts, and output never exceeds the configured bytes.

`maxSourceBytes` is a positive per-file cap with a 1 MiB default. The loader checks reported size before reading and still consumes content through `streamText()` with a running UTF-8 byte count, so missing/stale metadata cannot force an unbounded allocation. An oversized winning candidate is unavailable rather than a reason to fall through to another same-directory name. The plugin deliberately keeps no process-wide cache and never retains instruction prose. It keeps only `{ path, version, digest }` per effective scope in a `WeakMap<Session, Map<scope, state>>`: a matching provider `FsVersion` plus matching effective prompt state skips the read, while a changed version triggers a bounded read and SHA-1 confirmation. SHA-1 remains the cross-provider content identity persisted in visible structured metadata; provider versions are only an in-memory invalidation fast path. Cache transitions for model-visible changes commit only when the corresponding context survives the complete tool-result policy chain, and are invalidated if that accepted context is later dropped with its aborted step before reaching the log.

## Alternatives considered

**Use a global `ctx.systemPrompt.section()`.** Rejected because one Cordis context can host sessions with different cwd values, while repository-owned text is lower-authority context rather than top-authority provider system content.

**Inject the baseline on every `agent/pre-step`.** Rejected because repeated history injection wastes tokens, complicates duplicate state, and prevents a structurally stable provider prefix. Prefix composition gives a frozen, logged, per-instance baseline while dynamic append-only messages handle changes.

**Load both `AGENTS.md` and `CLAUDE.md` in one directory.** Rejected because repositories in transition commonly duplicate guidance across both files. Ordered candidates make precedence explicit and configurable.

**Parse rendered headings or hidden comments to recover loaded state.** Rejected because instruction prose can contain the same text, causing silent false positives. Persisted JSON metadata provides an unambiguous state channel that is invisible to the model.

**Summarize files with a model.** Rejected because instruction files are already curated summaries; another model call is nondeterministic and can erase edge-case requirements. Deterministic full text with byte budgeting is simpler.

## Consequences

Workspace guidance is isolated per session and shared by the demo front doors, Web Host, and every tool presentation mode. Initial instructions benefit from stable prefix caching, while nested and changed content remains durable and replayable. The generic session/agent context contract carries JSON metadata propagated through prompt-submit and post-tool `additionalContexts` arrays without flattening entries.

Repository text remains untrusted input. Lower-authority user-role framing, explicit precedence language, and delimiter escaping reduce risk but do not eliminate prompt injection. Following a candidate symlink to its target widens that surface to off-tree content, so the permission and sandbox layers that confine `ctx.fs` to trusted roots are the boundary that treats workspace files as data rather than authority (the [instruction-symlink follow note](2026-07-21-follow-instruction-symlinks.md) owns the residual risk).

The system is event-driven rather than watch-driven. Edits are not visible at the exact filesystem mutation instant unless that mutation goes through a structured tool; externally changed files are noticed on the next successful structured touch or resume. This keeps the design deterministic and provider-neutral.

## Deferred

Bash-derived path reporting, recursive startup scans, file watchers, lowercase defaults, `.claude/CLAUDE.md`, `.claude/rules/*.md`, import directives, ACP `additionalDirectories`, trust acknowledgements, and model-generated summaries are deferred. Project-directory `.local.` overlays now load by default (the [default local overlay](2026-07-21-local-instruction-overlay.md) owns that decision); a user-global overlay, directory rule systems, and imports still need their own precedence and trust designs.
