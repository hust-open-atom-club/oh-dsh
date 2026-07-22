# Agent Note: Make `dsh-fs-policy` an event-gate plugin, not a method interface

Status: implemented

## Problem

[The split-fs-seam Agent Note](../simplification/2026-06-26-fsspec-style-fs-seam.md) put `ctx.fileContext` between the model-facing tools and the `ctx.fs` provider: `dsh-tool-fs` injects `fileContext` and routes every `read`/`write`/`edit` through its methods. That makes `fileContext` **in-path and mandatory**. The tool cannot reach `ctx.fs` without it, the policy layer owns the fs I/O and the read windowing, and a deployment that does not want observed-state policy cannot simply drop the package — `dsh-tool-fs` would fail to resolve `ctx.fileContext`.

This couples three things that should be separable:

1. **What the tool does** — resolve a path, read a window, write/edit a file. This is the tool's job and needs only `ctx.fs`.
2. **The freshness/observation policy** — "edit requires a prior read", "write/edit must be based on the version you read". This is the `dsh-fs-policy` plugin's job.
3. **The recording of observed state** — a side effect that should never block the tool from functioning.

Because the tool calls `fileContext` methods, removing the policy layer is a breaking change rather than a graceful loss of an *add-on*. The policy is load-bearing for the tool to even run, not an opt-in tightening.

## Decision

Invert the control flow. **`dsh-tool-fs` becomes the executor and calls `ctx.fs` directly**; **`dsh-fs-policy` becomes a gate + recorder plugin** that participates through events, never through a method the tool calls and never by registering a `ctx.fileContext` service.

```text
tool          dsh-tool-fs       executor: resolves, reads windows, writes/edits via ctx.fs;
                                emits fs policy events; renders results
policy        dsh-fs-policy  plugin: listens to fs/write-intent +
                                fs/edit-intent (single-slot waterfall) and fs/observed
                                (emit) events; adds observed-state + freshness.
provider seam dsh-fs            ctx.fs: text IO + ATOMIC mutation primitives whose version
                                guard is OPTIONAL; owns the fs policy event vocabulary
provider      dsh-fs-local      local implementation of ctx.fs
```

The model is additive: bare `ctx.fs` performs atomic, unconstrained text I/O, while `dsh-fs-policy` adds observed state, read-before-edit, and version guards. Removing the policy therefore leaves the tools usable but unconstrained. Shipped agent configs load the policy; the bare mode exists to keep policy optional at the service boundary, not as the normal deployment stance.

`dsh-tool-fs` no longer injects `fileContext`. It injects `fs` and `tools`/`systemPrompt`.

## The policy is enforced by provider CAS, not by `dsh-fs-policy` stat

`dsh-fs-policy` enforces "you must write/edit based on the version you read" **without ever calling `stat` or comparing versions itself**. It supplies the observed version as the CAS basis and lets the provider's mutation critical section detect staleness:

- "Have you read this file?" is the one thing `dsh-fs-policy` decides locally — a `WeakMap` lookup, no I/O. No record ⇒ `FS_NOT_OBSERVED`.
- "Is the version you read still current?" is decided **inside `ctx.fs.editText`/`writeText`**, in the same atomic lock that performs the read-match-rename. `dsh-fs-policy` passes `vObserved` as the expectation; the provider raises `FS_STALE_VERSION` if the file has moved on.

This is deliberate. If `dsh-fs-policy` stat-ed and compared versions in its waterfall handler, there would be a TOCTOU gap between that check and the tool's actual write — the file could change in between, so the check would be a false guarantee that the provider's lock has to back up anyway. Putting the version check in the provider's critical section is both race-free and zero extra `stat`. So `dsh-fs-policy` does **no** filesystem I/O; the "must be based on the latest read" guarantee is *realized* by CAS, and `dsh-fs-policy` only chooses the basis (`vObserved`) and gates on prior observation.

## Provider contract change: the version guard is optional

