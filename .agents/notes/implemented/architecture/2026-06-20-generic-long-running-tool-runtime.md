# Agent Note: The background task runtime (`ctx.tasks`) and generic task control tools

Status: implemented

## Problem

Background bash originally combined two responsibilities: the bash executor ran processes and also managed task ids, ownership, incremental reads, cancellation, completion listeners, and model-facing control tools. Adding background subagents required the same lifecycle and interaction contract. Implementing that contract independently for every long-running capability would duplicate isolation, cleanup, notification, and prompt behavior while teaching the model a different collect-and-stop protocol for each producer.

The task registry, control tools, and completion notices form one harness capability. Bash and subagents should supply execution-specific hooks without owning generic task behavior.

## Decision

The `tasks/` package group owns background-task semantics:

- `@deepseek-ai/dsh-tasks` registers running work as `ctx.tasks` and owns task ids, authorization, snapshots, reads, cancellation, waiting, completion listeners, and cleanup.
- `@deepseek-ai/dsh-tool-tasks` exposes `task_output`, `task_list`, and `task_kill`, injects completion notices, and supplies the background-task system-prompt guidance.

Long-running tools are producers. `dsh-tool-bash` adapts a `BashProcess` into incremental output and process cancellation; `dsh-tool-subagent` adapts a child run into final output and child disposal. The execution seams remain independent of sessions and the task registry.

`TaskService` is a concrete, process-local service. TODO(task-service-backend): separate its public contract from the implementation when a second backend defines the required lifecycle; a systemd-backed runtime is one plausible driver, but this PR does not speculate about its durability, reconnect, ownership, or observation semantics.

## Runtime contract

The literal types live in the [task data-structure catalog](../../../../docs/core-data-structures/tasks.md). A producer calls `ctx.tasks.start()` with a kind, label, optional owning `Agent`, and a `run()` function. The runtime completes all failable preflight work before calling `run()` and invokes it once. After `run()` returns hooks, registration commits without another failable step; a producer cannot start work that lacks a collectable task id.

The producer hooks define three responsibilities:

- `cancel(reason?)` synchronously requests termination, is idempotent, and must cause `done` to settle.
- `done` never rejects and settles only after the producer has released the task's resources.
- Optional `readOutput()` returns the next consuming output delta. Omitting it declares a final-output task whose terminal result comes from `TaskOutcome.output`.

Statuses are `running`, `stopping`, `completed`, `killed`, and `failed`. Producer-specific information such as an exit code or stop reason belongs in `detail`; the registry does not interpret it. Task kinds form a merge-extensible string union, and task ids are branded and generated as `<kind>-N`, with a counter per kind.

The runtime attaches one continuation to `done`, records the first terminal outcome, resolves waiters, and invokes completion listeners with per-listener error containment. First-wins settlement matters during teardown: if `cancel` throws, the runtime force-fails the record and warns that work may be orphaned rather than waiting forever for a promise that may never settle. A later producer outcome cannot overwrite that diagnosis or notify twice. A `cancel` that returns without eventually settling `done` still blocks teardown because the runtime cannot distinguish it from a slow, valid stop.

Task registrations are not effects of the producer tool fiber. Reloading a tool or control-surface plugin therefore does not kill work owned by an agent and backend. The task service's own disposal cancels all live tasks and awaits contract-compliant producers.

## Authorization and owner lifecycle

Task ids are runtime-global and predictable, so every access is authorized by the registry. `get`, `read`, `wait`, and `kill` accept the calling `Agent`; `list` returns only tasks visible to that caller. An owned task is accessible only to the exact owning session. Unowned tasks are open to non-agent callers and die with the task service.

The snapshot stores the owner's branded `SessionId` for authorization, while lifecycle operations retain the exact live `Agent` instance. These identities serve different purposes: session equality grants access, but exact object identity selects cleanup and completion delivery. Reusing an agent or session id cannot redirect an old scope's cleanup or notices to a replacement.

