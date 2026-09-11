# Agent Note: Codex-style finish layer and macOS edge-to-edge chrome

Status: implemented

English | [中文](2026-09-11-codex-finish-layer.zh.md)

## Problem

The desktop surface kept its 0.1.2-era chrome: a filled in-page titlebar
strip with a 1px divider, a 1px window border, a bordered sidebar, and
outline-style buttons. The user asked for the ChatGPT desktop (Codex)
texture instead — separation by luminance, layered soft elevation,
continuous corners, and a clean top edge — on both Web and Desktop.

## Decision

The reference design system was extracted from the locally installed
ChatGPT.app `app.asar` (its `webview/assets/*.css` carries the full token
set) rather than eyeballed from screenshots:

- `corner-shape: superellipse(1.5)` with a 1.25× radius scale behind an
  `@supports` gate, radius ladder 2xs–4xl on a 0.25rem grid.
- Elevation tokens: a 0.5–1px stroke ring plus two diffuse layers; the
  composer stack is ChatGPT's own `0 0 0 1px #0000000a, 0 2px 8px
  #0000000a, 0 4px 80px 8px #00000006`.
- Neutral gray surfaces separated by luminance steps, never borders.
- Motion `cubic-bezier(0.2, 0.8, 0.2, 1)`.

`plugins/skins/src/client/finish.css` (injected by the skins client plugin
on every surface) owns the layer: finish tokens, sidebar-row squircles,
borderless sidebar buttons, the composer elevation, and popover panel
shadows. It only addresses structural hooks the runtime commits to
(`[data-slot]`, `[data-composer-card]`), never hashed CSS-module classes.
Each skin now pins `--dsw-specific-sidebar-fill` one step off the canvas
and a lifted active row (white pill on light skins), replacing the
same-color fill that made borders mandatory.

The macOS window follows ChatGPT's own primary-window recipe from the
same asar: `titleBarStyle: 'hiddenInset'` + `vibrancy: 'menu'` +
`acceptFirstMouse: true`. The in-page titlebar strip, its divider, and
the window border are gone; the frame columns reserve the 40px chrome row
internally so the sidebar tint runs to the window edge under the floating
traffic lights. Windows keeps its framed in-page titlebar unchanged.
`DEFAULT_UI_ZOOM_FACTOR` drops from 1.12 to 1: fractional device scale
shimmered every 1px hairline into dashed fragments — the artifact the
user reported as a dashed composer border.

The desktop frame proportions tighten (sidebar 280→260px default,
rightbar default 360→420px), the sidebar loses its border-right, and the
right column floats on a hairline plus a diffuse left shadow.

## Alternatives rejected

- Styling hashed runtime classes (`hHd-Xa_*`, `uV2eYG_*`): silently
  breaks on every runtime pin bump; structural hooks survive.
- `titleBarStyle: 'hidden'` without vibrancy: macOS still paints the
  native titlebar material over the content when inactive.
- Keeping 1.12 zoom and dropping the ring layers: the rings are integral
  to the reference look; integer scale fixes the root cause.

## Consequences

- Both Web and Desktop receive the finish through the skins plugin they
  already load; surface adapters keep rendering ownership per the
  architecture rules.
- Users who preferred larger default UI must zoom explicitly (the
  previous 1.12 default was arbitrary, not an accessibility contract).
- The skins test now asserts the ladder (sidebar fill ≠ canvas, pinned
  hover/active rows) instead of fill === canvas.
- ChatGPT.app's asar was read locally as a design reference only; no
  assets or code were copied into the repository.
