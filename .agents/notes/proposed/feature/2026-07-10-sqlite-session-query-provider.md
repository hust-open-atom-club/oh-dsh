# Agent Note: SQLite FTS5 session search

Status: proposed

## Problem

The exact-read `ctx.sessionQuery` service deliberately has no derived index. Large persisted histories need full-text search without scanning every event on every query, while current live sessions need an overlay newer than the last durability checkpoint. Search also needs concrete ranking, snippets, pagination, cancellation, and rebuild behavior.

Splitting those concerns across a speculative provider coordinator and a database implementation would create two coupled reconciliation state machines. The first real implementation should own the source observation, extraction, SQLite transaction, generation, and query as one lifecycle.

## Proposal

Add `@deepseek-ai/dsh-session-query-sqlite` beside the exact-read package. The package will expose a search service or extend the family with the smallest API required by its actual consumers; phase one does not pre-commit a provider-registration protocol. It will depend on `ctx.sessions` and optional `ctx.sessionPersistence`, own a separate derived SQLite database, and reuse the canonical `foldSurface()` classification.

The implementation owns one serialized reconciliation/DB transaction state machine. A transaction observes authoritative persisted metadata and live snapshots, extracts semantic documents, updates derived tables, advances relevant cursor generations, and executes or enables the corresponding query. No second service maintains parallel fingerprints, dirty flags, live-id sets, or invalidation generations.

Persisted documents survive restarts. Live overrides are connection-local and shadow the persisted rows for the same session, then disappear when the live owner or database closes. The derived database remains separate from canonical persistence so index reset, corruption, tokenizer changes, and schema churn cannot endanger durable conversation logs.

## Search semantics to decide with implementation

The implementation must define both cross-session and within-session scopes from executable use cases. Each searchable event is one document with session metadata, event metadata, surface classification, normalized semantic text, and a bounded plain-text snippet. Session results group by their strongest matching event; numeric backend scores remain private.

Search returns content-bearing result records rather than metadata-only headers. Chainable filters operate on that exact result shape and are designed and implemented with the search API instead of becoming a provider-specific pre-ranking contract. Query syntax is treated as data. Ordering includes stable tie fields. Opaque cursors bind to normalized request shape and the smallest relevant generation; unrelated session changes should not invalidate a within-session cursor. Cancellation must stop caller waiting and interrupt SQLite work where the runtime permits.

Tokenizer choice remains an implementation experiment. FTS5 trigram supports substring recall but rejects useful terms shorter than three characters and increases index size; the proposal must benchmark that tradeoff against the default Unicode tokenizer before making it contract.

## Extraction and reconciliation

The package starts with first-party semantic extraction for messages, reasoning, tool calls/results, blocked prompts, context, steering, todos, and error/status detail. Structural events and stream chunks contribute no document. Unknown declaration-merged event/content types remain non-searchable unless a real extension consumer demonstrates the need for a public extractor registry.

Reconciliation may use stable fingerprints to avoid rewriting unchanged persisted sessions, but the database package owns their calculation and storage. It must never report a row current when source observation or extraction failed. Provider-schema mismatch may reset only the derived database; ordinary source changes use transactional upsert/delete. Mounted but unreadable persistence fails affected searches without affecting canonical writes or known live exact reads.

## Alternatives considered

- **Add FTS tables to the canonical persistence database** — rejected because a rebuildable index must not share the authoritative log's schema/reset/failure boundary.
- **Reintroduce phase-one provider coordination** — rejected because there is one planned implementation and no evidence for a stable multi-provider seam.
- **Persist live overrides immediately** — rejected because live events are not canonical until the existing checkpoint commits.
- **Return BM25 scores** — rejected because provider-specific numeric scales are unstable across corpus changes.

## Acceptance criteria

- Restart tests cover unchanged, new, changed, and deleted persisted sessions without rebuilding the whole index.
- Reopening preserves persisted rows and removes live rows; live rows shadow and then reveal their persisted base.
- Tests cover both search scopes, content-bearing results, chainable result filters, surface defaults, snippets, escaping, deterministic ties, pagination, scoped stale cursors, cancellation, dynamic persistence mount/unmount, and recovery after a failed transaction.
- A schema mismatch resets only the derived database.
- A keyless end-to-end test combines a real persistence backend with the real SQLite search package.
- The Agent Note is amended to the measured tokenizer and public API actually implemented before moving to `implemented/`.

## Risks

A single owner is simpler but initially less reusable than a provider-neutral seam. That is intentional: a second real backend can reveal what to extract. SQLite runtime differences can affect FTS ranking and snippets, so tests must pin only contract-controlled ordering and presentation. The separate database adds configuration and lifecycle work, but preserves the canonical store's safety boundary.
