# Agent Note: Log-backed session titles

Status: implemented

English | [中文](2026-07-21-log-backed-session-titles.zh.md)

## Problem

A session needs a short human-facing title before an editor, terminal, or query consumer can present it usefully. The cheapest implementation can derive one from the first prompt, while higher-quality implementations may call a model over the first prompt or the whole conversation. Those strategies have different latency, cost, routing, and retry behavior, but every consumer needs one durable source of truth.

Session identity metadata is immutable, the event log is the replay and fork boundary, and every event must remain turn-enclosed. A model-generated title often finishes after the main turn closes, so writing it synchronously would delay the agent response while writing it as mutable metadata would bypass ordinary persistence, replay, and lineage semantics. Concurrent prompts, provider HMR, cancellation, and ignored abort signals also make an unfenced background result capable of overwriting a newer title.

## Decision

The [`session-title` capability family](../../../../packages/session-title/README.md) owns title state and generation policy. `@deepseek-ai/dsh-session-title` provides `ctx.sessionTitle`, a deterministic first-message fallback, and a registry for at most one optional asynchronous provider. `@deepseek-ai/dsh-session-title-llm` owns the common auxiliary-model request policy; separate first-message and all-user-messages plugins choose input cadence. The shared agent spine mounts only the fallback service with overridable explicit example limits, leaving both model providers opt-in.

### Event ownership and folding

Every accepted revision is a log-only `session/title` event. Its payload contains normalized non-empty text, the exact eligible human `user/message` seqs used to derive it, and either fallback provenance or the registered provider id plus optional provider/model route. Before an auxiliary title-model dispatch, the shared helper appends a log-only `session/title-llm-request` event containing the title-provider id, exact source seqs, route, system prompt, messages, and output-token cap; a later generation failure leaves the request auditable. The dispatched envelope is deep-frozen to preserve exact agreement with that record but carries no process-local agent-loop request identity, so loop-only reconstruction checks do not compare it with the main conversation header. Validation failures that never reach dispatch create no request event. `foldSessionTitle()` selects the latest title event and adds that event's seq and timestamp as `SessionTitleSnapshot`. Neither event enters `session.surface` or `deriveMessages()`.

The core session package exposes `ctx.sessions.appendOutOfBand()` only for plugin event types whose owners also declaration-merge an `OutOfBandSessionEventMap` marker. An open turn receives the log-only event directly and owns its normal checkpoint. A closed log receives `turn/start → event → turn/end` under the plugin's trigger, followed by an awaited flush. Once the synthetic turn opens, target-append failure still attempts to close and flush it; detach is deferred until the sequence settles. Session titles contribute the source-free `session-title` zero-step trigger and opt both title event types into this seam. No message caused that trigger, so consumers of the merge-extensible `TurnTriggerMap` discriminate `kind` before reading variant fields; goal-round admission, for example, ignores every non-`message` trigger.

### Input and asynchronous timing

Only text blocks from human-source `user/message` events are eligible. Empty, control-only, and non-text prompts wait for the next eligible message. The service schedules the first fallback without awaiting it from the prompt path, normalizes whitespace and control sequences, applies the configured word and UTF-8 byte limits without splitting a code point, and records the first message seq.

Automatic provider work starts only after the main loop has a current logged provider/model route. A newly appended `request/header` starts pending work directly; when the header is unchanged, the marked loop-built `llm/stream` request starts it after matching the folded route. Generation then runs independently of the agent response, and a completion joins whichever turn is open at acceptance time or uses the zero-step append path. Explicit `refresh(session, signal?)` materializes any missing fallback and awaits the registered provider; without a provider it returns the fallback. Caller cancellation during fallback flush does not roll back the durable append, but `refresh()` rechecks the signal and rejects instead of returning success. Concurrent refreshes reserve their session-local revision before waiting for fallback durability, so a newer call supersedes an older call before either can invert provider completion order. Automatic work and concurrent refreshes share one session-local in-flight fallback promise, so the first fallback creates only one title event and zero-step turn. All title-capability out-of-band writes share a per-session settlement queue; a replacement model request waits for any earlier title write, while the superseded model call itself remains independently abortable and cannot commit stale output. A title accepted during asynchronous compaction remains log-only, so the compactor's post-summary surface-node check tolerates it; a concurrent surface mutation still invalidates the replacement.

