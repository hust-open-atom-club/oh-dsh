# Agent Note: Subagent capability seam

Status: implemented

English | [中文](2026-06-21-subagent-capability-seam.zh.md)

> The full seam is shipped: the `dsh-subagent` interface and `dsh-tool-subagent` consumer; the two in-process backends (`dsh-subagent-spawn`, `dsh-subagent-fork`); the nested-agent snapshot infrastructure ([per-session snapshot replay](../testing/2026-06-22-subagent-snapshot-replay.md)); and the out-of-process `dsh-subagent-acp` backend ([its Agent Note](2026-06-22-acp-subagent-backend.md)).

## Problem

The harness has a long-deferred seam for **subagents** — an agent delegating work to another agent. The intent was sketched in the `Agent`/`AgentLoop` interfaces ([packages/core/agent/src/types.ts](../../../../packages/core/agent/src/types.ts), [packages/core/agent-loop/src/index.ts](../../../../packages/core/agent-loop/src/index.ts)): a creation option referencing a parent agent (fork = seed the child session with the parent's event log; spawn = fresh session), with the child returned as an `Agent` handle so steering and event subscription work uniformly. This Agent Note realizes that seam; the banner above lists what shipped.

The distinctive requirement — the one that shapes the whole design — is that **multiple subagent implementations must coexist at runtime**. A parent may want a cheap in-process child for a scoped subtask AND an isolated out-of-process child (over ACP) in the same session. The transports we foresee:

- **in-process** — a child concrete `Agent` on the same `Context` (the cheapest, and nearly free given the existing agent factory);
- **ACP** — act as an ACP *client* driving another agent process (which can be another instance of ourselves);
- later: **A2A**, the **Codex app-server**, and the **Claude Code Agent SDK** — each the same out-of-process "start a child, prompt it, stream updates, cancel" shape as the ACP backend.

## Alternatives considered

### Why not the bash seam shape

The bash seam ([capability seams](../architecture/2026-06-13-capability-seams.md)) registers exactly one `BashExecutor` per context; loading a second throws. That is correct for bash (one machine, one way to run a command) but wrong here: coexistence is the requirement. So the subagent service is a **named-provider registry** — each implementation registers under a unique name and a caller picks one by name — mirroring the **LLM adapter registry** (`LlmService.registerAdapter`), not the single-service bash executor. The seam is still three-package (interface / implementation / consumer); only the "one vs. many implementations" axis differs.

## Decision

### The three-package seam

A new package group `packages/subagent/`:

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-subagent` | interface: `SubagentService` (`ctx.subagents`), `SubagentProvider`, `SubagentRun`, the request/result/capability vocabulary, the `subagent/*` events |
| `@deepseek-ai/dsh-subagent-spawn` | implementation: a fresh in-process child via `ctx.agents.create` |
| `@deepseek-ai/dsh-subagent-fork` | implementation: an in-process child seeded with a snapshot of the parent's log |
| `@deepseek-ai/dsh-subagent-acp` | implementation: an ACP client driving a configured child process |
| `@deepseek-ai/dsh-tool-subagent` | consumer: the model-facing `subagent` tool over `ctx.subagents` |

### The primitive: async `start → SubagentRun`

A provider exposes `start(request) → Promise<SubagentRun>`. Fulfillment publishes a ready child and transfers its run handle to the caller. One signal covers cancellation before and after readiness; `dispose()` cancels remaining work and awaits quiescence. A rejected start cleans partial resources and emits no lifecycle event. `start` is transport-neutral; `spawn` names only the fresh in-process backend.

### Two kinds of optional capability, discovered two ways

- **Start-time features** (`outputSchema`, `depthLimit`, `toolFilter`, `persona`) ride on a static `provider.capabilities` descriptor. The service checks every requested one BEFORE delegating and **rejects loud** (`SubagentError('UNSUPPORTED_CAPABILITY')`) if the provider lacks it — never accepted-then-ignored. They must be checked before a run exists, which is why they cannot be runtime methods.
- **Runtime features** (steering via `sendMessage`, follow-up via `resume`) are **optional methods** on `SubagentRun`. The method's presence IS the capability, and TypeScript narrowing is the discovery mechanism: a consumer cannot call an absent method without narrowing first, so there is no silent-degradation path and no separate flags object to keep in sync.

### Fork vs. fresh are separate backends, not a flag

Fresh and forked children are separate providers, not a request flag. `dsh-subagent-spawn` starts an isolated child; `dsh-subagent-fork` seeds a balanced prefix containing only completed parent turns. The in-flight turn is excluded because its subagent call has no result yet and cannot form valid replay history.

### Child isolation and the parent log

Each subagent runs in its **own `Session`** (own id, `parentSession` lineage), persisted independently. The parent's log records only the spawn `tool/call` and its `tool/result` (the child's final output) — the child's internal steps and tool calls stay in the child's own session, never injected into the parent log. This is the only design that is identical across transports: an ACP child's internal events physically cannot be injected into our parent log, so making in-process behave the same keeps the seam transport-agnostic.

### Synchronous collect (first cut)

`dsh-tool-subagent` passes its execution signal to `start()`, awaits the child result, and disposes the run in `finally`. Non-completed outcomes become error results rather than successful partial output. This foreground consumer does not use the run's optional steering method.

### Provider selection is config, not model-facing

`dsh-tool-subagent` binds to exactly one provider name (`Config.provider`); the model sees only `{ description, prompt }`. To expose more than one transport, load the tool plugin more than once, each bound to a different provider and a distinct `toolName` (the tool registry rejects a duplicate name). The *service* holds the multi-provider registry; the *tool* picks one — no provider/type parameter in the schema this cut.

## Testing

Registry and tool tests replace only the nondeterministic child boundary with a package-local scripted provider while exercising the real `SubagentService`, lifecycle, task integration, and model-facing tool. Provider and consumer export shapes retain their Loader regression coverage for the failure described in [postmortem 0001](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md). Registry tests cover reload safety, duplicate names, and start-time capability rejection; nested-agent scenarios replay keylessly through [per-session snapshot replay](../testing/2026-06-22-subagent-snapshot-replay.md); in-process backends also have real-loop unit tests and a with-key e2e.

## Consequences

- **Recursion.** Without a bound, an in-process child can see the delegation tool and recurse. The in-process backends implement the optional absolute depth limit and scoped live-global `toolFilter`; ACP advertises both capabilities off and rejects such a request. The [subagent composition-controls Agent Note](2026-07-12-subagent-persona-tool-filter-and-depth.md) owns their exact semantics and security limits.
- **Blocking the parent turn.** Foreground collection holds the parent's step open for the child's full duration. Background delegation uses the shared `ctx.tasks` runtime and generic `task_*` tools, the same collection mechanism as background bash; the subagent seam itself remains task-agnostic.
- **Live progress.** This cut surfaces only lifecycle + final result; a per-chunk child→parent update stream is deferred with the background redesign.
- **ACP client surface.** Proxying `fs`/`terminal` from the ACP child back to the parent (a shared-workspace mode) is future work; the first cut advertises neither, so the child self-serves in its own process.
