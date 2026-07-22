# Agent Note: Web client architecture — the client cordis plugin tree, the slot system, and the React-free object layer

Status: implemented

English | [中文](2026-07-19-gui-web-client-architecture.zh.md)

> Division of labor: the channel-independent layering model and RPC protocol (message model / type system / contract face / client base class) are in the [layering and RPC protocol RFC](2026-07-19-gui-layering-and-rpc-protocol.md); this document = the browser side: how the client cordis tree loads, how UI plugins compose through slots and services, and how the React-free object layer feeds React through immutable snapshots.

## Problem

Two forces shape the browser client. First, streaming: in an event-driven conversation UI, if business state (the event window, streaming accumulation, pending interactions, the connection state machine) scatters across React components and a global store, every token chunk shakes the render tree, and swapping the UI library means rewriting the business logic. Second, modularity: UI features (layout, sidebar, conversation, theme, locale) must be independently loadable plugins — composed at runtime from a host-served manifest, not compiled into one bundle — without giving up compile-time type safety across plugin boundaries.

## Decision

Both ends run cordis. The host is a cordis plugin tree; the browser runs a second, client-side cordis tree whose every UI capability is a plugin loaded dynamically by a shell-held loader. Inside that tree, cordis ctx hosts all runtime facts (services, stores, session scopes) and React is pure projection: components import nothing from the framework, receive everything through props, and subscribe to immutable snapshots via `useSyncExternalStore` (uSES below).

```
┌─ Host ─────────────────────────┐   ┌─ Browser ─────────────────────────────────────────┐
│ sessions/agents/SessionLog     │   │ client cordis root ctx                             │
│ apiproxy: RPC + mux/host 双流  │◀─▶│  ├ loader（壳静态持有，不能经自己装载）             │
│ webserver:                     │   │  ├ immediately 先行组: connection/runtime/         │
│  ├ GET /plugins/<id>/client.js │   │  │   ui-theme/i18n（动态 bundle，并行先装）        │
│  └ GET / 注入 __DSH_BOOT__     │   │  ├ 后续组: layout/sidebar/conversation/trajectory  │
└────────────────────────────────┘   │  └ session scope ×N（观看驱动，惰性建）            │
                                     │ React: loading 页 → settled → 整 UI 一次成型       │
                                     └────────────────────────────────────────────────────┘
```

## The client cordis tree and the loading chain

Every UI plugin is simultaneously a host plugin (dual-entry package): the node half sits in the host's plugin tree so the host Loader governs its lifecycle, and the browser half is a tsdown closure bundle under the package's `exports["./client"]`. The host webserver derives the boot manifest from loaded plugins carrying a `dshClient` manifest field and injects it into the page as `window.__DSH_BOOT__` — the HTML alone tells the browser everything to fetch, zero extra round trips.

The loading chain, end to end:

1. `GET /` → the shell boots, mounts `ctx.loader` (the loader mechanism is held statically by the shell — a loader cannot load itself; its code home is `packages/client/runtime/src/client/loader/`, imported through the `./loader` subpath so the shell bundle does not swallow the rest of the runtime package), seeds the require module table with the pure-library instances (react, react-dom, cordis, ui-slots, web-react, ui-primitives), and renders a plugin-independent loading page.
2. `loader.start()` reads `__DSH_BOOT__`. Entries flagged `immediately` form the early-load group (connection, runtime, ui-theme, i18n): fetched in parallel, applied in intra-group `inject` topological order, and **the whole group must land before anything else loads**. Remaining plugins then load in inject order.
3. Each bundle executes `window.DSHClientProxy.loadPlugin({ id, factory })`. The loader calls `factory(require)` — bundles are closure factories whose external dependencies arrive through the injected `require`, resolved against the module table (no globals, no import maps; an unresolvable specifier fails loud). The factory returns its module export surface (including the cordis `apply`); the loader runs `ctx.plugin(apply)`, then **registers that export surface into the module table under the package name**, so inject topology guarantees later plugins can `require` earlier ones. Plugin CSS is inlined in the bundle and injected as `<style data-plugin="<id>">` (CSS Modules hashing + ownership tag = isolation).
4. `await loader.settled()` → the shell flips from the loading page to the real UI in one pass. A single failed plugin fails loud on the loading page; there is no partial-availability mode (progressive rendering is deferred work).

