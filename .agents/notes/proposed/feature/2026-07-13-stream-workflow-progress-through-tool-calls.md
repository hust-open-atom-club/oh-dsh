# Agent Note: Stream workflow progress through tool calls

Status: proposed

## Problem

The workflow engine intentionally emits balanced `workflow/*` observation events for run, phase, narration, and child-agent progress, but no production consumer presents them. Editors therefore show one pending workflow tool card until the final result even while the engine already reports which phase is active, what the script logged, and which children started or settled. The [dynamic-workflows decision](../../implemented/feature/2026-07-05-dynamic-workflows.md) explicitly reserves ACP progress UI for this event stream.

Making `dsh-acp` listen to workflow events directly would invert the capability boundary: the generic UI bridge would depend on an optional workflow package and special-case one tool name. The tool pipeline already owns the routing facts a live update needs—agent and call id—but exposes only pure pending/final presenters, so a long-running tool has no provider-neutral way to report transient UI state between them.

## Proposal

Add a live progress channel to `dsh-tools`. The registry-owned `ToolExecution` gains `reportProgress(view): boolean`, where `view` is a detached provider-neutral generic progress snapshot containing an optional replacement title and UI-facing content blocks. Progress cannot change the call's args-derived card tag, kind, raw input, locations, terminal intent, or diff intent; it updates only the live title/content within the presentation chosen up front. While the execution is active, the method validates and snapshots the view, then dispatches a contained, agent-scoped `tools/progress` observation carrying the authoritative execution identity and snapshot. Once final-result processing begins it returns `false` and emits nothing, so a late asynchronous reporter cannot overwrite a terminal card. Observer exceptions are logged and cannot fail the tool.

`dsh-acp` consumes `tools/progress` generically. It resolves the execution's agent through its existing agent-to-session map and emits an in-progress `tool_call_update` for the same call id. Because reporting is available only inside the tool execution pipeline, the durable `tool/call` and its ACP `tool_call` always precede the first update; closing the reporter before `tools/result` ensures no progress update follows the completed/failed card. Progress is live UI state rather than model input or durable history: session replay continues to reconstruct the pending and final cards from `tool/call` and `tool/result` without replaying transient updates.

`dsh-tool-workflow` becomes the first producer. Each tool execution installs a compact event capture before calling `ctx.workflows.start()`, because a valid engine may emit progress synchronously inside `start()`. Until the call returns, the capture reduces observed events into candidate states keyed by `WorkflowRunInfo.id`; it then selects the returned `WorkflowRun.id`, discards other candidates, reports the accumulated snapshot, and routes later matching events directly. If `start()` throws, the capture is disposed and its candidates are dropped. This preserves engine swappability without adding observer correlation to `WorkflowStartRequest` or requiring progress to wait until `start()` returns.

The reducer consumes the existing start, phase, log, agent-start, agent-end, and end events, reporting a replacement snapshot with the current phase, latest log line, active child labels, and completed/failed/cancelled counts. It does not accumulate a narration transcript; settled children leave the active set and become counters. `workflow/end`, tool settlement, or plugin disposal removes the reducer entry and event capture. The six workflow events, their metadata, paired child lifecycle, run handle, cancellation channels, and observer containment remain unchanged; third-party observers can continue consuming them directly.

Update the tool execution/presentation docs, generated event and API catalogs, workflow package docs, and the workflow data-structure catalog. ACP integration coverage must exercise the real workflow tool and worker seam with a scripted model boundary; the primary ACP snapshot suite adds one workflow-progress scenario because this changes the editor-facing transcript.

## Alternatives considered

**Delete the workflow observation surface.** Rejected in [the collapse-workflow simplification](../../rejected/simplification/2026-07-12-collapse-workflow-to-foreground-core.md): the events and their balanced lifecycle are intentional, and the missing piece is a consumer.

**Teach ACP about workflows directly.** This could map `WorkflowRunInfo` to a session and card, but it would make the generic bridge depend on an optional capability and bypass the rule that tools own presentation intent. A tool-progress channel solves the same routing problem for every long-running tool.

**Persist every progress update as a session event.** That would make live narration replayable, but it would permanently enlarge logs with state whose authoritative durable outcome is already the tool call/result pair. If resumable workflow progress becomes a product requirement, it needs a workflow-journaling design rather than UI snapshots disguised as durable facts.

## Acceptance criteria

- `ToolExecution.reportProgress()` is registry-owned, agent-scoped, snapshotting, observer-contained, and returns `false` without dispatch after terminal processing starts.
- ACP routes progress to the correct call in the correct live session; concurrent workflows in different sessions cannot cross-talk, and no `tool_call_update` appears before its `tool_call` or after its terminal update.
- Workflow progress shows the current phase, latest log line, active children, and outcome counts while preserving all existing `workflow/*` events and run semantics; a seam test engine that emits start, phase, log, child, and end events synchronously inside `start()` loses none of that reducer state.
- Cancellation, worker death, tool failure, session close, and plugin disposal release reducer state; replay emits only the durable pending/final card pair.
- Unit, workflow integration, ACP integration, snapshot, typecheck, coverage, doc-sync, module-graph, build, and hygiene gates pass.

## Risks

This adds a public live-progress method and event to the tool seam, so implementations must keep the active/terminal boundary exact and detach snapshots before observers see them. The pre-start capture can briefly observe unrelated workflow runs, so it holds only compact candidate state keyed by run id and drops every non-matching candidate as soon as `start()` returns. A workflow can emit many progress changes; the bounded reducer avoids transcript growth but still sends one UI update per meaningful event after correlation. If measured clients need coalescing, it must be a defaulted validated bridge configuration rather than a hardcoded throttle. Transient progress intentionally disappears on replay, so the final tool result remains the only durable workflow card content.
