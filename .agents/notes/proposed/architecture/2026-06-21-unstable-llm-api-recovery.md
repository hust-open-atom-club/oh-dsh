# Agent Note: Treat unstable LLM APIs as a first-class failure mode

Status: proposed

## Problem

LLM APIs are not a stable local function call. They rate-limit, overload, return 5xx/502/503 from gateways, close streaming sockets before `[DONE]`, emit malformed or provider-specific error payloads, hang mid-stream, surface SDK errors as in-band events, and sometimes require a delayed retry using `Retry-After`. The harness currently contains good error containment, but it does not yet treat this API instability as a first-class design problem.

`dsh-llm` defines two sanctioned adapter failure paths - throw from `stream()` or end with `finish { kind: 'error' | 'aborted' }` - and downstream consumers are expected to treat both as failed model calls. That was the right MVP containment baseline, documented in [the architecture](../../../../docs/architecture.md) and reinforced by [the twin-adapter RFC](../../implemented/architecture/2026-06-13-twin-llm-adapters.md). It is not enough for callers that depend on an unstable remote model API for every turn, and it forces every caller to understand two failure delivery mechanisms.

The audit found three load-bearing gaps.

- `LlmError` and `FinishReasonMap.error` carry only `message`, `code`, and sometimes HTTP `status` ([packages/llm/llm/src/index.ts](../../../../packages/llm/llm/src/index.ts), [packages/llm/llm/src/types.ts](../../../../packages/llm/llm/src/types.ts)). A caller cannot reliably tell "retry this after 800 ms on the same endpoint", "fail over to another route for the same model", "ask the user for credentials", "never retry because the request is invalid", "provider truncated the stream after committed output", or "adapter protocol bug" without provider-specific heuristics.
- The `llm/stream` waterfall is documented as the place for retry/routing/caching, but its value is one raw `AsyncIterable<StreamChunk>`. A listener can technically catch an API error and call `next()` again, but once it has yielded chunks, callers may already have rendered them, buffered them as output, or executed side effects based on completed tool calls. Retrying after that point can concatenate chunks from two provider responses into one apparent model output. The current surface has no canonical way to say "the tokens you saw were tentative; this response timed out, so discard them and restart."
- The adapter registry is one adapter per model name. That makes "logical model" and "concrete API route" the same thing, so the service has no vocabulary for "same model through another endpoint or SDK", "same provider region with different health", "fallback route with compatible capabilities", provider request ids, or per-route backoff state.

The result is a package that can surface an unstable LLM API failure, but cannot make principled recovery decisions for its callers. Ordinary provider turbulence should not require every consumer to reinvent retries around an unsafe stream boundary.

## Proposal

Introduce an LLM-call v2 contract centered on API-instability recovery: classify provider/API failures, separate provider responses from committed model output, route logical models through recoverable API routes, and make conservative retry/failover the default behavior in `dsh-llm`. Because the harness is unreleased, this should be a breaking cleanup rather than a compatibility layer around the underspecified v1 surface.

### 1. Replace flat error codes with a serializable `LlmFailure`

Keep `HarnessError` as the common thrown-error base, but make LLM failures carry a structured, JSON-serializable payload. `code` remains a stable leaf label for logs and provider-specific matching; retry/failover policy branches on the structured fields.

```ts
type LlmFailureClass =
  | 'auth'
  | 'rate-limit'
  | 'quota'
  | 'invalid-request'
  | 'unsupported'
  | 'timeout'
  | 'transport'
  | 'provider-overloaded'
  | 'provider-unavailable'
  | 'provider-bug'
  | 'protocol'
  | 'safety'
  | 'aborted'
  | 'unknown'

type LlmFailurePhase =
  | 'request-build'
  | 'connect'
  | 'response-headers'
  | 'stream'
  | 'finish'

interface LlmFailure {
  message: string
  code: string
  class: LlmFailureClass
  phase: LlmFailurePhase
  retryable: boolean
  failover: 'never' | 'same-model' | 'compatible-model'
  partialOutput: 'none' | 'uncommitted' | 'committed'
  provider?: string
  routeId?: string
  model?: string
  wireModel?: string
  status?: number
  retryAfterMs?: number
  requestId?: string
}
```

