# Agent Note: Scoped-layers store — one aggregate layer per scope behind a scheduling helper

Status: proposed

English | [中文](2026-07-12-scoped-layers-store.zh.md)

## Problem

Agent scoping ([the agent-scope Agent Note](../../implemented/architecture/2026-07-08-agent-scope-contexts.md), [runtime design](../../implemented/architecture/2026-07-12-agent-scope-runtime-design.md)) made "a registry with a global layer plus per-agent layers" a recurring shape, and every occurrence is hand-written. Six registration sites exist today — `tools.register`/`tools.restrict`/`tools.guard` in `dsh-tools` and `section`/`tools`/`variable` in `dsh-system-prompt` — each repeating the same 10-15-line effect choreography around its applicable global or scoped containers: read the calling context's tag, get or create the layer, validate, mutate, yield a rollback that deletes the entry and reclaims an emptied scoped layer, emit the applicable change event, and return the exact Cordis effect disposer.

Beyond the duplication, the risk concentrates in the choreography details:
- The rollback must be collected before the change emit (so a throwing listener unwinds the insertion instead of leaking it)
- The returned disposer must be Cordis's own function (a wrapper silently breaks nested ordered teardown)
- Emptied scoped layers must be reclaimed (a disposed agent must not leave residue keyed by its dead `ScopeKey`)

Every new consumer has to rewrite all of that correctly, and the copies have already diverged stylistically — two private layer helpers in `dsh-tools`, three inline IIFEs in `dsh-system-prompt`.

Finally, one agent's contribution to one service is scattered across several maps that know nothing of each other — there is no object that means "what this scope contributes here" — and the consumer count keeps growing: scoped guards and per-agent prompt/tool composition landed recently, while per-agent `fs/*` policy, `llm/*` overrides, and compaction policy are plausible future users of the same pattern.

## Proposal

`dsh-scope` gains a key-agnostic `store.ts`, with Cordis as its only peer dependency. The module implements the smallest abstraction shared by the six current sites: **business state and validation stay in an explicit layer class; one helper owns layer selection, effect attachment, rollback, notification, and reclamation**. One helper instance belongs to one service, and one layer instance aggregates everything a scope contributes to that service.

- **`ScopedLayers<L>`** is a concrete scheduler, not a base class. It owns the global layer plus one `Map<ScopeKey, L>`, constructs scoped layers on demand through an explicit factory, and reclaims a layer when `isEmpty()`. Its `effect(ctx, action, options?)` accepts one synchronous action that returns one synchronous undo because that is the complete shape of all six current sites. The single `ctx` decides both the visible layer (`scopeOf(ctx)`) and the owning Cordis fiber (`ctx.effect`), so "visible to X, disposed with Y" stays unrepresentable. The helper yields the undo before notifying listeners, returns Cordis's exact disposer, and reclaims a newly created empty layer if validation or mutation throws. Reads are `global`/`peek` plus `merge` (named entries with scoped shadowing and an optional global-admission predicate), `values` (global then scoped concatenation without shadowing), and `keys` (the pre-restriction name universe).
- **Explicit `ScopeLayer` classes** make each service's state visible to readers. `ToolLayer` and `PromptLayer` declare their three table properties and their `isEmpty()` aggregation directly; a small layer factory receives only the scope, while its closure may capture real constructor dependencies. Domain methods stay ordinary class methods. This costs a few repetitive declarations but avoids a mapped-type class factory, a scheduler/layer ownership cycle, reserved property names, and generated runtime structure.
- **`NamedEntries<V>` and `AnonymousEntries<V>`** are the two shared insertion-ordered tables. Named entries expose `insert`/lookup and retain the current global/scoped duplicate wording through domain `kind` and per-agent-alternative labels; anonymous entries expose only `append`, using process-unique symbol keys for O(1) undo removal. Keeping the classes separate makes meaningless mixed named/anonymous operations unrepresentable and keeps key types sound. Their iterators borrow membership and typed contribution values; they do not clone or freeze values. `ScopedLayers` materializes only the merged arrays/maps already required by the service read paths.

