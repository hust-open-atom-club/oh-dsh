# Agent Note: Remove implicit batching from ordinary sends

Status: implemented

English | [中文](2026-07-17-one-send-one-turn.zh.md)

## Problem

An ordinary `Agent.send()` payload is one complete caller message. Opportunistically draining every waiting payload into one turn would make adjacent calls share a boundary according to driver timing: calls from one synchronous stack, neighboring microtasks, event listeners, and model callbacks could be grouped differently even though callers used the same API.

A turn owns prompt admission, `turn/start`, `turn/end`, and the durability checkpoint. Combining messages would let a later message join an earlier message's model request instead of observing the earlier turn's closed result in the same session log, while mixed allowed and blocked prompts would require lifecycle states no caller explicitly requested.

`steer()` already expresses joining the active turn, while `inject()` records model-facing context without acting as an ordinary message. Implicit batching would make `send()` overlap both explicit operations instead of preserving a single meaning.

## Decision

Each successful `send()` synchronously validates agent state, snapshots and freezes content, appends one independent FIFO item, and publishes `agent/queued`. The loop dequeues at most one ordinary item for each turn start. If two items are both claimed, the second turn starts only after the first turn ends and its durability checkpoint settles; broad cancellation, disposal, or a pre-start failure can discard an unstarted item without creating an empty turn.

Prompt admission decides one message. An allowed prompt becomes that turn's `user/message`; a blocked prompt appends one durable `prompt/blocked` and ends that one-message turn as `rejected`. There are no mixed-batch or all-blocked-batch branches.

Running `steer()` appends to the active turn's steering FIFO. Idle `steer()` delegates to `send()` and therefore creates an independent ordinary queue item. `inject()` retains its turn-enclosure and flush behavior. `cancel()`, `status`, and `whenIdle()` remain whole-agent operations rather than per-message controls.

## Alternatives considered

**Keep opportunistic batching for throughput.** Combining queued prompts can reduce model calls when producers outpace the driver, but it makes turn boundaries depend on scheduling and lets a later message run before the preceding turn closes and its checkpoint settles. Explicit lifecycle semantics are worth the additional model calls; any future batching feature needs an explicit caller-visible contract justified by measurements.

## Verification

- Unit and property coverage pins same-stack, neighboring-microtask, differently sourced, and reentrant sends as one FIFO-ordered message per turn.
- A real-composition test pipes two lines through the built stdio binary and observes two model requests and two turn boundaries.
- A deferred first-turn flush proves the next queued turn cannot start before the checkpoint settles and that its request sees the preceding assistant result; a rejected flush still settles before the next turn starts.
- Prompt veto and listener failure, broad cancellation, disposal, and pre-commit `turn/start` failure preserve balanced recorded turns and do not merge or strand surviving queued work.
- Running and idle `steer()`, `inject()`, whole-agent status, and `whenIdle()` retain their existing coverage.

## Consequences

Ordinary turn boundaries are deterministic, and a claimed FIFO successor observes the preceding turn's closed session result after its checkpoint settles; settlement does not mean a failed flush became durable. Several queued items can still run under one global `running` interval, and broad cancellation can discard the entire unstarted tail, so status and quiescence remain agent-wide observations rather than per-message results.

Workloads that relied on coincidental batching make more model requests, incur more checkpoints, and may take longer to drain; FIFO queues may grow under sustained producers. Throughput optimization can return only through an explicit measured contract.
