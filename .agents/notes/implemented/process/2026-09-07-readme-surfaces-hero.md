# Agent Note: Three-surface composite hero in the README

Status: implemented

English | [中文](2026-09-07-readme-surfaces-hero.zh.md)

## Problem

The README hero was a single Desktop screenshot. Oh-DSH presents one runtime
through three surfaces — Desktop, Web, and TUI — so the repository's entry
image showed one surface and read as if Desktop were the whole product. A
flat screenshot also carried none of the skin accent colors that distinguish
the surfaces elsewhere in the product.

## Decision

Both README language sides embed `assets/oh-dsh-surfaces.svg` as the hero:
an animated, self-contained SVG composing three overlapping, slightly
tilted window cards over a deep-navy backdrop with a grid, glow ellipses,
and the whale brand mark as a watermark ghost.

- The three panels are real surface captures, not drawn mock UI: the
  Desktop card reuses the existing Desktop screenshot asset, the Web card
  shows the Web welcome page capture inside a drawn browser shell whose
  address pill reads `127.0.0.1:3080`, and the TUI card shows a real TUI
  capture inside a drawn terminal titlebar.
- Card accents mirror the skin identities: cyan for Web, brand blue for
  Desktop, jade green for TUI. They are literals in the asset, not imports
  from `@oh-dsh/skins`, because the SVG ships outside any bundle.
- The watermark uses the near-black whale mark from `assets/dsh-whale.png`
  lifted by an SVG `feComponentTransfer` filter; the blue `assets/icon.svg`
  remains the application icon and is not the hero brand mark.
- Animation is CSS inside the SVG (floating cards, pulsing glows) with a
  `prefers-reduced-motion` fallback and an identity first frame, so static
  renderers degrade gracefully. GitHub serves the hero through `<img>`,
  where external references are blocked, so all panels are base64-embedded
  and the file has no external dependencies.

The website download page and the GitHub social preview deliberately keep
the previous Desktop render for now. The website hero expects
transparent-background art that blends into its page frame, which the
composite — with its own dark rounded backdrop — cannot provide without a
separate transparent variant; the social preview additionally requires a
manual repository-settings upload.

The SVG is committed as the source of truth; its generator pipeline (panel
capture, cropping, and composition scripts) lives in the producing agent
workflow and is not part of the repository.

## Alternatives considered

**Keep the single Desktop screenshot.** No work and no new asset, but the
entry image continues to misrepresent the three-surface story the README
tells in text.

**A static PNG composite.** Simpler pipeline and no animation concerns, but
a raster blurs at README `width="100%"` scaling, loses the motion that
makes the stack feel alive, and cannot degrade by preference.

**An SVG referencing external panel files.** Keeps the SVG small, but
GitHub's `<img>` context blocks external references inside SVG images, so
the hero would render empty panels on GitHub.

**Drawn mock panels instead of real captures.** Full visual control and
crisper at small sizes, but the panels would drift from the real surfaces
and re-introduce the credibility problem the hero exists to fix.

**Switch the website and social preview in the same change.** One visual
identity everywhere at once, but both need work this change does not
include — a transparent-background variant for the site frame and a manual
settings upload — so the README moves first and alone.

## Consequences

- The hero is ~600 KB because the panels are embedded; the README gains
  one asset request and the panels age with the surfaces: the hero shows
  TUI v0.1.11 and the current Web welcome page, and should be recaptured
  when surface visuals change materially.
- Readers on reduced-motion settings or static contexts see the same
  composition as a still frame; nothing in the README depends on the
  animation running.
- The website download page and social preview remain on the single
  Desktop render until the transparent variant lands and the preview is
  uploaded, so the three surfaces appear inconsistently across entry
  points in the interim.
