# Agent Note: Keep one public stop primitive

Status: implemented

> **Implementation note:** Only `abort()` was removed. `whenIdle()` remains because it is the public quiescence signal and safely handles waiter settlement and replacement-turn races; consumers should not reconstruct that behavior from status transitions.

## Problem

The public `Agent` handle exposed two overlapping ways to stop in-flight work: step-only `abort()` and queue-aware `cancel()`. The former preserved queued input while the latter clears queued and steering work and aborts the active turn. In production, ACP uses `cancel()` for `session/cancel`, while lifecycle owners tear down agents through `AgentHandle.dispose()`. No production caller needs a bare step-only abort.

The behavioral distinction is real, but no shipping code needs the narrower operation. AgentLoop instead owns one private cancellation holder for the whole turn. `cancel(cause?)` carries a typed `user` or `parent` cause, defaults to `user`, and drops pending input; disposal remains a separate lifecycle interruption. The complete ownership and propagation contract lives in the [explicit turn cancellation RFC](../architecture/2026-07-16-explicit-turn-cancellation.md).

The extra surface area made the loop carry a public verb that is mostly a teardown internal: `abort()` had to be documented as distinct from queue-aware cancellation even though a UI cancellation almost always wants the broader operation.

## Decision

`cancel()` is the only public *stop* primitive on `Agent`. Lifecycle owners use `AgentHandle.dispose()` to stop and unregister an agent; non-owners use `cancel()` to abandon current and queued work. The implementation keeps a private turn cancellation holder, but it is not part of the plugin-facing `Agent` contract.

`whenIdle()` is **retained** as the public quiescence-observation primitive (resolve once the agent settles out of `running`, resolve immediately when already idle, await the loop exit when disposed). It is not a stop verb; it is how a non-owner observes the stop *completing* without disposing the agent. Its live consumers are ACP and agent tests that await settlement through this public seam (`packages/ui/acp/tests`, `packages/core/agent-loop/tests`); the production ACP bridge owns its agents and tears them down through `AgentHandle.dispose()`, so `packages/ui/acp/src` itself has no `whenIdle()` call.

Public `abort()` is absent, and the disposer remains async and waits for the loop to stop. Tests exercise cancellation through the public typed cause and explicit signal seams rather than reaching into the holder.

## Alternatives considered

**Removing `whenIdle()` too** — the original proposal's shape, reversed on validating the premise against the code (the implementation note above carries the full record): it is a load-bearing quiescence primitive, and pushing consumers onto hand-observed `running`→`idle` transitions is exactly the brittle path the defensive patterns warn against.

## Verification

`Agent` exposes no public `abort()` while `cancel()`, `whenIdle()`, and `steer()` remain; ACP cancellation calls `cancel()`; teardown awaits quiescence through handle disposal, with `whenIdle()` resolving on quiescence for non-owner observers; and the suites cover cancellation and disposal as the two supported stop paths.

## Consequences

A future plugin cannot abort only the current model/tool step while preserving queued prompts through the public interface. If that use case becomes real, it should return with a named consumer and a narrower contract. Today it is latent generality that keeps a private loop mechanic public.

## Related

This Agent Note only removes the redundant stop verb. Mid-turn steering remains an intentional message path; quiescence observation remains via `whenIdle()`. The resulting public surface is `send()`, `steer()`, `inject()`, `cancel()`, `whenIdle()`, status, options, session, and identity.
