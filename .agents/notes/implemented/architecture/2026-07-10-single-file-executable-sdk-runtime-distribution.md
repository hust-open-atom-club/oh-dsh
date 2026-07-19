# Agent Note: Single-file executable SDK runtime distribution (single-exe)

Status: implemented

English | [中文](2026-07-10-single-file-executable-sdk-runtime-distribution.zh.md)

## Problem

DeepSeek Harness needs a dedicated SDK distribution form for the Python library — no Node installation, runs directly on the target platform: a single-file executable (hereafter "the exe") that exposes a stdio JSON-RPC serving surface (`HarnessSdkServer`, the Python SDK's peer), where the plugins and configuration actually booted are decided entirely by a `cordis.yml` supplied from outside the exe.

- The JSONRPC protocol for talking to the Python SDK is already validated
- A standardized way for cordis.yml to load every plugin (ESModule) is needed
- The distribution must carry the Node runtime, and support a locally linked source debugging mode

## Decision

### Packaging route: @yao-pkg/pkg's `--sea` mode

The exe is packaged with the **`--sea` (enhanced SEA) mode** of [@yao-pkg/pkg](https://github.com/yao-pkg/pkg) (the actively maintained fork after vercel/pkg was archived). Relative to Node's native SEA, pkg adds a `/snapshot` VFS and runtime module hooks on top, hands the ESM entry to Node's default ESM loader unchanged, and depends on no ESM→CJS transpilation.
> Measured (macos-arm64, node24 target, pkg 6.21.0): bare-specifier ESM dynamic import inside the VFS (including top-level await), CJS interop, `node:sqlite`, fail-loud on package names outside the set, and on-disk ESM import outside the VFS all pass; `import.meta.url` comes through unchanged as `file:///snapshot/...`.

`--sea` requires target ≥ node22; the exe uniformly targets node24. One pkg invocation packages exactly one target; multi-platform builds invoke it once per platform.

Terminology reminder: pkg's `/snapshot` VFS has nothing to do with this repo's testing-system "snapshot" (ACP replay expected outputs, `$DSH_SNAPSHOT`); this document says "VFS" for the former.

### The serving surface is a plugin: the two packages ui/jsonrpc + examples/jsonrpc-demo

The deterministic protocol implementation (`server.ts` / `transport.ts`) lands as two packages on the existing `ui/acp` + `examples/acp-demo` pattern — the serving surface is itself a plugin:

- [`packages/ui/jsonrpc`](../../../../packages/ui/jsonrpc/README.md) (`@deepseek-ai/dsh-jsonrpc`): the pure protocol plugin; on apply it mounts `HarnessSdkServer` plus a line-delimited JSON-RPC transport on the process stdio, with disposal through `ctx.effect()`. Whether to serve is decided by `cordis.yml`; a yml that does not mount it is a legitimate process that does not serve. Protocol-level exit belongs to the plugin (after answering the `shutdown` request it disposes its own fiber, then `exit(0)`; an HMR-style unload only stops the service without exiting the process).
- [`packages/examples/jsonrpc-demo`](../../../../packages/examples/jsonrpc-demo/README.md) (`@deepseek-ai/dsh-jsonrpc-demo`): a thin app bin — `installFailLoud` + `loadEnv` + config discovery + `boot()` from [`dsh-app-boot`](../../../../packages/ui/app-boot/src/index.ts), done once boot completes; the server is brought up by the `dsh-jsonrpc` entry in the yml. Its only dependency is app-boot. Process-level exit belongs to the bin (stdin EOF/SIGTERM → dispose then 0, SIGINT → 130).

Config discovery has two channels and fails loudly when both are missing: the `DSH_CORDIS_CONFIG` environment variable first (the SDK client convention), then an argv positional argument; no default path and no built-in fallback whatsoever — "the plugins actually booted are decided by an external cordis.yml" is a hard semantic.

### Plugin resolution: the VFS holds a real package tree, the closure manifest IS the deploy root

Inside the exe's VFS sits a **real package tree in build-artifact form** (each package's `lib/` plus a real `node_modules`); the Loader resolves plugin names through standard dynamic `import()`: bare specifiers resolve upward along `node_modules` from the Loader's position inside the VFS, and land inside the VFS naturally. The closed set needs no allowlist code — the set is whatever the VFS has installed, and importing a name outside the set fails.

The deploy root is [`python/sdk-runtime/package.json`](../../../../python/sdk-runtime/package.json) (`dsh-jsonrpc-agent-pkg`, a pnpm workspace member and a zero-code pure dependency manifest) — the unified source of truth for "which plugins the exe ships" and "what the Python runtime distributes". Adding a plugin to the exe = adding one dependency line to the manifest and repackaging. [`scripts/verify-runtime-closure.ts`](../../../../scripts/verify-runtime-closure.ts) traverses every workspace package covered by that manifest and requires every non-optional workspace peer at the runtime root, reporting the complete referencing-package → missing-peer chain; CI static, pre-push, and the single-exe build run it before packaging. Deploy also packs by each package's `files`, so the shared chunks tsdown splits out must be covered by `files`.

### Build pipeline and artifacts

[`scripts/build-exe-for-python-sdk.ts`](../../../../scripts/build-exe-for-python-sdk.ts): runtime closure verification → `pnpm run build` → (after clearing) `pnpm --filter dsh-jsonrpc-agent-pkg deploy --legacy --prod --config.node-linker=hoisted --config.auto-install-peers=false --config.link-workspace-packages=true` **directly into** `python/sdk-runtime/src/deepseek_harness_runtime/runtime/node/` → inject the pkg configuration (`bin` points at `node_modules/@deepseek-ai/dsh-jsonrpc-demo/lib/bin.js` inside the closure, `assets` is a full glob — dynamic import is invisible to pkg's static analysis, so everything must be packed in explicitly) → one `pkg --sea` per target → the executables `dsh-jsonrpc-agent-pkg-<platform>-<arch>` land in `dist-exe/` and are copied back into the runtime directory. CI treats them as intermediate test inputs and retains their platform wheels. All four deploy flags are grounded in measurement: `--legacy` is the mandatory path with inject-workspace-packages off; hoisted yields a zero-symlink file tree (most stable for the pkg VFS, physically guaranteeing a single cordis instance); disabling automatic peer installation keeps unpublished package names from triggering registry resolution; link-workspace-packages points the closure at workspace/vendor sources.

CI: [`.github/workflows/build-exe-for-python-sdk.yml`](../../../../.github/workflows/build-exe-for-python-sdk.yml), triggered explicitly only — `workflow_dispatch`, or the `build-exe` label on a pull request; native builds on the three platforms linux-x64 / linux-arm64 (`ubuntu-24.04-arm`) / macos-arm64, with `~/.pkg-cache` cached; macOS ad-hoc signing is handled by pkg. Each leg drives a mock SSE model through the SDK with the default config and a custom `cordis.yml`, drives the exe directly over NDJSON JSON-RPC, verifies the JSONL and final response, and installs release-shaped wheels into a clean venv without `runtime_bin`; Linux additionally inspects GLIBC requirements and runs in a manylinux 2.28 container. A full three-target run retains four artifacts, each containing one release file: the platform-independent SDK wheel and three native runtime wheels; a subset dispatch retains the SDK wheel and selected runtime wheels. Bare executables and source bundles remain intermediate test inputs. [`.gitlab-ci.yml`](../../../../.gitlab-ci.yml) accepts only `python-vX.Y.Z` tag pipelines whose version matches the root `package.json`, builds one SDK wheel and three native runtime wheels, then a single serialized job checks and publishes all four to the project PyPI registry. Windows is a non-goal.

### Python SDK distribution: two carriers, exe for production, node for development

The Python SDK lives at [`python/`](../../../../python/README.md): `python/sdk` (the client) + `python/sdk-runtime` (the runtime carrier package). The runtime package's data directory holds three kinds of content: the checked-in default `runtime/cordis.yml`, the build-injected platform exe, and the build-injected `runtime/node/` closure tree. `resolve_bundled_launch_args()` automatic resolution **finds the exe only**; the node carrier is enabled only by an explicit `DSH_RUNTIME_MODE=node` (running `runtime/node/node_modules/@deepseek-ai/dsh-jsonrpc-demo/lib/bin.js`, requiring a system node ≥22.19), positioned as the development-verification channel for members of this repo, and does not enter wheel distributions.

[`scripts/build-python-release.py`](../../../../scripts/build-python-release.py) reads the authoritative stable `X.Y.Z` from the repository root `package.json` and stages both packages at that version, with the SDK depending exactly on `deepseek-harness-runtime-bin==X.Y.Z`. An optional `python-vX.Y.Z` release tag is a consistency assertion and is rejected when it differs from the repository version; the source `pyproject.toml` development sentinel never determines a release version. The SDK is a `py3-none-any` wheel; the wheel-only runtime package contains exactly one exe and uses one of `py3-none-manylinux_2_28_x86_64`, `py3-none-manylinux_2_28_aarch64`, or `py3-none-macosx_11_0_arm64`. Its Hatch hook rejects sdists, universal tags, mixed executable payloads, and unsupported platforms.

The exe's "must be explicitly configured" hard semantic is unchanged; the zero-config experience is restored by the wrapper: when the caller gave no `cordis`, named no explicit runtime, and the environment has no `DSH_CORDIS_CONFIG`, the client explicitly injects the checked-in default `cordis.yml` (agent-core + preloaded llm-deepseek + JSONL persistence + bash-local + the `dsh-jsonrpc` serving entry, with `!!js` environment-variable fallbacks) via `DSH_CORDIS_CONFIG`.

### Naming lineage

`@deepseek-ai/dsh-jsonrpc-demo` (the package) → `dsh-jsonrpc-agent` (the bin) → `dsh-jsonrpc-agent-pkg` (the closure manifest; no scope prefix, deliberately sidestepping the constraints' package-shape rules for `@deepseek-ai/dsh-*`) → `dsh-jsonrpc-agent-pkg-<platform>-<arch>` (the exe artifacts). The wire `serverInfo.name` stays `deepseek-harness-sdk-runtime` (a protocol-stable value); the Python dist names are `deepseek-harness` / `deepseek-harness-runtime-bin`.

## Disposition of worker-style plugins

`dsh-workflow-workerthread` and `dsh-code-runtime-worker` are supported inside the exe. Their built hosts convert the sibling `lib/worker.cjs` URL with `fileURLToPath()` and pass the resulting filesystem string to `Worker`, which is the form pkg's Worker hook resolves inside the VFS. The worker entries are CommonJS because that hook compiles VFS worker files as CommonJS. The workflow engine keeps its data-URL bootstrap for unbuilt source execution; only its built sibling entry uses the filesystem string. The custom-config executable smoke loads both backends, invokes a real `run_code` call and a zero-agent `workflow` call, and requires each worker to return `42` from inside pkg's VFS.

## Testing

The verification surface has three tiers. Mechanism tier: the measured conclusions for the `--sea` chain are embedded in the Decision sections (ESM dynamic import inside the VFS, single cordis instance, fail-loud config chain, `node:sqlite`, macOS ad-hoc signing runs). SDK tier: the complete keyless pytest suite covers the client protocol against a fake runtime peer, subprocess cleanup, absolute cwd propagation, dual-carrier launch, and carrier resolution; root CI runs it on Python 3.10. End-to-end tier: every platform build completes a turn against a mock endpoint through the default SDK path, a custom config, and the direct binary protocol, with final text and JSONL checked. The custom config additionally drives `run_code` and a zero-agent `workflow` through their real worker files inside the packaged VFS. The same build leg runs a committed executable-specific snapshot through the Python SDK: a keyless scripted model mounts a Cordis plugin that registers a tool, invokes that tool from `run_code`, runs a direct spawn subagent and a workflow that starts a second spawn child, then unmounts the plugin. The comparison normalizes the SDK result and notification stream plus the parent and two child JSONL logs. This harness stays separate from ACP's `pnpm run test:snapshot` because the protocols and build artifacts differ. The platform wheel is then installed in a clean venv and run without `runtime_bin`.

Manual-driving caveat: the bin treats stdin EOF as "the client is gone" and disposes immediately, so a short-lived pipe aborts an in-flight turn — pipe-driven runs must keep stdin open until the turn ends.

## Alternatives considered

**Bare Node native SEA.** The injected main script must be a single CJS file, and the blob carries no filesystem and no module resolution, so a dynamic import of a bare specifier has nothing to resolve against; the only option is compiling plugins statically into the main script and registering them by hand — bypassing standard module resolution and hardcoding the plugin set, contrary to "configuration decides everything". The final route is in fact "the official SEA foundation + pkg's VFS/module-hook layer"; what was rejected is the bare use, not SEA itself.

**pkg standard mode.** Killed by the PoC, not a trade-off: it turns ESM into CJS + V8 bytecode via esbuild, the runtime vm compilation wires up no dynamic-import callback, every `import()` throws `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`, and `--options experimental-require-module` has no effect; it also depends on community-patched Node binaries (no macos-arm64 prebuilt; compiling from source on the spot takes about 10 minutes). Zero viability for this repo's architecture.

**Pre-bundling each package ESM→CJS into the VFS.** The compromise that keeps real resolution semantics and only downgrades the module format; `--sea` passed measurement outright, so this layer of build complexity never needed introducing.

**jsonrpc-agent carrying the full closure dependencies.** The app bin would declare 53+ dependencies it never imports — a "packaging manifest" masquerading as real dependency relationships — and would force constraints to open two exceptions for it, cordis-in-dependencies and a files wildcard. With the closure manifest landing on the python-side manifest package, constraints needs no exception at all and the bin keeps the normal package shape isomorphic to acp-agent.

**An open plugin set (loading user plugins from disk).** This round ships a closed set; the PoC incidentally confirmed that on-disk ESM import outside the VFS works (through the `ctx.baseUrl` relative-path channel). It is listed as a future evolution, which must separately solve sharing the cordis instance inside the exe with external plugins.

## Consequences

**Bought**: zero-dependency single-file distribution on target platforms; plugin semantics strictly identical to running from source (the same real package tree, no transpilation, no registry); the serving surface, the plugin set, and the configuration all converge on two sources of truth — `cordis.yml` plus one dependency manifest; the exe and node carriers share one tree and one semantics, so development verification never waits for packaging; official Node binaries remove the patched-binary supply-chain concern.

**Paid**: artifacts on the order of 174MB with source entering the blob as-is (no bytecode obfuscation; a closed-source distribution requirement needs a separate evaluation); pkg's VFS/module-hook layer remains community-maintained (the build script pins `@yao-pkg/pkg@6.21.0`; upgrading is an explicit change); `--sea` is one invocation per target (matching CI's one leg per platform; local multi-platform builds are serial).
