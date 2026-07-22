# Agent Note: Semantic session checkpoints

Status: implemented

English | [中文](2026-07-21-semantic-session-checkpoints.zh.md)

## Problem

Persistence buffered every synchronous `session/event` until the loop's final turn checkpoint. A turn is the correct conversational transaction, but it is too coarse as the only crash-recovery point: a hard crash during a long model request or tool call could discard the whole in-flight turn, including the request envelope needed to identify what had been attempted. A tool call with no result was also repaired with one undifferentiated interruption error, so the resumed model could not tell whether execution had started and could retry a side effect blindly.

## Decision

`dsh-session-checkpoint-policy` owns semantic durability barriers as a zero-config plugin beside a persistence backend. It wraps `llm/stream` lazily and flushes the live session after `request/header` is logged but before the adapter stream is constructed. It wraps top-level `tools/execute` after ordered pre-execute policy and flushes the recorded `tool/call` before the tool body; nested dispatches reuse the outer model-visible call. It flushes at `agent/post-step` after the assistant message and ordered results are recorded. The loop's existing final `turn/end` checkpoint remains the closing boundary.

Persistence and checkpoint scheduling remain separate Cordis plugins. A backend makes requested `session/flush` boundaries durable but does not choose them; loading it without this policy is valid and retains the loop's coarser checkpoints. First-party persisted apps and runtimes explicitly mount both, while a specialized deployment may intentionally omit or replace the policy. Registration order governs whether events appended by other `agent/post-step` listeners join this checkpoint; the loop-owned assistant message and ordered results always precede the event.

Checkpoint failure and cancellation are fail-closed at effect boundaries. A rejected request checkpoint prevents adapter dispatch; a rejected tool checkpoint becomes an error result without invoking the tool body. If cancellation lands while the tool checkpoint is pending, the policy rechecks the signal and returns the canonical `ABORTED_BEFORE_DISPATCH` result. A rejected post-step checkpoint stops continuation before another model request. Persistence serialization continues to belong to the coordinator, so concurrent tool checkpoints cannot duplicate event sequences.

The ACP app owns its bridge, checkpoint policy, and persistence backend in one ordered Cordis effect. Cordis unloads sibling plugin effects concurrently, so independent mounts would let persistence detach while bridge teardown was still closing an interrupted turn. The composite lifecycle unloads the bridge first, waits for its agents to quiesce and flush the real `step/end` and `turn/end`, then removes checkpoint scheduling and persistence.

Crash repair distinguishes durable evidence. An assistant tool request without a `tool/call` becomes `TOOL_NOT_STARTED` and may be retried if still needed. A durable `tool/call` without a result becomes `TOOL_OUTCOME_UNKNOWN`; its model-visible result permits retry only for read-only or idempotent operations and directs the model to verify external state or ask the user before deciding about side-effecting work. A provider that supports idempotency keys can receive the stable `callId`, but the Harness does not claim generic exactly-once effects.

## Alternatives considered

Flushing every event or streaming chunk minimizes loss but turns local append and `fsync` latency into the hot path and destabilizes streaming throughput. Moving the barriers into `agent-loop` prevents omission for that loop but hides checkpoint policy inside the mechanism and removes Cordis-level replacement and ordering. Keeping turn-only flush preserves throughput but loses the request and execution intent needed for safe recovery. Automatically retrying every unmatched call is safe only for a subset of tools and can duplicate irreversible effects.

## Consequences

Hard-crash recovery retains the complete model request, durable tool intent, and complete settled step at the nearest semantic boundary while allowing partial streaming chunks since the previous boundary to remain lossy. Default CLI, TUI, ACP, Python SDK runtime, headless persistence tests, and JSON-RPC compositions mount the policy with their persistence backend. Unit tests cover ordering, cancellation during a checkpoint, fail-closed behavior, nested dispatch, disposal, and Loader shape; a real child process killed with `SIGKILL` proves request and tool-intent recovery through JSONL, and the shared persistence contract proves both recovery classifications across backends. Keyless ACP snapshots prove both that retry-risk guidance reaches resumed history and the next model turn and that graceful cancellation persists the loop's real closing boundaries.
