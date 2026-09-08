# Agent Note: npm/npx launchers forward onto the bundled pnpm

Status: implemented

English | [中文](2026-09-07-npm-pnpm-forwarding-shims.zh.md)

## Problem

Installing a third-party marketplace plugin whose lifecycle script calls
npm (`prepack: "npm run build"`) failed with
`Cannot find module '...\node-runtime\node_modules\npm\bin\npm-prefix.js'`
and `...\npm-cli.js`. The staged node runtime deliberately ships pnpm only:
`pruneNodeRuntime` removes `node_modules/npm`, and `ensureNodeRuntime`
stages the workspace pnpm beside it. But on Windows the official Node zip
places the `npm`/`npx`/`corepack` launchers at the distribution **root**
(next to `node.exe`), not in `bin/` like POSIX — the prune pass only cleaned
`bin/`, so the stock `npm.cmd` shims survived while the npm package they
point at was deleted.

The host process makes this the first `npm` on PATH: `runtimeSearchPath`
puts the node-runtime directory first for marketplace bundle builds, so a
plugin's `npm run build` resolves the dangling shim instead of failing
cleanly or finding a system npm. End-user machines without a system Node
have no fallback at all.

## Decision

The bundled runtime gains npm compatibility launchers that forward onto the
staged pnpm, so the default answer to "can everything just use pnpm?" is
yes — plugin authors do not need to change their npm-based scripts.

- `scripts/stage-runtime-lib.mjs` gains `stageNpmForwardingShims()` and a
  `stage-npm-shims` CLI subcommand (consumed by `nix/oh-dsh.nix`). It writes
  a self-contained `npm-forward.mjs` beside the staged pnpm and installs
  `npm`/`npx` launchers: `.cmd` + `.ps1` at the runtime root on Windows,
  shell launchers in `bin/` on POSIX. The forwarder embeds the library's
  `translateNpmInvocation` source verbatim via `Function.toString()`, so the
  tested translation is the shipped translation — the function must stay
  free of module-scope references.
- `translateNpmInvocation` maps only invocations with a faithful pnpm
  spelling: `run`/`install`/`test`/`exec`/`publish`/etc. pass through,
  `ci` becomes `install --frozen-lockfile`, `i`/`t`/`uninstall`/`rm`/
  `run-script` expand to their long forms, `npx ...` becomes
  `pnpm exec ...` (dropping npm-only `-y`), and `--prefix` becomes
  `--dir`. Anything else exits 1 with guidance to rewrite the script to
  call pnpm directly.
- `pruneNodeRuntime` in `scripts/stage-dsh.mjs` now also deletes the
  Windows root-level `npm`/`npx`/`corepack` launchers (`''`/`.cmd`/`.ps1`
  variants plus `install_tools.bat`) and the `corepack` module directories
  on all platforms, then calls `stageNpmForwardingShims()` so the forwarding
  launchers replace the stock ones after pruning.

## Alternatives considered

**Delete npm cleanly and require plugin authors to write pnpm.** Rejected:
the ecosystem overwhelmingly scripts lifecycle builds against npm; without
a forwarder every `prepack: "npm run build"` plugin fails on machines
without a system Node, and the marketplace catalog cannot police
third-party scripts.

**Stage a real npm distribution beside pnpm.** Rejected: doubles the
packaged runtime, needs its own update/security cadence, and reintroduces
a second package manager into a runtime whose whole design pins one.

**Shim inside the marketplace host (`platform.ts`) by rewriting PATH.**
Rejected: the failure is not marketplace-specific — any spawned lifecycle
script resolves `npm` through the node-runtime PATH entry — and fixing it
at staging time covers every consumer (Desktop, Web, TUI, Nix) once.

## Consequences

`npm`/`npx` on a packaged Oh-DSH runtime now mean "pnpm with npm-style
invocation translation". The passthrough table is deliberately small:
npm-specific subcommands (`config`, `dist-tag`, ...) fail with an actionable
message rather than silently diverging, so plugin authors hitting them get
told to switch to pnpm instead of debugging behavioral drift. Unsupported
npm semantics of translated subcommands (flag differences beyond
`--prefix`) pass through verbatim and may surface as pnpm errors. The
forwarder's embedded translation function is a structural contract: any
future edit must keep it self-contained, which
`tests/npm-forward.test.ts` guards alongside the translation table, the
launcher contents on both layouts, and the replacement of a dangling stock
`npm.cmd`.

## Testing

`tests/npm-forward.test.ts` covers the translation table (passthrough,
`ci`, aliases, `npx`, `--prefix` before and after the subcommand, unknown
subcommand errors), the staged launcher files and contents for the Windows
and POSIX layouts, and that the embedded forwarder matches the exported
function with no module-scope references. End-to-end, a fixture package
with `prepack: "npm run build"` builds successfully through the staged
runtime with the node-runtime directory first on PATH — the exact
resolution order of a marketplace bundle build.
