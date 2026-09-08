# Agent Note: marketplace bundle builds pin pnpm's hoisted layout

Status: implemented

English | [中文](2026-09-07-marketplace-bundle-hoisted-layout.zh.md)

## Problem

Installing the marketplace plugin `dsh-web-tools` on Windows failed with
`DSH runtime exited before readiness (code=1, signal=null)`. The preview
runtime's log showed the real error: the plugin entry imported `linkedom`
from its managed source directory and Node resolved
`ERR_MODULE_NOT_FOUND`. The dependencies had been installed minutes
earlier — by the marketplace bundle build — but did not survive the trip
from the build directory into the applied profile.

The marketplace transaction builds a scripted plugin checkout in a
disposable `bundle-builds/` directory (`pnpm install` plus only the
reviewed lifecycle scripts), then `renameSync`s the finished tree into
the profile's `.oh-dsh/sources/`. On Windows, pnpm's default isolated
layout links every installed package with an absolute junction into the
checkout's own `node_modules/.pnpm` tree. A directory rename rewrites the
path of the tree itself but not the junction targets inside it, so every
link dangles after the move and the plugin boots with no dependencies.

Worse, pinning `--config.node-linker=hoisted` on the install command
alone was not enough: pnpm's hoisted install materializes real
directories, but the subsequent `pnpm run prepack` re-reads
`.modules.yaml`, sees no linker override, and rebuilds the top-level
entries as absolute junctions again — reintroducing the failure right
before the rename.

## Decision

Every pnpm invocation in `ProductionMarketplacePlatform.buildBundle` —
the `install` and each reviewed lifecycle `run` — now passes
`--config.node-linker=hoisted`. The hoisted layout writes plain
directories inside the checkout, which travel with the tree across the
rename on every platform. This is the same layout dsh profiles
(`pnpm-workspace.yaml` `nodeLinker: hoisted`) and Windows package
staging (`installWindowsPackageDependencies`) already use, so third-party
bundles land in the dependency topology the rest of the runtime expects.

## Alternatives considered

**Copy instead of rename.** `cpSync` dereferences Windows junctions into
real directories, and a copy kept resolution working in a probe. It was
rejected because it doubles I/O for every install, and it silently
depends on copy semantics that differ per platform (`dereference` is not
the default everywhere) — the linker flag fixes the cause instead of
papering over one symptom.

**Rewrite junction targets after the move.** Rejected: patching
`.modules.yaml` and every link means reimplementing pnpm's layout logic
in the marketplace host, with per-platform symlink rules, for a problem
the package manager already knows how to avoid.

**Require plugin authors to ship a `pnpm-workspace.yaml`.** Rejected:
the marketplace catalog cannot police third-party repo layout, and the
failure was ours — the rename is Oh-DSH's own transaction step.

## Consequences

Scripted bundle installs keep the same disk footprint as the default
isolated layout: pnpm hard-links package files from the store under both
linkers, so hoisted's top-level entries are hard links rather than copies.
The preview-scoped `.pnpm-store` keeps the download cache local to the
transaction either way. Plugins whose build scripts
themselves run `pnpm install` without the flag (or `npm ci`) can still
rebuild their `node_modules` into a layout that dangles after the rename;
that is now a plugin bug rather than a marketplace default, and the
regression test catches the marketplace-side contract.
`tests/plugin-marketplace.test.ts` pins the behavior end to end: build a
fixture with a dependency, run a lifecycle script, rename the tree, and
require that the dependency still resolves.

## Testing

`pnpm test` runs the new regression on all platforms; on Windows it
exercises the actual junction semantics that used to break. Verified
against the real plugin: previewing and applying `dsh-web-tools` from the
Desktop marketplace now boots the preview runtime (`dsh web:` readiness
line), and the applied profile's source tree resolves `linkedom`.
