# Agent Note: Bundle dsh-context as the built-in context insight plugin

Status: implemented

English | [中文](2026-08-25-bundle-dsh-context.zh.md)

## Problem

Issue #136 asked for unified context capacity/remaining statistics across the
surfaces. The DSH composer's context ring is the only built-in signal; richer
insight required each user to find and install the third-party `dsh-context`
npm plugin themselves. Oh-DSH needed a bundling policy for an external plugin
that already ships a complete DSH plugin build of its own.

## Decision

- Pin the upstream as `upstream/dsh-context` at release tag `v0.31.1`, like
  the other pinned sources; `.gitmodules` tracks `main`, the gitlink pins the
  tag. The pin-and-consume-published-artifacts shape extends the
  [upstream surface extension seams](../../architecture/2026-08-18-upstream-surface-extension-seams.md)
  decision; unlike Better Sidebar and dsh-TUI, nothing is adapted or
  transformed. Updates move the pointer deliberately — never npm latest at install
  time.
- Build the plugin inside the submodule with the upstream's own tsdown
  configuration (`scripts/ensure-upstream-context.mjs`, stamp-guarded like
  dsh-TUI's compile). Both `make upstream` and `pnpm run build` invoke it, so
  every staging path — the dist:* chains and the CI runtime job that never
  run make — produces `upstream/dsh-context/lib` before staging. Stage the
  prebuilt `lib/` under the upstream npm name `dsh-context` from the upstream
  manifest — the dsh-TUI staging precedent, not a `plugins/` adapter. The
  host stays an unmodified plain Cordis plugin; the browser half is the
  upstream's own `window.__ModuleLoader__` bundle, so the panel and the
  `/context` command behave exactly as published.
- Mount on Desktop and Web via insert rows in the root and `web/`
  `cordis.patch.yml`; list in `BUNDLED_DESKTOP_CLIENT_PLUGINS` so the runtime
  snapshot and the smoke suites assert the client graph enrollment. TUI is
  excluded: the plugin is built around interactive panels and the upstream
  maintainer does not target TUI.
- The Nix assembly substitutes the plugin's npm release tarball
  (`upstream/dsh-context` from registry.npmjs.org, same pattern as the TUI
  renderer) instead of building in the sandbox; the shared runtime assembler
  (`installDesktopPackages` in `scripts/stage-runtime-lib.mjs`) enrolls it
  for the full and web surfaces from the repository-shaped staging root's
  `upstream/dsh-context` tree, keeping the upstream `lib/` layout. The build helper treats a checkout
  without git metadata and with a prebuilt `lib/index.js` as nothing to do.
- Host imports (`@deepseek-ai/dsh-session`, `dsh-settings`,
  `@deepseek-ai/schemastery`, `zod`) resolve through the staged runtime's
  hoisted tree; no adapter manifest or dependency mirroring is introduced.
  Because of that, the Windows dependency deploy now runs only for manifests
  with runtime `dependencies`/`optionalDependencies` — a peers-only upstream
  package is outside the pnpm workspace, so the deploy filter could never
  match it.
- The `dist:*` package scripts now stage with their matching `--surface`
  selector (desktop/web/tui). They previously staged `all`, which would have
  shipped the Desktop/Web-only dsh-context inside TUI release archives — and
  had always bundled foreign-surface packages into every distribution. The
  all-surface runtime bundle of `runtime-release.yml` keeps staging `all` by
  design.

## Alternatives considered

**Follow npm latest, as the upstream author suggested.** Rejected: it makes
the shipped plugin unreviewable and unfixable per release, and contradicts
the repository's pinned-source rule and release-only update policy. The pin
still upgrades through reviewed PRs.

**Adapt the source into `plugins/dsh-context` like dsh-vision.** Rejected:
dsh-context is not a seam Oh-DSH needs to rewrite — it is a self-contained
plugin with its own build; an adapted copy would fork the panel for no
architectural gain and double the upgrade work.

**Manifest-only `plugins/` adapter like better-sidebar-runtime.** Rejected:
that adapter exists because Oh-DSH compiles the upstream host itself with
repo-controlled externals. dsh-context builds itself correctly; a duplicate
manifest would only drift from the upstream version.

**Include TUI.** Rejected per the issue discussion: the value is the
interactive dashboard; the upstream explicitly does not target TUI.

## Consequences

- Desktop and Web users get the Context panel and `/context` out of the box;
  the panel coexists with the composer context ring (same facts, independent
  tab).
- `scripts/ensure-upstream-context.mjs` performs the build: it runs the
  submodule's install and build through the manifest-pinned pnpm
  (`pnpm dlx pnpm@<packageManager pin>`, currently 11.9.0) with
  `--ignore-workspace`, because ambient pnpm ≥ 11.20 abort on the pin — the
  scoped `@pnpm/exe` packages never published 11.9-line releases, so their
  engine-identity delegation cannot be verified. The completion stamp lives
  under `.cache/` (staging wipes `.stage/`, which would force a rebuild every
  cycle); reproduce manually with
  `pnpm --dir upstream/dsh-context dlx 'pnpm@11.9.0' run build` after the
  matching install.
- `tests/plugin-collection.test.ts` resolves `dsh-context` from the submodule
  manifest; every future built-in plugin staged from an upstream manifest
  extends that mapping.
- The pinned DSH runtime must keep providing the plugin's host imports
  (zod, scoped schemastery/cordis peers) — a runtime upgrade that drops them
  breaks staging loudly at smoke time, not silently.
