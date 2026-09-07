# Agent Note: Sidebar update rail reveals entries created after the collapse

Status: implemented

English | [中文](2026-09-06-sidebar-update-rail-late-reveal.zh.md)

## Problem

The desktop update entry ([sidebar update entry note](../feature/2026-09-04-sidebar-update-entry.md)) renders two React instances — a wide control in the logo row and a rail control below the whale — and only the rail shows while the frame carries `data-sidebar-collapsed`. Its CSS keeps the collapsed rail button painted at `opacity: 0` so a live fold commit can never flash it. Both reveal paths were tied to the moment a button already existed: `onFold()` adds the slide-in entry class during a live collapse, and the mount path could only see a button React had already rendered. An entry that materializes after the fold — an update check completing from About or the update window while the sidebar stays collapsed — matches neither: React creates the button only when the UI state leaves `hidden`, after `onFold()` has run, so the entry stays at the CSS `opacity: 0` until the user expands and collapses the sidebar again.

## Decision

`mountEntry` already re-runs `load()` on every DOM mutation the observer sees, and every rail-button birth is such a mutation. A new `revealRailEntry()` runs at the end of every `load()` and, whenever the frame is collapsed, gives an unrevealed rail button the same one-shot slide-in as a live fold: it clears any leftover inline style so the entrance always starts from the CSS `opacity: 0` base, then schedules the `rail-enter` class on the same 0 ms timer `onFold()` uses. The class animation's delay plus `forwards` fill hides the entry briefly, slides it in once from the rail-right edge, and keeps it visible. Reveal never paints the entry in place first, so the entrance cannot read as a drop followed by a slide when a fold is in flight, and it cannot double a live fold — both schedule the same class, and adding an already-present class is a no-op. The collapsed state is read from the frame attribute rather than the `prevCollapsed` transition tracker, so a frame that mounts already collapsed is covered even before the tracker ever observed a fold. The racy mount-time inline override is deleted; the next live fold still restarts the slide-in through `onFold()`, which clears the class on expand so each collapse re-enters cleanly.

## Alternatives considered

Showing a late entry statically in place (the first fix attempt): the button pops into its row instantly, and whenever a live-fold slide-in overlaps that moment the two motions compound — an in-place appearance followed by the rail slide — with no shared entrance language across the rail rows. Making the collapsed rail always visible in CSS would remove the `opacity: 0` default that guarantees a fold commit never flashes the icon. Keeping the reveal keyed to `prevCollapsed` instead of reading the attribute would miss entries born before the first fold record — a whole frame mounting already collapsed.

## Consequences

A check completing while the sidebar is collapsed now enters the button exactly once, with the same railIn motion the other rail controls use on a fold — no abrupt in-place pop, and nothing can overlap it with a second animation. The reveal is idempotent and only ever runs on loads triggered by actual DOM changes, so steady state costs nothing. A cold/late mount now animates like a fold entry instead of appearing statically: while the sidebar is already collapsed the icon shows about 150 ms after birth, sliding in from the rail-right edge, rather than instantly.
