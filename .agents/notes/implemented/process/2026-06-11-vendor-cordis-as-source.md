# Agent Note: Vendor Cordis as source, not npm dependencies

Status: implemented

## Problem

DeepSeek Harness SDK is built on the Cordis framework. Cordis core was at 4.0.0-rc.6 (a release candidate) when this repo started; the harness depends on framework internals (fiber lifecycle, effect disposal, waterfall dispatch) whose exact behavior matters to the agent loop's correctness guarantees.

## Decision

Copy the needed Cordis packages (core, loader, include, group, timer, hmr, logger-console) and the cordiverse foundation libraries (cosmokit, schemastery) into `vendor/` as source, flattened, keeping their original npm names so workspace resolution is transparent. Truly third-party dependencies (js-yaml, chokidar, @standard-schema/spec, …) stay on npm.

`vendor/README.md` is the manifest: upstream repo + commit SHA per package and an exhaustive local-modification log. A pre-commit guard (`scripts/check-vendor-manifest.sh`) rejects vendored-source changes that don't update the manifest in the same commit.

## Alternatives considered

- **Depend on the npm packages** — rejected: core was at a release candidate, and the harness leans on framework internals (fiber lifecycle, effect disposal, waterfall dispatch) whose exact behavior the agent loop's correctness guarantees depend on; an upstream RC bump could break them without a local fix path.
- **Vendor everything transitively** — rejected: truly third-party dependencies (js-yaml, chokidar, @standard-schema/spec, …) stay on npm; only the framework layer whose internals matter is owned.

## Consequences

- The harness fully owns its framework layer: auditable, patchable, pinned — an RC upstream can't break us, and we can fix framework bugs in-tree.
- Upstream sync is manual (documented procedure in the manifest). The modification log keeps the diff surface known.
- Vendored packages keep upstream code style; lint/strictness gates exclude them (their tsconfigs relax our newer compiler flags locally).
- One local patch exists from day one: hmr's locale-YAML imports removed (the runtime YAML import hook isn't vendored).
