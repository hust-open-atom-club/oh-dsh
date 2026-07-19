# Agent Note: The self-referential cordis toolset

Status: implemented

## Problem

Everything in this harness is a cordis plugin, but the agent running inside that plugin runtime cannot see or touch it: it cannot enumerate the services and events around it, cannot extend itself with a new tool mid-session, and cannot compose capabilities it invents. Handing the model that power is worth exploring — a self-referential agent that inspects and modifies its own runtime — but it raises three correctness problems at once, and the design is about answering them rather than the raw "let the model run code" mechanic.

First, model-written registration must be validated where it happens: a malformed tool schema has to fail at registration, not when a later request tries to assemble it into a prompt. Second, model-written code has to call service APIs whose source it has never seen — guessed method signatures and, worse, guessed return-value shapes cost many steps of blind probing. Third, everything the model mounts must be fully disposable, by the model on demand and by the ordinary plugin lifecycle when the host plugin reloads, or a long session accretes orphaned listeners and tools.

## Decision

The toolset ships as [`@deepseek-ai/dsh-tool-cordis`](../../../../packages/cordis/tool-cordis/README.md) — a new top-level `packages/cordis/` group — and is demoed by [`examples/cordis-agent`](../../../../examples/cordis-agent/README.md). It gives the model three tools over the live cordis runtime it is running inside: inspect it, mount model-written plugins into it, dispose them again.

The vm isolates accidental global pollution, and the context façade hides framework internals. Neither restricts the authority of exposed services: a mount can call `ctx.bash` to run commands with the host executor's privileges and can reach the real filesystem and web services. This is an opt-in development tool with bash-equivalent trust, not a security boundary or product default.

### The three tools

| Tool | Contract |
|---|---|
| `cordis_inspect` | Read-only report over the live runtime, one Markdown section per `what` value (omit `what` for all sections). An exact `name` with `what: "api"` or `what: "events"` narrows to one source-documented target. Never mutates. |
| `cordis_mount` | Evaluates `code` (the body of an async JavaScript function) in a `node:vm` sandbox; the code must `return` a cordis plugin, which is mounted as a child of the `cordis-dynamic` group fiber and tracked under a fresh id (`dyn-1`, `dyn-2`, …). |
| `cordis_unmount` | Disposes one dynamic mount by id and returns only after disposal reaches quiescence — every registration the plugin made is unwound, not merely requested to stop. |

`cordis_inspect` sections: `services` (every provided ctx service and the owning fiber, non-active owners flagged), `plugins` (a flat list of every loaded plugin with its lifecycle state, from `ctx.registry` — what capabilities are loaded, deliberately not the tree shape), `tools` (what the model can call), `dynamic` (the mount table: id, name, state, provided services, awaited services), `api` (live service signatures + the type shapes they reference, from the generated catalog), and `events` (harness events with dispatch mode and signature). Broad `api` and `events` reports omit full JSDoc to stay compact; an exact `name` returns one service or event with its original method/declaration JSDoc. A name is invalid with other sections, unknown targets fail, and an API target must be live. The model-facing tool descriptions carry the operational rules the model needs at call time; [the generated tool catalog](../../../../docs/tool-catalog.md) is their exhaustive rendering.

### Sandbox semantics

Mount code runs as an async-function body in a fresh vm realm. Its documented surface steers file, network, process, and timer access through Cordis services so mounts remain inspectable and disposable. Host-realm helpers still make Node escape possible, consistent with the trusted posture. `vmTimeoutMs` bounds only synchronous evaluation.

Sandbox globals are deliberately small: a tagged write-through `console` (`[cordis:<id>] …` on the host stdout/stderr, so a listener that fires long after the mount call still lands somewhere the user sees), the `harness.defineTool` / `harness.registerTool` registration pair, the encoding primitives fresh vm contexts lack (`btoa`/`atob` as host closures over `Buffer` — a sanctioned exception, `Buffer` itself is never exposed — plus `TextEncoder`/`TextDecoder`), and callable traps over the withheld Node APIs (`require`, `setTimeout`/`setInterval`/`setImmediate`/`clearTimeout`/`clearInterval`, `fetch`) that throw a redirect naming the cordis alternative. Only function-shaped globals are trapped; `process` and `Buffer` stay `undefined` so a `typeof` feature probe stays inert rather than detonating a throwing accessor.

