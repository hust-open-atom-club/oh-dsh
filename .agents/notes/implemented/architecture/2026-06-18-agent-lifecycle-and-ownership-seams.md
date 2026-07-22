# Agent Note: Agent lifecycle and ownership seams

Status: implemented

English | [中文](2026-06-18-agent-lifecycle-and-ownership-seams.zh.md)

## Problem

Several ACP and tool-bash limitations were symptoms of the same missing seam: plugins could create or resume agents through `ctx.agents`, but they could not own and dispose one agent independently, and long-running bash tasks carried no stable owner in the executor itself. ACP aborted and awaited agents on disconnect but could not unregister just that session's agent; `session/cancel` could not cancel queued-but-not-yet-started work; and `tool-bash` kept task ownership in a plugin-local `Map`, so an HMR reload could make an old task look unowned.

## Decision

Three seams: the queue-aware cancel, the `AgentHandle` disposer, and the bash owner token.

### 1. Queue-aware `Agent.cancel(cause?)`

A new `cancel()` verb on the `Agent` interface — the single public stop primitive. (It originally shipped alongside a narrower step-only `abort()`; that verb was later removed as unused, leaving `cancel()` the only public way to stop work.) It clears the inbox's queued + steering FIFOs, aborts the active turn if any, and keeps a cause-less pre-run marker so a prompt cancelled before claim never runs while a later prompt remains independent. An effective call emits `agent/cancel-requested` with the typed `user | parent` cause before clearing or aborting; idle cancellation emits nothing and cannot strand the next prompt. `whenIdle()` reaches post-cancel quiescence, and ACP `session/cancel` maps to `user`. The [explicit turn-cancellation decision](2026-07-16-explicit-turn-cancellation.md) owns the current cause, signal-lifetime, and cooperative-settlement contract.

### 2. `AgentHandle` async disposer

`ctx.agents.create`/`resume` (and the `AgentFactory` interface) return `AgentHandle = { agent: Agent; dispose(): Promise<void> }`. The disposer is a **consumer capability** — a registry observer holding only the bare `Agent` cannot tear it down. The caller fiber and registered factory provider are structural co-owners: caller unload enforces structured ownership, while provider unload must stop old instances whose scoped dependency surface resolves through that provider. All three paths reach the same memoized teardown: stop the loop, await its exit and idle flushes (true quiescence, not just the `disposed` status flip), detach the agent, detach its session, and unwind its scope. Each public ID becomes reusable when its exact registry entry detaches; there is no separate reservation-release phase. Config-created agents are already owned by the `AgentLoop` fiber (the handle is discarded). ACP holds each session's disposer in its `SessionRecord` and runs it on disconnect/teardown, so a bare client disconnect leaves no registered agent and no session-store entry — even when `session/load` races teardown (the just-resumed handle is disposed before the closed-guard throw).

**Teardown ORDER is load-bearing for durability**, and the implementation folds the session lifecycle into the agent's SINGLE composite cordis effect (`SessionStore.prepare`/`enter`/`announce`, replacing a sibling-effect split). A fiber unload disposes sibling effects concurrently (`Promise.all`), which would race removing the session store's append publication hooks against the loop's closing `session/flush` and drop the closing `turn/end`; inside one effect the disposers run as an ordered LIFO chain (loop stopped + `await agent.done` BEFORE the session detaches), so the loop's final flush is captured on BOTH the handle's `dispose()` and a fiber unload. The contained `agent/disposed` and `session/disposed` notifications cannot reject the chain or skip later teardown.

### 3. Bash owner token in the seam

Background-task ownership moved from a `tool-bash` plugin-local `Map<string, Agent>` into the executor. `BashExecRequest` gains an optional `owner?: string`; the resolved `BashExecSpec` carries it as required-but-nullable `owner: string | undefined` (a forgotten owner is a visible `undefined`, never a silently-absent property). The executor stores the token on its task and exposes it via a new `BashExecutor.ownerOf(id): string | undefined` seam (NOT on the public `BashTask` — one read path, no redundant API). `tool-bash` deletes its `Map` entirely: it stamps `exec.agent?.id` (the shared registry/session id) as the owner at `start`, and `bash_output`/`bash_kill` compare `ctx.bash.ownerOf(id)` to the caller's token with `!== undefined` semantics (an empty-string token is still a real owner). The completion notice finds the live agent by scanning `ctx.get('agents')?.list()` for `agent.id === ownerToken` (read via `ctx.get` — `onTaskDone` runs on the bash fiber, a foreign fiber, where the `ctx.agents` proxy would throw). Because ownership now lives on the task in the executor (disposed with the `dsh-bash` fiber), it SURVIVES a `tool-bash` HMR reload — closing the old `XXX(tool-bash-owner-hmr)` gap. (The `onTaskDone` listener is still effect-scoped to `tool-bash`'s `apply`, so a completion landing during the reload gap still drops its one notice — the pre-existing reload-gap drop — but the ownership fence itself is HMR-proof.)

## Verification

These invariants hold and are pinned by tests:

- ACP disconnect/session close leaves no registered agent AND no session-store entry for that session, even when `session/load` races teardown.
- `session/cancel` before a queued prompt starts prevents that prompt from running; a later accepted prompt remains an independent queued turn.
- A `tool-bash` HMR reload does NOT make an existing background task readable or killable by a different session (ownership survives on the executor).
- Existing non-ACP demos still work without managing handles explicitly; config-created agents remain owned by the `AgentLoop` plugin fiber.

## Session owner tokens are unique among live agents

The bash owner-token comparison relies on the shared `Agent.id`/`SessionId` being unique among live agents. Concurrent same-ID operations may both prepare privately, but publication enters the session and agent in order; `SessionStore.enter()` rejects a duplicate live session id, and every losing transaction rolls its private state back. A programmatic caller therefore cannot publish two live agents with one session token. The access *policy* (token comparison) stays in `tool-bash` (the consumer); the bash seam stores only an opaque `owner` string and never interprets it — the correct interface/implementation/consumer split.

## Alternatives considered

- **A public `BashTask.owner` field** instead of the `BashExecutor.ownerOf(id)` seam — rejected: one read path, no redundant API.
- **Sibling cordis effects for the agent's session lifecycle** — rejected: a fiber unload disposes sibling effects concurrently (`Promise.all`), racing removal of the store-owned append publication hooks against the loop's closing `session/flush`; the single composite effect's ordered LIFO chain is what captures the closing `turn/end` on both disposal paths.
- **A separate step-only `abort()` beside `cancel()`** — shipped originally, then removed as unused; `cancel()` is the single public stop primitive ([the public-stop-surface Agent Note](../simplification/2026-06-20-public-agent-stop-surface.md)).

## Consequences

This touched public interfaces (`Agent`, `AgentFactory`, the bash seam) deliberately, not as a local ACP patch. The simple synchronous `Agent.send()` ergonomics were preserved; the async lifecycle path is additive, for owners that need it.
