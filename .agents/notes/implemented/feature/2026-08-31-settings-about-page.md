# Agent Note: Settings About page with injected version facts

Status: implemented

English | [中文](2026-08-31-settings-about-page.zh.md)

## Problem

Users could not see, inside Settings, which versions they were running: the
Oh-DSH product version, the pinned upstream DeepSeek Harness release
(`dsh-source.json`), the bundled plugin versions (`plugins/*/package.json`
plus the pinned upstream `dsh-context` and `dsh-auth`), or the key toolchain
dependencies. The native About dialog and menu item exposed almost nothing,
and the update flow lived only in the app menu's "Check for updates…" item
and the separate update window. Issue #178 asked for an About settings
section with this inventory and a self-upgrade entry point.

## Decision

A pure client plugin, `plugins/about` (`@oh-dsh/about`), registers one
`settings.section` entry (id `oh-dsh-about`, order 90, namespace
`oh-dsh.about`) on both the Desktop and Web composition layers. The section
renders a centered hero (brand mark, product name, subtitle, version badge),
a Runtime card with the pinned upstream DSH release and its npm package, a
Components card with two expandable rows (bundled plugins, key dependencies)
whose chevrons unfold version tables, a Software update card, and a footer
with GitHub and license links. All color comes from the DSH theme tokens
(`--dsw-alias-brand-primary`,
`--dsw-alias-state-success-*`, label/border/background aliases) so the page
follows the active theme and dark mode; only `var()` fallbacks carry literal
hex values.

Version facts never come from runtime file reads. `scripts/build.mjs` reads
the repository manifests at build time and injects four esbuild `define`
constants alongside the existing `__OH_DSH_BUILD_VERSION__`:
`__OH_DSH_SOURCE_VERSION__` and `__OH_DSH_SOURCE_PACKAGE__` (the pinned
upstream release's version and npm identity from `dsh-source.json`),
`__OH_DSH_PLUGIN_VERSIONS__` (each `plugins/*/package.json` plus the pinned
upstream submodule manifests, sorted), and `__OH_DSH_DEPENDENCY_VERSIONS__`
(electron, electron-updater, semver from the root manifest).
`plugins/about/src/client/versions.ts` declares these constants and parses
them defensively. A missing submodule checkout only drops its About row; it
never fails the build.

Desktop-only update entry reuses the existing main-process seam through one
new sender-checked IPC channel: `desktop:open-updater` verifies the sender
is the main window and calls the existing `openUpdateWindow()`. (The About
update card itself has since moved to its own inline channels; see
[inline update flow](2026-09-02-about-inline-update-flow.md).) External
links ride the existing `openExternal` bridge and fall back to
`window.open` on Web, and the section adds no config-folder button — the
settings shell already owns that action. On Web, `window.dshDesktop` is
absent, so the update card is not rendered while the hero, version cards,
and footer links remain.

## Alternatives considered

**Expose the full `DesktopUpdateBridge` to the main-window renderer** so the
About page could show live update state and download progress inline.
Rejected: it widens the trusted IPC surface (either by relaxing the
`assertUpdateWindowSender` gate or duplicating the channels for a second
sender), and it duplicates the update window's entire state presentation for
marginal UX gain. The window already renders checking/not-available/
download/install states bilingually.

**Read versions at runtime from repository or staged files** (scan
`node_modules`, parse `dsh-source.json` from disk). Rejected: the packaged
app ships no repository layout, so every surface would need its own file
discovery path, and a missing or moved file would blank part of the page.
Build-time injection is total: the client bundle carries the facts, and the
web distribution has no filesystem to depend on.

**Read submodule revisions with `git describe` at build time** to mirror
`THIRD_PARTY_NOTICES.md` commit pins. Deferred: it makes the build depend on
a full git checkout (shallow CI checkouts and source tarballs would fail or
fall back), and the package manifests inside the submodules already carry
authoritative versions for the two upstream plugins.

**Ship the About page as part of an existing plugin** (sidebar or
desktop-frame). Rejected: sections are feature-owned by contract; a
cross-cutting version inventory is its own feature, and mounting it
independently keeps the composition layers free to drop it.

## Consequences

- The About inventory is frozen at build time: a running install shows the
  versions it was built with, not live package-manager state. That is the
  desired honesty for a packaged distribution, but anyone mutating
  `node_modules` after install sees stale labels.
- Adding a bundled plugin or bumping a key dependency updates the About page
  on the next build with no code change; adding a *new kind* of version fact
  (for example a submodule revision) requires extending
  `aboutVersionDefines` and the plugin's props.
- One new main-window IPC exists (`desktop:open-updater`), sender-checked
  like its marketplace siblings; the update window's isolation is intact.
  (The About page has since gained its own inline update channels with a
  closed command set; `desktop:open-updater` remains for legacy callers.)
- Tests pin the contract: `tests/about-page.test.ts` guards the section
  registration, the four injected defines, the update IPC,
  theme-token-driven styling, and both composition layers;
  `tests/stage-runtime-lib.test.ts` and `scripts/smoke-web.mjs` carry the
  new package through the surface manifests, and `scripts/smoke-runtime.mjs`
  exercises the plugin end to end through `BUNDLED_DESKTOP_CLIENT_PLUGINS`.
- TUI remains out of scope: its banner already prints the runtime version,
  and its settings mechanism is the upstream adapter system, not the browser
  slot graph.

## Testing

- `pnpm run typecheck`, `pnpm test` (the pre-existing Windows symlink-EPERM
  failures in `tests/stage-runtime-lib.test.ts` and `tests/tui-install.test.ts`
  reproduce identically on a clean checkout), `pnpm run build`,
  `pnpm run smoke:runtime`, and `pnpm run smoke:web` all pass with the
  plugin active on both surfaces.