Mount code crosses the vm boundary through three controls. Dual-realm `instanceof` recognizes both host and vm objects. `harness.defineTool` normalizes results into host-realm JSON and validates the `ToolExecuteReturn` shape before logging. The mounted plugin receives a whitelist context façade, not a raw or pass-through `Context`; framework plumbing and context-valued returns are rejected. Service reads require a declared `inject`, preserving Cordis activation and unload semantics. `ctx.tools.get` exposes only the schema view, so mounted code cannot bypass `ToolRegistry.execute` by calling a definition directly.

The boundary normalizes unambiguous JSON-Schema forms into `SchemaSpec`, including object wrappers, `integer`, and optional fields. Invalid vocabulary fails with the accepted alternatives. Parse, TypeScript, missing-return, Node-API, and duplicate-tool errors include the relevant source line or corrective contract without narrating implementation internals.

### The dynamic group and mount lifecycle

All dynamic mounts are children of one `cordis-dynamic` group beneath the tool plugin, so ordinary fiber disposal handles reload and unload. Mounting awaits settlement; startup failure disposes the fiber before returning an error. A settled pending mount remains visible with its missing injections. `cordis_unmount` awaits the mount fiber's disposal.

### Cross-mount composition via provide/inject

Mounts relate to each other through ordinary cordis service semantics, with their ids as the lifecycle handles: mount A calls `ctx.provide('foo', value)`, mount B declares `inject: ['foo']` and activates the moment `foo` exists; mounted first, B stays pending and names the missing service; unmounting A sends B back to pending (its registrations unwound) and a later re-provide re-runs B's `apply` through a fresh sandbox façade; a duplicate provide fails loud with the owning fiber named. One realm caveat: a service value provided by a mount is a vm-realm object — method calls on it work from anywhere, but consumers must not assume host prototypes on it.

### The generated API catalog

`cordis_inspect` serves API and event data from a generated catalog rather than a duplicated table. The generator reuses the Cordis catalog AST scan and emits service summaries, signatures, original service-method and event JSDoc, event modes, referenced type declarations, and the inherited context surface. Ambiguous type names are omitted and oversized declarations are marked as truncated.

Freshness is gated like every generated artifact: `pnpm run verify-cordis-api` (in `doc-sync`) regenerates in memory and fails on any diff, so a JSDoc or public-signature edit cannot ship without regenerating the catalog the model reads. At runtime the inspect tool intersects the catalog with the live runtime rather than dumping it: broad reports render live catalogued services as summary + signatures, live services without a catalog entry (mount-provided ones) as name + owning fiber, catalogued services with no live provider tersely, and then the referenced type shapes. Exact-name reports render one live service or event with the original JSDoc immediately before each signature; keeping that detail opt-in avoids charging its token cost on exploratory listings.

### Configuration, rendering, and observability

The plugin exposes one config field, validated by schemastery and documented in [the config catalog](../../../../docs/config-catalog.md): `vmTimeoutMs` (default 5000), the millisecond bound on the synchronous portion of mount-code evaluation. Tool names, the `cordis-dynamic` group name, and the `dyn-` id prefix are structural vocabulary and stay fixed. All three tools render as `generic` cards per [the tool cookbook](../../../../docs/cookbook/adding-a-tool.md) (`cordis_inspect` a `read`, `cordis_mount` an `execute` carrying the code as `rawInput`, `cordis_unmount` a `delete`), with no `presentResult` overrides.

