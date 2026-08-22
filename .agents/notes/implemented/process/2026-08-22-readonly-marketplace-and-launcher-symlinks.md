# Agent Note: Read-only marketplace bridge and symlink-resolving launcher

Status: implemented

English | [中文](2026-08-22-readonly-marketplace-and-launcher-symlinks.zh.md)

## Problem

Two regressions reported against the packaged 0.1.7 release
(#115, #116):

1. Starting `ohdsh tui` while Desktop holds the `~/.ohdsh` runtime
   lock crashed the whole TUI: the launcher starts read-only surfaces
   with `OH_DSH_READ_ONLY=1`, `@oh-dsh/plugin-marketplace` returned
   early without providing `pluginMarketplace`, and
   `@oh-dsh/tui-marketplace` injects that service, so activation
   failed and took the plugin tree down.
2. The macOS install docs suggest `sudo ln -sf` of `bin/ohdsh` into
   `/usr/local/bin`, but the launcher computed its root from `$0`
   without resolving symlinks and reported the misleading
   "Oh-DSH is not built" from `/usr/local`.

## Decision

- Keep `pluginMarketplace` provided in read-only viewer mode. The
  transaction manager gains a `readOnly` option: construction no
  longer recreates preview and rollback directories, and every
  dispatch except `refresh` is refused with a snapshot-level error.
  `refresh` stays available because it only refreshes the catalog
  cache, so viewers can still browse the catalog and installed list.
- `bin/ohdsh` resolves `$0` through symlink chains with a POSIX
  `while [ -L ]` loop (macOS `readlink` has no `-f`) before computing
  the root, so a `/usr/local/bin` link finds the installed
  application layout.

## Consequences

- Read-only TUI and Web surfaces activate their full plugin tree and
  can browse the marketplace; every mutating transaction returns the
  read-only snapshot error instead of mutating the locked data root.
- The launcher works from any chain of relative or absolute symlinks
  on macOS, Linux, and Windows-equivalent `ohdsh.cmd` is unaffected
  (cmd resolves its own script path).
- Regression tests cover both: the read-only manager refuses
  transactions without writing (tests/plugin-marketplace.test.ts) and
  the launcher resolves a symlink against a staged runtime layout
  (tests/launcher-symlink.test.ts, skipped on Windows).

## Alternatives considered

- Make `tui-marketplace` tolerate a missing `pluginMarketplace`
  service: hides the marketplace from viewers and leaves the same
  trap for the next consumer; rejected in favor of the degraded
  service.
- Update the macOS docs to drop `ln -sf`: keeps the bug for every
  existing instruction on the web; the loop is six lines; rejected.
