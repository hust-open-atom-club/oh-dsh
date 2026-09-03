# Agent Note: Portal dialog close buttons clear the reserved titlebar row

Status: implemented

English | [中文](2026-08-31-portal-dialog-close-clears-titlebar.zh.md)

## Problem

Opening an image preview ("view original") in a session portals the pinned
DSH runtime's image lightbox to `document.body`. The lightbox is a bare
`role='dialog'` whose close control is a 36px circular `position: fixed`
button parked at `top: 20px; right: 20px` — geometry written for a plain
browser viewport with nothing reserved at the top. On macOS and Windows the
Desktop surface reserves a 40px in-page titlebar row and paints it as an
opaque `body::before` strip at `z-index: 2147483645`, far above the
lightbox's own `z-index: 1000`. The strip covered the button's upper half:
the lightbox looked broken, showing half a white circle with the bottom tips
of an ✕ below the menu row, and the click target shrank to the visible
sliver.

The lightbox backdrop is off-balance in the same band. It centers the image
with a symmetric 40px padding against the whole viewport, so on a platform
that reserves the row the image's top edge sits 40px (reserved) + 40px
(padding) from the screen top while its bottom keeps only the 40px padding
— the preview touches the strip above and floats below. Its image ceiling
has the same viewport-only assumption: `max-height: calc(100vh - 80px)`
accounts for padding that the reserved row invalidates. Linux keeps its
native frame and reserves nothing, and Web never loads the chrome
stylesheet, so neither surface can produce either defect.

## Decision

The Desktop chrome stylesheet restores the lightbox's gutter symmetry below
the reserved row on the platforms that reserve it: the backdrop starts at
the strip's edge and keeps upstream's own 40px gutter width on all four
sides — the strip replaces the top gutter the viewport used to provide —
the image ceiling shrinks by the row plus the gutters, and the close button
rides the gutter grid at its corner:

```css
html[data-oh-dsh-desktop-platform='darwin'] body > [role='dialog'][aria-modal='true'],
html[data-oh-dsh-desktop-platform='win32'] body > [role='dialog'][aria-modal='true'] {
  top: var(--oh-dsh-titlebar-height, 40px) !important;
  padding: 40px !important;
}

html[data-oh-dsh-desktop-platform='darwin'] body > [role='dialog'][aria-modal='true'] > img,
html[data-oh-dsh-desktop-platform='win32'] body > [role='dialog'][aria-modal='true'] > img {
  max-height: calc(100vh - var(--oh-dsh-titlebar-height, 40px) - 80px) !important;
}

html[data-oh-dsh-desktop-platform='darwin'] body > [role='dialog'][aria-modal='true'] > button,
html[data-oh-dsh-desktop-platform='win32'] body > [role='dialog'][aria-modal='true'] > button {
  top: calc(var(--oh-dsh-titlebar-height, 40px) + 8px) !important;
  right: 8px !important;
}
```

The selectors are contracts about document structure, not about names: a
`role='dialog'` that is a direct child of `body` (a portal overlay), with
its close button and image as direct children. The pinned runtime is
rebuilt with hashed CSS-module class names (`fNh4Da_close` today, something
else next release), so class selectors would break on every upstream
update. The rules are platform-scoped to darwin and win32 — the only
surfaces that reserve the row — so Linux and Web keep upstream's own
geometry untouched. They carry `!important` because the pinned runtime's
stylesheet is injected after the chrome sheet and would win ties at equal
specificity; `!important` already carries the dialog demotion rules in the
same sheet.

The backdrop keeps upstream's 40px gutter width instead of introducing a
new Oh-DSH gutter size: the frame the user sees is the same 40px on all
four sides upstream designed, just relocated into the region below the
strip, with the strip standing in for the top gutter. The `max-height`
ceiling (`100vh - titlebar - 80px`) tracks the smaller content region — the
80px is the two vertical gutters plus nothing else — so tall previews
cannot re-overflow behind the strip.

`body::before` and the menubar remain the single owners of the reserved
row: the overlay moves instead of the strip lowering its guard, because
window dragging, the merged menu row, and the window actions all live in
that band.

The DSH `Modal` primitive is deliberately unaffected: its close button sits
inside a `[role='presentation']` wrapper rather than directly under body,
so the structure selector misses it, and its centered layout never enters
the titlebar band.

## Alternatives considered

**Patch the pinned runtime package in `cordis.patch.yml`.** Rejected: a
patch pins one upstream version's stylesheet and must be re-derived on every
runtime bump, and the change would still be a CSS override — carrying it in
the surface that owns the titlebar reservation keeps one owner for the row.

**Key the rule on the runtime's class name (`fNh4Da_close`).** Rejected:
CSS-module hashes change per build, so the fix would silently die on the
next pinned update; structure is the only stable contract available.

**Scope by `data-oh-dsh-desktop` without the platform qualifier.** Rejected:
Linux keeps its native frame and Web loads no chrome stylesheet, so both
would take an 8px+40px offset for no reason, drifting the button off the
corner it is designed for.

**Push the lightbox under the strip by lowering `body::before`'s z-index or
making it non-opaque.** Rejected: the strip guards window dragging, the
merged menu row, and the Windows window actions; letting portal overlays
paint into that band reintroduces exactly the class of overlap the guard
exists to prevent.

**Fix it upstream in DSH** (a titlebar-strip compatibility mode like Better
Sidebar's). Right long-term home, but it does not help this surface until a
release pins the fixed runtime, and Oh-DSH still needs a desktop-side answer
for any pinned overlay that parks fixed chrome at the viewport top.

## Consequences

The titlebar reservation gains a standing exception-shaped rule: overlays
that portal a bare dialog to `body` are re-framed into the region below the
reserved row — upstream's own 40px gutters on every side, a shrunken image
ceiling, and the close button anchored to the gutter grid — on macOS and
Windows. The rules are deliberately narrow — direct-child structure only —
so future pinned overlays with different inner structure (a header wrapper
around the close button, an image nested in a stage element) will need the
pattern extended, and these selectors are the single place to do it. The
`!important` ties the chrome sheet's authority to the reservation: upstream
restyling the lightbox does not silently reclaim the band, though a future
upstream lightbox redesign that changes its gutter width will need the
literal here updated. The contract test below pins the rules themselves,
while the visual check stays manual because the affected geometry belongs
to the pinned runtime's release cadence.

## Testing

`tests/desktop-titlebar.test.ts` asserts the darwin/win32-scoped structure
selectors: the backdrop's `top` at the reserved row with `padding: 40px`,
the image ceiling `calc(100vh - titlebar - 80px)`, the close button's
`calc(titlebar + 8px)` offset with `right: 8px`, and it rejects the
unscoped desktop-wide variant. On a packaged Windows build, opening an
image lightbox in a session shows the preview framed by upstream's 40px
gutter on all four sides below the menu row, tall previews staying inside
that frame, and the circular close button fully visible in the top-right
gutter with the strip and window actions still clickable.
