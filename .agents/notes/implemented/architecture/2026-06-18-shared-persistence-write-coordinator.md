# Agent Note: Shared persistence write coordinator

Status: implemented

## Problem

`dsh-session-persistence-jsonl` and `dsh-session-persistence-sqlite` intentionally prove the same `SessionPersistence` contract over different storage media, but their write-path orchestration was duplicated: per-session state, `session/created` adoption, backend-specific prefix reads, write-behind buffers, serialized flush chains, HMR seeding, and dispose drains. The pure seed-prefix collision and serializability guards had already moved into the seam package; the remaining orchestration was still correctness-heavy and received the same fixes twice. A code-level diff showed the two backends were byte-identical — or same-algorithm — for ALL of it: the four maps (`states`/`buffers`/`chains`/`inits`), `installWritePath`, `initFor`, `onCreated`'s four cases, `flush`, `drain`, `serialize`, `adopt`, `adoptLivePrefix`, `assertVersion`, and the `create`/`append`/`load` skeletons. Only the storage primitives (write bytes vs. INSERT rows) differed.

## Decision

Extract a backend-agnostic `PersistenceCoordinator` into `dsh-session-persistence`. The coordinator owns the orchestration once; each first-party backend composes one (`new PersistenceCoordinator(ctx, this)`), implements a small `PersistenceBackend` hook interface, and delegates its four public service methods (`create`/`append`/`load`/`list`) to it.

Composition, not inheritance. The coordinator is a concrete class the backend holds, not a base class the backend extends. The Agent Note's risk — "a coordinator must not make unusual backends fight an inheritance hierarchy" — is avoided: a backend exposes only the hooks; it cannot reach the coordinator's private orchestration state, and the public `SessionPersistence` service shape is unchanged, so a third-party backend MAY still implement the abstract service directly without the coordinator at all.

The coordinator retires each live session from its `session/disposed` notification: it waits for that exact Session object's initialization, serializes a final drain, and then removes the owned state, buffer, and init entries. Failed drains retain their buffers for backend teardown to retry. Settled per-id chain tails remove themselves only when they are still the current tail, so a completion cannot erase a newer operation for the same id. Backend teardown unregisters the write-path listeners before awaiting all admitted retirements, remaining buffers, and chains, then closes the backend.

### The hook interface (`PersistenceBackend<TornMarker>`)

Five required members plus an optional lifecycle hook form the only boundary between the coordinator and storage:

- `name` — backend label for the dispose-failure `AggregateError`.
- `loadStored(id)` — read one stored prefix by id across every storage scope (every JSONL cwd bucket; SQLite's id is globally unique). Resume/load, live adoption, and the create-collision probe share this lookup. The coordinator asserts the returned id and rejects a stored/live cwd mismatch before repair or state publication.
- `appendBatch(meta, events, isMaterialized)` — durably append a contiguous batch, lazily materializing the session ATOMICALLY when not yet materialized (the materialize-write and the first event batch must commit together — a crash between them must not leave a materialized-but-empty session; this is why there is no separate `materialize` hook).
- `commitRepair(meta, tornMarker, closers)` — make a crash repair durable: truncate the torn tail (iff `tornMarker !== undefined`) and append `closers`. **NOT required to be atomic** — JSONL legitimately truncates-then-appends in two fsync'd steps, SQLite does DELETE+INSERT in one transaction. Used by `load` (truncate + synthetic closers) and live-adoption (truncate only, `closers = []`).
- `list()` — list all stored metadata.
- `close?()` — optional lifecycle teardown (SQLite closes its db handle; JSONL omits it), awaited in the dispose effect AFTER the quiescence drain so a close failure never masks a drain error.

### The opaque torn marker

The single design choice that keeps the seam clean: the crash-repair "where is the torn tail" token is OPAQUE to the coordinator. The coordinator computes the synthetic closers (it owns `interruptedTurnClosers` from `dsh-session`), but it only ever tests `tornMarker !== undefined` and passes the value straight back to `commitRepair` — it never inspects it. Each backend picks its own marker type: JSONL carries the byte offset to truncate to plus any complete events decoded from an incomplete final frame, while SQLite carries the seq to delete from. The coordinator therefore knows neither byte lengths nor frame recovery state.

## Testing

The shared `runPersistenceContract` (public-API contract) keeps running for every backend. `runCoordinatorContract` (`tests/coordinator-contract.ts`) holds the write-path orchestration — adoption, HMR, collision, session and backend disposal drains, and crash-tail repair — and runs once per backend through a `CoordinatorFixture` (an in-memory reference + jsonl + sqlite). Coordinator-specific tests pin retirement map cleanup, same-id chain-tail races, failed-drain retry, and close ordering. The per-backend specs retain storage mechanics only (JSONL: path safety, fsync rollback, bucket listing; SQLite: schema version, `scanRows`, transaction rollback). A through-coordinator torn-tail→load→`commitRepair` test per real backend (via a `corruptTail` fixture hook) keeps the coordinator's torn-marker repair branch covered under the 100% per-file gate — the contract crash test only produces synthetic closers, never a torn marker, so it could not reach that branch.

## Alternatives considered

- **A base class the backends extend** — rejected for composition: a backend exposes only the hooks, cannot reach the coordinator's private orchestration state, and a third-party backend may still implement the abstract service directly without the coordinator at all.
- **A wider hook surface** — each candidate hook folds away: there is no scope-specific live lookup because `loadStored` plus the coordinator's cwd check preserves the collision boundary, no storage-locator generic because validated JSONL metadata reproduces its path while SQLite is already id-bound, no separate `materialize` hook because the first batch must commit atomically with materialization, no separate create-collision probe because it is `loadStored(id) !== undefined`, and no coordinator pass-through for `list()` because listing needs none of the orchestration.

## Consequences

The coordinator adds one indirection, an opaque torn marker, and detached session-retirement tasks, but centralizes correctness-heavy orchestration previously duplicated by every backend. Session disposal remains an observe-only event, so the session owner does not await persistence retirement; the coordinator contains failures, preserves uncommitted buffers, and makes backend teardown the quiescence boundary. Its hook surface stays narrow: identity, adoption, and collision checks reuse `loadStored`; materialization stays atomic inside `appendBatch`; and listing bypasses the coordinator. New backends implement storage primitives rather than copy the event-buffer-flush lifecycle.
