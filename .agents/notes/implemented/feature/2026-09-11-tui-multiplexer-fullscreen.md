# Agent Note: Default the TUI to the alternate screen inside multiplexers

Status: implemented

English | [中文](2026-09-11-tui-multiplexer-fullscreen.zh.md)

## Problem

The user runs the installed `ohdsh tui` (0.2.1, dsh-TUI beta.4) inside
zellij and the inline rendering collapses: the composer and status line
pin to the TOP of the pane while streamed frames anchor above the prompt
and crawl upward ("老是从下往上跑"). The inline renderer positions each
frame relative to the prompt cursor using cursor/size probes, and a
multiplexed pane answers those probes differently from a plain terminal,
so the frame anchoring inverts. Neither dsh-TUI beta.4 nor v0.10.0 has
any multiplexer handling; the fullscreen default is deliberately unset
upstream and falls through to the launcher-owned
`OH_DSH_TUI_FULLSCREEN`, so the choice belongs to the Oh-DSH launcher.

## Decision

`parseTuiArgs` in `src/tui.ts` defaults `fullscreen` to true when the
environment shows a multiplexer — `ZELLIJ`/`ZELLIJ_SESSION_NAME`/`TMUX`
set, or `TERM` starting with `screen`/`tmux`/`zellij` — and keeps the
plain-terminal inline default otherwise. The alternate screen sidesteps
the inline anchoring entirely. Precedence is unchanged: an explicit
`--fullscreen`/`--inline` flag or `DSH_OH_TUI_FULLSCREEN` always wins
over the new default. The `--help` text states both defaults.

## Consequences

- tmux/zellij/screen users get a correctly laid-out TUI with no flags;
  scrolling happens inside the alternate screen instead of the host
  scrollback, which is the standard trade for multiplexer sessions.
- A multiplexer tab switch can still leave stale stacked frames when the
  pane returns: while hidden, the pane's queued writes replay and the
  renderer's frame anchor can desync from the physical screen (observed
  under zellij on v0.10.0; upstream family: dsh-TUI#490). The renderer's
  built-in recovery is Ctrl+L (`redraw` action → `forceRedraw()`), which
  clears the physical screen and repaints atomically; usage docs state it
  beside the multiplexer default. Root-cause fix belongs upstream.
- `--inline` remains available for users who want scrollback inside a
  multiplexer and accept the anchoring quirks.
- The fix ships with the release carrying it; the installed 0.2.1 keeps
  the old behavior until upgraded.

## Alternatives considered

- **Patch the inline renderer's probe handling for multiplexers.**
  Rejected: the anchoring lives in the pinned upstream ink fork across
  several seams; multiplexer cursor-report emulation differs per host
  and is fragile to keep adapting downstream.
- **Flip the global default to fullscreen.** Rejected: inline scrollback
  in a plain terminal is the documented Oh-DSH default and works there;
  only multiplexed panes misbehave.

## Testing

`tests/tui.test.ts` covers the default matrix: plain env → inline;
`ZELLIJ`, `TMUX`, and `TERM=screen-256color` → fullscreen; explicit
`--inline` and `DSH_OH_TUI_FULLSCREEN=0` still win under `ZELLIJ=1`;
`TERM=xterm-256color` stays inline. Full suite and typecheck pass.