**The dual-instance ban**: a module-table package inlined into a plugin bundle would duplicate runtime identity (two React copies, two store registries — the root cause of an actual white-screen P0). The tsdown client preset enforces purity at build time: a bare-name import of a module-table package must resolve external (rewritten to its `/client` form where applicable), and any other workspace leak that is not an inline-safe wire/type layer fails the build (`packages/client/tsdown.client.ts`, pinned by `scripts/client-bundle-purity.spec.ts`).

Dev equals prod: plugins rebuild under `tsdown --watch`, refresh reloads the same chain; vite serves only the shell (`apps/web`). Type universes stay split at the aggregate level — the root `tsconfig.json` is the host program, `tsconfig.client.json` the client program, because both sides merge cordis `Context` under the same keys (`sessions`, `loader`) with different services; client packages consume the wire vocabulary through pure type subpaths (`@deepseek-ai/dsh-session/types` and kin) so no host augmentation rides into the client program.

## The slot system: how the page composes

A page is a tree of slots; whoever owns a region declares its slots. Contracts live in one place — the `SlotMap` interface in `@deepseek-ai/dsh-client-ui-slots`, extended by declaration merging. An entry declares the slot's axes and the **owner share** only; the registrant's injected props never enter the global table ("whoever injects it, owns its type"):

```ts ignore-check
declare module '@deepseek-ai/dsh-client-ui-slots' { interface SlotMap {
  sidebar:      { kind: 'single'; scope: 'root';    owner: SidebarOwnerProps }
  conversation: { kind: 'single'; scope: 'session'; owner: ConvOwnerProps; children: 'conversation.empty' }
} }
ctx.slots.define('sidebar', { kind: 'single', scope: 'root' })   // declare=类型，define=落账
ctx.slots.register('sidebar', SidebarRoot, { inject: (b) => ({ /* ... */ }) })
```

- Three kinds: `single` (duplicate registration throws), `list` (id/order), `keyed` (runtime dispatch, duplicate key throws). Register before define throws. Two scopes: `root` (no session context) and `session` — the scope decides the injection shape below.
- **Full component props are composed by reference, never re-typed**: a registrant's component declares `OwnerOf<K> & StandardOf<K> & OwnInjected` — the owner share referenced from the slot owner's package, the standard share supplied by the framework (session slots: `useSession`), and the registrant's own injected share declared locally next to the component. `register<K, I>` enforces the composition at the call site: the component parameter is `SlotComponent<ComposedProps<K, NoInfer<I>>>` (a bare call signature, not `FC` — FC's `propTypes` static position generates contravariance noise against the standard share), and `I` is inferred exclusively from the inject factory's return type (`NoInfer` pins it), so a drifted component or a mismatched factory is a compile error at the registration point. In ui-conversation the injected shares live in `src/client/contract/slots.ts` (`ConversationInjected` and kin) and each skeleton component's props is a one-line reference composition.
- **Delegation is a hand-written whitelist with an optional declared ceiling**: an owner component receives a whitelist-narrowed `slots: ScopedSlots<'a' | 'b'>` through its own props and calls `slots.renderSlot(key, props)`; passing a narrowed subset to a child goes through `narrowSlots` (pure type covariance). Overreach is a compile error, and the runtime whitelist backstops plain-JS callers. An entry may additionally declare `children: <key>` — register then validates the component's whitelist ⊆ the declared ceiling (opt-in visibility layer, not mandatory). Every rendered entry is wrapped in a per-entry error boundary: a crashing registrant (component or inject factory) blacks out only its own entry, while assembly errors (missing providers) rethrow — a miswired shell fails loud instead of degrading.
- **Props merge from three sources** (the outlet does it; owners write only the first): ① owner-supplied props (identity, display parameters, frozen slices) — typed as the entry's owner share, exact at the renderSlot point; ② scope-standard injection — session slots automatically receive `useSession` bound to the right Session; ③ the registrant's `inject` factory, called once per (entry × session) for session slots and once per entry for root slots, cached in WeakMaps so a session switch-back reuses the cached result. Inject factories receive the assembly handle (`SessionBinding { sessionId, session, ctx }` or `RootBinding { ctx }`) — an apply-world object that never enters React.
- Two supply channels close the loop: `RootBindingProvider` (mounted once by the shell) feeds root-slot inject factories their ctx; `createSessionProvider(deps)` builds the single session provider — dependency-inverted (`useCurrent` / `resolveBinding` / `renderBody`), so web-react never imports the runtime. It subscribes to the current session id, resolves a reference-stable binding, remounts its body under `key={id}`, and delegates body rendering to the assembler's `renderBody` closure (slot ownership stays with layout; the provider knows no slot names).

