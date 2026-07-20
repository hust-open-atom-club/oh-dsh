# Agent Note: Remove implicit batching from ordinary sends

Status: implemented

English | [中文](2026-07-17-one-send-one-turn.zh.md)

## Problem

Suppose a caller submits message A and then message B with two `Agent.send()` calls. Implicit batching can put A and B in one turn simply because both are waiting when the driver reads its queue. The caller made two calls, but the loop silently turns them into one unit of work.

That grouping depends on timing rather than caller intent. Calls from one synchronous stack, neighboring microtasks, event listeners, and model callbacks could be grouped differently even though every caller used the same API.

This grouping changes behavior, not just the number of model calls. One ordinary turn owns prompt admission, `turn/start`, `turn/end`, and a durability checkpoint. If message B shares message A's turn, B can enter A's model request instead of first seeing A's closed result in the session log. Allowing one message while blocking another also requires a mixed state that no caller requested.

## Decision

The rule is simple: each successful `send()` creates one independent FIFO queue item. If that item runs, it is the only ordinary message in its turn. An item can be dropped before it starts, so the precise guarantee is at most one turn rather than exactly one; two sends are never silently combined.

Before enqueueing an item, `send()` checks the agent state and makes a detached, deeply frozen snapshot of the content and resolved source. After enqueueing it, `send()` publishes `agent/queued`.

If messages A and B are both processed, B's turn starts only after A records `turn/end` and A's durability checkpoint settles. B's request therefore sees whatever closed result A left in the same session log. A checkpoint error is reported, but settlement only releases this ordering barrier; it does not make a failed write durable. Broad `cancel()`, disposal, or a failure before `turn/start` can instead discard an unstarted item without opening an empty turn.

Prompt admission decides one message at a time. An allowed prompt becomes that turn's `user/message`; a blocked prompt records one durable `prompt/blocked` and closes its one-message turn as `rejected`. Mixed-batch and all-blocked-batch branches do not exist.

The no-batching rule applies only to ordinary `send()`. Running `steer()` puts input in a separate steering FIFO. While a turn remains open, the loop records that input at the next steering checkpoint, which comes before either a model request or the decision whether to continue. Steering makes another step the default, but continuation or terminal policy can still stop before the step starts. Steering left after the turn closes and its durability checkpoint settles becomes later queued input; terminal `agent/turn-stop`, cancellation, or disposal can discard it. When the agent is idle, `steer()` delegates to `send()`, so it creates an independent ordinary queue item.

`inject()` continues to add model-facing context without submitting an ordinary message; its existing turn-enclosure and flush behavior stays unchanged. `cancel()` remains a whole-agent operation that can clear all unstarted ordinary and steering input and abort the current step. `status` and `whenIdle()` also describe the whole agent, not one message. Several one-message turns can share one `running` interval, including turn close and its checkpoint, so `running` does not prove that a turn is open.

## Alternatives considered

**Keep automatic ordinary-send batching to reduce model calls.** This can improve throughput when producers outpace the driver, but it makes turn boundaries depend on scheduling and lets a later message run before the preceding turn closes and reaches its checkpoint. The decision keeps the predictable boundary and accepts the extra calls. Any future batching feature needs an explicit caller-visible contract backed by measurements.

## Verification

- Unit and property tests submit sends from the same stack, neighboring microtasks, different producers, and reentrant callbacks; every message gets its own FIFO-ordered turn.
- A built-stdio test submits two lines and observes two model requests and two turn boundaries.
- Delayed and rejected first-turn checkpoints keep the next turn waiting and prove that its request sees the preceding assistant result.
- Failure-path tests cover prompt veto, listener failure, broad cancellation, disposal, and failure before `turn/start`; recorded turns stay balanced, messages do not merge, and surviving queued work still drains.
- Separate tests cover open-turn, post-turn-close, and idle `steer()`, plus `inject()`, whole-agent status, and `whenIdle()`.

## Consequences

Ordinary turn boundaries are predictable: messages A and B stay separate, and B runs only after A has closed and reached its checkpoint. Callers still do not receive a per-send completion or cancellation handle; broad cancellation can discard the entire unstarted tail, while status and quiescence remain agent-wide observations.

The trade-off is more model requests and more checkpoints. A busy queue can take longer to drain and can grow under sustained producers. Ordinary-send batching returns only through an explicit, measured contract.