For the bare provider to be unconstrained, the version guard on its two mutations becomes **optional** — present ⇒ guarded, absent ⇒ unconditional:

```ts ignore-check
// writeText: expected is now optional. The FsWriteIntent union is UNCHANGED.
writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal): Promise<FsWriteOutcome>
//   undefined          → unconditionally create-or-overwrite (bare default)
//   createIfAbsent     → create only, reject an existing file (dsh-fs-policy, unobserved)   [unchanged]
//   replaceIfVersion   → overwrite only at the observed version, else FS_STALE_VERSION    [unchanged]

// editText: expected becomes optional (was the required { version: FsVersion }).
editText(target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal): Promise<FsEditOutcome>
//   undefined    → unconditionally replace literal text in the current content (bare default);
//                  a missing target still reports FS_STALE_VERSION
//   { version }  → edit only at that version, else FS_STALE_VERSION (the current behavior)
```

The `FsWriteIntent` union itself does not change — the third "unconditional" state is expressed by *omitting* `expected`, so both mutations share one symmetric shape (`expected?`: omit = no guard, present = guarded). This keeps full backward compatibility for the guarded paths `dsh-fs-policy` uses; only the previously-impossible "no guard" case is new, and it is the bare-provider default. The mutation still runs inside the backend's per-target lock either way, so an unconditional write/edit is still atomic (no torn files); "unconditional" drops the *version* precondition, not the atomicity. `editText` reports a missing target as `FS_STALE_VERSION` on both guarded and unguarded paths, preserving one edit failure code for "the target cannot be edited at this moment".

## Event vocabulary (owned by `dsh-fs`)

The events live in `@deepseek-ai/dsh-fs`, not in `dsh-fs-policy`. This is forced by the decoupling contract: `dsh-tool-fs` is the emitter, so it must reference the event types, and it must keep compiling even though `dsh-fs-policy` no longer provides a method service. `dsh-fs` is the package both `dsh-tool-fs` and `dsh-fs-policy` already depend on, so it is the only home that lets the emitter and the policy listener share a vocabulary without the emitter depending on the policy plugin.

These events carry existing `dsh-fs` vocabulary (`FsTarget`, `FsVersion`, `FsWriteIntent`) plus an opaque actor — not model-facing concepts (no line windows, numbered lines, or rendered footers leak down).

**The two `fs/*` decision events are single-slot, first-wins waterfalls.** `dsh-fs-policy` returns without calling `next()`, so it owns the slot in the default deployment; a listener registered earlier or with `prepend` would replace that policy. Permission, audit, and sandbox concerns remain on the composable `tools/execute` waterfall.

The actor is typed `object` in `dsh-fs` — a pure opaque carrier the provider seam never reads or narrows. The owner-derivation (`actor.agent?.session`) and the `{ agent?: { session? } }` structural shape stay entirely inside `dsh-fs-policy`, which narrows the `object` actor to that shape in its listeners. `dsh-fs` owns the event names and the fs vocabulary; it does NOT own the policy layer's runtime owner structure.

```ts
import type { FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'

interface Events {
  /**
   * Single-slot decision: produce the write expectation for the next
   * ctx.fs.writeText. The default returns undefined (unconditional create-or-
   * overwrite — the bare provider). The policy listener returns createIfAbsent
   * (unobserved) or { kind: 'replaceIfVersion', version: vObserved } (observed).
   * The listener does NOT call next(): one decision, not a composable chain. @mode waterfall
   */
  'fs/write-intent'(target: FsTarget, actor: object | undefined, next: () => FsWriteIntent | undefined | Promise<FsWriteIntent | undefined>): Promise<FsWriteIntent | undefined>
  /**
   * Single-slot decision: produce the optional version guard for the next
   * ctx.fs.editText. The default returns undefined (unconditional edit of the
   * current content — the bare provider; no stat). The policy listener returns
   * { version: vObserved }, or throws FS_NOT_OBSERVED if the actor is unset or
   * has not observed the target. Does NOT call next(): one decision. @mode waterfall
   */
  'fs/edit-intent'(target: FsTarget, actor: object | undefined, next: () => { version: FsVersion } | undefined | Promise<{ version: FsVersion } | undefined>): Promise<{ version: FsVersion } | undefined>
  /**
   * Record that an actor observed a target at a version, after a successful
   * read/write/edit. Fire-and-forget (plain emit). Listeners MUST be
   * synchronous, side-effect-only recorders (`dsh-fs-policy`'s is a WeakMap
   * write); the tool does not guard the emit, so a throwing listener surfaces as
   * the tool's isError result. No listener ⇒ nothing recorded.
   * @mode emit
   */
  'fs/observed'(target: FsTarget, version: FsVersion, actor: object | undefined): void
}
```

