# Agent Note: A collapsed sidebar retains its control rail

Status: implemented

English | [中文](2026-07-22-collapsed-sidebar-control-rail.zh.md)

## Problem

The sidebar close action persisted `open: false`, and the layout mapped that preference to a zero-width grid track. The only sidebar toggle and the settings entry both lived inside that clipped track, so closing the sidebar removed every visible recovery control. Reloading preserved the closed preference and reproduced the lockout.

## Decision

The layout maps a closed sidebar to the fixed `SIDEBAR_COLLAPSED` width of 60px: one 28px icon control between the sidebar's 16px horizontal paddings. The compact rail participates in the concession solver and retains its right border, while the stored expanded width remains untouched.

`AppFrame` marks the sidebar collapsed from the persisted `open` preference rather than from a zero resolved width. It keeps the sidebar slot mounted but removes the resize handle while collapsed.

`SidebarRoot` subscribes to the derived open boolean. Its collapsed render removes the brand, creation controls, search, and session tree from the rendered and accessibility trees; the top control changes to `Expand sidebar`, and the bottom `Settings` control remains in the rail.

## Alternatives considered

- **Render an expand button over the center column** — rejected because it recovers only the toggle, not the persistent settings area, and splits sidebar chrome across two package owners.
- **Keep a zero-width grid track and let the rail overflow it** — rejected because the rail would overlap the center column and leave hit testing and responsive geometry disconnected from the grid.
- **Keep the complete sidebar tree mounted and hide it with clipping** — rejected because hidden controls remain in the semantic tree and continue subscribing and rendering even though only two controls belong in the collapsed state.

## Consequences

- A collapsed sidebar reserves 60px instead of yielding the entire width to the center column. Expanding restores the persisted width and drag behavior.
- The settings entry remains visible but retains its existing placeholder behavior; this change does not introduce an account or settings screen.
- Layout solver tests pin the compact width, sidebar component tests pin the visible controls, and the keyless real-bundle web smoke test pins collapse and recovery through the assembled client.
