# Agent Note: Keep one public stop primitive

Status: implemented

> **Implementation note:** Only `abort()` was removed. `whenIdle()` remains because it is the public quiescence signal and safely handles waiter settlement and replacement-turn races; consumers should not reconstruct that behavior from status transitions.

## Problem

The public `Agent` handle exposed two overlapping ways to stop in-flight work: `abort(reason?)` and `cancel(reason?)`. `abort()` killed only the in-flight step and left queued work alone; `cancel()` clears queued and steering work, aborts the running step, and handles the pre-step race. In production, ACP uses `cancel()` for `session/cancel`, while lifecycle owners tear down agents through `AgentHandle.dispose()`. No production caller needed bare `abort()`.

The `abort()`/`cancel()` distinction is real — `abort()` preserves queued prompts and steering while `cancel()` drops them — but no shipping code called the public `abort()` verb. The loop's own stop paths (`cancel()` and disposal) abort the current `AbortController` directly rather than routing through `Agent.abort()`. Most tests that called `abort()` interrupt an empty queue and switch to `cancel(reason)`; the steering re-delivery test that deliberately depends on queue preservation drives the in-flight `AbortController` directly, because `cancel()` would drop the queued steering it is trying to prove survives a step abort. The no-argument `abort()` default reason (`'aborted'`) is deleted with the verb rather than preserved by accident; `cancel()` keeps its own `'cancelled'` default.

The extra surface area made the loop carry a public verb that is mostly a teardown internal: `abort()` had to be documented as distinct from queue-aware cancellation even though a UI cancellation almost always wants the broader operation.

## Decision

`cancel()` is the only public *stop* primitive on `Agent`. Lifecycle owners use `AgentHandle.dispose()` to stop and unregister an agent; non-owners use `cancel()` to abandon current and queued work. The implementation keeps a private abort controller, but it is not part of the plugin-facing `Agent` contract.

`whenIdle()` is **retained** as the public quiescence-observation primitive (resolve once the agent settles out of `running`, resolve immediately when already idle, await the loop exit when disposed). It is not a stop verb; it is how a non-owner observes the stop *completing* without disposing the agent. Its live consumers are ACP and agent tests that await settlement through this public seam (`packages/ui/acp/tests`, `packages/core/agent-loop/tests`); the production ACP bridge owns its agents and tears them down through `AgentHandle.dispose()`, so `packages/ui/acp/src` itself has no `whenIdle()` call.

Public `abort()` is deleted, with the tests that exercised it as standalone API and the docs that described step-only abort as an embedding feature. Empty-queue abort tests migrated to `cancel(reason)` where they still prove cancellation behavior; tests whose subject is the loop's internal `AbortController` drive that controller directly via an in-package typed cast to the private field; tests that only pinned the removed no-arg `abort()` default went with the method. The disposer remains async and still waits for the loop to stop.

## Alternatives considered

**Removing `whenIdle()` too** — the original proposal's shape, reversed on validating the premise against the code (the implementation note above carries the full record): it is a load-bearing quiescence primitive, and pushing consumers onto hand-observed `running`→`idle` transitions is exactly the brittle path the defensive patterns warn against.

## Verification

`Agent` exposes no public `abort()` while `cancel()`, `whenIdle()`, and `steer()` remain; ACP cancellation calls `cancel()`; teardown awaits quiescence through handle disposal, with `whenIdle()` resolving on quiescence for non-owner observers; and the suites cover cancellation and disposal as the two supported stop paths.

## Consequences

A future plugin cannot abort only the current model/tool step while preserving queued prompts through the public interface. If that use case becomes real, it should return with a named consumer and a narrower contract. Today it is latent generality that keeps a private loop mechanic public.

## Related

This Agent Note only removes the redundant stop verb. Mid-turn steering remains an intentional message path; quiescence observation remains via `whenIdle()`. The resulting public surface is `send()`, `steer()`, `inject()`, `cancel()`, `whenIdle()`, status, options, session, and identity.