The first task for an owner attaches one asynchronous effect to `owner.ctx`. Agent-scope disposal cancels that owner's live tasks, awaits their terminal records, and removes their snapshots. This effect survives producer reloads and joins the agent's existing quiescence boundary. The task service retains the effect disposer so service reload can detach callbacks from still-live agent scopes after global teardown.

For contract-compliant producers, `AgentHandle.dispose()` resolves only after owned background work has stopped. Work intended to outlive an agent must be started unowned; survival across runtime restarts requires a separate durable-job design.

## Service surface

`TaskService` provides:

- `start(spec)` for preflighted, atomic registration.
- `get(id, caller?)` and `list(caller?)` for non-consuming snapshots.
- `read(id, caller?)` for a consuming stream delta or an idempotent final result.
- `kill(id, caller?, reason?)` for cancellation.
- `wait(id, timeoutMs, caller?, signal?)` for bounded terminal waiting.
- `onTaskDone(listener)` for effect-scoped observation with exact-owner delivery and listener containment.
- `attachSurface(name)` for the control-surface availability fence.

`wait` returns the terminal snapshot when the task settles or the live snapshot when its timeout expires. Aborting a wait cancels only that wait. If settlement has already assigned terminal delivery to the waiter, the terminal snapshot still wins. Waiters unregister synchronously on abort so a same-tick settlement cannot suppress a completion notice on behalf of a reader that receives nothing.

A producer loaded without any control surface would let callers start work they cannot collect or stop. `dsh-tool-tasks` therefore calls `attachSurface()` for its lifetime, and `start()` fails before producer execution when no surface is attached. This check occurs at start rather than plugin load because sibling plugins may activate concurrently. Custom non-model surfaces can attach themselves without teaching the registry tool names.

## Model-facing control surface

`dsh-tool-tasks` registers three kind-independent tools with generic ACP cards:

- `task_output(task_id, wait?, timeout_ms?)` reads output and always appends `[status: ...]`. Stream tasks return only output since the previous read; final-output tasks return their result after settlement. Reads are non-blocking unless `wait: true`, whose timeout is defaulted and capped by plugin config. A wait timeout reports the still-running status and does not stop the task.
- `task_list()` returns caller-visible tasks as `<id> [<kind>] <status> — <label>`, or `(no background tasks)`.
- `task_kill(task_id, reason?)` requests cancellation immediately. The optional logged reason is forwarded to the producer. Terminal tasks report their existing status; a throwing producer cancel fails the call and leaves the task running.

Stream reads share one task-scoped consuming cursor because the owning model is the intended reader. A UI or multiple independent readers need a separate non-consuming observation API; sharing this cursor would let readers consume one another's output.

The system prompt tells the model to retain task ids, continue independent work instead of busy-polling or duplicating a running task, collect relevant tasks before its final answer, and kill work that no longer matters. Completion injects a logged `context/message` into the exact owner's session; it becomes durable context for the next request but does not wake an idle agent.

The runtime marks a terminal task `reported` when a read or wait delivers it, when a live waiter has claimed delivery at settlement, or when the model explicitly kills it. Reported tasks do not inject redundant completion notices. Listener failures are logged independently, do not stop later listeners, and are not awaited by waiters or teardown.

## Producer opt-in

Each producer owns whether its schema exposes `run_in_background` through defaulted config. `dsh-tool-bash` and each `dsh-tool-subagent` instance use `enableRunInBackground`, defaulting to true. A disabled instance omits the parameter and also rejects a forced background argument at execution because the generic argument validator permits undeclared keys. Schema omission advertises the capability; the execution check enforces it.

`ctx.tasks` does not rewrite producer schemas. A bundle forwards configuration only for producers it owns. If a background call reaches `start()` without an attached surface, the runtime fence fails before execution.

## Producer integrations

