# Agent Note: Fold the stdio UI helper into the stdio app

Status: implemented

The later [redundant-agent removal](2026-07-20-remove-stdio-and-echo-agents.md) supersedes this package-placement decision and removes the folded package, app, and line-oriented surface entirely.

## Problem

The readline UI was a whole package (`@deepseek-ai/dsh-ui-stdio` under `packages/support/`) whose only runtime importer was the app package `@deepseek-ai/dsh-stdio-demo`. The examples reach the readline UI by loading the app, never by composing the helper themselves; every other repo reference was mechanical or descriptive surface that existed BECAUSE the package boundary existed — manifest and tsconfig entries, generated module-graph rows, dependency-graph and README rows, and doc comments naming the package. The ui group README recorded the support placement rationale ("exists chiefly for the examples and the coverage gate — `ui/` is reserved for surfaces shipped as product"), which left a standing tension: a shipped product app depending on a support package documented as NOT product surface.

The boundary bought package metadata, workspace and tsconfig references, module-graph rows, README entries, and publint surface for a helper that is not independently swappable: the stdio app's front-door cluster always includes the readline UI, and nothing else can meaningfully consume it.

## Decision

The helper lives in `@deepseek-ai/dsh-stdio` as the terminal-channel plugin (`packages/ui/stdio/src/index.ts`): `createStdioChat`, its `StdioRuntime` test seam, and its unit tests (`packages/ui/stdio/tests/stdio.spec.ts`, `readline.spec.ts`) moved with it, so EOF handling, rendering, disposal, and piped-vs-TTY behavior stay unit-covered under the per-file coverage gate without hijacking process globals. The module keeps the named `name`/`inject`/`Config`/`apply` export shape — the contract the app's `ctx.plugin(uiStdio, …)` mount consumes — and the keyless Loader-path smokes in `examples/echo-agent` and `examples/repl-agent` keep proving the composed tree boots through the real Loader (the stdio package's plugin-shape unit suite pins the explicit `unwrapExports` assertion, since a bundle without `inject` would boot past a stray default rather than crash).

The `packages/support/ui-stdio` package is gone: manifest, tsconfig references, module-graph rows, and README rows deleted; the doc comments that named the package (the example e2e module docs, `packages/README.md`, the support and todo READMEs, [the ui group README](../../../../packages/ui/README.md)) describe the in-package module.

## Alternatives considered

### Why not promote it to `ui/` instead?

Promotion would have resolved the support-vs-product mismatch while keeping the boundary — the right call only if the readline UI were an independently swappable integration or had a second composer, and the consumer census said neither. The structured ACP bridge stays its own package because it is the product protocol surface with its own contract and snapshot tiers; the readline helper is scaffolding for one app's front door. Re-extraction stays cheap pre-release: if a second product app wants the readline UI, split it back out then, with that consumer shaping the package contract.

## Consequences

- The stdio app owns its whole front door; a leaf `cordis.yml` still loads one app package and nothing changed shape for the demos.
- A future standalone terminal UI that wants the helper as a package reintroduces it with that second consumer, rather than the repo keeping a boundary for hypothetical reuse.
