# Agent Note: Compaction as a capability seam (abstract contract + basic backend)

Status: implemented

## Problem

A long-running agent conversation grows without bound. As the event log accumulates turns, the derived message history eventually approaches the model's context window — the model then truncates mid-response (`max-tokens`) or degrades. **Compaction** is the mitigation: replace a run of older history with a concise summary, keeping recent context intact.

The [session surface](../architecture/2026-06-18-session-surface.md) was built as the foundation for exactly this — an ordered projection over the event log with a `surfaceOp: { op: 'replace', start, end }` operation purpose-built to shadow a range of entries and insert a replacement, with `sourceEventSeqs` recording provenance so the decision replays deterministically. What remained was the plugin that *decides what to compact and produces the summary*.

Two forces shape the design. First, compaction policy and reusable token measurement vary independently: measurement belongs to the LLM-family [`ctx.tokenMeter` service](../architecture/2026-07-15-replay-token-meter-service.md), while summarization can be a model call, a template, or a remote service. Second, `SurfaceEventType` is closed to five event types (`user/message`, `assistant/message`, `tool/result`, `context/message`, `steering/message`); only those may carry `surfaceOp`. A bespoke `compaction/*` event therefore **cannot** itself appear on the surface — the compiler rejects `surfaceOp` on it and the invariants plugin rejects it at runtime.

## Decision

### Compaction is a capability seam, split interface / implementation

Per the [capability-seams Agent Note](../architecture/2026-06-13-capability-seams.md), compaction ships as separate packages so the contract, the algorithm, and (later) the consumer surface evolve independently:

1. **Interface** — `@deepseek-ai/dsh-compact`: an abstract `CompactService` owning the `ctx.compact` key, the `CompactionResult` vocabulary, and the `compact/*` session events. It declares `compactIfNeeded()` and `compactRegion()` as **abstract** — the contract states *what* compaction does, not *how*.
2. **Implementation** — `@deepseek-ai/dsh-compact-basic`: a concrete `BasicCompactService` that consumes `ctx.tokenMeter` and owns the tail→head retention walk, summarization via `ctx.llm.stream()`, the surface replacement, the lock, post-step pressure, and canonical context-overflow recovery. `summarize()` is its sole subclass hook; pricing and replay stay with the meter.
3. **Consumer** — deferred. A `/compact` tool and slash command will `inject: ['compact']` and call the contract; they are intentionally out of scope here so the seam settles first.

### The contract depends on `dsh-session` and `dsh-llm` — a deliberate deviation

The capability-seams Agent Note states the interface package "depends only on cordis" (true of `dsh-bash`, whose vocabulary is self-contained). Compaction **cannot** honor that: its verbs act on an agent-owned `Session` (`compactRegion(start, end, agent)`) and its output uses the content vocabulary (`CompactionResult.summary: ContentBlock[]`). There is no way to express the contract without naming `Session`/`SessionEvent` (from `dsh-session`) and `ContentBlock` (from `dsh-llm`).

This is not a coupling smell — it is the contract's domain. The "only cordis" guidance was always shorthand for "the interface depends only on what the contract genuinely names, and never on an implementation." `dsh-session` and `dsh-llm` are themselves interface/vocabulary packages, not implementations; `dsh-compact` still imports no backend. The seam's real invariant — *consumers and implementations evolve independently behind an abstract service* — holds intact.

### Abstract `compactIfNeeded` / `compactRegion`, algorithm in the backend

An earlier draft put the full algorithm (the retention walk, token-summing, text extraction) as concrete methods on the interface. That recouples the contract to one strategy: a backend that wants a different retention policy or event sequence would have to fight inherited concrete code. Making both core methods abstract puts every *how* decision in the backend and keeps the interface a statement of *what*. Token measurement is not a compaction hook at all; the singleton service lets multiple consumers share one per-session replay fold.

`compactIfNeeded(agent, trigger, signal)` takes an explicit `'pressure' | 'context-overflow'` trigger and cancellation. It reads only the latest durable routed request; no header means no work, while any routed provider/model target uses the singleton estimator. `compactRegion(start, end, agent, signal?)` uses `agent.session` as its single session identity and keeps an optional signal for manual callers. The default summarizer resolves its target from explicit config, the latest logged routed target, then agent options, and records the provider/model pair after any `llm/stream` routing.

### Automatic pressure runs after successful durable step work

Successful-call pressure cannot run at pre-step because final `agent/request` routing, provider output, tool results, buffered context, and steering do not exist there. Serial `agent/post-step(agent, turn, step, signal)` fires after those facts are durable and before `step/end`. `dsh-compact-basic` measures the canonical logged request through `ctx.tokenMeter`, so the next request sees any replacement without a speculative envelope override.

Canonical provider context overflow takes a separate path. The failed step closes, `agent/request-error` receives the original request error and consecutive retry count, and compact-basic forces one useful balanced reduction. It returns retry only if `session.surface.replaceGeneration` increases; the loop then opens a new numbered step and reconstructs its request from the durable log. No range, no replacement, recovery failure, cancellation, an exhausted cap, or an unrelated error preserves the original provider failure. The complete lifecycle decision is in the [after-call recovery Agent Note](../architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md).