The bash seam exposes `resolve`, `run`, and `start`. `start(spec)` returns a `BashProcess` with incremental reads, cancellation, exit facts, and a non-rejecting quiescence promise. The local executor retains live handles only so its own disposal can kill and join processes. Foreground callers continue to use `resolve` and `run` directly.

For background bash, `dsh-tool-bash` registers the calling agent as owner. Its hooks map `kill()` to cancellation, `done` to a completed or killed `TaskOutcome`, and `readOutput()` to the process's bounded incremental output plus spill and sandbox notices. Generic task tools own ids, status lines, listing, waiting, and completion notices.

For background subagents, `dsh-tool-subagent` creates a task-owned `AbortController` and begins provider startup inside the task starter. Cancellation aborts the same signal before or after provider readiness. `done` awaits both the child result and child disposal, maps completed output to a final result, maps abort to `killed`, and maps other stop reasons or infrastructure failures to `failed`. Intermediate child history remains in the child session and is not exposed through `readOutput()`.

## Alternatives considered

### Per-capability control tools

Separate bash and subagent output/stop tools duplicate ids, isolation, cleanup, notification, and guidance while increasing the model's schema and protocol burden. One runtime keeps execution-specific behavior in producers without cloning the task lifecycle.

### An immediate abstract task-runtime backend

The current `TaskStart.run()` contract passes in-process callbacks and exact `Agent` objects. A durable backend changes identity, restart, ownership, and observation semantics, so extracting an interface before a second implementation exists would freeze the wrong boundary.

### Consumer-owned authorization or cleanup events

Consumer-owned checks invite inconsistent or missing isolation on each new surface. A broadcast cleanup event makes every listener filter every agent and provides no registration disposer. Central authorization plus one owner-scoped effect gives every consumer the same fence and an awaited, removable lifecycle hook.

### Blocking output or a separate wait tool

Blocking by default would serialize the parent while background work runs. Waiting without reading would add another model call and schema without returning useful information. `task_output(wait: true)` makes blocking explicit and combines it with result delivery.

The wait uses the shared deadline primitives but not the generic tool-timeout policy. A wait timeout is a successful observation that returns `[status: running]`; the generic policy would replace it with a timeout error. No tool-call timeout controls task lifetime after a task id has been returned.

### Runtime-owned output sinks

A push sink would centralize buffering, but bash already owns bounded buffers, truncation, and spill files behind its executor seam. Pulling formatted deltas preserves that ownership. A durable backend that owns storage may justify revisiting the producer interface.

### Random ids, promotion, or lifecycle session events

Authorization, not unguessability, is the access boundary, and ids do not derive filesystem paths; sequential branded ids keep transcripts readable. Foreground-to-background promotion requires a user interaction contract the SDK does not prescribe. Starts, reads, and notices are already logged as tool and context events, so dedicated task session events would duplicate model-visible facts.

## Testing

Unit coverage pins preflight atomicity, per-kind ids, stream and final reads, wait timeout and abort races, cancellation, first-wins settlement, listener containment, notice suppression, owner isolation, stale owner instances, owner cleanup, service teardown, and the no-surface fence. Producer tests cover bash process mapping, subagent startup cancellation, terminal mapping, and disposal. Snapshot coverage pins the control-tool schemas and prompt guidance.

## Consequences

Bash commands and subagents share one id vocabulary, listing, notice format, prompt habit, and set of control tools. New long-running producers implement execution hooks instead of another registry and tool family. The [tool cookbook](../../../../docs/cookbook/adding-a-tool.md) points producers to this contract.

Owned background bash now stops with its agent instead of surviving it. Background processes have no executor timeout; callers must kill irrelevant work or rely on owner/service disposal. Stream reads support one consuming reader, completion notices do not wake idle agents, and a producer that returns from `cancel` without settling `done` can still stall teardown. Durable jobs, independent observation cursors, and foreground promotion remain separate designs.