The `fs/*` decision events are **unbound waterfalls dispatched by the tool** (like `agent/request`, which the loop dispatches with no `this`), not service-bound waterfalls (like `llm/stream`). The dispatcher is the `dsh-tool-fs` plugin, which is not a service.

## Tool contract (`dsh-tool-fs`)

The tool keeps its model-facing schemas (`read`/`write`/`edit`, byte-for-byte unchanged) and prompt sections. The prompt guidance stays policy-first because a deployment loading the fs tools is expected to also load `dsh-fs-policy`: the model is still told to read before overwriting or editing, and any wording that says the "backend" requires that should be corrected to say the fs-policy plugin requires it. The bare-provider fallback does not change the prompt stance.

`dsh-tool-fs` gains the executor responsibilities relocated from the old `fileContext` method service, including **read rendering** (`read-render.ts`: `buildWindow` + `formatReadOutput`, `READ_MAX_BYTES`, `READ_MAX_LINE_LENGTH`, `FileReadOutcome`/`FileTextLine`, plus `STREAM_MIN_SIZE` in `read.ts`), which is the tool's rendering detail now that the tool owns the read. Those read-rendering types and helpers move into `dsh-tool-fs`; the policy plugin must not remain a type dependency for the tool.

`dsh-tool-fs` is a single root plugin that registers all three tools (`read`/`write`/`edit`), mirroring `dsh-tool-bash`. It injects `fs` (plus `tools`/`systemPrompt`), never `fileContext`. (The original proposal also exposed each tool as a `/read`/`/write`/`/edit` subpath plugin for focused deployments; that was dropped on implementation — no consumer needed a single-tool deployment, and the subpath publishing forced bespoke `tsdown`/`tsconfig`/`files`/workspace-constraint handling no sibling tool package carries. The per-tool registration helpers (`applyReadTool`/`applyWriteTool`/`applyEditTool`) remain internal modules the root plugin composes.)

`stat` budget is minimized by letting the waterfall produce the expectation lazily — the bare default returns `undefined` (no guard) and never stats:

- **read** — one `stat` (type + size routing + version), then `readText`/`streamText`, then `buildWindow`, then an `emit('fs/observed', target, info.version, exec)`. The post-read confirming `stat` from the old `fileContext.read` is dropped; a writer racing between the routing stat and the read can at worst make a *later* guarded edit spuriously `FS_STALE_VERSION` (fail-closed: the model re-reads, never writes against the wrong version, since `editText` re-checks in its lock).
- **write** — `expectation = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)`, then `ctx.fs.writeText(target, content, expectation)`, then an `emit('fs/observed', target, outcome.version, exec)`. **Zero stat in the tool** with or without `dsh-fs-policy`.
- **edit** — `expectation = await ctx.waterfall('fs/edit-intent', target, exec, () => undefined)`, then `ctx.fs.editText(target, edit, expectation)`, then an `emit('fs/observed', target, outcome.version, exec)`. **Zero stat in the tool** in both cases: the bare default is `undefined` (unconditional edit), so the tool never stats to manufacture a basis. If the target is absent, the provider reports `FS_STALE_VERSION` even on the unguarded path.

