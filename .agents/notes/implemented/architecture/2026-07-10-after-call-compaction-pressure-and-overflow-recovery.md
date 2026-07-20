# Agent Note: After-call compaction pressure and context-overflow recovery

Status: implemented

English | [中文](2026-07-10-after-call-compaction-pressure-and-overflow-recovery.zh.md)

## Problem

`agent/pre-step` runs before final request routing and before assistant output, tool results, buffered context, and steering exist. Even with the assembled prompt and session prefix, its pressure view is provisional because `agent/request` can still change routing or call configuration and tool schemas are not frozen with those inputs. Adding fields cannot make pre-call state describe a completed call and couples the generic seam to compaction.

Successful calls are not the only pressure signal. A provider can reject a request for exceeding its context window before it returns usage, and some successful calls omit usage. The system therefore needs replayable post-call pressure plus a narrow failure-recovery path that preserves the provider error whenever compaction cannot prove useful progress.

## Decision

### Successful pressure moves to a durable post-step checkpoint

`agent/pre-step` is narrowed to `(agent, turn, step, signal)`. It remains a generic serial checkpoint before `step/start`, but it carries no compaction-only prompt or prefix fields.

The loop fires awaited serial `agent/post-step(agent, turn, step, signal)` after assistant output, every dispatched or synthetic tool result, post-tool context, and steering are durable, but before `step/end`. This placement gives pressure policy the complete successful-call state without splitting an assistant tool call from its result. A listener failure is an ordinary turn failure; it never enters model-request recovery.

`dsh-compact-basic` reads the exact latest routed model from the durable request header only to establish that a completed route exists, then asks the singleton `ctx.tokenMeter` to measure the canonical logged envelope and current surface. It does not fall back to `AgentOptions.model` for automatic pressure. A headerless session has no completed routed request to assess and produces no work; any durable non-empty model name uses the same estimator. Operational measurement or summarization failures warn and continue with full history.

### Request recovery is limited to the final model boundary

`RequestError`, `RequestErrorDecision`, and the `agent/request-error` waterfall represent failures after the final adapter has been selected. Each returned stream handle owns a private failure set that preserves the original thrown error identity across dispatch, iterator construction, and iteration without leaking nested-call provenance into an outer call. Terminal in-band `error` or `aborted` finishes enter the same path. Prompt assembly, request middleware, request logging, result processing, tools, post-step listeners, and cleanup remain ordinary failures.

The failed step closes before recovery runs. A retry opens the next numbered step and rebuilds the request from the durable log; consecutive recovery attempts reset only after a successful provider request. Both DeepSeek adapters normalize recognized provider context-limit failures to `CONTEXT_WINDOW_EXCEEDED`.

If cancellation lands after assistant tool calls are durable but before all calls dispatch, the loop records a synthetic `tool/call` and aborted `tool/result` pair for every undispatched call before following the normal abort path. The surface therefore never retains orphaned durable tool calls merely because cancellation won the race.

### CompactService exposes intent, not token accounting

`CompactService.compactIfNeeded(agent, trigger, signal)` accepts `trigger: 'pressure' | 'context-overflow'`. The interface gains no estimation methods or token types; `ctx.tokenMeter` remains the reusable accounting owner.

For `pressure`, compact-basic applies the service-wide threshold and retained-tail policy to one unified `ctx.tokenMeter.measure()` result. The same singleton meter owns range pricing, provenance, shadowed token counts, and non-shrinking-summary rejection. The common defaults remain threshold ratio `0.8`, retained history `floor(contextWindow × 0.16)`, summarization provider/model `''`, `maxTokens: 8192`, `compactionRetries: 1`, and `auto: true`.

For canonical overflow, compact-basic bypasses scalar pressure and the normal retained-token budget. It chooses the maximal tool-balanced head range while leaving the newest indivisible unit, then attempts exactly one shrinking compaction under the same signal. The automatic listener snapshots `session.surface.replaceGeneration` and returns `{ action: 'retry' }` only when compaction succeeds and the generation increases. A backend returning a result without replacement cannot authorize retry.

`maxOverflowRetries` is optional and defaults to `1`; `0` disables overflow recovery without disabling pressure. `auto: false` registers neither automatic listener. Noncanonical errors, exhausted attempts, an already-aborted signal, a missing routed model, no safe range, no generation change, and recovery throws all delegate to the next listener. With no later recovery, the loop reports the original provider error object and code. Cancellation or disposal remains authoritative even if recovery work completes concurrently.

The default summarizer resolves explicit configuration, then the latest logged route, then agent options. Because direct `llm/stream` middleware may reroute that auxiliary call, `compact/summary.{provider, model}` records the final mutable `GenerateOptions` target observed after dispatch rather than the pre-waterfall candidate.

## Testing

Unit tests cover final-adapter failure provenance and identity, closed-step retry numbering and reset, cancellation and disposal, post-step ordering, routed-envelope pressure, balanced overflow reduction, generation proof, caps, delegation, and auxiliary-call routing. Real-loop tests cover thrown and in-band overflow through compaction to a reconstructed retry request.

## Alternatives considered

- **Keep provisional pre-step pressure and add more arguments** — rejected because later routing and request mutation remain outside any earlier snapshot, while generic lifecycle becomes coupled to one plugin.
- **Retry the same numbered step** — rejected because recovery appends durable events after the failed boundary. A new step preserves balanced nesting and reconstructability.
- **Retry whenever `compactIfNeeded` returns a result** — rejected because a custom backend can report success without changing model-visible state. `replaceGeneration` is the authoritative proof.
- **Let compact-basic parse provider wording** — rejected because classification belongs at adapters and must cover both thrown and in-band delivery.
- **Fall back to `AgentOptions.model` when no durable route exists** — rejected because automatic policy must describe a completed logged request. Headerless pressure and recovery delegate unchanged.

## Consequences

Post-step pressure describes the completed routed request, including durable tool results and request-only prefix fields. Canonical overflow supplies the backstop when no successful usage anchor exists. Recovery is bounded, cancellation-owned, and monotonic: it retries only after a visible surface generation change.

The cost is one additional serial checkpoint on successful steps and adapter-maintained overflow classification. Provider wording and heuristic character density remain maintenance risks. Surface compaction still cannot repair an envelope that alone exceeds the window or split one indivisible oversized message/tool unit.

This Agent Note supersedes only the pre-step automatic-trigger portion of the [compaction capability-seam Agent Note](../feature/2026-06-18-compaction-capability-seam.md). The service split, standalone token meter, balanced range contract, log-recorded lock, summary replacement, and sole `summarize()` subclass hook remain unchanged.
