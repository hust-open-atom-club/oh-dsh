# Agent Note: One-row desktop chrome via the Windows Window Controls Overlay

Status: implemented
Archived: 2026-08-26

English | [中文](2026-08-17-desktop-single-row-titlebar.zh.md)

## Problem

On Windows, the Desktop window stacked three horizontal chrome bands above the conversation: the native menu bar row, the native title-bar row, and the in-page 40px titlebar strip that `src/client.ts` paints for dragging (macOS already collapsed to one row with `titleBarStyle: 'hiddenInset'`). Users read the stack as three competing headers. Any fix had to keep the native caption buttons (minimize/maximize/close carry Windows snap layouts), keep the full application menu reachable, and keep the drag strip — without adding a second title-bar implementation or weakening the pinned-Upstream boundary that keeps `upstream/` untouched.

## Decision

Windows windows are created with `titleBarStyle: 'hidden'` plus `titleBarOverlay`, and `autoHideMenuBar: true` so the menu row no longer reserves a band (Alt still reveals the native menu bar; accelerators work because `Menu.setApplicationMenu` stays installed). The overlay's `height` is `Math.ceil(DESKTOP_TITLEBAR_HEIGHT * DEFAULT_UI_ZOOM_FACTOR)`: the overlay is declared in device-independent pixels while the strip measures CSS pixels under the 1.12 zoom factor, so rounding up keeps the caption buttons inside the strip at any zoom. `DESKTOP_TITLEBAR_HEIGHT` lives in `src/contracts.ts` so the main process and the client share one number instead of two constants that can drift.

The application menu is reachable without Alt: the client renders the menu's top-level labels (served over the bridge from the built `Menu`) as buttons inside the strip's left corner, and a click pops the corresponding native submenu anchored at the button. Only the labels cross the process boundary — `buildMenu()` remains the single owner of items, roles, and accelerators. The popup handler converts the button's CSS-pixel position to client-relative DIPs via the webContents zoom factor; on Windows `popup({x, y})` positions are client-relative, so adding window-origin offsets lands the menu mid-window (the bug the first cut shipped with and the live check caught).

The client strip now sizes itself from the overlay geometry instead of assuming its own height: `body` padding and the `::before` drag strip use `env(titlebar-area-height, var(--oh-dsh-titlebar-height))`, and `.oh-dsh-panel-toolbar` — the sidebar plugin's fixed panel buttons, which previously anchored 14px from the window edge and would sit under the caption buttons — shifts with `env(titlebar-area-x)`/`env(titlebar-area-width)` so it keeps its 14px clearance from the overlay's left edge. The menu bar itself is a drag-region sibling of the strip with `no-drag` button islands, filling the corner Windows leaves blank (macOS has traffic lights there). The `nativeTheme` `updated` handler re-calls `setTitleBarOverlay` so the overlay recolors with the window background on theme switches; non-overlay windows (splash/update) are skipped via the existing catch. macOS keeps `hiddenInset`; Linux keeps the plain frame — the merge…

## Alternatives considered

### Why not `frame: false` with fully custom caption buttons?

Drawing our own min/max/close in the strip would remove the Windows snap-layout flyout that hangs off the native maximize button and put OS button behavior (double-click maximize, aero snap, touch targets) in our hands forever. The Window Controls Overlay keeps all of that native; we only reserve the space.

### Why not keep the menu bar and hide only the title bar?

`titleBarStyle: 'hidden'` without `autoHideMenuBar` still leaves the menu bar row occupying its own band on Windows; the three-band stack survives with a hole where the title bar was. The user-visible ask was one row, so the menu must live inside it.

### Why not a full in-page menu (items rendered in the web layer)?

Rendering menu *items* in the web layer would fork the menu into a second UI the main process must drive over the command bridge, duplicating roles (`about`, `services`, `quit`) that `Menu.setApplicationMenu` already owns across surfaces, and it would re-style native menu behavior (checkboxes, accelerators, submenu nesting) forever. Rendering only the top-level *labels* and popping the native submenu keeps one owner; the web layer owns pixels, the main process owns the menu.

### Why not read the overlay height in the client instead of sharing the constant?

The env() variables only exist once the overlay is active; deriving the fallback from a second, client-side height constant is exactly the drift the shared `DESKTOP_TITLEBAR_HEIGHT` exists to prevent. The client still prefers `env()` when present, so the strip follows the real overlay even if Windows reports a different height.

## Consequences

Bought: one chrome row on Windows matching the macOS shape, native caption buttons and snap layouts intact, the menu visible in that row with native submenus, and a single height constant shared across the process boundary. Cost: the strip height now follows the overlay (45px at default zoom rather than a flat 40 CSS px — 5px more content offset), the toolbar sits 137px-plus-clearance from the right edge on default-width windows, and the menu bar's labels are plain text in the web layer — role-provided mnemonics and the native menubar's hover-to-open traversal do not carry over (click-to-open only; Alt reveals the full native bar when needed). The `nativeTheme` listener is win32-guarded and ignores non-overlay windows.

## Testing

`tests/desktop-titlebar.test.ts` pins the win32 window-shape branch, the macOS `hiddenInset` retention, the shared constant, the zoom-aware overlay height derivation, the strip/toolbar `env()` geometry, and the menu-bar contract: labels and popup on the bridge, `buildMenu()` as the single menu owner, zoom-factor coordinate conversion, and the win32-main-window-only mount with drag/no-drag regions. Live verification on Windows (CDP against a staged runtime under an isolated `OH_DSH_HOME`): `outerHeight - innerHeight = 8` (resize border only; the menu+title rows are gone), `titlebar-area-height = 45` equals the strip's 45px `padding-top`, the panel toolbar's right edge keeps 14px clearance from the overlay's left edge, and the menu bar renders all six top-level labels inside the strip (y 0–45, buttons no-drag) with the File submenu popping at the button after the client-relative coordinate fix (user-confirmed on the live window). The full `pnpm test`/`typecheck`/`build` chain passes on this machine except `tests/nix-collect-deps.test.ts`, which needs `python3` (absent here; fails identically on unmodified HEAD), and `scripts/smoke-runtime.mjs`, whose client…

## Related

The drag strip and dialog z-index layering this change builds on are owned by the desktop client chrome in `src/client.ts`; the panel toolbar belongs to the [workspace sidebar tool registry](2026-08-11-workspace-sidebar-order-and-folding.md).
