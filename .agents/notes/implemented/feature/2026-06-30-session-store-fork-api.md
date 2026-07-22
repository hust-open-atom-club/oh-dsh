# Agent Note: SessionStore fork API

Status: implemented

## Problem

The event-sourced session log already has the primitive a fork needs: create a new session with a seed event prefix, then derive model history from that seeded log exactly as replay does. That primitive is intentionally low-level: `ctx.sessions.create(id, { seed, meta })` accepts any valid seed, but ordinary live-session branching needs policy around which prefix can be copied, which metadata is stamped on the child, and how errors are classified.

The semantic hazard is the fork boundary. A valid user-visible fork seed must be contiguous and turn-enclosed. Forking inside an active turn would copy an open `turn/start`, possibly an open `step/start`, and possibly dangling tool calls. That violates turn-enclosure and provider-transcript invariants, and it creates a misleading child history that appears to have participated in an unfinished parent turn. The existing [subagent seam](2026-06-21-subagent-capability-seam.md) deliberately solves a different problem: tool-triggered subagent forks usually happen while the parent turn is open, so `dsh-subagent-fork` clips the seed to the parent's last completed-turn prefix. A general session fork should not silently clip; it should either fork the requested boundary or reject it.

## Decision

`dsh-session` owns ordinary live-session forking directly on `ctx.sessions`. There is no separate `dsh-session-fork` package or `ctx.sessionFork` service: the API has no independent backend, event vocabulary, lifecycle, or persistence behavior, and all durable work delegates to the existing session store and persistence backends.

The store exposes one operation:

```ts ignore-check
type SessionForkSource = Session | SessionId

class SessionStore extends Service {
  fork(source: SessionForkSource, boundary?: number, childSessionId?: SessionId): Session
}
```

`boundary` is the inclusive source event `seq` to copy through. When omitted, it defaults to the source session's current last event; on an empty source, omitted `boundary` creates an empty child. Fork-specific validation only checks that the requested boundary exists and is a `turn/end`. The selected prefix is then deep-cloned into the child seed. The child inherits the source session's `cwd`, stamps `parentSession` to the source id, and sets `seedLength` to the copied prefix length. When `childSessionId` is omitted, `SessionStore` generates one using its existing id policy.

An empty prefix is forkable; any non-empty boundary must be a safe existing sequence at `turn/end`, regardless of reason. Typed errors distinguish missing sources, stale objects, duplicate child ids, and invalid boundaries. Broader log validation and crash repair remain with their existing owners.

## Alternatives considered

**Separate `ctx.sessionFork` service.** This was the first implementation, but review showed it overfit the capability-seam pattern. The code had no swappable backend, no extra event surface, no independent ownership lifecycle, and no durable behavior beyond `ctx.sessions.create({ seed, meta })`. Keeping a separate package would make callers discover and install a second service just to perform policy around a session-store primitive.

**Two functions: `snapshot()` plus `fork()`.** This preserved a reusable seed/metadata computation, but the only supported consumer created a session immediately. It also made the surface feel more abstract than the concrete operation users need. A single `fork()` with an explicit `boundary` keeps the API direct while still supporting previous-point forks.

**Silently clip open turns to the last completed boundary.** That is correct for `dsh-subagent-fork`, where delegation often starts while the parent turn is open and the child should inherit only the completed prefix. It is wrong for ordinary user/session branching because it hides that the requested fork point was not actually a valid boundary and silently drops the parent turn tail.

## Consequences

The public surface stays small and discoverable: live session branching is part of `ctx.sessions`, next to `create({ seed })`, rather than a standalone service or a two-step helper pair. Persistence continues to work through existing `session/created` and `session/flush` behavior: a forked child starts life with seeded events, so existing backends persist that seed once and preserve `parentSession` / `seedLength` in the header.

The v1 scope still excludes ACP `session/fork`, unloaded persisted-session forking, model-facing tools, and subagent refactors. If a future ACP method is added, it should advertise the capability only after it has transcript/snapshot coverage; this Agent Note adds no editor-facing updates, so no ACP snapshot is required now. Fork-child replay remains covered by the existing [seed-boundary testing Agent Note](../testing/2026-06-22-fork-child-replay-seed-boundary.md), while this API gets focused `dsh-session` unit tests plus JSONL persistence coverage.