Implementation homes: registry core in `packages/client/ui-slots` (zero dependencies), outlet/providers/uSES bridge in `packages/client/web-react`.

## Services and scope addressing

A service is a plugin's only API surface toward other plugins (UI components and injection faces are not APIs; a plugin nobody calls mounts no service — ui-trajectory is the minimal-plugin exemplar: no ctx service, only view-map merges). The roster: `ctx.connection` (api client + stream handles), `ctx.slots` (registry wrapper emitting `slots/changed`), `ctx.sessions` (list store, scope tree, bindings), `ctx.loader`, `ctx.theme`, `ctx.i18n`, `ctx.layout` (navigation + panel viewing state), `ctx.conversation` (send/cancel/selection/views/startSession), `ctx.toolviews` (named per-tool render registry with per-session scope filters).

Beyond SlotMap, two more typed registration rings follow the same declare-merge idiom: the **view ring** (`ConversationViewMap` — an entry may declare `chromeProps`/`extraProps` extension shapes; `ConvViewPropsOf<Id>`/`ChromePropsOf<Id>` compose base + extension, so a view with no declaration gets the base for free while ui-trajectory's entries carry real per-view props) and the **tool ring** (tool names stay an open set — no global key table; typing hardens inside the entry: `ToolViewProps.block` is the real `ToolCallBlock` union defined in runtime, and register infers the registrant's injected share like slots do).

**Scope addressing** mirrors the host's agent-scope idiom: services are root singletons whose methods take no sessionId — they read the caller's scope mark (`scopeOf(ctx)`). Inside a session scope, `ctx.conversation.send('hi', 'queue')` targets that session; cross-session calls re-target by switching ctx (`ctx.sessions.scope(id)!.conversation.send(...)`); calling a scoped method from root ctx throws. Client session scopes are minted like host agent scopes (a no-op plugin fiber + a scope-key extend), built lazily on first viewing and torn down only when the session is removed and unwatched — host-session death alone does not tear a scope (it freezes into a read-only viewport).

## The data object layer (`packages/client/runtime/src/client/sessions/`)

Frames enter, snapshots exit, the fold sits between — React-free (zero React imports, grep-assertable):

```
mux/host 帧（ConnectionController 泵入，sinks 注入）
        │
        ▼
SessionManager.handleMuxEnvelope / handleHostEnvelope
        │ 带 sessionId 的帧只投已存在实例（审批/问答 requested 例外：进 pendingBuffers 缓冲）
        ▼
Session.handleMuxEnvelope ──► events 窗口（seq 连续升序）
        │                        │ 定稿事件            │ chunk
        │                        ▼                    ▼
        │                   FoldAdapter        PartialAccumulator
        │                  （→ nodes）          （→ partial）
        ▼
Notifier 微任务合批 ──► ConversationSnapshot 缓存 ──uSES──► 组件
```