The first-message provider schedules once when a fresh session first creates its fallback. An automatic failure does not reschedule on later prompts; `refresh()` is the retry path. The all-messages provider schedules after every eligible human prompt and passes all eligible messages through that revision, including seeded history. Its newer revision aborts and supersedes older pending or active work.

### Registration, routing, and failure policy

`register(provider)` validates one branded stable id, cadence, and generation function, then returns an awaitable effect disposer. A second live registration throws immediately. Provider disposal marks the registration closing, aborts its pending and active work, and waits for every call to settle before removing the registration, so replacement cannot overlap a provider that ignores cancellation. Session disposal aborts its active work. Service teardown prevents queued fallback and provider microtasks from starting, aborts active work, and drains tracked promises before unloading completes. Every session-local generation has a monotonic revision and exact registration identity; acceptance rechecks revision, registration, session liveness, service liveness, and cancellation, so stale output cannot commit.

Model providers require explicit word, CJK-character, input-byte, output-token, and timeout limits. Optional `provider` and `model` overrides are a pair; without them the helper uses the exact route from the logged main request header. Selected messages are framed as JSON under one fixed language-aware instruction. The input limit measures that final user prompt, including wrappers, seq fields, and JSON escaping, before the request is logged or dispatched. Oversized input is rejected rather than truncated because truncation would make the recorded source seqs falsely imply complete use. The fused deadline is checked while consuming each stream chunk and after completion, so a successful result returned after timeout cannot be accepted even when an interceptor or adapter ignores abort.

Automatic provider failures are nonfatal warnings and retain the latest title. Explicit refresh failures reject to the caller. Output must be non-empty text with unique ordered seqs drawn from the fixed request; the service normalizes and byte-limits it before durable acceptance.

### Forks and consumers

A fork inherits seed title events unchanged, like the rest of its source log. The first-message provider does not automatically retitle a fork. The all-messages provider may append a child-owned revision after a later child prompt, using inherited and new eligible messages.

`ctx.sessionQuery.readTitle()` folds one live-preferred or persisted log without loading titles during `listSessions()`. ACP maps the event to `session_info_update` during both live streaming and load replay, using the event timestamp for `updatedAt`. The TUI uses the latest title as its header subtitle and sets the terminal window title to `<session title> — <configured product title>` after terminal-safe rendering. A synthetic title turn remains a completed durability boundary for the metadata write; consumers reporting agent completion use the core `findLastMessageTurnEnd()` fold so a later title, injection, or other plugin-owned turn cannot replace the preceding message-triggered outcome.

## Alternatives considered

- **Mutable `SessionHeader` or side metadata** — rejected because it creates a second persistence mutation protocol, weakens immutable identity metadata, makes crash atomicity backend-specific, and gives forks ambiguous copy-versus-reference behavior. The append-only log already owns replayable latest-wins state.
- **Await title generation before returning the agent response** — rejected because auxiliary provider latency and failure would sit on the main interaction's critical path. The deterministic fallback gives immediate useful state while a better title may arrive later.
- **Put titles in derived history or the request prefix** — rejected because UI metadata would consume tokens, change cache identity, and make the main model observe its own label. A log-only event remains reconstructable without becoming model-visible.
- **Permit multiple registered providers and resolve precedence after completion** — rejected because completion order is not product precedence and would make retries, HMR, and provenance nondeterministic. A deployment that needs a composite policy can register one provider that owns that policy.
- **Silently truncate oversized auxiliary input** — rejected because the provider result would claim exact source-message provenance while receiving only partial text. Keeping the prior title and warning preserves truthful attribution.
- **Index titles in `listSessions()` immediately** — rejected because the existing lightweight metadata list would need per-backend derived-index synchronization. Exact `readTitle()` establishes the read contract without precommitting search or indexing policy.

## Consequences

- Titles survive JSONL and SQLite persistence, replay through ACP, and follow fork inheritance without a separate mutable record.
- A fallback appears without an auxiliary call; deployments choose whether better titles justify model cost and whether later prompts should retitle a session.
- Auxiliary request records and late accepted titles consume event seqs and may create balanced zero-step turns, so persistence exposes both attempted dispatches and accepted updates even though model history and KV-cache identity do not change.
- One provider and monotonic per-session revisions make disposal, supersession, and stale-result rejection explicit, at the cost of leaving multi-strategy precedence to a composite provider.
- Manual rename, deletion, generated-versus-user precedence, search, and list indexing remain outside the capability.
