# Agent Note: Multiplex concurrent ACP sessions over one connection

Status: implemented

English | [中文](2026-06-14-acp-multi-session.zh.md)

## Problem

An ACP editor can keep several conversations alive over one agent subprocess. A single-active-session bridge would force extra processes and would not match Zed's client model, which tracks multiple session ids and concurrent loads. Multiplexing introduces isolation risks: events, prompt completion, cancellation, permission prompts, config selections, and predictable background-task ids must never cross session boundaries.

## Decision

The ACP bridge stores live sessions in `Map<SessionId, SessionRecord>`. Agent-scoped callbacks use `ownedRecord`: look up `agent.session.id` in that forward map and accept the record only when it owns the exact agent object, so a foreign same-id object cannot claim the session. A record owns its agent handle, in-flight prompt, live tool-call presentation state, pending idle config switches, session cwd, and client capability snapshot. A separate loading-id set reserves each id before asynchronous resume so two pipelined loads cannot construct duplicate agents; distinct ids may load concurrently.

Every `session/event` and `agent/status` callback resolves the owning record before sending or settling anything. Each session permits one in-flight prompt independently. The prompt records a log watermark, captures its own `turn/start`, and settles only on the matching `turn/end`; a late end from a cancelled prior turn cannot resolve a newer prompt. `session/cancel` addresses one record and calls only that agent's queue-aware cancel path.

Permission ownership uses the same exact-agent check against the forward map. The ACP `approval/request` answerer prompts only the editor session that owns the requesting agent and delegates foreign requests. User-interaction elicitations likewise route by agent ownership. Per-session sandbox and approval config values fold only that session's events, with pending idle switches stored on that record until the next turn anchors them.

Background bash tasks carry an opaque owner token equal to the owning session id. `bash_output` and `bash_kill` compare the caller's token with the executor's task ownership before reading or killing; a predictable task id alone grants no access. Ownership is stored with the executor task, so a tool plugin reload does not erase it.

Connection teardown clears the live map, settles each pending prompt as cancelled, and disposes all `AgentHandle`s in parallel. Each handle stops and awaits its loop, flushes the session while attached, unregisters the agent, and removes the session. Teardown is memoized and shared by client disconnect and plugin disposal.

## Protocol and workspace scope

[ACP v1 expressly permits several concurrent sessions on one connection](https://github.com/agentclientprotocol/agent-client-protocol/blob/01beb5fb5eec60e9f516a80d85eb03594bac61e3/docs/get-started/architecture.mdx#L16-L24), and each new session carries its own primary `cwd`. This bridge implements that session-level multiplexing, including different primary workspaces as recorded by the [per-session cwd decision](../architecture/2026-07-02-fs-per-session-cwd.md); it does not create one agent subprocess per session.

A multi-root project inside one session is a separate optional capability: ACP defines the [effective roots as the primary `cwd` plus `additionalDirectories`](https://github.com/agentclientprotocol/agent-client-protocol/blob/01beb5fb5eec60e9f516a80d85eb03594bac61e3/docs/protocol/v1/session-setup.mdx#L313-L367). [Zed sends the remaining project work directories only when the agent advertises that capability](https://github.com/zed-industries/zed/blob/ea77ca2818f3e059a2b61ecc7e63b67e01e1cec5/crates/agent_servers/src/acp.rs#L1139-L1145), otherwise it [drops them from the session request](https://github.com/zed-industries/zed/blob/ea77ca2818f3e059a2b61ecc7e63b67e01e1cec5/crates/agent_servers/src/acp.rs#L1454-L1472). The bridge does not advertise this capability and rejects non-empty values, as recorded in its [known limitations](../../../../packages/ui/acp/README.md#known-limitations-and-deferred-work), so a current Zed multi-root project reaches it with only the first work directory.

[The standard transport is one editor-launched agent subprocess per stdio connection](https://github.com/agentclientprotocol/agent-client-protocol/blob/01beb5fb5eec60e9f516a80d85eb03594bac61e3/docs/protocol/v1/transports.mdx#L17-L42); multiple editor connections therefore require multiple subprocesses or a custom transport, while this decision guarantees multiple sessions within one connection. Within that connection, `ctx.sandboxPolicy` resolves every session's `cwd` as its own `workspace-write` root, so the shared bash and filesystem services can serve concurrent projects without granting cross-project writes. This does not add ACP `additionalDirectories`; it removes the process-wide root limit from the already-supported one-primary-root-per-session path.

## Alternatives considered

**One live session per connection** — rejected. It adds process overhead and contradicts the target client's multi-session shape without removing multiplexing needs from the editor.

**A per-session `ctx.extend()`** — rejected. A child context does not by itself create a child plugin fiber, so listeners would still belong to the bridge fiber. The implemented bridge instead uses global listeners with explicit O(1) demultiplexing and per-session owned records; agent lifecycle is owned by `AgentHandle`.

**Agent object identity as bash-task ownership** — rejected. A resumed or replaced agent object may legitimately represent the same durable session. The opaque session token is the cross-boundary identity that should survive plugin reloads.

## Consequences

N sessions can stream, prompt, request permission, switch config, and run background tasks concurrently without interleaving or cross-settling. A cancel or dispose in one session does not affect its neighbors. The bridge pays for explicit maps and isolation tests, but it does not add one listener set per session and therefore avoids listener fan-out during long-lived connections.

The bridge still exposes no protocol method to close one live session independently. Today records leave together on connection teardown; session close/resume lifecycle capabilities remain deferred in the ACP feature checklist.

## Verification

The multi-session suite drives concurrent sessions through interleaved updates, independent in-flight prompts, targeted cancellation, same-id and distinct-id load races, permission routing, config isolation, and teardown. Tool-bash tests prove one session cannot read or kill another session's background task.
