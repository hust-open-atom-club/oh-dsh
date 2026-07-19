# Agent Note: Slot type-chain hardening — the non-obvious implementation rulings

Status: implemented

English | [中文](2026-07-22-slot-type-chain-implementation.zh.md)

> Scope: why the slot registration/render type chain (`packages/client/ui-slots/src/index.ts`, consumed by `packages/client/web-react/src/scoped-slots.tsx`) is implemented the way it is. The design-level trade-offs (registration-site inference over declaration tables, hand-written whitelists over derived ones) live in the web client architecture RFC; this note pins the five implementation decisions a future editor would otherwise re-litigate or accidentally revert.

## Problem

The hardened chain types every hop from `SlotMap` declaration to rendered component: owner share + framework-standard share + registrant-injected share compose into the component's props, checked at `register()`. Making that constraint hold without false rejections forced five choices that look arbitrary from the code alone — each one exists because the obvious alternative fails in a specific, reproducible way.

## Decision

### 1. `SlotComponent<P>` (bare call signature) instead of `FC<P>` at the registration position

`register()` constrains components as `SlotComponent<ComposedProps<K, NoInfer<I>>>` where `SlotComponent<P> = (props: P) => ReactNode`. React's `FC` carries static fields (`propTypes`, `defaultProps`) whose types reference `P` in covariant positions; assignability between two `FC` instantiations therefore checks those statics too, and the bottom-typed standard share (see ruling 4's `useSession: never`) makes those covariant checks reject components that narrow it — precisely the components the design wants to accept. The bare call signature checks through clean parameter contravariance only. Components stay ordinary functions; nothing observable changes at runtime.

### 2. `NoInfer<I>` pins the registrant share's inference to the inject factory

`I` (the registrant's injected share) must be inferred from the `inject` factory's return type — the single authoritative source. Without `NoInfer`, TS also collects inference candidates from the component parameter position, and a drifted component (consuming a key the factory does not supply) silently WIDENS `I` to make the call check, absorbing the drift instead of reporting it. `NoInfer<I>` at the component position removes that candidate site, so negative sample ⑥ (a hand-drifted copy of the owner share fails at `register`) actually fails — with inference bleed it would pass. If the `NoInfer` ever gets "simplified away", the type-chain spec's expect-error site goes red first.

### 3. `ComposedProps` dispatches on the entry's `owner` key for progressive migration

`ComposedProps<K, I>` composes `owner & standard & I` only when the SlotMap entry declares an `owner` share; entries without one fall back to the legacy full-`props` constraint (`PropsShape`). This conditional is the migration seam: legacy declarations keep compiling unchanged while entries opt into the composed model one at a time, and both forms flow through the same `register()` overload — no parallel API, no flag. Removing the fallback branch is the flip-the-switch moment for the whole repo, not a cleanup.

### 4. The standard share is bottom-typed, and bare `register` bivariance is accepted, not fought

Session slots' framework-supplied hook is constrained as `{ useSession: never }` (`StandardOf`): `never` in a parameter-ish position means any registrant narrowing (e.g. a runtime-typed conversation hook) is accepted, and the responsibility for what actually arrives lives with the injecting renderer. Known boundary rider: for components typed with METHOD syntax or otherwise bivariant parameter positions, TS can accept a `register` call it strictly shouldn't (parameter bivariance is unsound by design in TS). The accepted stance is documented rather than tested: we do not add negative samples that depend on strictness TS does not guarantee — they would pin compiler-version behavior, not our contract. The samples we do pin (six expect-error sites in `packages/client/ui-slots/tests/type-chain.spec.tsx`) all fail for contract reasons.

### 5. `ChildrenChecked` is an opt-in validation layer keyed on the entry's `children` declaration

Sub-slot delegation authority stays a hand-written whitelist (`slots: ScopedSlots<'a' | 'b'>` in the component's own props). `ChildrenChecked<K, P>` adds an optional second check: only when the entry declares `children` does the component's `slots` face get validated against the authorized union (violation collapses `slots` to `never`, surfacing at the register call). Entries without `children` pass through untouched. The hook point is inside `ComposedProps` — i.e. it fires exactly at the registration boundary, not at render — because register is where both halves (entry declaration, component face) are statically visible at once; a render-time check would need runtime plumbing for a purely static guarantee.

## Consequences

The register call site is now the chain's single choke point: share drift, missing inject keys, unauthorized sub-slot faces, and keyed/list option omissions all surface there at compile time, and the six-sample negative spec pins each failure mode. Costs: the conditional types make hover-signatures at register sites noticeably wider; the bottom-typed standard share shifts arrival-type responsibility onto web-react's renderer (documented on `StandardOf`); and the bivariance boundary means one unsound-accept class is knowingly tolerated.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| Keep `FC` and cast at register sites | The casts hide exactly the drift the chain exists to catch; FC statics' covariant noise is the mechanical cause, so remove the noise, not the check |
| Infer `I` from the component parameter | Inference bleed absorbs props drift silently — negative sample ⑥ becomes unwritable |
| Big-bang migration to composed props | Every SlotMap declarant lands in one PR; the `owner`-keyed conditional lets entries migrate one by one with both forms live |
| Test the bivariant-accept edge as a negative sample | Would pin TS soundness behavior we don't own; compiler upgrades would break the spec without any contract change |
| Derive delegation whitelists from `children` declarations | The hand-written face is the API the component author reads; derivation inverts ownership and was rejected at design level — `ChildrenChecked` validates instead of generating |
