# Agent Note: Sidebar update entry — a DOM-anchored desktop-only plugin

Status: implemented

English | [中文](2026-09-04-sidebar-update-entry.zh.md)

## Problem

In Oh-DSH Desktop the only entry into the update flow is the application menu's
"Check for Updates…" item, which opens the update window; there is no in-shell
affordance, so a remote update is easy to miss. The issue asks for a
download/update button immediately left of the sidebar's "Collapse sidebar"
toggle, visible in both the expanded and the 56px rail states.

The left sidebar shell (brand row + collapse toggle + New Session) is rendered
by the pinned upstream `@deepseek-ai/dsh-client-ui-sidebar` `SidebarRoot`
([root frame v21 note](../architecture/2026-08-18-desktop-root-frame-v21.md)
owns why the desktop replaces the upstream layout with `desktop-frame`).
`SidebarRoot` declares no slot inside its logo row — only
`sidebar.brand.mark/name`, `sidebar.workspaces`, `sidebar.settings`, and
`sidebar.footer.action` — and `upstream/` is pinned and must not be edited.
The rail is also only 36px of content wide and stocks exactly one 36x36
control per row, so a second icon cannot share the logo row with the collapse
toggle.

## Decision

Ship a new desktop-only plugin, `plugins/update-button`
(`@oh-dsh/update-button`), following the one-capability-per-plugin
convention (precedent: `plugin-marketplace` registers components into the
upstream shell's declared `sidebar.footer.action` hole).

- **Composition.** Enabled only in the desktop profile: inserted as
  `oh-update-button` in the root `cordis.patch.yml`, added to
  `SURFACE_PACKAGE_NAMES.desktop` and the staged-plugin directories in
  `scripts/stage-runtime-lib.mjs`, to `BUNDLED_DESKTOP_CLIENT_PLUGINS` in
  `src/profile.ts`, to the build and stage artifact lists
  (`scripts/build.mjs`, `scripts/stage-dsh.mjs`), and to the
  stage-runtime-lib test fixture. The web surface intentionally excludes it
  (the browser surface has no update window).
- **Placement.** Two independent, unrelated icon instances, one per fold
  state (loaded, never relocated). Wide: a 28px download control inside the
  logo row immediately left of the collapse toggle, loaded only once the
  brand button exists so it never lands in front of the logo. Collapsed: a
  36px download control in its own row directly below the whale (like the
  upstream New Session row; the 36px rail fits one control per row).
  Visibility follows the frame's `data-sidebar-collapsed` attribute through
  CSS. On a live collapse the wide instance leaves the row at once (an
  off-layout clone fades out in its place, matching the row's 150ms fade) and
  the rail instance slides in on the upstream `.railIn` rhythm (150ms delay +
  150ms slide from `translateX(49px)`). A narrow order guard moves the wide
  host back between brand and collapse only when a brand remount left it at
  the row head. Earlier revisions (single relocating host, hide-and-reveal
  timing, footer-action slot) were replaced by this design per maintainer
  feedback; per-seat icon artwork was unified on the download glyph.
- **Action.** Click calls `DesktopBridge.openUpdater()`, which opens the
  existing update window; the window always starts `manager.check()`, so the
  existing check → download → install flow is reused with no new IPC.
- **Presentation.** The hover/focus bubble mirrors the upstream primitives
  `Tooltip` tokens and geometry (13px, `--dsw-alias-tooltip-bg`, static label
  ink, right side, 150ms fade; hover 500ms, focus immediate). Copy is
  localized through the plugin's own `oh-dsh.update-button` locale dictionary.

## Alternatives considered

- **Editing pinned `upstream/` to add a logo-row slot.** Rejected:
  `upstream/` is pinned source; Oh-DSH adapts upstream behavior in `plugins/`
  instead.
- **Registering into an existing upstream slot.** Rejected: none of the
  declared holes sits next to the collapse toggle (`footer.action` is at the
  sidebar foot).
- **Copying the whole `ui-sidebar` shell to add one slot.** Rejected: high
  maintenance cost tracking the pinned npm release.
- **Keeping the entry inside `plugins/desktop-frame`.** Rejected after the
  first implementation: chrome responsibilities belong to a dedicated
  capability plugin (moved per maintainer direction).

## Consequences

- The upstream `SidebarRoot` DOM shape is an implicit dependency; the locator
  guards by shape (trailing control row containing a button, never the last
  row of its column) and bails silently when the structure drifts.
- A foreign node inside a React-managed row needs load-time placement and an
  order guard (never a continuous re-seater); the rail geometry rule (one
  36x36 control per row) must not be violated; the logo-row instance is
  wide-only content and must be out of the row before the rail layout forms.
- Update-state rendering ships with the entry and is purely snapshot-driven
  through `DesktopBridge.aboutUpdate` (state push + initial snapshot): the
  icons are hidden for idle / not-available / checking / error, show a red
  badge on available / downloading / downloaded, and surface an
  `unsupported` manager (dev / non-packaged runs and unsupported platforms)
  as a badge-free visible entry — reachable without claiming an update is
  installable. There is no dev simulation: no shortcut, no localStorage
  override, so packaged and dev runs follow the same code path and nothing
  can leak a testing affordance into a release build.