`dsh-tools` migrates its three tables into one `ToolLayer`: tools, compiled restrictions, and guards. The layer owns restriction admission and guard evaluation; the facade retains domain validation that needs service configuration, such as the reserved `run_code` name and the current known-global-name universe. Readonly allow/deny inputs are compiled once into internal sets. `dsh-system-prompt` likewise migrates sections, tool providers, and variables into one `PromptLayer`. Every registration facade performs its public argument validation and then makes one `effect` call with a label and, for guards, `silent: true`. A generic helper does not learn domain rules such as "restrictions require a scoped context."

`assemble` stays in the `SystemPrompt` facade for three reasons: the subject scope's layer may not exist and reads must not create it; shadowing requires merge-before-evaluate so a hidden section provider is never called; and the assembly waterfall and `toolOrder` use service-level resources. Sections and tool providers keep their current materialized derived views. Variable providers instead iterate the global and scoped `NamedEntries` directly, preserving today's live Map behavior when a provider registers another variable during assembly. Tool guards likewise iterate their `AnonymousEntries` directly.

Migration preserves public behavior and exact duplicate messages. The internal aggregate layer is reclaimed only after all three tables empty rather than when one table empties; no service API exposes layer identity. Direct live iteration retains current re-entrant variable-provider and guard behavior, while selector helpers continue to materialize the same section, tool-provider, and tool-resolution views their facades build today.

`ScopeLayer`, `EntryValues`, `ScopedLayers`, `NamedEntries`, and `AnonymousEntries` are public `dsh-scope` root exports with export JSDoc. Consumers import them from `@deepseek-ai/dsh-scope`; `store.ts` is an implementation module, not a package subpath.

## API sketch

```ts ignore-check
export interface ScopeLayer {
  isEmpty(): boolean
}

export class ScopedLayers<L extends ScopeLayer> {
  constructor(createLayer: (scope: ScopeKey | undefined) => L, options: { onChange?: () => void })
  readonly global: L
  peek(scope: ScopeKey | undefined): L | undefined
  merge<T>(scope: ScopeKey | undefined, pick: (layer: L) => NamedEntries<T>, admitGlobal?: (name: string) => boolean): Map<string, T>
  values<T>(scope: ScopeKey | undefined, pick: (layer: L) => EntryValues<T>): T[]
  keys<T>(scope: ScopeKey | undefined, pick: (layer: L) => NamedEntries<T>): string[]
  effect(ctx: Context, action: (layer: L) => () => void, options: { label: string; silent?: boolean }): () => void
}

export interface EntryValues<V> {
  values(): IterableIterator<V>
  isEmpty(): boolean
}

export class NamedEntries<V> implements EntryValues<V> {
  constructor(kind: string, perAgentAlternative: string, scope: ScopeKey | undefined)
  insert(name: string, value: V): () => void
  get(name: string): V | undefined
  has(name: string): boolean
  keys(): IterableIterator<string>
  entries(): IterableIterator<[string, V]>
  values(): IterableIterator<V>
  isEmpty(): boolean
}

export class AnonymousEntries<V> implements EntryValues<V> {
  append(value: V): () => void
  values(): IterableIterator<V>
  isEmpty(): boolean
}
```

What a migrated consumer looks like — the heaviest current site shrinks from 30+ lines of choreography to a declaration and one-line facades:

```ts ignore-check
class ToolLayer implements ScopeLayer {
  readonly tools = new NamedEntries<ToolDefinition>('tool', 'variant', this.scope)
  readonly restrictions = new AnonymousEntries<CompiledToolRestriction>()
  readonly guards = new AnonymousEntries<ToolGuardRegistration>()

  constructor(
    readonly scope: ScopeKey | undefined,
  ) {}

  isEmpty(): boolean { return this.tools.isEmpty() && this.restrictions.isEmpty() && this.guards.isEmpty() }
  addRestriction(filter: ToolRestriction): () => void { /* compile to sets, append */ }
  admits(name: string): boolean { /* intersection over this.restrictions.values() */ }
  guardReason(view: Readonly<ToolExecution>): string | undefined { /* first monotonic denial */ }
}

class ToolRegistry extends Service {
  private readonly layers = new ScopedLayers(
    scope => new ToolLayer(scope),
    { onChange: () => this.ctx.emit('tools/change') },
  )

  register(definition: ToolDefinition): () => void {
    return this.layers.effect(this.ctx,
      layer => layer.tools.insert(definition.name, definition),
      { label: 'tools.register()' })
  }

  private resolveVisible(scope?: ScopeKey): ToolDefinition[] {
    const scoped = this.layers.peek(scope)
    return Array.from(this.layers.merge(scope, layer => layer.tools, name => scoped?.admits(name) ?? true).values())
  }
}
```

