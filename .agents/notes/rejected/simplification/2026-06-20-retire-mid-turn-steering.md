# Agent Note: Retire mid-turn steering

Status: rejected — mid-turn steering is an intentional agent capability for between-step user/plugin input and future goal/loop workflows. It is complexity with a product direction, not an accidental duplicate of `send()`.

English | [中文](2026-06-20-retire-mid-turn-steering.zh.md)

## Problem

The agent exposes two user-message paths that look close but have different lifecycle semantics: `send()` queues a normal user turn, while `steer()` injects a message between steps of the currently running turn and falls back to `send()` when idle. That distinction leaks through the whole stack: `Agent.steer()` is public API, the session log has a durable `steering/message` event, the agent event taxonomy has `agent/steering`, the loop maintains a steering FIFO beside the queued-message FIFO, cancellation clears both queues, and `deriveMessages()` has to render steering as a tagged synthetic user message rather than a normal prompt.

The continuation seam amplifies the cost. `agent/turn-continuation` defaults to `hadToolCalls || steeringInjected`, so a same-turn steering message can force the loop to call the model again even if the model did not ask for tools. The comments name future `/goal`, `/loop`, and budget-guard uses, but the current repo has no production listener; only tests register the waterfall. Separately, the only production UI that calls `steer()` is the stdio demo. ACP already sends prompts through the ordinary queue while a turn is running.

## Proposal

Delete mid-turn user steering for now. `Agent.send()` becomes the single public way to submit user content; when the agent is running, the content waits for the next turn. The loop continues within a turn only for tool calls, not because a user typed while a step was running. A caller that wants to interrupt the current turn uses `cancel()` and then `send()`.

Remove `Agent.steer()`, the steering FIFO, `steering/message`, `agent/steering`, steering-derived continuation, and the cancellation logic that distinguishes queued messages from steering messages. Remove `agent/turn-continuation` in the same change unless the implementing PR discovers a production listener; without steering, the current repo has no concrete continuation consumer left. If a real budget or goal plugin later needs forced continuation, it should reintroduce a narrower seam with that plugin as the concrete consumer.

## Acceptance criteria

- `Agent` exposes one user-message entry point, `send()`.
- The durable session event vocabulary no longer contains `steering/message`.
- `deriveMessages()` renders normal user messages and context injections, with no steering tag path.
- The loop has one queued-message FIFO and no same-turn user-message continuation path.
- `agent/turn-continuation` is removed or narrowed to a named production consumer.
- The stdio UI and docs describe input while running as queued next-turn input.
- The session format version and recorded fixtures are refreshed; non-current stored logs are rejected per the pre-release format policy.

## What we give up

A user cannot add same-turn steering content while a model is between tool steps. That behavior is useful in theory for "while you are already working, also consider X", but it is not the behavior ACP exposes today and it makes the turn boundary much harder to reason about. The simpler behavior is reasonable: user input becomes the next prompt, and cancellation remains the explicit tool for replacing in-flight work.

## Related

This pairs naturally with [dropping durable step boundaries](2026-06-20-drop-durable-step-boundaries.md), because removing same-turn steering and `agent/turn-continuation` leaves tool calls as the only reason a turn contains multiple model steps.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