```
assistant/message → tool/result/context/steering
await serial agent/post-step          ⟵ pressure compaction inside the successful step
step/end

provider overflow → step/end
await waterfall agent/request-error  ⟵ forced compaction between attempts
retry → next numbered step/start      ⟵ derives from the replacement surface
```

### Retention is turn-agnostic; tool-pairing balance is the only structural guard

Auto-compaction checks after **every successful** step, not once per turn. This is load-bearing for runaway-turn survival: a tool-heavy ReAct turn appends an `assistant/message` + a `tool/result` per step, so the surface grows within a turn. The post-step check can compact early closed tool pairs before continuation opens the next step, and provider-confirmed overflow remains the backstop when a request crosses the limit first.

`compactIfNeeded` retains the smallest tail of whole surface units whose estimated size reaches `retainTokens` and compacts older nodes. A unit is a complete closed step or one no-step message. If the token cutoff lands inside a step, retention expands until the cut is tool-pairing balanced. Balance is checked on surface order, not log sequence, because replacement summaries have new sequence numbers at old surface positions. `dsh-compact` exports the before/after edge helpers; their per-session cache folds only appended surface-tail nodes while `replaceGeneration` is unchanged, does no event reads for log-only growth, and rebuilds current membership and balances after replacement. `compactRegion` rejects boundaries that split a tool call from its result. The in-flight turn receives no special retention.

A runaway turn thus compacts exactly like any other history: its early *closed* steps get summarized while its recent steps stay verbatim. When the only compactable content left is an un-splittable open tail step (its tool-calls have no results yet), compaction declines (`null`) and retries once that step closes.

**Single-unit overflow is out of scope, by design.** If a single retained unit — one closed step, or a large free entry such as a pasted `user/message` — *alone* exceeds the budget, compaction cannot help and the next model call may go out over-budget. Bounding an individual unit's size is a separate concern (output truncation), handled elsewhere; compaction makes no promise about it, and the harness without such a mechanism can still break on a single oversized unit. This is named honestly rather than papered over.

### Head-anchoring: one auto checkpoint, always at the head

Auto-compaction always starts at the surface head, merging the prior checkpoint with newly compacted history so only one automatic checkpoint remains. `shadowedRange` is therefore positional rather than a numeric sequence interval: a newer summary sequence may occupy an older surface position. `shadowedSeqs` records the authoritative surface order. Manual mid-range compaction may leave multiple checkpoints.

### Approximate convergence invariant

`resolveConfig` supplies usable defaults: threshold ratio `0.8`, retained tail `floor(contextWindow × 0.16)`, empty summarization provider/model overrides, `maxTokens: 8192`, `compactionRetries: 1`, `maxOverflowRetries: 1`, and `auto: true`. Optional top-level `thresholdRatio` and `retainTokens` override the policy for the token meter's single context window; retention must remain below the resulting threshold. Convergence remains dynamic because provider output caps can be spent on hidden or surfaced reasoning tokens and summary size is unpredictable. If pressure remains over threshold, `compactIfNeeded()` re-compacts the head checkpoint up to the configured retry count, but each committed summary must be smaller than what it shadows. Overflow bypasses threshold and retained-tail policy for one maximal balanced head reduction, leaving the newest indivisible unit.

### Surface replacement: `compact/*` events are log-only; one `user/message` carries the summary

Because `SurfaceEventType` is closed, the summary cannot ride on a `compact/*` event. The backend instead appends a **single `user/message`** with `surfaceOp: { op: 'replace', start, end }` whose `content` is the (framed) summary and whose `sourceEventSeqs` covers the shadowed entries *and* the bookkeeping events. The `compact/*` events are pure log records (lock + provenance). The surface mutation sits **inside** the lock — `compact/end` is the last event appended:

```
compact/start    → log-only. Acquires the lock.
[summarize older range via the backend]
compact/summary  → log-only. Provenance: raw summary, range, shadowed seqs, token count.
user/message     → surfaceOp { op:'replace', start, end }. THE surface mutation (framed summary).
                   deriveMessages() renders it as a user-role message.
compact/end      → log-only. Releases the lock (carries `error` on a recoverable failure).
```

`deriveMessages()` then yields `[summary_as_user_message, ...retained_entries]`. Reusing `user/message` is honest rather than a workaround: a summary genuinely *is* user-role context.

### Checkpoint framing + incremental merge (backend-private)

The basic backend wraps the summary as established checkpoint context and tags it for incremental merging on the next cycle. The raw summary remains on `compact/summary`. Framing is backend policy; the seam promises only that one replacement user message carries the possibly framed summary.

### Blocking via a log-recorded lock, plus a crash/recoverable failure taxonomy

The `compact/start … compact/end` bracket is justified, in order of what now does the work:

1. **Crash-detectable orphan + provenance** (primary). Summarization is a slow model call persisted *after* `compact/start`. A crash mid-summarization leaves a `compact/start` with no matching `compact/end` — a detectable orphan. Releasing the lock last (rather than first) converts the crash window from *silent corruption* into that detectable orphan.
2. **Prevents concurrent compaction.** `compactRegion` refuses to start if the current turn holds an unmatched `compact/start`. (The loop is single-threaded across either awaited automatic seam, so this is also a re-entry tripwire — a thrown "already in progress" signals a real bug.)

Two failure paths, both documented:

- **Crash** (the loop dies mid-summarization): a dangling `compact/start`, no closer. Because `compact/*` are **log-only**, the orphan is **inert** — the surface replacement never landed, so the full, uncompacted history derives correctly. Generic turn-repair (`interruptedTurnClosers`) closes the turn with a synthetic `turn/end`; the orphan sits *before* that `turn/end`, so the turn-scoped in-progress check never sees it and a crash cannot wedge future compaction.
- **Recoverable** (summarization throws but the loop survives): the backend appends `compact/end` with its **`error`** field set and leaves the surface untouched. Post-step pressure warns and continues; overflow recovery delegates so the original provider error remains authoritative.

`compact/end` keeps its `error?` field (mirroring `tool/result`'s self-contained error — one event tells success from failure without correlating a sibling). There is no separate `compact/error` event.

**Core session repair stays compaction-agnostic — deliberately.** `interruptedTurnClosers` is never taught about `compact/*`. Teaching it would force every future `xxx/start … xxx/end` plugin pair to patch a core module — exactly the coupling the capability-seam architecture exists to avoid. Because the log-only orphan is inert, no special repair is needed: generic turn-repair plus the inertness of an un-landed surface mutation is sufficient.

## Alternatives considered

- **The full algorithm as concrete interface methods** — rejected because it recouples the contract to one retention strategy. Both core methods are abstract; reusable measurement is a separate LLM-family service and `summarize()` is basic's sole hook.
- **Compaction on `agent/request` or provisional `agent/pre-step` inputs** — rejected because neither proves the final durable request and both couple generic lifecycle to compaction-specific envelope data. Post-step replay plus canonical overflow recovery covers both successful and rejected calls.
- **A separate `compact/error` event** — rejected: `compact/end` keeps an `error?` field, mirroring `tool/result`'s self-contained error — one event tells success from failure without correlating a sibling.
- **Teaching core turn-repair about `compact/*`** — rejected: the log-only orphan is inert, and a core module patched for every future `xxx/start … xxx/end` plugin pair is exactly the coupling the capability-seam architecture exists to avoid.

## Consequences

- **Packages**: `packages/compact/compact` supplies the interface and `compact-basic` supplies the backend. `packages/llm/token-meter` owns replay-aware measurement independently. The consumer tier is deferred.
- **Automatic seams**: `agent/post-step` (`@mode serial`) handles successful-call pressure and `agent/request-error` (`@mode waterfall`) handles final request failures after the failed step closes. Generic `agent/pre-step` remains a four-argument checkpoint with no compaction-only prompt/prefix payload.
- **`SessionEventMap`** gains `compact/start` / `compact/summary` / `compact/end` by declaration merging (merge-extensible); `SurfaceEventType` is **not** touched. These are session events, not cordis `Events`, so the event-taxonomy gate needs no entry.
- **`dsh-compact`** owns `toolPairingBalancedBefore(session, seq)` and `toolPairingBalancedAfter(session, seq)`, the cached surface-edge checks that `compactRegion` and `compactIfNeeded` use to avoid splitting a tool-call/result pair. The cache validates current membership by seq and answers both edges from one per-cut balance sequence; stale or missing seqs and orphan results reject. `dsh-session` continues to own the surface `replace` operation, ordered event sequences, and rewrite generation.
- **`dsh-invariants`** drops its `surface replace: start must be <= end` assertion: a head-anchored compaction lands a high-seq replacement entry at an older range's *position*, so `start > end` numerically is normal and valid (the range is positional, validated by the surface's `indexOf` checks that remain). The turn-enclosure invariant is reused unchanged.
- **Wiring**: `examples/repl-agent/cordis.yml` loads zero-config `dsh-token-meter` before `dsh-compact-basic`; the service-wide window and compact defaults make the pair usable without repeated numeric policy.

## Testing

- **Unit:** Real Loader and invariant plugins cover whole-unit retention, convergence failure, both `compact/end` outcomes, head anchoring, open-tail refusal, inert crash orphans, forced below-threshold overflow, generation proof, caps, and original-error preservation.
- **Loop:** Tests pin post-step after durable tool results and before `step/end`, actual `agent/request` routing, closed failed steps, fresh retry numbering, and complete thrown/in-band overflow → compaction → reconstructed retry composition.
- **With-key e2e:** A real model and bash session with lowered limits triggers compaction, records a complete `compact/start…end` pair, shrinks the surface, and finishes the task.
- **Snapshot gap:** Runaway-turn compaction cannot yet replay because the summarization call records no `assistant/chunk` events or `sessionId`; interleaved summarization-call replay remains follow-up work.
