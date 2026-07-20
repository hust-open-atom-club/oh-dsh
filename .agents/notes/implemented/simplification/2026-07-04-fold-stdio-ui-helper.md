# Agent Note: Fold the stdio UI helper into the stdio app

Status: implemented

The later [redundant-agent removal](2026-07-20-remove-stdio-and-echo-agents.md) supersedes this package-placement decision and removes the folded package, app, and line-oriented surface entirely.

## Problem

The readline UI was a whole package (`@deepseek-ai/dsh-ui-stdio` under `packages/support/`) whose only runtime importer was the app package `@deepseek-ai/dsh-stdio-demo`. The examples reach the readline UI by loading the app, never by composing the helper themselves; every other repo reference was mechanical or descriptive surface that existed BECAUSE the package boundary existed — manifest and tsconfig entries, generated module-graph rows, dependency-graph and README rows, and doc comments naming the package. The ui group README recorded the support placement rationale ("exists chiefly for the examples and the coverage gate — `ui/` is reserved for surfaces shipped as product"), which left a standing tension: a shipped product app depending on a support package documented as NOT product surface.

The boundary bought package metadata, workspace and tsconfig references, module-graph rows, README entries, and publint surface for a helper that is not independently swappable: the stdio app's front-door cluster always includes the readline UI, and nothing else can meaningfully consume it.

## Decision

The helper moved into the now-removed `@deepseek-ai/dsh-stdio` package as its terminal-channel plugin: `createStdioChat`, its `StdioRuntime` test seam, and the `stdio.spec.ts` and `readline.spec.ts` unit suites moved with it, so EOF handling, rendering, disposal, and piped-vs-TTY behavior stayed unit-covered under the per-file coverage gate without hijacking process globals. The module retained the named `name`/`inject`/`Config`/`apply` export shape consumed by the app's `ctx.plugin(uiStdio, …)` mount, while keyless Loader-path smokes proved the composed tree booted through the real Loader; the plugin-shape unit suite pinned the explicit `unwrapExports` assertion because a bundle without `inject` could otherwise boot past a stray default rather than crash.

The `packages/support/ui-stdio` package is gone: manifest, tsconfig references, module-graph rows, and README rows deleted; the doc comments that named the package (the example e2e module docs, `packages/README.md`, the support and todo READMEs, [the ui group README](../../../../packages/ui/README.md)) describe the in-package module.

## Alternatives considered

### Why not promote it to `ui/` instead?

Promotion would have resolved the support-vs-product mismatch while keeping the boundary — the right call only if the readline UI were an independently swappable integration or had a second composer, and the consumer census said neither. The structured ACP bridge stays its own package because it is the product protocol surface with its own contract and snapshot tiers; the readline helper is scaffolding for one app's front door. Re-extraction stays cheap pre-release: if a second product app wants the readline UI, split it back out then, with that consumer shaping the package contract.

## Consequences

- The stdio app owns its whole front door; a leaf `cordis.yml` still loads one app package and nothing changed shape for the demos.
- A future standalone terminal UI that wants the helper as a package reintroduces it with that second consumer, rather than the repo keeping a boundary for hypothetical reuse.
