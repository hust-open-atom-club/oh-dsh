# Agent Note: The slot system standard — single register, four props shares, and the framework store seat

Status: implemented

English | [中文](2026-07-22-slot-type-chain-implementation.zh.md)

> Scope: the definitive slot-system design for the web client — how UI plugins compose the page, where render authority lives, how component props are typed, and where business live-data goes. The [web client architecture RFC](2026-07-19-gui-web-client-architecture.md) owns the surrounding context (loading chain, object layer, services) and defers its slot sections here.

## Problem

The page is composed at runtime from independently loaded plugins, so the UI needs a composition mechanism that answers four questions with static force. Who may render into a region — and is that authority enforceable, or merely conventional? How does a component receive everything it needs while staying a pure function (no ctx, no framework imports), without every value being hand-threaded through assembly code? Where does business live-data live so that streaming updates re-render precisely the subscribers — without every plugin building its own subscription machinery? And how much of this can the compiler check, so that a drifted component, an over-reaching render call, or a mismatched store schema is a compile error at one visible call site rather than a runtime surprise?

## Decision

One sentence: **the shell renders only `'root'`; a plugin composes UI through a single `register` call that simultaneously occupies a slot, declares+authorizes its child slots, declares its store, and injects its business face; components are pure functions whose props arrive in four shares, each auto-derived from its single source of truth.**

### 'root' is the only a-priori slot

`SlotsService` (client runtime) declares `'root'` at construction — single/root, `owner: {}` — and its `SlotMap` merge lives in the runtime package. The shell's entire assembly is `ctx.slots.renderSlot('root', {})`: the only ctx-level render entry; any other key, a missing renderer, or an unregistered root fails loud (no fallback).

### register is the single API; children = declaration + authorization + runtime spec

```ts ignore-check
ctx.slots.register({
  name: 'root',
  children: {
    'sidebar':      { kind: 'single', scope: 'root' },
    'conversation': { kind: 'single', scope: 'session' },
  },
  store: createLayoutStore,      // StoreHandle or factory (below)
  inject: injectFrame,           // business face (below)
}, AppFrame)
```

There is no separate slot-definition API. The `children` object both **declares the child slots into existence** and **authorizes this component to render them** — a slot is a hole in the render tree that exists because someone will render it, so its lifecycle is the declaring entry's lifecycle (entry disposed → slots gone, contributions cleared). The values are the runtime spec (`kind`/`scope` drive outlet iteration and binding selection; `SlotMap` is types-only and erased at runtime, which is why an array of keys could not work), statically checked against the `SlotMap` entry so type and value are declared at one point and cross-validated.

Parity rule: **the declaring entry holds the exclusive right to render its child slots**, settled entirely at register time (misconfiguration fails loud at load; the render hot path carries no checks). Loud-at-load cases: a second entry declaring an already-declared slot; registering into an undeclared slot; one store handle mounted under two scopes.

`SlotMap` declaration merging remains the type authority, and an entry declares only its own axes plus the **owner share** — the registrant's injected props never enter the global table ("whoever injects it, owns its type").

### Component props: four shares, each from its own source of truth

| Share | Type | Source of truth | Contents |
|---|---|---|---|
| runtime | `PropsRuntime<K>` | SlotMap entry for K | `OwnerOf<K>` (render-site params) + session-scope standard `useSession`/`sessionId` + global `useSessions` |
| child render | `PropsRenderSlots<S>` | register's `children` keys | `renderSlot(key, owner)`, key statically narrowed to S |
| store | `PropsStore<H>` | store factory return type | `useStore` selector hook + `actions.*` (draft-param stripped) |
| business | `I` | inject return type | plain data + callbacks (hooks banned) |

`sessionId` is framework-supplied wherever `scope: 'session'` is declared — owner params do not carry it. The register call site is the double-lock choke point: a component whose renderSlot keys exceed the `children` declaration, or that misses a declared face, or whose store/inject shapes drift, is a compile error on that line. Delegation is ordinary props passing (hand the `renderSlot` function down, optionally behind a narrower signature) — there is no whitelist face object and no minting API.

### The store seat: framework engine, registrant schema

The framework owns exactly one subscription machine: the snapshot store engine (zustand vanilla + immer + optional localStorage persistence) lives in the **runtime package** (`./client` main entry — no subpath), producing bare observable sources; web-react binds them into hooks at the outlet (per-source cached uSES binding). What a store *contains* is the registrant's declaration, written as a factory so no module-level handle exists (a module-scoped handle would be a de-facto singleton surviving plugin reloads):

```ts ignore-check
export function createChatStore() {
  return defineStore({
    init: () => ({ selection: null as SelectionTarget | null, draft: '' }),
    persist: 'dsh.conversation.chat',
    actions: {
      select:    (d, t: SelectionTarget) => { d.selection = t },
      clearDraft:(d) => { d.draft = '' },
    },
  })
}
```

One factory, three consumption points: (a) `register` — pass the factory for an exclusive store, or call it once in `apply` and pass the same handle to several registers to share the instance (cross-plugin sharing is constructively impossible: the handle never leaves the package); (b) `PropsStore<ReturnType<typeof createChatStore>>` derives the component's store share with zero hand-written members; (c) tests call the factory and `.create()` a real engine instance, feeding `useSelector`/`actions` straight in as props — production outlets run the very same `create` path, so there is no second machinery.