## Alternatives considered

**Per-scope registry instances behind a parent/child delegation chain.** Instance explosion; the "deployment tools plus my tools" merged view needs a hand-built delegating registry per service; single-subscription observers (persistence, the ACP bridge) would have to discover and subscribe per instance; and a delegation chain cannot express subtraction (restrictions). A child registry would also have to reach back into a parent context, widening the exposure surface.

**Explicit scope parameters on registration APIs.** Already rejected by the agent-scope Agent Note: omitting the parameter silently registers globally, and the shape can express visible-to-X-disposed-with-Y, which is almost always a bug.

**Extracting only the data structure, leaving the choreography in services.** Removes the safe half of the duplication and keeps the dangerous half — the rollback-before-emit ordering, raw-disposer, and reclamation rules are exactly where the bugs live.

**Accepting the full Cordis `Effect` union as a layer action.** None of the six sites has asynchronous setup, multiple undos, or an independent settlement boundary. Normalizing promises, iterables, async iterables, LIFO sealing, and partial failure would duplicate lifecycle machinery speculatively. The store accepts one synchronous action and one undo; a future real boundary can justify widening it.

**Generating layer classes from a mapped-type table DSL.** The two consumers each declare three tables. A class factory would save a handful of lines while adding generated runtime shape, reserved names, polymorphic-`this` typing, and a second construction model. Explicit classes are easier to inspect and can still share the entry tables and `ScopedLayers`.

**A fixed-container helper with built-in view semantics.** Pins container shapes and merge policy inside the helper; business gets no freedom, and every naming or single-value variation becomes a helper feature request.

**One helper per table.** Reproduces today's scattered bookkeeping — that is the status quo being replaced, with N scope maps per service and no aggregate for an agent's contribution.

**`helper.get(ctx).effect(...)` two-step registration.** Splits layer creation from lifecycle attachment; a throw between the steps strands an empty layer, and the returned handle is an extra allocation per call.

**Layers holding a ctx and registering their own effects.** Turns data objects into lifecycle managers and reinstates the choreography once per business class.

## Acceptance criteria

- `store.ts` ships in `dsh-scope` (peer dependencies unchanged: Cordis only; module-graph position unchanged) with per-file 100% coverage of layer selection and reclamation, synchronous action/undo ordering, throwing-action cleanup, throwing-change-listener rollback, exact disposer identity, `label`/`silent`, factory typing, merge selectors, and separate named/anonymous entry semantics. Its five public symbols are re-exported from the package root and carry export JSDoc.
- `dsh-tools` and `dsh-system-prompt` each collapse to one `ScopedLayers`; every registration facade validates its domain contract and then makes one `effect` call, and all keep returning the exact Cordis effect disposer.
- Existing behavior, duplicate messages, validation order, live variable-provider re-entrancy, and live guard re-entrancy remain unchanged. Tests additionally pin aggregate reclamation timing and selector materialization.
- Documentation lands in the same change: `dsh-scope`/`dsh-tools`/`dsh-system-prompt` READMEs; on implementation this Agent Note moves to `implemented/` and the [runtime-design Agent Note](../../implemented/architecture/2026-07-12-agent-scope-runtime-design.md)'s registration section is updated in place.

## Risks

- The layer/facade boundary may not fit a future consumer's shape. Mitigation: `ScopeLayer` requires only `isEmpty()`, while the factory closure can capture constructor dependencies without giving a layer ownership of its scheduler.
- A future registration may genuinely need asynchronous setup or several independently owned undos. The helper deliberately does not predict that lifecycle; such a consumer must first identify its owner and settlement boundary, then widen the contract with tests.
- Explicit layer declarations repeat three property initializers and `isEmpty()` in each consumer. Accepted: the repetition keeps runtime state and types visible and avoids a second DSL for two classes.
- Two core registries migrate at once. Mitigated by the behavior comparison performed during design and by landing the store with equivalence-pinning tests before either migration commit.
