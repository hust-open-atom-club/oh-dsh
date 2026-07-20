# Agent Note: Bounded recovery for transient LLM request failures

Status: implemented

## Problem

`dsh-llm` can report provider failures either by throwing during adapter dispatch or iteration or by ending with `finish { kind: 'error' | 'aborted' }`. The final adapter boundary tags thrown failures so `dsh-agent-loop` can distinguish them from middleware and result-processing defects, and the loop normalizes both delivery forms into `agent/request-error` after closing the failed step. The default decision is `fail`; `dsh-compact-basic` is the only shipped recovery listener, and it retries a canonical context-window overflow only after compaction proves that the durable surface shrank.

That boundary is already safe for another request attempt. Raw `assistant/chunk` events carry the failed `turn` and `step`, message derivation ignores them unless a successful `assistant/message` cites them, tool calls are dispatched only after a successful terminal finish and assembly, and a retry opens a new numbered step from the durable log. The harness therefore does not need a second response lifecycle or tentative-output protocol to keep two attempts separate.

The prior boundary left three narrower gaps.

- Provider failures retain only a message and usually a code. HTTP status, retry delay, and provider request id are discarded or recoverable only through provider-specific error objects, so generic recovery cannot make or explain a decision without parsing text.
- Retry ownership differs by adapter. The hand-written DeepSeek adapter makes one attempt, while pi-ai profiles can enable opaque library retries. Combining hidden transport retries with an `agent/request-error` listener would multiply attempts and omit intermediate failures from the session log.
- A recovered failure has no durable status fact. The failed step and chunks remain reconstructable, but an observer cannot tell whether the agent is deliberately backing off, for how long, or why. A long silent wait looks like a stalled loop.

The goal is bounded recovery from transient failures of the same explicit provider/model request. Provider or model failover, response splicing, and semantic output repair are different problems and have no current consumer.

## Decision

### Preserve failure facts without embedding policy

`@deepseek-ai/dsh-llm` exports one JSON-serializable `LlmFailure` payload:

```ts ignore-check
type ProviderRequestId = Branded<'ProviderRequestId'>

interface LlmFailure {
  message: string
  code: string
  status?: number
  providerRetryAfterMs?: number
  requestId?: ProviderRequestId
}
```

`code` remains the provider-neutral machine-routing taxonomy established by `HarnessError`; the new fields are observations from the provider boundary. `ProviderRequestId` is owned and constructed by `dsh-llm`, then serializes as its provider-issued string. The payload deliberately has no `retryable`, `failover`, `partialOutput`, provider, model, phase, or route id fields. Retryability belongs to policy, provider/model are already in the durable request header, and partial output is derived from the failed step's `assistant/chunk` events.

`LlmError` carries `failure: LlmFailure` and preserves `failure.code === error.code`. `FinishReasonMap.error` and `FinishReasonMap.aborted` carry the same payload instead of parallel failure shapes. An adapter-thrown `Error` keeps its exact object identity: the final-adapter scope associates the normalized facts with that object in call-local sidecar state and rethrows it unchanged; a non-`Error` throw is wrapped as today. `llmFailureOf(stream, error)` retrieves those facts alongside the existing provenance check, while an in-band finish without an error object becomes a new `LlmError`. This preserves listeners that key on error type or identity while giving all final-adapter failures, including unknown SDK exceptions, an `UNKNOWN` terminal payload.

The agent loop keeps `RequestError` as that exact error object and passes `LlmFailure` as a separate argument to `agent/request-error`; it does not mutate possibly frozen third-party errors. It also uses the payload when converting an in-band finish and when recording an unrecovered `turn/end.reason`.

Adapters extract structured facts before falling back to message inspection. They validate HTTP status, parse `Retry-After` seconds or dates into a positive finite millisecond delay, brand the provider request id when exposed, and distinguish their own timeout from the caller's abort. Provider-specific codes and messages may refine a mapping, but no recovery listener parses them.

The initial shared transient-code set is intentionally small: the adapters' existing `RATE_LIMIT` and `SERVER` mappings plus explicit `TIMEOUT` and `TRANSPORT` codes for the two missing remote-failure families. Authentication, quota, invalid request, context overflow, protocol, abort, and unknown failures keep distinct stable codes and are not transient by default. Adding a code requires adapter fixtures and a documented policy decision; it does not require expanding a second failure-class enum.

