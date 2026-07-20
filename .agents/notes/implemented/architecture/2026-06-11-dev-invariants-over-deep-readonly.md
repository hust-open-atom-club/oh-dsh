# Agent Note: Source-owned session immutability and dev-mode invariants

Status: implemented

## Problem

The session log needs two different protections: immutable ownership of each stored fact, and checks for relationships among facts across time and service seams. Conflating them in an optional development plugin would leave production history vulnerable; trying to express both through TypeScript readonly types would not create a runtime boundary or describe relational rules.

The session log is the durable source of truth for replay, request reconstruction, persistence, and user-visible history. Code outside the session package must be able to inspect that history without retaining a reference that can rewrite it later, and inputs accepted from callers must not remain connected to caller-owned mutable objects.

Immutability of individual values is only half of the contract. A log can contain perfectly immutable records whose sequence, turn/step nesting, tool-call pairing, scoped delivery, or reconstructed model request is wrong. Those rules relate multiple records or services and cannot be established by freezing one object.

TypeScript readonly types are not a sufficient runtime boundary. They disappear when the program runs, a cast can bypass them, and a recursive `DeepReadonly<T>` would spread through every log and message consumer even though some downstream request-processing APIs intentionally work with mutable values.

## Decision

Responsibility is split between an always-on storage boundary and optional development assertions.

### Session owns immutable history

`Session` accepts an event only after one recursive pass has materialized a lossless JSON snapshot. That pass rejects unsupported values and produces the exact detached record that enters the log, so validation and storage cannot observe different values from a stateful getter or retain caller-owned nested references.

The accepted event and all of its descendants are deep-frozen before publication. `append()` returns that owned frozen event, `session/event` observers receive the same record, and `session.events` returns a frozen array snapshot. A previously returned array does not grow after a later append. Seed records pass through the same validation, snapshot, and freeze boundary before construction succeeds.

This guarantee belongs in `Session`, not in an optional listener, because every composition relies on trustworthy history. A production deployment, a focused test, or a custom embedding receives the same storage semantics whether or not development support plugins are registered.

### Derived requests remain detached

`deriveMessages()` projects logged surface events into detached, deep-frozen `Message` objects and returns a fresh array snapshot. Request assembly can therefore combine derived history with other inputs without exposing a path back into the log. The cache reuses safe immutable projections rather than recloning the complete history for each model call.

### The invariants plugin checks relationships

`dsh-invariants` is a pure-listener development plugin. It does not freeze records and has no configuration; disposal removes only its assertions. It checks rules that require trace state or observation of another seam, including monotonic sequence numbers, turn and step nesting, tool-call/result pairing, legal agent-status transitions, subject-correct scoped dispatch, and equality between a loop-built request and the request reconstructed from its session-log prefix.

When the plugin attaches to an existing or seeded session, it replays the immutable log to rebuild trace state. This makes hot reload safe in the middle of a turn without giving the plugin ownership of session storage.

## Alternatives considered

### Pervasive deep-readonly types

[The rejected immutable-public-surfaces proposal](../../rejected/architecture/2026-06-11-immutable-public-surfaces.md) would apply a recursive readonly type across public log and message surfaces. That provides editor feedback but not a runtime guarantee: TypeScript types are erased and plugin code can cast through them. It also pushes readonly types into consumers where mutation is intentional. Runtime ownership at the `Session` boundary protects every caller without that type propagation.

### Development-only freezing

Freezing history only when an invariants plugin is installed would make the core guarantee composition-dependent. Code could pass development tests and still corrupt history in production or in a focused composition that omits the plugin. Storage immutability is therefore always on, while the more expensive relational checks remain opt-in development support.

### Clone only when deriving messages

Detaching `deriveMessages()` would protect the most common request path but leave other readers of `session.events`, append return values, and session-event observers able to mutate durable history. The log must protect its own boundary; derived projections are an additional isolation boundary, not a substitute.

## Consequences

- Every accepted live or seeded session event is detached from caller-owned inputs and deeply immutable before any observer can receive it.
- `session.events` exposes stable immutable snapshots instead of the private growing array.
- Request-side mutation cannot reach stored history through derived messages.
- Development builds can enable relational assertions without changing storage behavior, and disposing or omitting the plugin does not weaken log immutability.
- `dsh-invariants` has no `Config` surface because it has no behavior to tune.
- The runtime boundary carries a recursive snapshot-and-freeze cost once per accepted event; later readers and cached projections reuse the owned immutable records.
