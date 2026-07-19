# Agent Note: Exact session query service

Status: implemented

## Problem

Session history exists in two places: current `SessionStore` objects and an optional persistence backend. Consumers that need exact inspection would otherwise duplicate live-versus-persisted precedence, persistence lifecycle handling, raw-event surface classification, relationship tracing, and defensive cloning. Durable state can lag the live log between checkpoints, so persistence alone is not a truthful current source.

Full-text search is related but materially larger. Designing provider registration, extraction, synchronization, invalidation, ranking, and cursor contracts before a real backend exists creates two speculative state machines: one in the interface service and another in the eventual database package.

## Decision

`@deepseek-ai/dsh-session-query` owns `ctx.sessionQuery`, a small trusted exact-inspection service over one logical corpus. It exposes `listSessions()`, `listEvents(sessionId)`, bounded `readEvent(request)`, `traceSession(sessionId)`, and `traceEvent(request)`. It does not expose filters, text extractors, search requests, provider registration, or derived-index synchronization. The separate [tracing decision](2026-07-13-session-query-tracing.md) owns lineage and event-relationship semantics.

The service observes the optional `ctx.sessionPersistence` binding dynamically but retains no persisted cache or invalidation listener. Each cross-corpus list asks the active backend for authoritative metadata, then overlays a fresh live-store list. Matching ids become one `SessionRecord`: the live header wins and `live`/`persisted` independently report source availability. Immutable header disagreement is `SESSION_QUERY_SOURCE_CONFLICT`.

An exact target read first checks the live store and snapshots the live header and event log. This path never consults persistence, so a failing durable backend cannot make known live history unreadable. With no live target, the service lists current persistence metadata, proves the id exists, loads it, and rejects a list/load header mismatch. All returned headers and events cross one structured-clone boundary.

## Surface semantics

`dsh-session` exports `foldSurface(events)`, and `SurfaceManager` uses the same transition functions for its incremental cache. The fold returns detached current event sequences and each replacement's actual removed seqs. `listEvents()` and `traceEvent()` use that result to classify every raw event, so inspection cannot disagree with model-history derivation about positional replacement semantics.

`readEvent()` returns the complete target plus raw neighbors by contiguous seq. `before` and `after` default to zero and are independently bounded by `readWindowMax`, default 50. The result carries a cloned `SessionHeader`, not a source-availability record, because determining a live target's persisted flag would violate the guarantee that live exact reads do not depend on persistence health.

## Security boundary

The service is context-wide trusted infrastructure, not an authorization layer. A future model-facing history tool or human UI applies explicit caller/session scope. The service adds no model-facing tool and changes no transcript or snapshot surface.

## Alternatives considered

- **Put logical-corpus resolution directly in every consumer** — rejected because source precedence, conflicts, optional-service lifecycle, cloning, and surface classification are shared correctness rules.
- **Query only persistence** — rejected because checkpoints can lag the current live log.
- **Cache persisted metadata and listen for writes/removals** — rejected because exact reads can ask the authoritative sources directly, while cache invalidation adds lifecycle and concurrency state before scale requires it.
- **Define a provider-neutral search protocol now** — rejected because no provider consumes it. The first SQLite FTS package should own one reconciliation/transaction state machine; a smaller shared seam can be extracted later only when a second implementation proves the boundary.

## Consequences

The service has one source-resolution state variable: the currently mounted persistence service. There are no provider queues, fingerprints, extractor registries, observation generations, or derived index updates. Exact reads and event traces remain usable in live-only deployments and deterministic when persistence is present.

Cross-corpus listing, lineage tracing, and persisted event operations perform backend I/O on each call. That is deliberate: correctness comes from current authoritative state, and scale-oriented search belongs to the proposed database package. Full-text search is unavailable until that package defines and implements its complete contract.