### Put retry policy on the existing failed-step seam

`@deepseek-ai/dsh-llm-retry` is a function plugin that listens to `agent/request-error`. It introduces no service or new loop branch; the agent-loop package changes only the data carried through its existing failed-step recovery control flow.

The `agent/request-error` seam carries the current `LlmFailure` and an immutable list of prior failures that led to another request attempt in this consecutive recovery sequence. `dsh-llm-retry` counts only prior failures whose codes are in its configured transient set, while `dsh-compact-basic` counts only prior context-overflow failures. A successful model request clears the history. Alternating transient and context-overflow failures therefore consume their owning policy budgets independently; the maximum request count is one plus the sum of the finite budgets of the loaded recovery policies.

The plugin resolves and validates this deployment configuration at load:

```ts ignore-check
interface Config {
  maxTransientRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  jitterRatio?: number
  retryableCodes?: string[]
}
```

The defaults are two transient retries, a 500 millisecond initial delay, a 10 second delay cap, 10 percent jitter, and the four transient codes above. The count and delay bounds match the conservative edge of the inspected implementations: [OpenCode uses two request retries with 500 ms/10 s bounds](https://github.com/anomalyco/opencode/blob/9976269ab1accfc9f9dc98a4a688c516934de422/%70ackages/llm/src/route/executor.ts#L36-L39), [Pi separates three agent-level retries from provider retries and defaults provider retries to zero](https://github.com/earendil-works/pi/blob/3da591ab74ab9ab407e72ed882600b2c851fae21/%70ackages/coding-agent/docs/settings.md#L139-L147), and [Codex uses finite request/stream budgets plus a five-minute idle timeout](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/model-provider-info/src/lib.rs#L25-L33). Ten percent follows [Codex's bounded jitter](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/codex-client/src/retry.rs#L40-L47). Two retries mean at most three provider requests when no other recovery policy applies. `maxTransientRetries` is a non-negative integer, delays are positive finite numbers with `initialDelayMs <= maxDelayMs`, `jitterRatio` is in `[0, 1]`, and codes are non-empty and unique. These are Cordis config fields rather than hidden constants so deployments can choose different cost and latency budgets.

For an eligible failure with budget remaining, the one-based transient retry count uses bounded exponential backoff. A valid `providerRetryAfterMs` replaces exponential backoff only when it does not exceed `maxDelayMs`; a longer provider delay causes delegation instead of an earlier retry that violates the provider instruction. Local backoff multiplies by an injected random factor in `[1 - jitterRatio, 1 + jitterRatio]` and clamps the final value to `maxDelayMs`; provider delay is not jittered.

The plugin owns a lifetime `AbortController` and tracks every active backoff callback. Each wait fuses the waterfall's turn signal with that lifetime signal. Effect cleanup first unregisters the listener, then aborts and awaits the active callbacks; a captured callback whose lifetime signal aborts returns `fail` and can neither retry nor enter the rest of its captured waterfall after disposal. This makes HMR disposal quiescent even though Cordis has already captured the listener.

Before sleeping, `dsh-llm-retry` appends one non-surface `llm/retry` session event containing the turn, failed step, one-based transient retry number, configured maximum, scheduled delay, and `LlmFailure`. The plugin owns the `SessionEventMap` augmentation; `dsh-session` remains generic persistence and does not absorb the optional policy's vocabulary. The event says what was scheduled, not that the next request completed; cancellation during the delay is subsequently visible on `turn/end`. The event ships only with a production renderer and replay/snapshot coverage, because its purpose is operational state rather than trace collection.

The listener calls `next()` for a non-transient code, an exhausted policy budget, or an over-cap provider delay. This preserves composition with context-overflow recovery and later policy plugins. It returns `{ action: 'retry' }` only after the delay completes under both signals; turn cancellation and plugin disposal return `fail`, after which the loop's cancellation/disposal checks remain authoritative.

The agent-spine demo bundle loads the plugin so the shared stdio/TUI, one-shot CLI, and ACP example compositions use the same bounded policy. Library consumers retain explicit plugin composition: omitting the plugin leaves `agent/request-error` at its current fail default.

### Make one layer own visible attempts

Adapters perform one provider request per `stream()` call. The pi-ai adapter removes public `maxRetries` and `maxRetryDelayMs` profile fields and disables library retries; the hand-written adapter keeps its current single-attempt behavior. This prevents an SDK budget from multiplying the agent budget and ensures every transient retry is represented by a closed failed step plus `llm/retry`.

`ctx.llm.stream()` remains the raw one-attempt waterfall. Direct callers such as compaction summarization receive the structured failure but do not gain automatic retry, because they have no agent step boundary or general durable place to separate attempts. A future direct-call consumer may justify a buffering helper that retries only before emitting a chunk; this decision adds no such helper.

### Bound stalled streams where they can be stopped

Each adapter exposes a validated `streamIdleTimeoutMs` configuration field with the five-minute prior-art default cited above. The interval is capped at Node's maximum timer delay so it cannot be clamped to one millisecond. It covers each outstanding iterator `next()` from demand to the next valid `StreamChunk`; time a consumer spends between `next()` calls is not provider idle time.

`@deepseek-ai/dsh-timeout` exposes a rearmable idle-watchdog primitive. One stable local `AbortController` is fused with the caller signal and passed to the transport for the whole adapter call; each outstanding `next()` arms the watchdog, resolution disarms it, and the next demand rearms it. Timeout aborts that stable controller with a capability-owned `TimeoutReason`, and `finally` clears the timer. The adapter classifies its watchdog as `TIMEOUT` and an earlier upstream abort as `ABORTED`. The existing one-shot `deadline()` is not presented as a sliding timer.

Boundary tests prove termination at both actual transports. The hand-written adapter aborts its fetch/reader, and the pi-ai adapter maps the stable signal through the SDK and proves the SDK closes the response. A timer that merely rejects a consumer promise while leaving the request running does not satisfy the contract.

### Keep attempts separate in the existing log

A failed attempt may leave `assistant/chunk` events in its closed step, but it never appends `assistant/message` and never dispatches a tool. A retry opens the next numbered step, reconstructs the request from the durable surface, and produces its own chunks. UIs may render live chunks while a step is open, then mark or clear that transient view when `llm/retry` identifies the failed step or `turn/end` records terminal failure; message derivation continues to ignore the failed chunks.

If recovery is exhausted, the final failure is stored once on `turn/end.reason` with the structured facts. If transient recovery continues, `llm/retry` is the durable home for that attempt's failure and delay. No standalone final-error event or response-id vocabulary is added.

## Out of scope

- Automatic provider or model failover. Requests already select one explicit provider and model, and the provider registry deliberately has one adapter owner per provider.
- Retrying or continuing after a successful terminal finish, or splicing chunks from two attempts into one assistant message.
- Repairing malformed tool arguments, refusals, content filters, or other semantic model output.
- Unbounded retries, unattended retry-until-cancelled behavior, circuit breakers, shared provider health, or cross-agent retry budgets.
- Changing `llm/stream` into a response lifecycle or adding convenience generation APIs without a production consumer.

## Alternatives considered

- **Retry inside `llm/stream` or the provider SDK** — rejected because a raw stream has no durable attempt boundary after emitting chunks, hidden SDK retries multiply budgets, and neither path can record each failed attempt consistently.
- **Add response start, interrupted, discarded, failed, and committed events to `dsh-llm`** — rejected because the agent log already separates raw chunks, successful messages, and numbered attempts. A second state machine would duplicate ownership without enabling the bounded same-route retry.
- **Add logical routes, capability matrices, and failover selection** — rejected because current requests already name provider and model explicitly, one adapter owns each provider, and no current consumer requires automatic fallback or can prove semantic compatibility.
- **Put `retryable` or `failover` on `LlmFailure`** — rejected because adapters report facts while deployment policy decides action. The same 429 may be retried in an interactive bundle and rejected in a cost-capped batch.
- **Retry forever while the caller remains active** — rejected because it gives one request unbounded cost and latency. Visible status makes bounded waiting understandable; it does not make an unlimited budget safe.
- **Log retry status only through the process logger** — rejected because process logs do not reconstruct session behavior and cannot drive replayed UI state.
- **Keep only flat codes** — rejected because retry delay and provider request id are structured provider facts, and HTTP status is necessary for diagnosis when different wire failures share one stable code.

## Verification

- `LlmFailure` is the single serializable payload for thrown, error-finish, and aborted-finish final-adapter failures; normalization preserves stable code, status, retry delay, branded provider request id, error cause, and caller-abort versus adapter-timeout classification where available.
- An adapter-thrown `Error` reaches `agent/request-error` as the exact same object while its sidecar `LlmFailure` reaches the adjacent argument; tests retain the existing identity assertion for extensible and frozen third-party errors.
- DeepSeek and pi-ai adapter tests cover representative 400, 401/403, 429, 5xx, connection, malformed/truncated stream, timeout, abort, retry-after seconds/date, request-id, and unknown-SDK-error paths without recovery policy parsing message text.
- Pi-ai pins the SDK option to zero retries and performs one observed wire attempt for a retryable provider response; separate tests make removing either boundary fail.
- `agent/request-error` carries current failure facts plus immutable prior-retried failure facts; a success clears that history, and alternating transient/context-overflow integration tests prove the two policies consume only their own finite budgets.
- `dsh-llm-retry` validates every config field at Loader startup, delegates all ineligible paths with `next()`, and makes at most `maxTransientRetries + 1` provider requests when no other policy applies.
- HMR-during-backoff tests prove disposal unregisters the listener, aborts and awaits its captured callbacks, emits no retry decision after disposal, and leaves no timer or promise alive.
- Pure unit tests cover transient-code selection, exponential backoff and jitter bounds, valid and over-cap `Retry-After`, exhausted budgets, deterministic timer/random seams, and abort during backoff.
- Real agent-loop tests cover failure before chunks, partial chunks then failure, thrown and in-band failures, retry to success in a new step, exhaustion to structured `turn/end.reason`, and composition with `dsh-compact-basic` context-overflow recovery.
- The partial-chunk integration test proves failed chunks remain attributed to the failed step, no assistant message or tool side effect is committed for that step, and the successful retry has distinct provenance.
- The plugin-owned `llm/retry` event is non-surface, survives JSONL and SQLite round trips, is ignored by message derivation, and drives TUI retraction plus durable discarded-attempt markers in append-only ACP and stdio streams. Keyless snapshots cover scheduling, cancellation, success, and exhaustion.
- Idle-watchdog tests prove the stable signal is rearmed only while `next()` is outstanding, disarmed during consumer think time and in `finally`, and classified separately from a total-call deadline and an earlier caller abort; adapter tests prove the signal stops the underlying request rather than merely detaching it.
- Direct `ctx.llm.stream()` callers remain single-attempt and receive the same structured failure facts.

## Consequences

- Every transient recovery attempt is visible as a closed step plus `llm/retry`, and the bounded policy prevents hidden SDK retries from multiplying cost. A retry can still duplicate provider billing even when no chunk arrived; the finite attempt budget limits but cannot remove that risk.
- Provider SDKs may hide status or retry headers. Those adapters retain the stable facts they expose and otherwise use a coarse code rather than letting recovery policy parse fragile text.
- Durable retry events expand the session protocol and UI state machine. Shipping the event and its consumer together prevents an unused telemetry vocabulary, but later schema changes still require persistence and replay work.
- Clearing a failed step's live chunks can visibly retract output. That is preferable to presenting discarded text or partial tool JSON as committed history, and snapshots pin the transition.
- Adapter-local idle enforcement stops stalled transports without counting consumer think time. Contract tests at each transport boundary guard against SDK drift.
- Multiple recovery plugins add their finite budgets. Their classifiers remain disjoint here; an overlapping classifier would be registration-order policy and must be documented and tested by the plugins that introduce it.

## Related

- [Structured error taxonomy](../../implemented/architecture/2026-06-11-structured-error-taxonomy.md) owns stable machine-routable codes and cause chaining.
- [Reconstructable requests](../../implemented/architecture/2026-07-05-reconstructable-requests.md) makes provider/model and complete request inputs durable before dispatch.
- [Timeout deadline library](../../implemented/architecture/2026-07-06-timeout-deadline-library.md) separates shared deadline classification from capability-owned termination.
- [After-call compaction pressure and context-overflow recovery](../../implemented/architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md) owns the current closed-step request-recovery seam and bounded overflow retry.
- [Provider-routed LLM adapters](../../implemented/architecture/2026-07-14-provider-routed-llm-adapters.md) owns explicit provider/model routing and the one-adapter-per-provider invariant.