`LlmError` should carry `failure: LlmFailure`; `FinishReasonMap.error` should carry the same payload instead of a parallel `{ message, code? }` shape. Adapter-thrown errors and in-band finish errors are input forms to the recovery layer. The public lifecycle stream should convert classified LLM API failures into terminal lifecycle events rather than requiring callers to catch thrown provider errors. The failure payload is serializable so callers can log or persist it if they choose, while the internal thrown `LlmError` may still carry a non-serializable `cause` chain for local debugging.

Adapters are responsible for faithful provider/API classification at their boundary: HTTP status, `Retry-After`, provider request id headers, SDK error type, timeout vs caller abort, malformed SSE, missing `[DONE]`, unknown finish reason, and unsupported local request shape. The current pi-ai adapter's regex over message text is acceptable only as a temporary fallback when the SDK hides the real status; the adapter should prefer structured SDK/provider fields when available.

### 2. Split provider responses from committed model output

Make "response" a first-class boundary in `ctx.llm.stream()`. An adapter streams one provider API response. The LLM service runs zero or more responses according to recovery policy and exposes one canonical response-lifecycle stream to consumers. Convenience APIs may expose a committed-or-failed result for simple callers, but that result must be derived from the lifecycle stream, not a parallel contract.

The primary response id is generated by the harness before the adapter call starts. Provider response ids and request ids are metadata attached when known; they are not the primary key because providers may omit them, report them only after the stream starts, reuse them in surprising ways, or fail before one exists.

The important invariant: chunks from a failed response must never be silently spliced together with chunks from a later response as one apparent model result. Token deltas from a response are tentative until that response reaches a committing terminal finish (`stop`, `tool-calls`, or `max-tokens`). The lifecycle stream must be able to report that tentative tokens were shown live, then discarded because the response timed out, disconnected, or otherwise failed before commit.

The event vocabulary should keep the familiar `assistant/chunk` concept but stop pretending every chunk is already final output. A possible spelling is:

```ts ignore-check
type LlmStreamEvent =
  | { type: 'response/start'; responseId: ResponseId; responseIndex: number; routeId: string }
  | { type: 'assistant/chunk'; responseId: ResponseId; commitment: 'uncommitted'; chunk: StreamChunk }
  | { type: 'response/interrupted'; responseId: ResponseId; failure: LlmFailure; scheduledRetryMs?: number }
  | { type: 'response/failed'; responseId?: ResponseId; failure: LlmFailure }
  | { type: 'response/committed'; responseId: ResponseId; message: Message; finish: FinishReason; usage?: TokenUsage }

type LlmCallOutcome =
  | { type: 'committed'; responseId: ResponseId; message: Message; finish: FinishReason; usage?: TokenUsage }
  | { type: 'failed'; responseId?: ResponseId; failure: LlmFailure }
```

The implementation may choose the exact names, but the type shape should make the state transition obvious: assistant chunks start uncommitted, then the enclosing response becomes interrupted/discarded, failed, or committed.

- **Lifecycle assistant chunks.** The lifecycle stream should make the old ambiguity explicit: these events are assistant chunk messages, but each one belongs to a response and has a commitment state. Most arrive as uncommitted live UI state; a response that fails before commit marks them interrupted/discarded, and a response that reaches a committing finish lets the UI mark that response committed.
- **Retry before commit.** If an API response fails before a committing finish, the service may retry or fail over and exclude the failed response from the committed result, while surfacing response diagnostics separately.
- **Commit on terminal finish.** Once a response reaches a committing finish, the response owns the visible result. `dsh-llm` emits a `response/committed` event carrying the fully assembled assistant `Message`, final `FinishReason`, usage, and response metadata. Callers that persist messages, execute tool calls, or otherwise take side effects should use this committed event rather than rebuilding output from lifecycle chunks.
- **Terminal failure.** If recovery reaches a non-retryable failure, is aborted by the caller, or otherwise stops without a committing finish, `dsh-llm` emits `response/failed` carrying the final `LlmFailure` and ends the lifecycle stream normally. Throwing is reserved for defects outside the classified LLM API failure contract.
- **Fail after commit.** If a later failure is ever observable after commit, the lifecycle reports `response/failed` with `partialOutput: 'committed'`; automatic retry is not allowed unless a later RFC designs an explicit continuation/repair protocol.

This means replacing the single overloaded raw-chunk `llm/stream` waterfall with a lifecycle stream and narrower hooks: one around a single provider response, one around recovery policy decisions, and one around convenience APIs that only expose the terminal outcome. Names are implementation details for the follow-up PR, but the semantics are not: plugins must be able to wrap "one API response" without pretending they can safely retry already-committed chunks.

