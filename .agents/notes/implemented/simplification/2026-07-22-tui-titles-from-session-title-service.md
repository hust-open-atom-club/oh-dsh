# Agent Note: TUI titles come from the session-title service

Status: implemented

English | [中文](2026-07-22-tui-titles-from-session-title-service.zh.md)

## Problem

Two model-title implementations coexisted after the tui-staging line merged onto master. The TUI carried its own `autoTitle` feature: a fire-and-forget `ctx.llm.stream` call after the first user message that set the terminal window title via OSC 0, with a one-shot latch, its own prompt, its own 40-character cap, and its own resume re-derivation ([auto-title Agent Note](../feature/2026-07-21-tui-auto-pane-title.md), [default-on Agent Note](../feature/2026-07-21-tui-auto-title-default-on.md)). Master had meanwhile landed [log-backed session titles](../feature/2026-07-21-log-backed-session-titles.md): a `sessionTitle` capability whose accepted revisions are durable `session/title` events, with a deterministic fallback and optional model providers. The TUI already consumed `session/title` for its header subtitle and window title, so a session could be titled twice by different strategies, and the TUI's process-local title was invisible to every other consumer (ACP, resume listings, forks).

## Decision

The TUI-local generation is removed; the session-title service is the one title source. `TuiConfig.autoTitle`, the latch, the abort controller, the title prompt, and `titleLine` are gone from `dsh-tui`. The terminal rename stays: the TUI folds the latest logged title on mount (`foldSessionTitle`), renders it as the banner subtitle, and sets the terminal window title to `<session title> — <configured title>` on every accepted `session/title` event — including resumed sessions, whose titles now replay from the log instead of being re-generated.

Model-made titles are a composition choice: `examples/tui-agent/cordis.yml` (and the scripted PTY fixture) mount `@deepseek-ai/dsh-session-title-first-message-llm`, which inherits the main request's route and replaces the spine's deterministic fallback with a short model summary. Deployments without the provider keep the fallback title from `dsh-agent-spine-demo`'s bundled `SessionTitleService`.

## Alternatives considered

**Keep both, letting the logged title win.** This was the first merge resolution: auto-title owned the whole window title until a logged `session/title` arrived in suffix form. It preserved behavior but doubled the model calls on every fresh session and left the TUI's title unobservable in the log, violating model-visible ⟺ logged in spirit and splitting the title contract across two owners.

**Port auto-title's prompt and cap into the service as a third provider.** The first-message-llm provider already exists with the same cadence, a reviewed prompt contract, durable request records, and supersession fencing; a second near-identical provider would be pure duplication.

## Consequences

One title pipeline: durable, replayable, visible to every consumer, and fenced against stale completions by the service. The TUI sheds ~90 lines and its `llm`-streaming path. The cost is that a title now requires the provider plugin in the composition for model quality — a leaf choice, not a TUI default — and the terminal title changes shape from the bare model summary to the suffixed `<title> — <product>` form the log-backed path always used. The superseded auto-title Agent Notes carry pointers here.
