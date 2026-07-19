# Agent Note: Persisted same-session goal domain

Status: implemented

English | [中文](2026-07-19-persisted-same-session-goal-domain.zh.md)

## Problem

A long-running objective outlives one prompt, turn, or model request. Treating that objective as an in-memory loop variable loses it on process restart, while putting it only in UI state makes model behavior impossible to reconstruct. Treating every session turn as progress also charges unrelated human messages against an automatic-work budget.

Durable lifecycle and permission to continue are different facts. A session may retain an active objective after restart or fork, but silently starting work when a user opens that session is surprising. The domain needs replayable state without persisted auto-execution authority, and it must remain a plugin on the public agent/session seams rather than a special case in the concrete loop.

## Decision

`@deepseek-ai/dsh-goal` in `packages/goal/goal/` owns one current same-session goal through `ctx.goals`. A goal has a branded id, objective, durable phase, compare-and-set revision, and `maxGoalRounds`. `defaultMaxGoalRounds` is a validated deployment setting with default `256`; `resolveCreate()` materializes it before mutation.

The durable phases are `active`, `paused`, `blocked`, `usage-limited`, `budget-limited`, and `complete`. A separate live activation is `armed` or `disarmed`. Creation and explicit resume arm activation; pause, completion, blocking, limit transitions, and clear disarm it. Edits preserve activation. Activation is never part of the persisted snapshot.

### Durable record and replay

Every non-clear mutation uses `Agent.inject()` to append a raw, model-visible `context/message` containing a versioned full snapshot. Clear appends a revisioned tombstone. The context source is `{ kind: 'goal', goalId, revision, round: 0 }`; metadata and rendered `<goal_state>...</goal_state>` content must agree exactly. The session log is the only durable source of truth, so persistence and fork inherit goal records without another database or header field.

The replay fold validates JSON shape, source attribution, rendered content, fresh ids, revision continuity, lifecycle transitions, counters, and monotonic per-goal timestamps. Goal rounds are positive sequential `user/message` source numbers for the current active revision and cannot exceed `maxGoalRounds`; ordinary session turns do not affect the counter. A malformed current-format record fails replay rather than being ignored or repaired.

When `Agent.inject()` defers a mutation inside an active tool batch, the service overlays the accepted payload in process memory so a later mutation can use its new revision. Reconciliation removes only an exact matching payload when the FIFO append becomes visible; the durable log remains authoritative after restart.

### Lifecycle and live activation

At most one goal is current. Create requires no current non-complete goal and always generates a revision-one id not used earlier in the session; a completed goal may be replaced. Every other mutation carries the expected `GoalRef`, and stale ids or revisions reject. Resume accepts a stopped phase or a disarmed active goal only when the round cap has remaining capacity; budget limiting requires the admitted count to have reached the cap.

A cache built from any seed starts disarmed, and every `agent/session-start` edge disarms it again. Resume and fork therefore preserve the durable objective and history but never initiate work on their own. A later human prompt can be interpreted by the model, whose policy surface may explicitly call resume and arm the goal.

### Service boundary

The service accepts only the exact live `Agent` object registered under its id. Successful mutation injection emits the scoped `goal/changed` event with contained listener failures. Policy consumers use this service plus the public `Agent` interface and `agent/*` events; the goal domain does not import or modify `dsh-agent-loop`.

## Testing

Unit coverage pins creation defaults, exact-live-agent checks, compare-and-set rejection, every lifecycle transition, cap enforcement, clear/replacement, seeded replay and `SessionStore.fork()` inheritance, session-start disarming and active-goal rearming, FIFO deferred mutation reconciliation, listener containment, backward-clock clamping, strict record decoding, lifecycle continuity, source/content agreement, and sequential round attribution. A keyless Loader/stdio process test mounts the service and a lifecycle consumer through test-only `cordis.yml`, then reads the persisted JSONL externally to verify the model-visible snapshot and absence of an unrequested goal round. The package source is held to the repository's per-file 100% coverage gate.

## Alternatives considered

- **Store goals in a separate database or session header** — rejected because the session log already supplies ordering, persistence, fork prefixes, and reconstructability; a second store introduces atomicity and lineage questions.
- **Use hidden log-only events** — rejected because durable state that changes future model behavior must be model-visible and reconstructable under the repository's logging invariant.
- **Persist activation and restart automatically** — rejected because opening or resuming a session must wait for human input; durable phase records status, not fresh authority to spend resources.
- **Count all session turns as goal rounds** — rejected because one session can contain human clarification, inspection, and unrelated work; only goal-attributed continuation turns consume this budget.
- **Add goal state or a generic loop abstraction to `dsh-agent-loop`** — rejected because state and continuation policy can compose through existing plugins, `Agent` verbs, and events without privileging the shipped loop implementation.

## Consequences

- Goal history survives persistence, resume, compaction of unrelated nodes, and session fork as ordinary session data.
- Resume and fork expose the same durable phase while remaining operationally inert until an explicit resume mutation arms activation.
- Full snapshots simplify inspection and strict replay but repeat the objective and state fields in model history until compaction shadows them.
- Revision and lifecycle validation reject tampered, partially written, or producer-inconsistent goal records early.
- Round caps bound continuation count only; token, currency, time, and provider limits remain separate policy concerns.

## Known limitations and deferred work

- This domain records state but does not schedule goal rounds, cancel active turns, or classify abnormal stops.
- The actor that records `complete` or `blocked` is authoritative; an independent evaluator or completion certificate is deferred to a policy consumer.
- There is one current goal per session; parallel objective graphs and cross-session goal storage are absent.
- `GOAL_CHANGE_VERSION` has no pre-release compatibility promise or migration path.
