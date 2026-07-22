# Agent Note: TSC-first build and one compiler ownership

Status: implemented

> Root project topology (which tsconfig owns which graph) has since moved to a solution root over two aggregate programs; see the [solution-root note](2026-07-22-tsconfig-solution-root-two-aggregates.md). The tsc-first pipeline decided here is unchanged.

## Problem

The current TypeScript build and typecheck setup had these issues:

- `build` used `tsc` to transform `.ts` to `.d.ts` files for packages under `packages/<group>/<pkg>` and `vendor/*`, and then used `tsdown` to transform `.ts` to bundled `.js` files. This made two tools do TypeScript transform.
- `typecheck` tended to validate packages, vendor source, examples, tests, and scripts through one root typecheck config.

The goal is to make build and typecheck use matching tsconfig boundaries and TypeScript resolution/transform behavior. Build should generate `.js`, `.d.ts`, `.js.map`, and `.d.ts.map` through one compiler and config, so publish output and type validation stay consistent.

Validation found several concrete technical issues and possible routes:

- `tsdown` uses `oxc` to transform TypeScript, which is not the same behavior as `tsc`.
    - Bundled `.d.ts` emitted by `tsdown` conflicts with Cordis' internal relative module augmentation shape.
    - The tsc output is affected by `allowImportingTsExtensions`, so we need to ensure that generated `.js` files do not import `.ts` files and generated `.d.ts` files keep explicit relative specifiers that NodeNext/Node16 accepts. Therefore, in-package relative imports use explicit `.ts` specifiers in TypeScript source and `rewriteRelativeImportExtensions` rewrites those specifiers to `.js` in emitted JS.
    - Bundled `.js` emitted by `tsdown` is not the same behavior as per-file `.js` emitted by `tsc -b`, such as decorator transform behavior.
- `vendor/*/src`, examples, tests, and scripts cannot all be plain-included in one root strict program.
    - Directly typechecking `vendor/*/src` under the root strict config triggers many type errors outside this project's ownership.
    - Package dependencies under `packages/*/*` on `vendor` are resolved to the `vendor/*/lib` for different tsconfig strictness.


## Decision

In-package relative imports use explicit `.ts` specifiers.

`pnpm run build` is a two-stage build:

- Stage 1: `tsc -b` over the root solution emits per-module `.js`, declarations `.d.ts`, JS sourcemaps `.js.map`, and declaration sourcemaps `.d.ts.map` into each package's `lib/types`. This is the authoritative TypeScript compilation result. For publish we keep `.d.ts` / `.d.ts.map` and ignore `.js` / `.js.map`.
    - The graph is the project-reference graph reachable from the root solution `tsconfig.json` through the two aggregates ([topology](2026-07-22-tsconfig-solution-root-two-aggregates.md)). It validates and emits package/vendor build results.
- Stage 2: a bundler reads the emitted JS under `lib/types` and writes the bundled runtime entry as `lib/index.js` or `lib/index.mjs` (follow current behavior). This stage is bundling only. It must not read TypeScript source or emit declarations.

`tsdown` is no longer the owner of TypeScript compilation or declaration output.

`pnpm run typecheck` runs the same `tsc -b` graph.
- The aggregates (`tsconfig.host.json`, `tsconfig.client.json`) typecheck examples, tests, and scripts with `noEmit`, and validate package/vendor source through references.
- Referenced package/vendor projects keep the same emit behavior as build, so typecheck refreshes their `lib/types` outputs instead of using a separate no-emit graph. Project-specific strictness changes live in the owning `packages/*/*/tsconfig.json` or `vendor/*/tsconfig.json`.
- The no-emit aggregates disable `rewriteRelativeImportExtensions`; they emit nothing and include tests that import helpers across project-reference boundaries. Package/vendor emit projects keep the rewrite enabled.

The command orchestration shape is:

```sh
pnpm run build:
tsc -b
tsdown

pnpm run verify-node-next-types:
tsx scripts/verify-node-next-types.ts

pnpm run typecheck:
tsc -b
```

`pnpm run demo:*` still runs `src` directly through tsx and root paths, without a compile step.

## Alternatives considered

- **Keep `tsdown`/oxc as the TypeScript transformer** — oxc's transform is not `tsc` behavior (decorator transform differs, bundled JS differs from per-file emit), and its bundled `.d.ts` conflicts with Cordis' internal relative module augmentation shape.
- **One root strict program over packages, vendor, examples, tests, and scripts** — vendor source triggers type errors outside this project's ownership under the root strict flags; project references with per-project strictness are the boundary that works.

## Consequences

Build responsibilities are clearer:

- Each module under `packages/<group>/<pkg>` and `vendor/*` has one local tsconfig for build, typecheck, and tools that run source directly, such as `tsx` and `vitest`.
- The `build` command drives the root solution graph. `tsc -b` owns the publishable per-module `.js` and `.d.ts` output, and the bundler owns only `lib/index.*`.
    - `lib/types/*.d.ts` and `.d.ts.map` are the publish declaration output.
    - `lib/types/*.d.ts` uses explicit `.ts` relative specifiers, which TypeScript's NodeNext/Node16 resolver maps to sibling `.d.ts` files.
    - `lib/types/*.js` is only a bundler input and must not be used as a runtime entry or public import target.
    - `lib/index.*` is the publish runtime output and is generated by the bundler, currently `tsdown`.
- `pnpm run verify-node-next-types` scans built declarations for relative specifiers without file extensions, then typechecks a temporary external ESM consumer with `moduleResolution: "NodeNext"` against the built `types`/`exports` surface, so declaration specifier regressions fail before publish.
- The `typecheck` command uses `tsconfig.json`. Examples, tests, and scripts are checked by the root no-emit project, while packages and vendor modules keep the same emit behavior as `build`. Package and vendor source stays behind project-reference boundaries.

The Cordis vendor copy now has one more type-structure divergence from upstream. During upstream sync, that divergence must be reapplied or explicitly retired.
