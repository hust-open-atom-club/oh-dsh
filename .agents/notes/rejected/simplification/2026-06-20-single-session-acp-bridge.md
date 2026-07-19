# Agent Note: Return the ACP bridge to one live session per connection

Status: rejected — Zed is the current target ACP client and its ACP implementation is explicitly multi-session: it stores live sessions in a `HashMap<SessionId, AcpSession>`, tracks `pending_sessions`, joins concurrent loads for the same id, and tests close-during-load behavior.

## Problem

The ACP bridge now supports multiple live sessions on one JSON-RPC connection. That capability brings multi-entry session maps, reverse session/agent lookups, per-session prompt state, loading ids, demux for every event, cross-session teardown, and isolation concerns for future permission prompts and background tasks. The older [multi-session ACP proposal](../../implemented/feature/2026-06-14-acp-multi-session.md) still tracks the unfinished permission-ownership piece; this Agent Note is the competing simplification path.

The product target has proven it needs concurrent editor conversations over one harness process: Zed's ACP connection owns multiple sessions and load states. The snapshot replay tier still avoids concurrent model streams because its replay entries are positional; that is a test-fixture limitation, not a reason to remove bridge multiplexing.

## Proposal

Scope ACP back to one live session per connection. `session/new` or `session/load` creates the only session record; a second live session request is rejected until the existing session is disposed or the connection closes. If editors need multiple chat tabs, they can launch multiple agent subprocesses until the bridge has a concrete multi-session UX and permission model.

Remove the multi-session maps and demux where a single `SessionRecord | undefined` is enough. The bridge can still keep the agent/session lifecycle seams that make disposal correct; the simplification is only about multiplexing more than one active session through the same transport.

## Acceptance criteria

- ACP has one active session record per connection.
- `session/new` and `session/load` reject while that record exists.
- Event handlers no longer demux across a `Map<sessionId, record>`.
- Multi-session tests are removed or moved under the proposal that continues to defend multiplexing.
- The existing [multi-session ACP proposal](../../implemented/feature/2026-06-14-acp-multi-session.md) is updated to link this Agent Note and remains the live direction.

## What we give up

An ACP client cannot host several concurrent conversations on one server process. That is a meaningful capability cut. The simpler model is still reasonable for an unreleased harness: one editor conversation maps to one agent process, and cross-session permission/background-task isolation stops being a live correctness burden.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
