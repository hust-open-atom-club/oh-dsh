# Agent Note: Fresh-agent Ralph workflow tool

Status: implemented

English | [中文](2026-07-19-fresh-agent-ralph-workflow-tool.zh.md)

## Problem

Same-session goals preserve conversation and let one agent continue a durable objective, while the general workflow tool lets the model write a fan-out orchestration script. Neither is the Ralph pattern: repeatedly give the same objective to a completely fresh worker, use the shared workspace as long-term memory, and carry only a small explicit handoff until work completes or a limit is reached.

Adding Ralph behavior to `dsh-agent-loop`, the goal driver, or the public model-written workflow language would couple one policy to unrelated execution machinery. Letting each child inherit the parent conversation would also defeat context reset and make replay depend on a growing implicit prefix. The feature needs a fixed, reviewable policy built from existing plugin primitives, with cancellation quiescence, bounded cross-round data, a generous configurable cap, and no novel human-facing goal state.

## Decision

Add `@deepseek-ai/dsh-tool-ralph` as a separate consumer package under `packages/workflow/`. It registers `ralph({ objective, maxRounds? })`, owns a fixed workflow script, and depends only on `ctx.tools`, `ctx.systemPrompt`, `ctx.workflows`, and `ctx.subagents`. A Ralph run is not a session goal, creates no goal state, and requires no branch in the concrete agent loop.

The tool is foreground-only. The calling agent parents every child for cwd and lineage, the parent tool call waits for the complete run, and the parent step's abort signal cancels the workflow. `run.dispose()` is awaited on every path, so cancellation reaches the worker engine's bounded settlement and child quiescence before the call returns.

### Per-run workflow provider route

`WorkflowStartRequest` gains optional `subagentProvider`. The worker-thread engine resolves that explicit per-run value before falling back to its configured provider and uses the result for every `agent()` call in the run. The script cannot observe or replace this route. The ordinary `workflow` tool leaves the field unset and exposes no new model argument, so general workflow behavior and provider policy stay unchanged.

The Ralph plugin's `subagentProvider` defaults to `spawn`. Immediately before a call it requires the named provider to exist, support structured output, and report `inheritsParentContext: false`; a fork-like or incapable provider fails loudly before workflow start. Provider lookup remains call-time because effect-scoped provider registration can change under HMR.

### Ralph rounds and handoff

The hierarchy is Ralph Run → Ralph Round → fresh child Turn → Step. One Ralph round creates exactly one child through the selected provider. Spawn gives that child a distinct session with no seed while preserving the parent's cwd, so the shared working tree is the durable authority and neither parent conversation nor prior child history enters the request.

The fixed prompt passes only the immutable objective, current round and cap, a workspace-as-authority instruction, and the previous structured report. A `RalphRoundReport` contains `status: continue | complete | blocked`, `summary`, `evidence`, `nextSteps`, and `blocker`. Strings must be normalized; `continue` requires next steps and no blocker, `complete` requires evidence with no next steps or blocker, and `blocked` requires a concrete blocker. The script validates semantics and serialized size before the report can become the next handoff; the consumer validates the materialized terminal value again across the workflow seam.

`maxRounds` defaults to `256` and is also the deployment ceiling for a call override. `maxHandoffChars` defaults to `16384`. Both are positive safe-integer config values, and oversized reports fail rather than being silently truncated. After a `continue` report at the last permitted round, the fixed script returns `budget-limited`; `complete` and `blocked` return immediately with the final report and number of rounds started.

### Model and UI surface

The model may supply only `objective` and optional `maxRounds`; provider selection, report schema, handoff cap, and script are deployment-owned. A fixed prompt section says to use `ralph` only when the direct human explicitly asks for Ralph or fresh-agent iteration, and distinguishes it from same-session goals, bounded delegation, and general fan-out workflows. This is guidance rather than a new goal UX state machine.

ACP and terminal presentation use a generic `ralph` card whose raw input is the objective. The parent transcript retains the original tool call and one bounded terminal report, not intermediate child messages. Shipped headless, REPL/TUI, and ACP compositions load the plugin beside the existing workflow engine; JSON-RPC remains unchanged because its default composition does not expose workflows.

## Testing

Unit tests cover config and call-cap resolution, provider capability rejection, fixed start-request routing, all three terminal outcomes, malformed and oversized boundary values, abort timing, disposal, render intent, prompt lifecycle, and namespace-plugin shape at per-file 100% coverage. Worker-engine tests prove that a per-run provider override selects every child without changing the configured default, including the built `lib/worker.cjs` under plain Node.

A keyless real-stack integration drives the fixed script through the actual worker-thread engine, spawn provider, structured-output runtime, and agent loop. It proves distinct child identities, absent `seedLength`, inherited cwd, no parent-history markers in either child request, exact previous-report handoff only in the following round, terminal completion, and disposal of both children. Tool tests pin generic call/result presentation, while ACP replay header snapshots pin the shipped schema and prompt-guidance transcript surface.

## Alternatives considered

- **Put Ralph in the same-session goal driver** — rejected because goal rounds intentionally preserve one conversation, while Ralph's defining property is a fresh context per round; combining them would make goal lifecycle and child orchestration inseparable.
- **Expose a `fresh` or loop flag on the general workflow tool** — rejected because the model-written script surface should remain general and provider-neutral; Ralph's fixed report protocol and stop policy deserve one reviewable consumer.
- **Use `subagent_fork` for replay convenience** — rejected because inherited completed turns are implicit, growing handoff state and violate the fresh-context contract. The workspace plus one structured report is replayable without inserting artificial cancellation records.
- **Call the subagent seam directly from the tool** — rejected because the existing workflow engine already owns foreground orchestration, structured children, cancellation propagation, worker termination, events, and quiescent disposal. Reusing it demonstrates plugin composition instead of building a second loop runtime.
- **Silently truncate a large report** — rejected because truncation can remove status evidence or next steps while still looking like an authoritative handoff. A producer must emit a valid report within the configured bound.

## Consequences

- Fresh-agent iteration is a first-class model tool implemented entirely as a removable plugin over existing seams.
- Goal rounds and Ralph rounds stay different concepts: the former is one same-session continuation turn, while the latter is one fresh child inside a foreground workflow.
- The workspace becomes authoritative cross-round memory, so workers must inspect and verify it rather than trusting a narrative handoff.
- A generous round ceiling permits substantial autonomous work, while deployment config still bounds child count and every handoff remains size-limited.
- Provider routing becomes an explicit workflow start concern without expanding the script or ordinary workflow tool surface.

## Known limitations and deferred work

- Completion and blocker status are worker self-declarations. An independent evaluator, evaluator-driven feedback round, completion certificate, or adversarial verifier is intentionally deferred.
- Runs are foreground and process-local. Background collection, persistence/resume, scheduling, and restart recovery are absent.
- Round count is the only aggregate budget. Token, currency, elapsed-time, and provider-usage budgets remain separate future policy.
- One round creates one child. Within-round fan-out, evaluator/worker role separation, dynamic provider or model selection, and cross-run journals are deferred.
- Prompt guidance asks models not to invoke Ralph recursively; a structural child-tool restriction would require a separately designed workflow child-policy surface.
