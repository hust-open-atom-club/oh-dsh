# Agent Note: Multiplex concurrent ACP sessions over one connection

Status: implemented

## Problem

An ACP editor can keep several conversations alive over one agent subprocess. A single-active-session bridge would force extra processes and would not match Zed's client model, which tracks multiple session ids and concurrent loads. Multiplexing introduces isolation risks: events, prompt completion, cancellation, permission prompts, config selections, and predictable background-task ids must never cross session boundaries.

## Decision

The ACP bridge stores live sessions in `Map<SessionId, SessionRecord>`. Agent-scoped callbacks use `ownedRecord`: look up `agent.session.id` in that forward map and accept the record only when it owns the exact agent object, so a foreign same-id object cannot claim the session. A record owns its agent handle, in-flight prompt, live tool-call presentation state, pending idle config switches, session cwd, and client capability snapshot. A separate loading-id set reserves each id before asynchronous resume so two pipelined loads cannot construct duplicate agents; distinct ids may load concurrently.

Every `session/event` and `agent/status` callback resolves the owning record before sending or settling anything. Each session permits one in-flight prompt independently. The prompt records a log watermark, captures its own `turn/start`, and settles only on the matching `turn/end`; a late end from a cancelled prior turn cannot resolve a newer prompt. `session/cancel` addresses one record and calls only that agent's queue-aware cancel path.

Permission ownership uses the same exact-agent check against the forward map. The ACP `approval/request` answerer prompts only the editor session that owns the requesting agent and delegates foreign requests. User-interaction elicitations likewise route by agent ownership. Per-session sandbox and approval config values fold only that session's events, with pending idle switches stored on that record until the next turn anchors them.

Background bash tasks carry an opaque owner token equal to the owning session id. `bash_output` and `bash_kill` compare the caller's token with the executor's task ownership before reading or killing; a predictable task id alone grants no access. Ownership is stored with the executor task, so a tool plugin reload does not erase it.

Connection teardown clears the live map, settles each pending prompt as cancelled, and disposes all `AgentHandle`s in parallel. Each handle stops and awaits its loop, flushes the session while attached, unregisters the agent, and removes the session. Teardown is memoized and shared by client disconnect and plugin disposal.

## Alternatives considered

**One live session per connection** — rejected. It adds process overhead and contradicts the target client's multi-session shape without removing multiplexing needs from the editor.

**A per-session `ctx.extend()`** — rejected. A child context does not by itself create a child plugin fiber, so listeners would still belong to the bridge fiber. The implemented bridge instead uses global listeners with explicit O(1) demultiplexing and per-session owned records; agent lifecycle is owned by `AgentHandle`.

**Agent object identity as bash-task ownership** — rejected. A resumed or replaced agent object may legitimately represent the same durable session. The opaque session token is the cross-boundary identity that should survive plugin reloads.

## Consequences

N sessions can stream, prompt, request permission, switch config, and run background tasks concurrently without interleaving or cross-settling. A cancel or dispose in one session does not affect its neighbors. The bridge pays for explicit maps and isolation tests, but it does not add one listener set per session and therefore avoids listener fan-out during long-lived connections.

The bridge still exposes no protocol method to close one live session independently. Today records leave together on connection teardown; session close/resume lifecycle capabilities remain deferred in the ACP feature checklist.

## Verification

The multi-session suite drives concurrent sessions through interleaved updates, independent in-flight prompts, targeted cancellation, same-id and distinct-id load races, permission routing, config isolation, and teardown. Tool-bash tests prove one session cannot read or kill another session's background task.