The tool passes `exec` (the tool-execution context) as the `actor` argument on every dispatch, so `dsh-fs-policy` can derive its observed-state owner. The tool does not know whether the policy plugin is present: it always provides the bare default behavior in the `next` thunk, and `dsh-fs-policy` short-circuits the thunk before it runs in the default deployment.

**`fs/observed` fires after a successful operation.** Its listeners must be synchronous, non-throwing recorders; the tool does not guard the plain emit, so a throwing listener would report failure after a mutation already succeeded. Async or fallible observation needs a separate event contract.

## Policy plugin contract (`dsh-fs-policy`)

`dsh-fs-policy` is a plugin, not a service. It does not register `ctx.fileContext`, has no public method surface, and exposes no `read`/`write`/`edit`/`resolve` methods. It attaches three listeners via `ctx.on()` registrations (each returning a disposer for HMR). It keeps the observed-state `WeakMap<owner, Map<targetKey, { version }>>` and the structural owner derivation (narrowing the event's opaque `object` actor to its own `{ agent?: { session? } }` shape), but does not inject `fs` — every handler operates only on its own `WeakMap`, never on `ctx.fs`.

- `fs/write-intent` listener: `prior = getObserved(owner, key)`; return `prior ? { kind: 'replaceIfVersion', version: prior.version } : { kind: 'createIfAbsent' }`. It does NOT call `next()`: it fully owns the single decision slot.
- `fs/edit-intent` listener: `prior = getObserved(owner, key)`; if no `owner` or no `prior`, throw `FS_NOT_OBSERVED`; else return `{ version: prior.version }`. Also does not call `next()`.
- `fs/observed` listener: `record(owner, key, version)`.

An observed-state entry is the **prior-observation record**: a successful `read`, `write`, OR `edit` all emit `fs/observed` and record `{ version }`, so the entry's presence means "this owner has observed this target at this version", not narrowly "has read it". This is what lets a create-then-edit or edit-then-edit sequence work without an intervening re-read: the mutation refreshes the recorded version to its own result, so the next edit's basis is the version it just produced. `FS_NOT_OBSERVED` rejects only an edit with NO prior observation of any kind. The owner is derived structurally from `{ agent?: { session? } }`; disposal drops all state (HMR safety).

`dsh-fs-policy` is now a pure policy/recording plugin with no service surface — it influences the world only through the event seam. That is what removes the method coupling from `dsh-tool-fs`.

## Bare-provider behavior (no `dsh-fs-policy`)

This is not the intended deployment stance — a config loading the fs tools is expected to also load `dsh-fs-policy`. It is the unconstrained provider floor that exists once the tool is no longer coupled to a policy method service. With `dsh-fs-policy` absent, every `fs/*` waterfall falls through to its `undefined` default and `fs/observed` has no listener:

- **read** is identical (it never needed policy; it only emits a now-unheard `fs/observed`).
- **write** unconditionally creates-or-overwrites: `expected` is `undefined`, so `writeText` writes whether or not the file exists and whatever its current version. No read-first requirement, no version check.
- **edit** unconditionally replaces literal text in the file's current content: `expected` is `undefined`, so `editText` matches and rewrites without a version guard or a read-first requirement (`FS_EDIT_NOT_FOUND`/`FS_AMBIGUOUS_EDIT` still apply — those are about the literal match, not freshness). A missing target still reports `FS_STALE_VERSION`, matching the guarded edit path's "cannot edit this target now" code.

Both mutations are still atomic (the backend's per-target lock is unconditional). What is simply *absent*, not lost, is the policy `dsh-fs-policy` would add: observed-state, read-before-edit, and version-guarded write/edit. Loading `dsh-fs-policy` layers those constraints on by having its listeners return guarded `expected` values instead of `undefined`; nothing in the bare provider changes.

## Supersedes

This amends — does not reverse — [the split-fs-seam Agent Note](../simplification/2026-06-26-fsspec-style-fs-seam.md). The four-layer split, the provider contract, and the freshness *policy* are all kept. What changes is the **coupling between the tool and the policy layer**: a mandatory method service became a plugin-owned event gate, and the fs I/O + read windowing moved from `fileContext` up into `dsh-tool-fs`. The split-fs-seam Agent Note's description of `dsh-tool-fs` injecting `fileContext` and of `fileContext` owning `read`/`write`/`edit` was updated to match in the same change.

## Verification

Tests pin both paths: without `dsh-fs-policy`, the root tool plugin boots against `dsh-fs-local`, and read, create, overwrite, and unread edit succeed; with the policy, unread edit returns `FS_NOT_OBSERVED` and unread overwrite is gated by `createIfAbsent`. A later intent listener is not reached after the policy decides. Stale edits fail through provider CAS while the policy performs no `stat`; the tool budgets remain one `stat` for read and zero for write or edit on either path. Model-facing schemas remain byte-for-byte unchanged, so snapshots do not change.

## Alternatives considered

- **Keep `ctx.fileContext` as an in-path method service** — the shape [the split-fs-seam Agent Note](../simplification/2026-06-26-fsspec-style-fs-seam.md) first landed; rejected because the tool could not run without the policy layer, making policy load-bearing for basic operation instead of an opt-in tightening.
- **Policy-side version checking** (`dsh-fs-policy` stats and compares in its waterfall handler) — rejected for the TOCTOU gap between that check and the tool's actual write; the provider's mutation critical section is the only race-free place, so the policy only chooses the CAS basis and gates on prior observation.
- **Per-tool `/read`/`/write`/`/edit` subpath plugins** — dropped on implementation: no consumer needed a single-tool deployment, and subpath publishing forced bespoke `tsdown`/`tsconfig`/`files`/workspace-constraint handling no sibling tool package carries; the per-tool registration helpers remain internal modules the root plugin composes.

## Consequences

- **Event indirection over a method call.** A waterfall + emit is less direct than `await ctx.fileContext.edit(...)`. The payoff is removing the tool-to-policy method dependency while keeping the default policy plugin; the cost is one more event vocabulary to learn. Mitigated by keeping the three events narrow and documenting the default-thunk semantics on each.
- **Policy events in the storage seam.** `dsh-fs` gains two version-decision events plus a recording event though it is "just storage". This is the price of decoupling (the emitter cannot depend on the policy plugin). The events carry only `dsh-fs` vocabulary plus an opaque `object` actor and no model-facing concepts, so the seam stays free of line-window/observation policy types and of the agent/session owner structure.
- **Single policy occupant, first-wins by convention.** The `fs/write-intent`/`fs/edit-intent` slots hold exactly one decider; the first-registered (or `prepend`ed) listener wins and the rest are short-circuited. `dsh-fs-policy` owning the slot is a deployment convention, not an event-enforced invariant — a second decider registered first would bypass it. This is acceptable because a second fs-version-policy decider is a misconfiguration, not a feature. If a future need for *layered* fs version policy appears, it is a new Agent Note (a composable value-passing seam), not a silent second listener on these events. Layered permission/audit/sandbox interception already has its home on `tools/execute`.
- **Dropping the post-read confirming stat** makes a follow-up *guarded* edit occasionally fail-closed (`FS_STALE_VERSION` → re-read) under a read/write race. This is a UX nicety lost, never a correctness hole; the provider lock still prevents wrong-version writes.
- **The bare provider does no read-before-write/edit and no version check.** A deployment without `dsh-fs-policy` lets the model overwrite or edit any existing file unconditionally. This is the deliberate meaning of keeping the tool independent of a policy service: the safety disciplines live in the `dsh-fs-policy` plugin. A deployment that omits it is opting into an unconstrained filesystem on purpose; that is not the intended stance for a config that ships the fs tools.
