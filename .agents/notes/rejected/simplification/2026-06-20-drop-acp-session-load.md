# Agent Note: Drop ACP session/load until resume has a product shape

Status: rejected — Zed is the current target ACP client, advertises and exercises load-capable sessions, and keeps pending-load state for concurrent `session/load`. The bridge should keep `session/load` and make the resume contract solid.

English | [中文](2026-06-20-drop-acp-session-load.zh.md)

## Problem

ACP advertises `loadSession: true` and implements `session/load` by injecting persistence into the bridge, validating cwd against stored metadata, reconstructing an agent from the persisted log, and replaying prior transcript updates to the client. That path has its own race handling, loading-id guard, replay presenter logic, and tests. It also depends on the canonical log retaining enough UI data to reconstruct old chunks and tool presentations.

Durable persistence remains foundational, but editor-visible resume is not yet a designed product flow. There is no session picker, no title/preview metadata, and no clear UX for failed or partial loads. The bridge is paying complexity for a feature that is exercised by tests, documentation, and the current target client's session model.

## Proposal

For now, ACP starts fresh sessions only. `initialize` advertises `loadSession: false` or omits the capability, and `session/load` is unsupported. Persistence remains available to the agent loop and tests; resume can still exist as a lower-level factory if another consumer needs it. The editor bridge should reintroduce `session/load` alongside a real session-selection UX and a stable load transcript contract.

## Acceptance criteria

- ACP no longer injects `sessionPersistence` solely for `session/load`.
- `initialize` does not advertise load support.
- The `session/load` handler, loading-id tracking, cwd preflight for loaded sessions, and load replay tests are removed.
- Snapshot fixtures no longer rely on load replay presentation.
- [ACP docs](../../../../packages/ui/acp/README.md) describe fresh-session support only.

## What we give up

An editor cannot reopen a prior persisted session through ACP. That is a real product feature, but the current implementation is ahead of the UX and ties the bridge to token-level log replay. Keeping persistence while dropping editor load narrows the bridge to the workflow it can currently present cleanly.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