- **Session** (session.ts): lazily built, resident — once created it keeps eating frames in the background, so switching away and back renders instantly. Operations: `prompt`/`cancel` (RPC passthrough; failures land in the snapshot's `promptError`), `open` (pull the tail history page, idempotent), `loadOlder` (upward paging, reentry-guarded), `resync` (reconnect = clear the window and rerun open). Subscription: `subscribe`/`getSnapshot` (always the cached reference) — `implements ObservableSnapshot<ConversationSnapshot>`, with `useSelector = bindSnapshotSelector(this)` attached at construction, so a Session is directly a uSES source. Frame dispatch is one switch: `session/event` frames dedup by seq (the only dedup key), buffer while open is in flight, otherwise append + incremental fold; open/stitch merges the live buffer by seq and backfills once if `subscribed.lastSeq` outruns the window tail.
- **ConversationSnapshot** (conversation.ts): the immutable snapshot contract — `nodes` (folded, surface-ordered), `partial`, `runningCalls`, `pending`, `running`, `removed`, `openState`, `hasMore`, `promptError` and kin. **Reference discipline** (the premise of memo and uSES): the top-level object is fresh on every change; the nodes array is rebuilt but element references come from the cache; unchanged substructures reuse the previous snapshot's references.
- **SessionManager** (manager.ts): instance cluster + frame entry + the session list. sessionId-bearing frames go only to existing instances (a mux broadcast must not instantiate every session); approval/question `requested` frames are the exception — they never land in history, so they buffer in `pendingBuffers` and replay on instantiation.
- **Notifier** (notifier.ts): two channels chosen by change source. `markDirty()` (default; frame-driven changes always) batches per microtask — N changes, one notification, one re-render; the flush rebuilds the snapshot cache before notifying. `notifyNow()` (only direct echoes of user gestures) rebuilds and notifies in the same tick — controlled inputs roll the DOM back and jump the caret if their echo defers to a microtask. Frame-driven code using notifyNow collapses batching back to per-frame renders; banned.
- **FoldAdapter / PartialAccumulator**: the fold reuses the core SurfaceManager (`@deepseek-ai/dsh-session/surface`), padding sentinel events so a paged window starting at seq > 0 satisfies the core's `seq === index` assertion; a cross-window replace degrades to a tolerant linear scan and sets `foldDegraded`. Chunks stay out of the fold entirely (O(1) skip): the accumulator folds StreamChunks into `AssistantBlock[]`, a delta swapping only that block's reference, and the finalizing message discards the accumulator in the same batch (no flicker on promotion). Cost model: one chunk = one string concatenation + a dirty mark; an unsubscribed Session under a frame storm costs only the mark.
- **ConnectionController** (in `packages/client/connection`): opens the mux/host streams, pumps with for-await, reconnects with exponential backoff (500ms doubling to 10s, jitter, unlimited) behind a generation fence; sinks are injected one-way (the Controller does not know Session). Reconnect = rebuild: `onConnected` → list refresh + per-open-session resync. The object layer faces only `IApiClient`; the Web carriage (HTTP POST for the two client→server quadrants, SSE for the two server→client) and the client class family are the layering RFC's territory.

## The React face (`packages/client/web-react`)

The glue package is the whole ctx↔React boundary; components stay framework-free.

- `createSnapshotStore<T>(init, opts)`: the store engine for plugin-owned data and shell viewing state — zustand vanilla with draft-based updates, `flush: 'sync'` by default (controlled inputs need same-tick echo) with opt-in `'raf'` batching for frame-driven stores, opt-in whole-value localStorage persistence, dev-mode deep freeze. Both a Session object and a snapshot store satisfy the one data contract React consumes: `ObservableSnapshot<T>` (`getSnapshot`/`subscribe`).
- `bindSnapshotSelector(source)`: binds a source into a typed selector hook over uSES-with-selector. The four uSES contract clauses hold by construction: getSnapshot returns the cached reference; subscribe is a bind-time closure (reference-stable forever); pure CSR passes no server snapshot; equality defaults to `Object.is` with `shallowEqual` opt-in per call.
- `useInvoke(fn)`: wraps an async action into a stable trigger plus pending flag; pending rides a per-hook external store read through uSES (no setState on the render path), concurrent invocations are counted, and the invoke reference never changes.
- Equality protocol, whole chain: producers use structural sharing; consumers short-circuit with `Object.is` or `shallowEqual`; `React.memo` shallow. Deep comparison is banned everywhere.

## Directory shape

Twelve `packages/client/*` packages (ui-slots, ui-primitives, web-react, connection, runtime, ui-layout, ui-sidebar, ui-conversation, ui-trajectory, ui-theme, i18n, web) plus `apps/web` — the vite application, a thin `main` over the shell's boot export. Plugin packages keep their browser half under `src/client/`; **every build artifact lands in `lib/`** — the node half as `lib/index.js`/`lib/invariant.js`, the browser bundle as `lib/client.js` (the shared tsdown client preset emits both; there is no `dist/` directory, and `exports["./client"]` points at `./lib/client.js`). Dependency direction: `ui-slots ← web-react ← runtime ← ui-* (peers) ← web`, with ui-primitives/ui-theme/i18n as zero-dependency side paths.

A multi-domain plugin package additionally splits its client half by future package boundaries — ui-conversation is the exemplar:

```
src/client/
  contract/    the only shared face between domains (types + composed props shares)
  service.ts   cross-domain orchestration (imports contract only)
  skeleton/    domain: shell components (ConversationRoot/InputBar/EmptyState/DetailsPanel)
  chat/        domain: the chat view
  toolviews/   domain: the tool-row registry and samples
  apply.ts     the ONLY file allowed to import across domains (assembly point)
  index.ts     thin re-export shell (contract + apply + components)
```

Domain implementation files never import a sibling domain — shared surfaces route through `contract/` (e.g. chat consumes the tool registry through a `ToolViewResolver` read-face interface, not the registry class). `scripts/verify-client-domain-graph.ts` enforces the layering (contract=0, domains=1, apply/index=2; imports may only point at levels ≤ own; sibling-domain edges fail). A future package split promotes each domain directory to a package and mechanically rewrites import paths.

## How to develop

- **A new UI feature** = a new plugin package: declare `dshClient` (+ `inject` topology) in package.json, write the browser half under `src/client/` (apply mounts services/stores, registers slots and toolviews), keep the node half an empty apply unless there is host logic, build with the shared preset. Add the plugin to the host config; the manifest and loading follow automatically.
- **A new slot**: merge the contract into `SlotMap`, `define` at the owner, render through the owner's own `ScopedSlots` whitelist; registrants `register` with an optional inject factory. Never export components globally.
- **Consuming a new frame type**: sessionId-bearing → a branch in Session's dispatch switch; host-level → the Manager routing table; if the UI needs it, a `ConversationSnapshot` field with the reference discipline kept.
- **Where does this state live**: per-session and must survive switches → the Session object / scope-mounted store; private to one view (selection, scroll) → component state; shell viewing state (navigation, panel widths, preferences) → `ctx.layout`'s stores; business data → always the object layer, never a viewing-state store.
- **Notification channel**: frame-driven/async = `markDirty` batching; direct user-gesture echo whose controlled input needs the same tick = `notifyNow`.

## Consequences

Token streams no longer shake the render tree: a frame storm costs unsubscribed sessions one dirty bit and the subscribed view one batched re-render per microtask (raf-batched for frame-driven stores). UI features load, fail, and get disabled as independent plugins — one crashing slot entry blacks out one card, one failed bundle fails loud before the UI flips in. The accepted costs: the loader/module-table machinery is bespoke infrastructure the team owns end to end; the one-flip boot (no progressive rendering) trades first-paint granularity for assembly simplicity; and the dual type programs make "which aggregate sees this file" a question developers occasionally have to answer.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| One statically-linked SPA bundle | Plugins must be host-composable at runtime (config-driven); a monolith re-couples every UI feature to one build |
| window globals / import maps for shared deps | The DI require table keeps sharing explicit, fail-loud, and swappable; globals leak identity and version silently |
| Business data in zustand slices | The event window/accumulator is a behavioral state machine, not a flat slice; the object layer keeps snapshot granularity and batching controllable |
| String-keyed global component registry for tool rows | Tool views are consumed by multiple views and need per-session differentiation — a named service (`ctx.toolviews`) with scope filters is the honest shape |
| Progressive/Suspense boot in P-I | One-flip boot is strictly simpler; the loader's per-plugin status face is kept so progressive lighting can land later without re-architecture |