Model-visible ⟺ logged holds with no new session event type: a mount or unmount is visible only through its own `tool/call` / `tool/result` pair, which the loop logs, and the changed tool set a mount induces is logged by the full changed request header the loop emits when schemas change between steps. There is deliberately no `cordis/mount` provenance event — it would duplicate what the tool-call pair records. Dynamic mounts are process-lifetime, not session state: resuming a persisted session rehydrates the conversation but does not re-mount plugins.

## Alternatives considered

**A structured per-capability registration tool instead of `cordis_mount`.** The most tempting alternative is a `cordis_register_tool` with explicit `name` / `description` / `parameters` / `code` fields (and siblings `cordis_register_listener`, `cordis_register_service`, …) rather than a single "mount a plugin" primitive. It was rejected because its one real win — no plugin boilerplate for the single commonest case — does not pay for its costs, while a single mount primitive answers every capability at once.

| Dimension | Structured per-capability tools | Single `cordis_mount` |
|---|---|---|
| Schema correctness | `parameters` is still a model-written JSON object needing SchemaSpec validation, merely one step earlier | The same validation runs at the sandbox boundary, with the same instructive errors |
| The code field | An `execute` body is still model-written JS in a vm; the realm and service-call correctness problems are unchanged | One sandbox, one normalization path, one guarded registration |
| Capability coverage | Tools only; listeners, services, `inject` relations each need another structured tool — a surface that grows without bound | One vocabulary (a cordis plugin) covers every effect, present and future |
| Cross-mount composition | Not expressible in a tool-registration payload | Native `provide`/`inject`, ordinary cordis semantics |
| Inspectability | Registers something the plugin list cannot show as a plugin | What the model mounts is exactly what `cordis_inspect` renders |
| Model ergonomics | Wins for the single most common case (no plugin boilerplate) | Mitigated by the canonical recipe in the mount description plus boundary errors that teach the fix |

The correctness investment therefore goes where it pays for every capability at once: the generated API catalog surfaced through `cordis_inspect`, and sandbox-boundary validation whose error messages teach the correct call. A structured registration tool remains addable later as sugar that synthesizes mount code; nothing here forecloses it.

**A hand-maintained service/event reference in the tool.** The first cut of the inspect tool carried a hand-written table of service method signatures. It was replaced by the generated `api-catalog.ts` because a hand table drifts from the JSDoc the moment a signature changes and nothing gates the drift, whereas the generated artifact is freshness-checked against the same AST the docs use.

**A new `cordis/mount` session event.** A durable provenance event recording each mount (source, name) has clear precedent (`hook/invoked`, `compact/start`). It was declined for v1: mount and unmount are already visible as `tool/call` / `tool/result` pairs and the tool-set change is already logged as a full changed request header, so a dedicated event would only duplicate the record. It remains addable if an audit use case needs mount provenance separable from the tool call.

**A hardened / capability-restricted sandbox.** Trapping Node built-ins and handing mount code a whitelist façade rather than the raw context might suggest an intent to sandbox for safety. It is explicitly not that: the traps and the façade narrow the *surface* mount code sees — steering it onto cordis services and away from leak-prone Node built-ins and framework internals — for correctness and to close the unguarded-context escape, but the capabilities the façade exposes (`ctx.bash`, `ctx.fs`, `ctx.web`) reach the real runtime, so it is not a security boundary. A real one (separate process, permission prompts) was out of scope for a dev/opt-in toolset and would fight the entire point — handing the model the live runtime.

## Consequences

The toolset is a deliberate opt-in with a fully-privileged `ctx`, so a deployment adopts it as consciously as a bash tool. Several facts follow that the tool descriptions warn the model about directly: a waterfall listener (e.g. `tools/pre-execute`) that returns without calling `next()` vetoes the chain, so a mounted listener can lobotomize the agent's own tool dispatch ([waterfall semantics](../../../../docs/cordis-primer.md#cordis-waterfall-semantics)); mount code runs inside a tool call of the current turn, so awaiting anything that resolves only after the turn deadlocks; `vmTimeoutMs` bounds synchronous evaluation only; and mounts do not survive session resume.
