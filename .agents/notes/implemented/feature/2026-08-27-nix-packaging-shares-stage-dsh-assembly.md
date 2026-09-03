# Agent Note: Nix packaging shares the stage-dsh runtime assembly

Status: implemented

English | [中文](2026-08-27-nix-packaging-shares-stage-dsh-assembly.zh.md)

## Problem

`nix/oh-dsh.nix` assembled the packaged runtime through a parallel pipeline —
`register-plugins.py` (hardcoded plugin directories and per-surface sets),
`collect-deps.py`, hand-rolled pnpm staging, and a hand-merged runtime
dependency manifest — duplicating the layout logic of `scripts/stage-dsh.mjs`.
The two sources of truth drifted: desktop-frame, tui-marketplace, and
plugin-marketplace were missing from the Nix registry; pnpm was not staged at
`node-runtime/lib/node_modules/pnpm`; `/dev/null` was absent from Landlock
argv. Every official staging change had to be re-implemented in Python and
shell.

## Decision

Extract the runtime-staging operations from `stage-dsh.mjs` into
`scripts/stage-runtime-lib.mjs`. `createStageRuntime(context)` closes over
the staging context (`root`, `stage`, `runtime`, `nodeRuntime`,
`dshSource`, platform flags, `npmRelease`, `run`, `adapters`) and
exports the same functions the release pipeline calls — `installDesktopPackages`,
the compiled/host dependency installers, `alignBetterSidebarPtyDependency`,
`exposeHoistedPackages`, `recordExposedDependencies`,
`ensureLinuxLandlockLauncher`, `ensureLinuxPtyBuild`,
`stagePnpmIntoNodeRuntime`, `restoreExecutableHelpers`,
`pruneRuntimeDevelopmentFiles`, `assertSelfContained` — plus
`SURFACE_PACKAGE_NAMES` as the single surface-package manifest and small CLI
subcommands (`install-packages`, `stage-pnpm`,
`restore-executable-helpers`) for offline consumers.

`stage-dsh.mjs` keeps only network acquisition (Node download, DSH npm
tarball, pnpm install/deploy), pruning, and smokes; every layout decision
delegates to the factory.

Nix consumes the same factory. The bundle derivation overlays the workspace
tree with the published release trees (dsh-TUI renderer including its bundled
compiled `@dsh-std` node_modules, dsh-auth, dsh-context) into a
repository-shaped staging root, copies the selected DSH runtime source, and
runs `install-packages --release-graph` plus `restore-executable-helpers`.
The final derivation stages pnpm through `stage-pnpm` and runs a
`SURFACE_PACKAGE_NAMES` parity guardrail that fails the build when a surface
package is missing. `register-plugins.py` and `collect-deps.py` are
deleted; the final derivation references the whole `scripts/` tree so the
assembler's relative imports resolve from the store copy.

One deliberate divergence from the extracted code: `runtimeDependencyTarget`
guards the `.pnpm` store scan with `existsSync()` so flat runtimes (no
pnpm store) fail with the descriptive error instead of `ENOENT`.

## Alternatives considered

**Run `stage-dsh.mjs` verbatim in Nix.** Rejected: top-level side effects and
`curl` downloads of Node and the DSH tarball cannot run inside the offline
Nix sandbox.

**Keep `register-plugins.py` and add a parity test only.** Rejected: leaves
two sources of truth for the surface layout; drift returns on the next plugin
addition.

**Ship the workspace `node_modules` into the final derivation.** Rejected:
roughly a gigabyte of extra store closure; bundle-level assembly adds only one
runtime copy instead.

## Consequences

- Desktop plugin lists, the pnpm layout, Landlock argv, dependency wiring
  (package-local `.oh-dsh-store` copies, runtime graph for host
  dependencies), and the profile-fallback dependency manifest now have one
  implementation shared by the release pipeline and Nix; the Nix build fails
  closed on parity drift.
- Nix assembly no longer needs `python3`; `collect-deps.py`'s transitive
  closure copying is replaced by `installCompiledPackageDependencies`.
- `tests/stage-runtime-lib.test.ts` replaces `tests/nix-register-plugins.test.ts`
  and `tests/nix-collect-deps.test.ts`; `tests/landlock-launcher.test.ts`,
  `tests/settings-boundary.test.ts`, `tests/liangshen.test.ts`, and
  `tests/stage-surface.test.ts` now pin the shared assembler.
- The renderer's private `dsh-auth` dependency comes from the shared
  dependency installer instead of the extra-deps copy loop; see
  2026-08-26-bundle-dsh-auth. This note partially supersedes the Nix mechanism
  sections of 2026-08-24-cross-surface-liangshen-preset,
  2026-08-25-bundle-dsh-context, and 2026-08-26-bundle-dsh-auth; their
  surface-membership decisions remain active.
- Verification: CI typecheck, `node --test` (only the sandbox-limited
  `install-sh` tests fail), and `pnpm run build` pass; a dev-machine
  `install-packages --release-graph` smoke over a raw llm-agents runtime
  copy reports no missing surface packages; the Nix package builds
  (`oh-dsh-desktop-0.1.10`) and the assembled runtime passes the parity
  guardrail, stages pnpm 11.21.0 at the published path, carries the compiled
  renderer entry (`lib/types/index.js`), keeps the sidebar's dependency store
  package-local, and boots under the Landlock launcher (0.1.0-rc.7).
