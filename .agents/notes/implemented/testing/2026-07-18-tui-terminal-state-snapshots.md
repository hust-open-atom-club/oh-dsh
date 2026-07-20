# Agent Note: Snapshot semantic terminal state for the TUI

Status: implemented

English | [中文](2026-07-18-tui-terminal-state-snapshots.zh.md)

## Problem

The TUI is a stateful renderer. Its user-visible result depends on ANSI parsing, differential frames, wrapping, scrollback, viewport position, terminal width, focus, cursor state, and each tool's presentation intent. Unit tests that collect `Terminal.write()` fragments can prove event handling, but they cannot prove the final screen a terminal displays. The same screen may also be emitted through different write fragments, so pinning those fragments creates false regressions.

Component-line snapshots stop before ANSI reaches a terminal and miss cursor movement, clearing, styling, overlay composition, and reflow. Raster screenshots include font and platform rendering noise that is unrelated to the TUI contract. A completed flow built by directly appending plausible session events has another blind spot: it proves the renderer accepts those shapes, not that the production agent loop and tool implementations produce them.

The TUI therefore needs a deterministic, reviewable representation of terminal state, recorded model journeys that execute the real downstream stack, and a smaller test at the real process and PTY boundary.

## Decision

TUI coverage has four complementary layers:

1. `packages/ui/tui/tests/tui.spec.ts` tests event mapping, input routing, disposal, and error behavior directly.
2. `packages/ui/tui/tests/tui.snapshot.ts` mounts the production TUI against a headless terminal emulator for transient states that a completed session log cannot retain: in-flight streaming, pending tool calls, overlays, expansion, compaction reflow, errors, and shutdown.
3. `examples/tui-agent/tests/tui.snapshot.ts` replays committed JSONL session logs through the production agent loop and real tools, then compares the resulting semantic terminal state.
4. `examples/tui-agent/tests/tui-keyless-smoke.e2e.ts` boots the real Loader composition in a PTY, drives a scripted conversation through streaming and `ask_user_question`, and verifies startup, input, exit, failure reporting, and terminal restoration.

The runnable TUI has its own `examples/tui-agent` leaf beside the readline `repl-agent` and `acp-agent` leaves. It reuses the repl-agent backend and tool composition through an asserted include patch while fixing the shared terminal app to `ui.mode: tui`; TUI snapshots and PTY tests live with that leaf.

### Recorded-session replay

Each example-level scenario directory owns `session.jsonl`, optional child logs `session.<n>.jsonl`, and `terminal.expected.txt`. The primary log supplies user-authored `user/message` prompts and the recorded `assistant/chunk` sequence. `dsh-llm-replay` derives one model-call script per session, binds child logs to fresh child sessions, and is the only mocked boundary. The agent loop, bash and filesystem implementations, Code Mode worker, subagent provider, workflow worker, Cordis tools, presenters, and TUI are production implementations.

The suite rejects a journey when its tool-call sequence differs, an expected event count is missing, a tool result is an error, a turn ends in error, a workflow lifecycle is incomplete, or the live child-session count differs from the fixture set. These assertions prevent an attractive terminal expected output from hiding a failed or bypassed production path.

The live-model fixtures use `DSH_SNAPSHOT=record`; record mode rewrites their primary and child JSONL logs and terminal expected outputs. The deterministic Cordis toolchain keeps an authored complete JSONL script because reliably coercing a live model through five exact tool boundaries and two children is not a stable recording contract. `DSH_SNAPSHOT=refresh` replays every committed script keylessly and rewrites only derived terminal expected outputs. Plain replay compares without writing, and unknown mode values fail loud.

### Semantic terminal projection

The package-local `HeadlessTerminal` implements the same pi-tui `Terminal` interface as the process terminal and feeds every ANSI write into the pinned `@xterm/headless` parser. Snapshot code waits for synchronized frames to quiesce before reading state, so a checkpoint represents a completed screen rather than a timer-dependent write prefix.

Each expected output projects dimensions, active-buffer and viewport coordinates, lifecycle and cursor state, rows, wrap markers, and non-default style ranges into text. Scroll-heavy cards capture the used buffer; overlays capture the visible viewport. Text and style remain separate so a reviewer can distinguish content changes from presentation changes without decoding ANSI bytes.

Every checkpoint enforces theme independence across the complete terminal state: no RGB colors, no palette entries beyond ANSI 0–15, and no explicit background colors. Reverse video remains valid for selection because it uses terminal defaults. Both suites own closed inventories that reject missing scenarios, missing checkpoints, and orphaned expected output files.

### Required scenario matrix

| Layer | Scenario | Contract pinned |
|---|---|---|
| Recorded journey | Multi-turn conversation | Recorded reasoning/text chunks, two input turns, retained history, token totals, and idle editor state |
| Recorded journey | Todo plan | Real `todo_write` execution, result card, and persistent plan rendering |
| Recorded journey | Bash terminal card | Real local executor output, description, exit status, and completed terminal card |
| Recorded journey | Parallel filesystem reads | Two calls from one assistant message, real file contents, ordering, and separate completed cards |
| Recorded journey | Code Mode | Real `run_code` worker execution, two `tool/code-dispatch` events, captured program output, and completed card |
| Recorded journey | Dynamic workflow | Real workflow worker, phase lifecycle, replayed child session, structured return value, and completed card |
| Recorded journey | Cordis dynamic toolchain | Real mount, Code Mode inspect, direct subagent, workflow child, unmount, and all production presenters |
| Transient state | Streaming and pending advanced calls | In-flight reasoning/text plus pending Code Mode, workflow, and Cordis cards that disappear from completed logs |
| Transient state | Cards, interaction, layout, failure, and shutdown | Collapsed/expanded card families, question validation, compaction replacement, resize reflow, help/errors, cursor restoration, and terminal stop |

## Alternatives considered

- **Snapshot raw terminal writes** — rejected because differential rendering may change write boundaries without changing the screen, while cursor and clear sequences are unreadable in review.
- **Snapshot component render lines before terminal output** — rejected because it does not test ANSI parsing, cursor movement, overlays, viewport behavior, or independent components in one frame.
- **Build every completed flow by appending session events** — rejected because a hand-authored event sequence can drift from the agent loop, tool execution, child-session binding, or worker behavior while its presentation test stays green. Direct event construction remains limited to transient renderer states.
- **Reuse ACP stdout expected outputs as the TUI oracle** — rejected because a recorded model journey is transport-neutral but its presentation is not. TUI scenarios own terminal expected outputs while using the same JSONL replay vocabulary.
- **Commit raster screenshots** — rejected because fonts, glyph metrics, antialiasing, and host terminal themes make them platform-sensitive and make semantic style changes difficult to review.
- **Use only PTY end-to-end tests** — rejected because raw PTY output is a stream of historical drawing operations, not queryable final state. PTY tests retain the real Loader/input/teardown boundary, while the emulator owns broad state coverage.

## Consequences

- Completed advanced snapshots now fail when the real Code Mode, workflow, subagent, filesystem, bash, or Cordis path breaks, rather than accepting a fabricated result event.
- TUI visual regressions produce readable cell-and-style diffs, while JSONL fixtures retain the exact model chunks that made the production path execute.
- The emulator uses xterm's proposed buffer API. An xterm upgrade requires rerunning and reviewing the semantic projection; terminal-specific behavior still needs the PTY smoke.
- Expected outputs deliberately encode wrapping and viewport behavior at fixed sizes. Intentional layout changes use keyless refresh, while model-journey changes use record mode and review both JSONL and terminal diffs.
