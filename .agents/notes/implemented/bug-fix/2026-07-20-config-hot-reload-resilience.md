# Agent Note: A config hot-reload must not kill or degrade a live app

Status: implemented

English | [中文](2026-07-20-config-hot-reload-resilience.zh.md)

## Problem

The demo apps mount `@cordisjs/plugin-hmr` as a leaf so a running agent picks up `cordis.yml` edits. One bad edit killed the process: `Include.refresh()` rethrew the YAML parse error, the HMR watcher awaits `refresh()` inside an async chokidar callback nobody catches, and the resulting unhandled rejection tripped `dsh-app-boot`'s fail-loud handler — `exit(1)` mid-session, losing the live TUI. Two adjacent defects made even *valid* reloads wrong: a file that parses to `undefined` (empty or mid-write truncated — editors and `sed -i` routinely produce these states) crashed the entry walk instead of reading as invalid, and a re-read never re-applied the include's `config.patches`, so any hot-reload of an overlay-based tree (Code Mode, personal overlays) silently reverted patched entries and removed inserted ones.

## Decision

Harden the vendored `@cordisjs/plugin-include` (logged as local modification 8 in [vendor/README.md](../../../../vendor/README.md)) rather than the callers:

- `refresh()` awaits the whole read-and-update and catches failures, logs a warning, and keeps the last good entry tree. A hot-reload is advisory; the invariant is that no file state reachable by an editor may take the process down.
- `read()` rejects a non-array parse result with a `TypeError`, folding the `undefined`-parse case into the same "invalid file" signal, and commits `content`/`data` only after a successful parse — so reverting an edit to the exact last good content correctly reads as "unchanged".
- `refresh()` and the `internal/update` listener apply `this.applyPatches(...)` before `root.update()`, restoring parity with `[Service.init]`. `applyPatches` deep-copies the cached parse (`structuredClone`) instead of mutating it, so repeated application converges and removing a patch reverts to the file's own values. The listener uses the incoming config's `patches` and persists that config itself: it vetoes the fiber restart (children update in place), and `Fiber.update` only assigns `this.config` behind `next()`, so without the explicit assignment the next re-read would re-apply the old overlay.

Boot-time behavior stays fail-loud and gets a sharper diagnostic: `[Service.init]` falls back to `initial` (or "config file not found") only on `ENOENT`; an existing-but-invalid file now fails with its real parse error instead of being mislabelled as absent or silently overwritten by `initial`.

## Alternatives considered

**Catch in the HMR watcher callback instead of `refresh()`.** Rejected: it would leave `refresh()` a trap for every other caller (the `internal/update` path shares the same tree-update logic), and it cannot fix the `undefined`-parse or patch-loss defects, which live inside the include.

**Filter config-file rejections in `installFailLoud`.** Rejected: the fail-loud handler exists to make late load failures visible; teaching it to classify exceptions by origin would silently swallow genuine boot failures and leave the stale-`data` crash in place.

**A PTY e2e proving the TUI survives a bad edit.** Rejected as the primary gate: the PTY smoke reads the repo's committed `cordis.yml`, so corrupting it in-place is not test-safe, and a temp copy cannot resolve the tree's bare package specifiers. The unit spec drives the exact `refresh()` entry point the watcher calls; the fix was additionally verified manually against the live TUI (bad YAML, empty file, restored file).

## Consequences

- A bad `cordis.yml` edit now logs `ignoring config reload at <file>` and the agent keeps running on the last good tree; the next valid edit applies normally. With no logger exporter mounted in the TUI demos the warning is currently invisible on screen — surfacing loader warnings in the TUI is deferred.
- Overlay trees survive base-file reloads with patches intact instead of silently reverting to the unpatched base.
- The vendored include diverges further from upstream; the divergence is logged in the vendor manifest and re-applies on the next sync.
- Known gap, out of scope here: the HMR watcher only handles chokidar `change` events, so editors that replace the file by rename (BSD `sed -i`, `git checkout`) do not trigger a config reload at all; and a reloaded app-entry config does not visibly restart the running TUI (pre-existing on the unmodified tree).

## Testing

`packages/ui/app-boot/tests/config-reload.spec.ts` boots real Loader trees against temp configs and pins: an invalid-YAML edit and an empty-file edit both resolve `refresh()` without rejection and keep the previous entry config; a subsequent valid edit applies; an overlay tree re-applies both entry patches and inserted entries on re-read; a hot-update of the include entry's own `patches` applies immediately, survives the next file re-read, and reverts cleanly when the patches are removed. The assertions fail on the unpatched vendored include.
