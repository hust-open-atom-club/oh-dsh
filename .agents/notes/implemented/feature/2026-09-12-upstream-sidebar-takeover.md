# Agent Note: Upstream sidebar takeover

Status: implemented

English | [中文](2026-09-12-upstream-sidebar-takeover.zh.md)

## Problem

Oh-DSH maintained a parallel workspace-tools stack: our own file explorer,
file viewers, git review panel, and browser view inside a private panel
system, next to the runtime's native right-sidebar dock — two panel systems
side by side. The pinned upstream DSH-better-sidebar v0.19 had already
aligned with DSH 0.1.5 (its tabs register as native right-sidebar tab
types; only its bottom workbench stays plugin-owned), while we shipped only
its host half and re-implemented a simpler client of our own.

## Decision

Ship the upstream plugin whole and retire our parallel views; Oh-DSH keeps
the theme and UI finish, upstream keeps the feature surface.

- `upstream/DSH-better-sidebar` joins the pnpm workspace; `scripts/build.mjs`
  runs its own tsdown build (host ESM, browser client, lazy chunk scripts)
  and staging copies its `lib/` wholesale, exactly like dsh-context. The
  former host-only `@oh-dsh/better-sidebar-runtime` package is deleted —
  one npm name (`dsh-better-sidebar`) carries both halves, and the
  chunk-serving `/sidebar/bundle` route finds its scripts next to the host
  module again.
- The staging spec owns the host closure the pinned manifest cannot declare
  (node-pty/schemastery/ws resolve from the source tree; the
  @deepseek-ai/dsh-settings/dsh-tools peers resolve from the staged runtime).
- Our `@oh-dsh/sidebar` retires its review/files/file/browser tab
  registrations and all four simple viewers; `openReview/openBrowser/
  openBrowserUrl/openFile/openFiles` now route through the native
  `sidebarRight` controller (`openTab('changes'/'browser'/'files')`,
  `openResource(dsh-resource://file/…)`) with the same pending-queue
  contract the upstream surface follows.
- Two real 0.1.5 contract fixes fell out: session starts live on the
  `uiWorkspace` service (the bare `workspaces` controller has no
  `startSession`), and `layout.beginNavigation()` must return a real
  `AbortSignal` (`AbortSignal.any` in uiWorkspace and the upstream fork).

## Alternatives considered

- Registering OUR components as native tab types (the original plan):
  keeps us maintaining a review/files/browser implementation forever.
- Bundling the upstream client with our esbuild pipeline: would replicate
  its module-loader banner, CSS modules, and chunk factory conventions —
  exactly the maintenance the takeover removes.
- Keeping the host-only split and staging a second client-only package:
  the host include walker imports every runtime dependency's `main`, so a
  mainless client package cannot ride along; one whole package is the
  layout the runtime's loader actually supports.

## Consequences

- The CodeMirror editor, rich git lens, subagent/jobs views, side chats,
  and the embedded browser arrive for free and stay upstream-maintained;
  document preview (pdf.js) comes from the native runtime packages.
- Our commit-review-comments feature loses its UI with the review panel
  (the service goes with it); if wanted again it returns as a native tab,
  not a private panel.
- The workspace lockfile grew the upstream build's dependency closure
  (codemirror, mermaid, xterm, …); the recorded refresh round landed the
  new fetchPnpmDeps hash, and the nix bundle source now stages the
  plugin's manifest, built lib/, and node_modules links alongside the
  other published-release overlays — both pinned builds verified green.
- The upstream bottom workbench toggle now appears in the session header
  next to the native expand control, and Oh-DSH's floating panel toolbar
  is retired with it: the corner belongs to the native controls, and the
  pinned summary, side panel, and bottom panel stay reachable through the
  application menu entries and their shortcuts. Retiring our bottom
  terminal drawer is the remaining follow-up once the dock proves out in
  daily use.
