# Agent Note: Dedicated full-screen TUI front door

Status: implemented

English | [中文](2026-07-17-dedicated-full-screen-tui-front-door.zh.md)

## Problem

At the time this front door was introduced, the line-oriented agent handled pipes and ordinary terminals, but a full-screen coding interface had to own raw input, differential screen drawing, cursor state, overlays, and terminal restoration. Combining those contracts in one UI plugin would have coupled a stream-oriented path to a TTY-only lifecycle. The later [redundant-agent removal](../simplification/2026-07-20-remove-stdio-and-echo-agents.md) removes that line agent; this Note continues to own the TUI design.

The interactive channel must remain a Cordis plugin over the same agent, session, tool, and user-interaction services as every other front door. It needs to resume durable history, follow compaction replacements, display tool-owned presentation, and restore the terminal on startup failure and disposal. A standalone chat application or a second agent composition would duplicate behavior outside the plugin graph.

## Decision

DeepSeek Harness ships [`@deepseek-ai/dsh-tui`](../../../../packages/ui/tui/README.md) as a dedicated Cordis plugin. It owns terminal input and presentation only; agent lifecycle, session persistence, tool execution, and the model-facing question tool remain separate composition entries. The plugin requires both stdin and stdout to be TTYs and fails instead of silently changing to line-oriented behavior.

The app layer has one terminal front door. `@deepseek-ai/dsh-tui-demo` mounts the TUI before the configured agent, and `examples/tui-agent` owns the interactive coding composition and Code Mode overlay directly. Non-interactive tasks use `@deepseek-ai/dsh-cli-demo`; ACP remains a separate editor protocol.

The selected front door receives the exact generated or resumed `SessionId` used by the pre-created agent. It mounts before the agent composition, waits for the matching root agent, and enters full-screen mode only after that agent exists. A matching `agent-loop/config-start-failed` event is therefore reported before screen takeover and exits with status 1.

### Session projection and interaction

The TUI rebuilds the transcript from the active `session.surface` and reprojects it whenever an event carries a `surfaceOp`, so resumed and compacted history matches the model-visible conversation. It renders Markdown text and reasoning, token totals, the latest `todo/write` plan, and tool cards produced through each tool definition's `presentCall` and `presentResult` methods. Long card bodies retain a configurable head/tail preview with the hidden-line count; one terminal control expands or collapses every card. Pending chunks and tool calls update the same components that completed events settle.

Editor input calls `agent.send()` while idle and `agent.steer()` while a turn is running. Cancellation, reasoning visibility, tool-card expansion, redraw, transcript clearing, and exit are terminal-only controls. The idle footer derives context occupancy from `tokenMeter` and pairs the selected model with its reasoning state; during a run, elapsed activity and the Escape interrupt hint replace that summary. The plugin registers the shared `userInteraction` provider and presents queued questions in a wide bottom-left keyboard panel with batch progress, numbered options, and aligned descriptions; agent behavior and answer logging remain owned by their existing services.

The `/model` command presents the advisory `ctx.llm` catalog as a keyboard selector and changes only this TUI session's target; argument forms remain available for direct selection. Agent-scoped prompt-assembly and request waterfalls snapshot one provider/model pair per step, so `{{provider}}` / `{{model}}` interpolation and request routing cannot split when a command arrives during assembly. The latest logged request header restores a used target; a selection that never reaches a request remains process-local.

### Terminal ownership

Before model output, session data, tool presentation, questions, configuration, or diagnostics reach pi-tui or the terminal title, `displayText()` renders C0 and C1 controls other than line feeds as visible hexadecimal escapes. Only the TUI and pi-tui create ANSI control sequences.

The built-in palette uses standard 16-color ANSI foregrounds and SGR attributes, keeps body text and backgrounds at terminal defaults, and uses reverse video for selection. Host terminals therefore remap the interface for light and dark themes without a TUI-specific theme setting; `color: false` removes styling.

## Verification

The implemented [TUI terminal-state snapshot Agent Note](../testing/2026-07-18-tui-terminal-state-snapshots.md) owns the four-layer verification contract: direct behavior tests, transient semantic terminal snapshots, recorded JSONL journeys through production tools, and Loader/PTY smoke tests. The package README owns configuration, commands, model-visible effects, and current limitations.

## Alternatives considered

- **Keep readline and full-screen modes inside `@deepseek-ai/dsh-stdio`** — rejected because line-oriented output and differential TTY rendering have different dependencies, input rules, logging ownership, and teardown obligations. Separate packages keep the pipe-safe contract small and explicit.
- **Let the TUI plugin silently downgrade when either stream is not a TTY** — rejected because a fallback hides deployment mistakes and changes interaction semantics. The app bundle may select a front door with `auto`; an explicitly mounted TUI fails loud.
- **Keep TUI wiring and tests under the readline `repl-agent` leaf** — rejected because one leaf would represent two distinct front doors and break symmetry with `acp-agent`. A dedicated `tui-agent` leaf owns TUI overlays and tests while reusing the repl-agent backend composition.
- **Mutate `agent.options` when `/model` runs** — rejected because creation options do not provide an atomic boundary between asynchronous prompt assembly and request routing. Agent-scoped waterfalls preserve immutable creation input and snapshot the selected pair for each step.

## Consequences

- Interactive terminal work has a stateful Markdown, card, plan, and question interface with no second terminal protocol to keep aligned.
- The TUI carries a pi-tui dependency and a strict TTY requirement; non-TTY deployments use the Headless app or a structured protocol.
- Session projection makes resume and compaction consistent with the durable conversation, but one configured session owns the transcript and editor.
- Tool packages extend terminal cards through their existing presentation methods without adding tool-specific branches to the TUI.
- Model selection uses adapter-advertised metadata without turning catalog membership into request validation; unused selections are not durable state.