### 3. Route logical models through recoverable API routes

Separate the logical model a caller requests from the concrete provider route that serves a response. Replace "one adapter per model name" with route registration, for example:

```ts ignore-check
ctx.llm.registerRoute({
  routeId: 'deepseek-direct:deepseek-v4-flash',
  model: 'deepseek-v4-flash',
  wireModel: 'deepseek-v4-flash',
  provider: 'deepseek',
  adapter,
  priority: 0,
  capabilities: { tools: true, reasoning: true, images: false, prefill: false },
})
```

`GenerateOptions.model` remains the logical model. The service resolves it to a route for each API response, records the route in failure/response diagnostics, and can retry on the same route or fail over to another route with compatible capabilities. Duplicate model names become normal; duplicate route ids are the conflict. This is the smallest vocabulary that can express direct endpoint vs SDK-backed endpoint, regional endpoints, and future fallback models without making every caller own routing.

The route registry must keep the lifecycle guarantees of the current adapter registry: `registerRoute()` is effect-scoped, returns a disposer, and has an HMR-safety test proving disposal removes the route. It should not preserve `llm/adapter-change`; if [PR #82](https://github.com/deepseek-ai/deepseek-harness/pull/82) lands first, that event is already gone, and the route registry should not reintroduce it without a concrete consumer.

The new ids should follow the branded-id policy. `ResponseId`, `RouteId`, and the logical/wire model ids cross package boundaries and are easy to swap accidentally, so the implementation should deliberately brand or explicitly decline to brand each one in line with `2026-06-20-branded-ids` and its implementation stack ([PR #84](https://github.com/deepseek-ai/deepseek-harness/pull/84)).

### 4. Put default API recovery policy in `dsh-llm`

Adapters should not perform hidden SDK retries unless those retries are surfaced as response lifecycle events with classified failures. The service owns the default policy so every consumer gets the same behavior and the same audit trail.

Default policy should be conservative:

- Retry transient API failures (`rate-limit`, `timeout`, `transport`, `provider-overloaded`, `provider-unavailable`) only before committed output, and keep retrying until the caller aborts or the failure class changes to a non-retryable one.
- Honor `retryAfterMs` up to `maxRetryDelayMs`, otherwise use bounded exponential backoff with jitter. The same cap applies to both provider-supplied retry hints and ordinary exponential backoff; diagnostics record whether the delay source was `provider-retry-after` or `exponential-backoff`.
- Treat 429/408/409/425/500/502/503/504 and connection resets as potentially recoverable unless the provider payload says otherwise; treat 400/401/403, unsupported local options, caller abort, and adapter protocol bugs as non-retryable.
- Fail over only when the failure says failover is safe and the candidate route advertises compatible capabilities for the request (`tools`, reasoning passback, images, prefill, stop sequences, strict tools).
- Share the caller's `AbortSignal` across the whole recovered call, and expose per-response timeouts as explicit policy. A stuck stream must time out in a controlled way instead of hanging the turn forever.
- Surface every retry decision to the UI with retry count, backoff delay, route, and failure summary, so an actively watching user can tell the agent is waiting on provider capacity instead of frozen.

The policy should be configurable through a typed service option and an event/waterfall seam so product plugins can adjust timing/backoff details, but the default retry posture is not opt-in: a basic agent should keep recovering from retryable 429/5xx/connectivity noise until cancelled.

The zero-config defaults should be sensible production behavior, not placeholders:

```ts
const defaultLlmRecoveryConfig = {
  maxResponses: 'unbounded',
  maxElapsedMs: 'unbounded',
  connectTimeoutMs: 15_000,
  responseHeaderTimeoutMs: 60_000,
  streamIdleTimeoutMs: 5 * 60_000,
  initialBackoffMs: 200,
  maxRetryDelayMs: 10 * 60_000,
  jitterRatio: 0.1,
}
```

The retry-delay cap is deliberate. The survey found mixed precedent: Codex parses retry delays out of streamed OpenAI rate-limit error messages and uses that requested delay, but Codex also has finite stream retry counts; the official OpenAI and Anthropic TypeScript SDKs parse `retry-after-ms`, `Retry-After` seconds, and `Retry-After` dates and then sleep for the provider-specified duration; the official OpenAI and Anthropic Python SDKs only honor `Retry-After` when it is greater than zero and at most 60 seconds, otherwise falling back to ordinary exponential backoff. Because this RFC's default retry posture is unbounded, blindly honoring a multi-hour provider delay can make the agent look dead, while ignoring the hint entirely can retry too aggressively. The service should therefore record both `providerRetryAfterMs` and `scheduledRetryMs`, cap the scheduled sleep at `maxRetryDelayMs`, and surface that choice to the UI.

The service cannot reliably infer whether the user is actively watching or away from the keyboard, so the default should not fail a retryable model call merely because a short interactive budget expired. A clear UI can make long waits tolerable even in interactive sessions: "retried 8 times; next retry in 10 minutes" is better than silently failing recoverable provider turbulence and asking the user to resubmit.

### 5. Define the caller contract, not the product transcript

This RFC is deliberately about the `dsh-llm` API and how callers use it, not about the final transcript/event architecture of the product. The LLM package should guarantee these caller-visible semantics:

- `ctx.llm.stream()` is the live response-lifecycle API. It reports response starts, uncommitted assistant chunks, retries/backoff, interruptions/discards, terminal failures, and the one committed result.
- `response/committed` is the only event that makes model output safe for history or side effects. It carries the assembled `Message`, finish reason, usage, response id, route metadata, and provider ids known to the service.
- `response/failed` is the terminal event for classified failures. Callers should not need `try`/`catch` to learn that a provider was rate-limited, unavailable, misconfigured, aborted, or otherwise unable to produce a committed response.
- Response diagnostics are JSON-serializable so callers can store, display, or ignore them. The LLM package does not decide whether those diagnostics become session events, agent events, telemetry rows, or UI-only state.
- Any assembled convenience helper that survives or is reintroduced returns a terminal union (`committed` or `failed`) rather than throwing for classified LLM failures. It must be derived from the lifecycle stream so recovery semantics stay single-sourced.

The session log shape, agent event taxonomy, ACP rendering, snapshot/replay fixtures, and whether live uncommitted chunks are ever durably recorded are downstream integration decisions. So is the fate of today's assembled public helper methods: [PR #82](https://github.com/deepseek-ai/deepseek-harness/pull/82) implements the proposed removal of `generate()`, `streamBlocks()`, `GenerateResult`, and `llm/generate`, and this RFC should not resurrect them without a real caller. This RFC should constrain downstream work only by the LLM API contract above.

The current simplification stack was checked while drafting this proposal. [PR #83](https://github.com/deepseek-ai/deepseek-harness/pull/83) and [PR #85](https://github.com/deepseek-ai/deepseek-harness/pull/85) do not change this RFC's LLM API assumptions. [PR #86](https://github.com/deepseek-ai/deepseek-harness/pull/86) does matter for later integration because it folds durable token usage onto `assistant/message` and operational errors onto `turn/end.reason`; if it lands first, the LLM recovery implementation should still stop at the `dsh-llm` lifecycle contract here and let the agent/session layer decide how committed usage and terminal failures map onto those load-bearing product events.

## Out of scope

This RFC does not propose silent mid-stream continuation after user-visible output. That requires a separate model-history design: either provider-supported prefill/continuation, a recovery prompt that explicitly shows the partial assistant output, or a UI affordance that marks the partial answer as failed and asks the model to continue in a new step. Splicing two API responses into one assistant message is rejected.

This RFC also does not solve semantic model-output repair: malformed tool-call JSON, refusal handling, or content-filter fallbacks. Those may use the same failure vocabulary later, but they are higher-level agent behaviors, not unstable-API recovery.

This RFC does not decide whether product UIs consume LLM lifecycle events directly, through agent events, or through session events. It also does not decide which response diagnostics belong in the durable session log. Those decisions belong in narrower integration RFCs once the `dsh-llm` contract exists.

## Alternatives considered

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->

## Acceptance criteria

- Adapter-thrown `LlmError`s and in-band finish errors carry one structured, JSON-serializable `LlmFailure` payload.
- Recovery policy can distinguish retry, failover, credential/user-action, unsupported request, caller abort, adapter/protocol bug, and post-commit partial stream failure without parsing message text.
- `ctx.llm.stream()` exposes the response lifecycle as the canonical stream, including terminal `response/failed` events for classified failures; convenience APIs are derived views for callers that only want the terminal outcome.
- `response/committed` carries the assembled assistant `Message`; callers do not need to rebuild committed output from lifecycle chunks.
- Any assembled convenience API that survives or is reintroduced returns a committed/failed union derived from the lifecycle stream, rather than throwing for classified LLM failures.
- The LLM service has an explicit API-response boundary; no retry path can present output from two provider responses as one committed assistant result.
- The route registry allows multiple concrete API routes for one logical model and records the selected route on responses/failures.
- `registerRoute()` is effect-scoped, returns a disposer, and has an HMR-safety test proving route cleanup; `llm/adapter-change` is not reintroduced unless a concrete consumer needs it.
- New LLM ids are deliberately branded or explicitly left unbranded according to the branded-id policy, with `ResponseId`, `RouteId`, and logical/wire model ids decided together.
- Default recovery retries transient pre-commit failures with bounded backoff, honors provider retry-after hints, times out stuck streams, disables hidden SDK retries or surfaces them as response lifecycle events, and never retries after committed chunks without an explicit continuation design.
- Unit tests cover thrown errors and finish-error chunks through `dsh-llm`, retry-before-first-commit, failover to a second compatible route, unbounded retry status/backoff visibility, abort during backoff, stream timeout, and the "partial chunks then failure does not retry/splice" invariant.
- Adapter tests classify representative HTTP statuses, retry-after headers, request ids, malformed/truncated SSE streams, SDK in-stream errors, caller aborts, and unsupported options into `LlmFailure`.
- Docs updated in the same change: [the architecture LLM section](../../../../docs/architecture.md), [the LLM adapter cookbook](../../../../docs/cookbook/adding-an-llm-adapter.md), and the LLM package README.

## Risks

- **More surface area in the LLM core.** API recovery adds policy, route state, response diagnostics, and tests. That complexity belongs in `dsh-llm` because every consumer otherwise reinvents it around the same unsafe stream boundary.
- **Committed result lags live UI.** Safe recovery means callers cannot treat streamed tokens as final assistant output until the response commits. UIs can still stream eagerly from lifecycle assistant chunks, but side-effecting consumers must wait for `response/committed`.
- **Breaking adapter churn.** Existing adapters will change from "stream chunks or throw a flat `LlmError`" to "stream one classified API response." Pre-release rules favor the correct seam over shims.
- **Route compatibility is easy to overclaim.** A route must advertise concrete capabilities, and failover must check the request actually fits them. "Same model name" is not enough when one route lacks strict tools, reasoning passback, images, stop sequences, or prefill.

## Related

- Builds on [Provider-neutral content-block vocabulary](../../implemented/architecture/2026-06-11-content-block-vocabulary.md): the content vocabulary stays provider-neutral; this adds a provider-neutral failure/recovery vocabulary beside it.
- Revises the scope implied by [Two LLM adapters as a design-verification twin](../../implemented/architecture/2026-06-13-twin-llm-adapters.md): the twin validated chunk shape and error delivery paths, but it also exposed that delivery paths are not enough for unstable API recovery.
- Extends [Structured error taxonomy](../../implemented/architecture/2026-06-11-structured-error-taxonomy.md): `HarnessError.code` was the foundation; LLM API recovery needs a richer payload because retry/failover policy cannot safely branch on one flat string.
- Coordinates with [PR #82](https://github.com/deepseek-ai/deepseek-harness/pull/82), which implements the `drop-unconsumed-llm-assembled-surfaces` and `drop-unconsumed-llm-adapter-change-event` simplification RFCs. If that PR lands first, this RFC starts from a narrower `dsh-llm`: no `generate()`, no `streamBlocks()`, no `GenerateResult`, no `llm/generate`, and no `llm/adapter-change`. Recovery should build on that baseline rather than revive removed convenience or change-notification surfaces speculatively.
- Is orthogonal to [PR #81](https://github.com/deepseek-ai/deepseek-harness/pull/81), which proposes provider-request app attribution headers. Recovery route metadata and provider request construction can carry attribution policy later, but this RFC does not define request headers.
- Coordinates with [PR #84](https://github.com/deepseek-ai/deepseek-harness/pull/84), which implements the branded-id RFC. The new response/route/model ids introduced here are exactly the sort of cross-boundary ids that need an explicit branding decision before implementation.
- Coordinates with [PR #86](https://github.com/deepseek-ai/deepseek-harness/pull/86), which implements the `collapse-trace-only-session-events` simplification RFC. If that stack lands first, downstream recovery integration should map committed usage and terminal error facts onto the surviving load-bearing session events instead of reintroducing standalone trace-only records from inside `dsh-llm`.
