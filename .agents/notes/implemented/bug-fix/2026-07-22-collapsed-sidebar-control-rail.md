# Agent Note: A collapsed sidebar retains its control rail

Status: implemented

English | [中文](2026-07-22-collapsed-sidebar-control-rail.zh.md)

## Problem

The sidebar close action persisted a zero width preference, and the layout mapped that preference to a zero-width grid track. The only sidebar toggle and the settings entry both lived inside that clipped track, so closing the sidebar removed every visible recovery control. Reloading preserved the closed preference and reproduced the lockout.

## Decision

The layout maps a closed sidebar (persisted width `0`) to the fixed `SIDEBAR_COLLAPSED` width of 56px: a 24px icon column between the sidebar's 16px horizontal paddings. The compact rail participates in the concession solver and retains its right border, while the stored expanded width remains untouched.

`AppFrame` marks the sidebar collapsed from the persisted width preference rather than from the resolved track width, removes the resize handle while collapsed, and passes `collapsed` to the sidebar slot as owner props from the render site. Collapse and expand animate: the frame transitions `grid-template-columns` (and the remaining handle its `left`) on the deepsuite sider curve — `--ds-ease-in-out` over `--ds-transition-duration-slow`, both supplied by ui-theme's base sheet; transitions pause during drags and under `prefers-reduced-motion`.

`SidebarRoot` reads the owner `collapsed` prop and morphs in place rather than swapping renders: the four control rows persist into the rail — expand toggle, new session, new workspace, search, in the same top-down order as their expanded rows — animating their geometry (heights, paddings, margins, capsule borders) on the same curve, each aligned with its expanded counterpart's behavior (the search icon expands the sidebar and focuses the search box). Wide-only content (brand, labels, input, session tree) cross-fades out over 200ms, stays mounted while the collapse animates, and unmounts once the 300ms settle passes — dropping the sessions subscription and leaving the rendered and accessibility trees. The search query lives with the root and survives the round trip.

## Alternatives considered

- **Render an expand button over the center column** — rejected because it recovers only the toggle, not the persistent settings area, and splits sidebar chrome across two package owners.
- **Keep a zero-width grid track and let the rail overflow it** — rejected because the rail would overlap the center column and leave hit testing and responsive geometry disconnected from the grid.
- **Keep the complete sidebar tree mounted and hide it with clipping** — rejected because hidden controls remain in the semantic tree and continue subscribing and rendering even though only two controls belong in the collapsed state.

## Consequences

- A collapsed sidebar reserves 56px instead of yielding the entire width to the center column. Expanding restores the persisted width and drag behavior.
- The settings entry remains visible but retains its existing placeholder behavior; this change does not introduce an account or settings screen.
- Layout solver tests pin the compact width, sidebar component tests pin the visible controls, and the keyless real-bundle web smoke test pins collapse and recovery through the assembled client.
