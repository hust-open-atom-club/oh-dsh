# Agent Note: Extract example apps into packages

Status: implemented

## Problem

An example folder is supposed to be *thin* — the variable wiring of a demo, not the demo's machinery. Before this change it was thick. Each example carried a hand-rolled `start.ts` boot bootstrap, an infra preamble (`timer`, and — for the stdio demos — `logger` + `hmr`), nested includes of three shared YAML fragments (`base.yml` / `base-core.yml` / `acp-agent/acp-tail.yml`), and per-example `agent-loop`/persistence/system-prompt config. The actual app — the spine of services every agent needs — was spread across the leaf and those includes.

The leaf configs also owned a coupled front door. ACP requires stdout purity and creates agents through `session/new`; stdio requires a console logger and a pre-created `main`. Prose warnings were the only guard against combining these incorrectly, while three `start.ts` files duplicated the Loader bootstrap and lifecycle code.

## Decision

Each example is now **mostly an invocation of an app package**, splitting the wiring along the existing [interface / implementation / consumer seam](2026-06-13-capability-seams.md): the **app package owns the composition**, the leaf `cordis.yml` owns only the **swappable choices** (which LLM adapter, which bash executor, model, prompt, persistence root).

- **`@deepseek-ai/dsh-agent-spine-demo`** ([packages/examples/agent-spine-demo](../../../../packages/examples/agent-spine-demo)) composes the providerless, executor-less, UI-less spine and forwards the loop's agent-list config. Its dependency on the concrete loop is intentional because this package composes the spine rather than extending it; swapping the loop means supplying another bundle.
- **`@deepseek-ai/dsh-stdio-demo`** ([packages/examples/stdio-demo](../../../../packages/examples/stdio-demo)) and **`@deepseek-ai/dsh-acp-demo`** ([packages/examples/acp-demo](../../../../packages/examples/acp-demo)) bake in their front doors. Stdio includes `ui-stdio`, a console logger, and `main`; ACP includes the bridge and JSONL persistence but no stdout logger or pre-created agent. Leaves may add plugins, but the safe composition is now the default artifact.
- **`start.ts` is gone.** Each app package exposes a `bin` (`dsh-stdio-demo` / `dsh-acp-demo`); the `demo:*` scripts invoke it (e.g. `dsh-stdio-demo ./cordis.yml`). The Loader-boot tail, `.env` loading, and fail-loud guards live in the shared [`@deepseek-ai/dsh-app-boot`](../../../../packages/ui/app-boot) package (unit-tested under the per-file coverage gate — see [share the app bins' boot glue](../simplification/2026-07-04-share-app-bin-boot-glue.md)); each bin is a thin self-executing composition over those helpers plus its app-specific lifecycle (the ACP bin: snapshot-mode selection and stdin-dispose). The `bin.ts` files themselves stay coverage-excluded (self-executing CLI entries, like the old `start.ts`) and are driven by the keyless Loader-path tests.
- **Each leaf `cordis.yml` collapses** to backends + config: the LLM adapter (`llm-deepseek` with apiKey/models, or `llm-replay`), the bash executor (`bash-local`), `hmr` for the stdio demos (see the amendment below), and one app entry carrying the app's config (model, system prompt, persistence root — surfaced as the app package's own `Config`, which routes each value to wherever the app wires it: stdio onto its pre-created agent, acp onto the bridge plugin).
- **echo-agent folds onto `dsh-stdio-demo`**, swapping the LLM backend to the local `mock-llm` and adding the local `echo-tool` (plus `bash-local`, which the spine's `tool-bash` injects) at the leaf — the clean demonstration of "swap the backend, keep the app". `mock-llm.ts` / `echo-tool.ts` stay as example-local teaching plugins.
- **`base.yml`, `base-core.yml`, and `acp-agent/acp-tail.yml` are retired** — the spine they shared now lives in `dsh-agent-spine-demo`.

`bash-local` and the LLM adapter stay **leaf choices**: the bundle ships `tool-bash` (the consumer schema), the leaf picks the executor implementation, so a sandboxed executor or replay adapter swaps in without touching the app.

### Amendment on implementation: `hmr` stays a leaf entry

The proposal listed `hmr` among the stdio app's baked-in front-door cluster. Validating against the code, baking `hmr` into the `dsh-stdio-demo` package fights cordis in two ways, so it ships as a **leaf `cordis.yml` entry** instead:

1. `@cordisjs/plugin-hmr` is a Loader-only, subprocess-only dev plugin — its constructor throws without `node --expose-internals` + a live `loader` service, so it can only run in the real `demo:*`/bin subprocess, never in the in-process unit/coverage tier.
2. The in-process test tier (vitest) cannot even *import* the vendored `hmr` module (its class-decorator `@Inject` form fails under Vite's transform), so a package whose `apply` statically imported it could never satisfy the per-file 100% coverage gate on its headline function.

Crucially, `hmr` is **not** a stdout-purity footgun the way the console logger is — a stray `hmr` in the ACP config would not corrupt the JSON-RPC frames — so leaving it at the leaf costs none of the safety the coupling argument is about. The **logger** (the real coupling) stays baked in: the stdio app includes it, the ACP app omits it.

## Alternatives considered

### Why not keep the wiring in shared YAML includes?

The old `base*.yml`/`acp-tail.yml` includes already deduped the *config*, but a YAML include cannot **encapsulate** the front-door coupling — it can only describe it in a comment and trust every leaf to obey. It also cannot own a `bin`, so the boot glue stayed copied across three `start.ts` files. A package turns "the ACP app never logs to stdout" from a prose warning into a property of the artifact: there is no logger entry in the leaf to get wrong.

## Verification

- Example directories contain only their config, README, and tests: `start.ts`, the infrastructure preamble, and the shared YAML includes are gone.
- `demo:echo`, `demo:repl`, and `demo:acp` invoke the app-package bins.
- Each new package has a README and per-file 100% coverage; each app package also has a keyless real-Loader-path bin smoke that catches export-shape failures described in [postmortem 0001](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md).
- The ACP replay transcript remains unchanged because the plugin set and load order did not change.

## Consequences

- **The bare-plugin-tree pedagogy.** echo-agent's inlined `cordis.yml` showed every plugin at once; the spine now lives behind a bundle, so seeing the whole tree means opening `dsh-agent-spine-demo`. The app package's README carries that teaching weight.
- **A layer of indirection.** "What does this demo load?" becomes a package read, not a single YAML scan.

## Related

- Supersedes [Make the shared example base providerless](../../rejected/architecture/2026-06-20-providerless-example-base.md): renaming `base.yml` to the providerless core is moot once the spine moves into `dsh-agent-spine-demo` and the `base*.yml` files are deleted.
- Builds on the [capability-seams](2026-06-13-capability-seams.md) interface/implementation/consumer split — backends and presentation stay leaf choices; the spine is the shared bundle.
- Complements [Reorganize packages into a modular hierarchy](2026-06-20-package-hierarchy.md): the new app/core packages slot into existing groups under that hierarchy (`core` for the reusable spine bundle, `ui` for the app-specific front doors).
