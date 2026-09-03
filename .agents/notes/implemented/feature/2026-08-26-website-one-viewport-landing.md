# Agent Note: One-viewport landing layout

Status: implemented

English | [中文](2026-08-26-website-one-viewport-landing.zh.md)

## Problem

The landing page's hero carried viewport-relative minimum heights plus
large vertical paddings, and the product screenshot scaled with the
column width, so the page exceeded a typical laptop viewport and the
footer was only reachable by scrolling.

## Decision

The page shell is now a `min-height: 100vh` flex column: the header and
footer are non-shrinking rows, `main` fills the remaining height, and the
hero centers its two columns vertically inside it. The product frame
shrink-wraps its image and the image keeps its aspect ratio capped at
`min(60vh, 640px)`, so the screenshot never forces the page past the
viewport. Hero spacing is tightened, and a `max-height: 780px` media
query compacts the title, download button, and screenshot further on
short desktop screens. Mobile widths (≤820px) keep the scrollable
single-column flow unchanged.

## Alternatives considered

**`overflow: hidden` on the body.** Rejected because it silently clips
content on very short screens instead of degrading to scrolling.

**`object-fit: cover` on the screenshot.** Rejected because it crops the
UI screenshot's edges; the frame must show the whole image.

**Fixed pixel sizing for the hero.** Rejected because it abandons the
existing fluid design for wide screens instead of capping only the
height driver.

## Consequences

The landing fits one desktop viewport without scrolling from 1280×800 up
to 1920×1080, with the footer always visible; very short viewports fall
back to scrolling rather than clipping, and phones still scroll. The
screenshot scales by viewport height, so on wide-and-short windows it no
longer fills the whole hero column — the glow and shadow keep the visual
anchor while the grid gap centers the copy.

## Testing

Measured in a real browser at 1440×900, 1366×768, 1280×800, 1512×982,
and 1920×1080: `document.scrollHeight` equals `innerHeight` (no
scrollbar) at every size, and the footer community links sit at the
exact footer center (e.g. 720/720 px at 1440×900). The 390px mobile
layout still stacks and scrolls as before. Agent Note format,
classification, and translation-pairing gates pass.