Store scope is **derived from the mounting entry's scope** (session slot → one instance per session, living and dying with the session; root slot → one per entry). Read = `props.useStore`; write = `props.actions.*` only — the raw instance (with `update`/`set`) never reaches a component, so the declared actions are the complete, auditable mutation surface. Production code never calls the factory or `create` outside `apply`.

### inject: the registrant's business face, on its own ctx

An inject factory takes what its declarations earn it — `sessionId` for session slots, bound `actions` when a store is declared, nothing otherwise — and reads services through the **apply closure's own ctx**, so its capability boundary is the plugin's declared `inject` topology (the cordis property proxy applies natively; there is no assembly handle carrying a wider ctx). Its return value is plain data and callbacks only: the narrowed read/write face of the plugin's own services, cross-service orchestration (e.g. `send` = `actions.clearDraft()` + `ctx.conversation.send(...)`), and per-(entry×session) assembly side effects. No hooks, no ReactNode producers, no whole-service objects — narrowing is the value: what a component can do is exactly the factory's return shape.

### Data-boundary discipline

Hooks are framework-made only: `useSession`, `useSessions`, `useStore`, `renderSlot` are the four seats, implemented once with framework-guaranteed correctness; business code passes plain data and callbacks between parent and child (a component's own behavioral hooks that subscribe to nothing external remain fine). Live data has exactly three channels: what the parent knows travels as owner props at the renderSlot site; what only the component knows is local state; what must be shared across entries or survive remounts is a declared store. Derivation is a pure function over framework-hook data (`useMemo`), never a subscription of its own.

### Tree context and the renderer seam

`SessionProvider` is a framework component **delivered as a standard-kit seat**: an entry whose `children` declare a session-scope slot receives it as a prop (type in ui-slots, value injected by the renderer) — components never value-import it. It is self-wired (it reads the runtime's current-session state internally; the assembler passes nothing), render-prop shaped — `children(sessionId)` with an `empty` branch, remounting under `key={sessionId}`. `BindingContext` is machinery-internal; business components see zero React contexts. Inject factories execute inside the outlet on purpose (per-entry error boundaries catch them; a crashing registrant blacks out only its own entry while assembly errors rethrow); the outlet reads tree context as a machinery-only implicit parameter — the "identity from the register closure, situation from the tree position" split.

Rendering lives behind an install seam so the runtime stays React-free: `SlotRenderer` (interface in ui-slots, implementation `createSlotRenderer()` in web-react) is installed once at shell boot via `ctx.slots.install(...)`; double install and render-before-install throw. Ownership bookkeeping is a single `Map<key, entry>` in the service — ledger, slots, contributions, render bindings, and store instances all live and die on the one entry axis, which closes the stale-authority window across plugin reloads by construction (a disposed entry's captured `renderSlot` throws a stale-authorization error on entry).

### Type-chain implementation rulings

Two hardening decisions in the register signature exist because the obvious alternative fails in a specific, reproducible way; a future editor should not re-litigate them:

1. **`SlotComponent<P>` (bare call signature) instead of `FC<P>` at the registration position.** React's `FC` carries static fields (`propTypes`, `defaultProps`) whose types reference `P` in covariant positions; assignability between two `FC` instantiations checks those statics too and rejects components the design wants to accept. The bare call signature checks through clean parameter contravariance only; components stay ordinary functions.
2. **`NoInfer<I>` pins the business share's inference to the inject factory.** Without it, TS also collects inference candidates from the component parameter position, and a drifted component (consuming a key the factory does not supply) silently widens `I` to make the call check — absorbing exactly the drift the chain exists to catch. The negative-sample spec pins this: if the `NoInfer` is ever "simplified away", the expect-error site goes red first.

## Consequences

Render authority is enforceable rather than conventional: who renders what is a load-time fact, and auditing the UI structure = reading the register calls. Every props surface is statically derived from one source (SlotMap entry, children keys, store factory, inject return), so a schema change propagates by compiler rather than by grep. Plugins carry no subscription machinery of their own — store lifecycle (per-session instances, disposal, persistence) is framework semantics keyed to the entry axis. Costs: registration options are dense (children spec objects); the framework carries real inference machinery (`defineStore`'s init/actions same-round inference may need a curried fallback); and the compile-time double locks mean prototype-stage drift is a hard error, not a warning.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| Separate define/register two-step API | The split leaves render authority unenforced and invites ordering bugs; children-in-register settles declaration, authorization, and spec in one visible place |
| Whitelist face objects (`ScopedSlots` + narrowing helpers) | With the whitelist already in the component's props type, the face is derivable by machinery; a mintable face object is a third authority surface with runtime-only checks |
| Assembly handles carrying root ctx into inject | Bypasses declared inject topology — every factory could reach every service, so package.json dependency declarations stop meaning anything |
| `children` as a key array | kind/scope are runtime dispatch data; SlotMap is erased, so an array forces a second spec-registration API — a definition API reborn |
| Business-defined hooks via inject | Every plugin becomes its own subscription machine; the framework store seat carries the same data with one audited machine |
| Module-level store handles | A module-scope handle is a singleton across plugin reloads and test cases; the factory form scopes identity to apply/test invocation |
| Components receiving the store instance | `update`/`set` in render code makes the mutation surface unauditable; declared actions keep "what can change" a register-site fact |
| `FC` at the register position / inferring `I` from the component | FC statics generate covariant noise that rejects valid components; component-side inference absorbs props drift silently (see rulings above) |
