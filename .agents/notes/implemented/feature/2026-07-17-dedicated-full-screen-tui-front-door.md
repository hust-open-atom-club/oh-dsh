# Agent Note: Dedicated full-screen TUI front door

Status: implemented

English | [中文](2026-07-17-dedicated-full-screen-tui-front-door.zh.md)

## Problem

The line-oriented `@deepseek-ai/dsh-stdio` front door works in pipes and ordinary terminals, but a full-screen coding interface must own raw input, differential screen drawing, cursor state, overlays, and terminal restoration. Combining those contracts in one UI plugin couples the pipe-safe path to a TTY-only lifecycle and makes it unclear which terminal behavior a composition selects.

The interactive channel must remain a Cordis plugin over the same agent, session, tool, and user-interaction services as every other front door. It needs to resume durable history, follow compaction replacements, display tool-owned presentation, and restore the terminal on startup failure and disposal. A standalone chat application or a second agent composition would duplicate behavior outside the plugin graph.

## Decision

DeepSeek Harness ships [`@deepseek-ai/dsh-tui`](../../../../packages/ui/tui/README.md) as a dedicated Cordis plugin. It owns terminal input and presentation only; agent lifecycle, session persistence, tool execution, and the model-facing question tool remain separate composition entries. The plugin requires both stdin and stdout to be TTYs and fails instead of silently changing to line-oriented behavior.

The app layer selects a concrete terminal front door before mounting it. `@deepseek-ai/dsh-stdio-demo` can resolve `auto` from the two process streams, while the `repl-agent` and `tui-agent` leaves explicitly select readline and TUI respectively. The TUI leaf reuses the repl-agent backend and tool composition through an asserted include patch, so the three runnable agent leaves remain symmetric without duplicating deployment choices.

The selected front door receives the exact generated or resumed `SessionId` used by the pre-created agent. It mounts before the agent composition, waits for the matching root agent, and enters full-screen mode only after that agent exists. A matching `agent-loop/config-start-failed` event is therefore reported before screen takeover and exits with status 1.

### Session projection and interaction

The TUI rebuilds the transcript from the active `session.surface` and reprojects it whenever an event carries a `surfaceOp`, so resumed and compacted history matches the model-visible conversation. It renders Markdown text and reasoning, token totals, the latest `todo/write` plan, and tool cards produced through each tool definition's `presentCall` and `presentResult` methods. Pending chunks and tool calls update the same components that completed events settle.

Editor input calls `agent.send()` while idle and `agent.steer()` while a turn is running. Cancellation, reasoning visibility, tool-card expansion, redraw, transcript clearing, and exit are terminal-only controls. The plugin registers the shared `userInteraction` provider and presents questions as queued keyboard overlays; agent behavior and answer logging remain owned by their existing services.

### Terminal ownership

Before model output, session data, tool presentation, questions, configuration, or diagnostics reach pi-tui or the terminal title, `displayText()` renders C0 and C1 controls other than line feeds as visible hexadecimal escapes. Only the TUI and pi-tui create ANSI control sequences.

The built-in palette uses standard 16-color ANSI foregrounds and SGR attributes, keeps body text and backgrounds at terminal defaults, and uses reverse video for selection. Host terminals therefore remap the interface for light and dark themes without a TUI-specific theme setting; `color: false` removes styling.

## Verification

The implemented [TUI terminal-state snapshot Agent Note](../testing/2026-07-18-tui-terminal-state-snapshots.md) owns the four-layer verification contract: direct behavior tests, transient semantic terminal snapshots, recorded JSONL journeys through production tools, and Loader/PTY smoke tests. The package README owns configuration, commands, model-visible effects, and current limitations.

## Alternatives considered

- **Keep readline and full-screen modes inside `@deepseek-ai/dsh-stdio`** — rejected because line-oriented output and differential TTY rendering have different dependencies, input rules, logging ownership, and teardown obligations. Separate packages keep the pipe-safe contract small and explicit.
- **Let the TUI plugin silently downgrade when either stream is not a TTY** — rejected because a fallback hides deployment mistakes and changes interaction semantics. The app bundle may select a front door with `auto`; an explicitly mounted TUI fails loud.
- **Keep TUI wiring and tests under the readline `repl-agent` leaf** — rejected because one leaf would represent two distinct front doors and break symmetry with `acp-agent`. A dedicated `tui-agent` leaf owns TUI overlays and tests while reusing the repl-agent backend composition.

## Consequences

- Interactive terminal work gains a stateful Markdown, card, plan, and question interface without changing the line-oriented protocol used by pipes and automation.
- The TUI carries a pi-tui dependency and a strict TTY requirement; non-TTY deployments select `@deepseek-ai/dsh-stdio` at composition time.
- Session projection makes resume and compaction consistent with the durable conversation, but one configured session owns the transcript and editor.
- Tool packages extend terminal cards through their existing presentation methods without adding tool-specific branches to the TUI.
