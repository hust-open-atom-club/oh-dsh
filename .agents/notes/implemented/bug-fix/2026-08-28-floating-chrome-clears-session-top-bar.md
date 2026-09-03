# Agent Note: Floating chrome clears the session top bar on framed desktops

Status: implemented

English | [中文](2026-08-28-floating-chrome-clears-session-top-bar.zh.md)

## Problem

The desktop panel toolbar (pinned summary, terminal, side panel) is a floating
element fixed at `top: 5px; right: 14px` with the maximum z-index. macOS and
Windows reserve an in-page title bar row on `<body>`, so their content starts
below it. Framed platforms (Linux) keep the native window title bar and reserve
nothing, so the conversation column starts at y=0 — and its top bar parks a
`Session log` control (111px wide, inset 28px) in exactly the corner the
toolbar occupies. The toolbar covered it: an active session could not reach its
own session log button, and the toolbar's hit area silently swallowed the
click.

## Decision

`desktop-frame` publishes two facts about its own layout on the root element,
because floating chrome is mounted outside the frame and can only read them
from there:

- `--oh-dsh-details-width` — the current width of the session details column,
  `0px` when collapsed.
- `data-oh-dsh-session-active` — present while a non-blank session is current,
  which is exactly when the conversation top bar renders its controls.

The side tools panel publishes a third fact the same way —
`--oh-dsh-workspace-panel-inset`, the panel's width plus its distance from the
right edge, `0px` while it is closed — and marks
`data-oh-dsh-side-panel-maximized` when it is maximized. The toolbar **owns the
corner**; its `right` only steps aside for whatever squeezes the conversation
column:

```css
min(
  max(
    14px,
    calc(
      8px
      + var(--oh-dsh-details-width, 0px)
      + var(--oh-dsh-workspace-panel-inset, 0px)
    )
  ),
  calc(100vw - 460px)
)
```

The session top bar's utilities — the `Session log` control — are the ones that
move: on framed platforms they stand down by
`--oh-dsh-toolbar-clearance: 89px`, which is the toolbar's footprint (95px
body + 14px inset + 8px gap = 117px) minus the top bar's own 28px right
padding, so the button ends up visually 8px clear of the toolbar. The utilities
are reached through the stable slot contract —
`[data-slot='conversation.session.header'] :has(> [data-slot='conversation.session.header.utilities'])`
— never through the hashed CSS-module classes around them, and only while a
session is active and the side panel is not maximized.

Vertical placement is part of the same contract: while a session is active the
toolbar sits at `top: 11px` with 28px buttons, matching the `Session log`
button's height and center line instead of hovering half a row above it.

A maximized side panel owns the top row end to end, so the toolbar drops to the
bottom-right corner instead of hanging in the middle of the panel, and the
utilities' clearance is lifted — nothing sits in that corner anymore. The
toolbar stays visible and clickable, because the panel header carries back,
close-tab, and close controls but no restore control of its own.

The pinned-summary panel takes the details-width term only; it already sits
below the top bar, and it is mutually exclusive with the side tools panel.
macOS and Windows keep their own `right` overrides and skip the clearance:
their title bar row makes the collision impossible, and moving anything there
would only drift the toolbar off the corner.

Measured on Linux at a 1282px viewport. With a session open the toolbar spans
1173..1268 (the corner) and `Session log` sits at 1054..1165 — an 8px gap,
both centred on y=28, with no interactive element anywhere under the toolbar.
Opening the side tools panel (480px wide) moves both left together: `Session
log` to 574..685, the toolbar to 699..794 — a 14px gap (the toolbar's inset
relative to the squeezed column differs by 6px between the two states; both
read as ordinary control spacing). Maximizing the panel docks the toolbar at
1173..1268 / y=765 and restores `Session log` to its natural corner position.
Opening the details column shifts the toolbar and the utilities together, so
the gap stays constant.

## Alternatives considered

**Reserve a chrome row inside the frame on framed platforms.** Built first and
rejected: Linux already renders the native window title bar, so a 40px empty
row reads as wasted space rather than as chrome. It was the visually worst
option and was reverted.

**Drop the toolbar below the conversation top bar (`top: 52px`).** Rejected
because it floats over conversation content instead of the window edge, and it
collides with the pinned-summary panel, which opens at `top: 48px`.

**Move the toolbar to another corner.** Rejected because the bottom edge
belongs to the terminal panel and the composer, and because a panel control
strip belongs at the window's top edge on every platform.

**Pad the upstream top bar so `Session log` moves left.** Rejected because the
element lives inside an upstream CSS-module tree; a selector tuned to hashed
class names breaks on every upstream release.

**Apply the inset unconditionally.** Rejected because no session means no
`Session log` control, and a permanently inset toolbar would hover away from
the corner for no visible reason.

**Combine the insets with `max()` instead of adding them.** Built and rejected:
the side panel does not cover the conversation column, it squeezes it, so
`Session log` travels left with it. Taking the maximum cleared the panel but
landed the toolbar on `Session log` again, 81px of overlap.

**Keep the top-right inset while the panel is maximized.** Rejected as the
original defect: the panel is then as wide as the viewport, `Session log` is
squeezed to x=96, and the `min()` cap parks the toolbar at 359..460 — dead
centre of the panel, which is exactly what the first report described.

**Move the toolbar and let `Session log` keep the corner.** Built and shipped
in the first iteration, then reversed on feedback: the corner reads as the
toolbar's natural home, and the swapped layout keeps the two controls on one
line with a stable gap. The current decision moves the utilities instead, which
also keeps the toolbar's position independent of the upstream control's exact
width.

**Hide the toolbar while the panel is maximized.** Rejected because the panel
header exposes back, close-tab, and close but no restore control, and the
maximized state survives closing the panel: hiding the only toggle would strand
the user in a maximized panel.

**Read the panel's width from the layout store.** Rejected because the panel is
maximized and styled by CSS, so only the mounted element knows its real
footprint; a `ResizeObserver` on that element stays correct through drags,
maximize, and viewport changes.

## Consequences

Three small contracts now connect the frame and the side tools panel to the
floating chrome: two CSS custom properties, two root attributes, and the
`max()` / `min()` composition on the toolbar plus the clearance rule on the
utilities slot. The toolbar owns its corner and reads no layout state of its
own, so `sidebar` stays decoupled from the frame's store and the panel's width.
The 89px clearance is an agreement with the upstream top bar's layout — 117px
of toolbar footprint minus 28px of the top bar's own padding — with the same
fragility the earlier 139px inset had: if the upstream geometry changes, the
variable is the single place to update, and the slot-based selector survives
rebuilds. The panel's footprint is measured at runtime, so resize and maximize
need no extra plumbing. Tests in `tests/desktop-titlebar.test.ts` pin the
published values, the clearance rule, the vertical alignment, and the composed
`right` rule, so a silent regression fails the suite instead of the user's next
click.
