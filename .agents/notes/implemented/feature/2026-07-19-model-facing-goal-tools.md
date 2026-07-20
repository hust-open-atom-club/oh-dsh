# Agent Note: Model-facing same-session goal tools

Status: implemented

English | [中文](2026-07-19-model-facing-goal-tools.zh.md)

## Problem

The persisted goal domain deliberately exposes lifecycle verbs to plugins, not directly to a model. A model still needs a small control surface for discovering the current goal, creating one from human intent, and changing its lifecycle. Prompt guidance alone cannot establish who authorized a mutation: a subagent, injected plugin message, stale model turn, or resumed session could all produce the same tool arguments.

The surface also needs to preserve the separation between durable state and live execution authority. A restored or forked session can replay an active goal but starts disarmed; a later human request such as “continue” should let the model rearm it without requiring a literal command phrase. Conversely, an admitted autonomous goal round must be able to report completion or a persistent blocker without gaining permission to edit, pause, resume, or replace the human objective.

## Decision

`@deepseek-ai/dsh-tool-goal` in `packages/goal/tool-goal/` contributes three exclusive tools and one system-prompt policy section over `ctx.goals`: `get_goal`, `create_goal`, and `update_goal`. The names and read-create-update shape follow Codex's compact goal tool surface while the authority rules use this repository's public agent, session, tool, and goal seams.

### Tools and model contract

`get_goal()` returns the current goal or `null`. A non-null result contains the compare-and-set id and revision, objective, durable phase, admitted and maximum goal rounds, any blocker reason, plus the process-local activation observation. `create_goal(objective, max_goal_rounds?)` creates one long-running same-session objective. `update_goal(goal_id, revision, action, objective?, max_goal_rounds?, blocked_reason?)` supports `edit`, `pause`, `resume`, `complete`, and `blocked`; replacement fields are valid only for `edit`, while a non-empty `blocked_reason` is required only for `blocked` and persists under the stable `model-reported` code.

The prompt tells the model that it may infer goal intent from a direct human request in any wording or language, but should not convert routine single-turn work into a goal. It must read the current goal before updating and copy the exact id and revision. On a restored or forked active-but-disarmed goal, a semantic human request to continue is grounds for `resume`. Completion is reserved for an achieved objective, and difficulty or uncertainty alone is not a blocker; a block report must name the concrete condition.

All three tools use exclusive execution so a model-ordered batch observes prior mutations and their new revisions. Results are compact JSON. ACP presentation is a pure function of arguments and uses generic read or mutation cards; activation is reported only as live observation and is never written into replay state.

An autonomous goal round that successfully reports completion or blocking contributes the existing terminal `agent/turn-stop` decision for that physical turn, preventing an unnecessary follow-up request. Direct-human mutations do not contribute a terminal stop: the assistant can acknowledge the change, and concurrent human steering remains available to ordinary continuation folding.

### Execution authority

Every call requires an `exec.agent` that is the exact running object in `AgentRegistry`, is the current inherited driver initiator, and has an open turn. These are execution-time checks and cannot be bypassed by prompt injection or hand-authored tool arguments.

Create, edit, pause, and resume additionally require an accepted user message or user steering event in the current turn of a runtime-root agent. Root ownership is derived from the live agent graph rather than durable fork ancestry: a resumed fork can receive direct human authority, while a live child remains a subagent and cannot mutate these states. User source is a host attestation: `Agent.send()` and `steer()` default an omitted source to `{ kind: 'user' }`, so non-human producers must label their own content. The runtime proves provenance, not whether the human's wording semantically warrants creation or resumption; that interpretation remains with the model.

Complete and blocked accept either direct-human authority or the exact current goal round. Goal-round authority requires a goal-sourced `user/message` whose goal id, revision, and round all equal the folded current goal. It grants only the two terminal reports. Direct human authority may stop a goal immediately.

### Blocking threshold

`blockedAfterConsecutiveRounds` is a validated positive safe-integer configuration with default `3`. When an autonomous goal round calls `blocked`, the plugin mechanically requires at least that many admitted rounds and a non-empty explanation; the configured value also appears in model guidance. The runtime cannot determine whether those rounds encountered the same blocking condition, so semantic equivalence remains a model judgment. This count is deliberately separate from the goal's generous continuation cap.

## Testing

Unit coverage pins registration and disposal, exclusive scheduling, generated prompt policy, generic presentation, direct-human creation in a non-English turn, exact/stale/non-running agent and driver checks, live-child rejection, resumed-fork root authority, steering, mismatched initiators, read/create/edit/pause/resume behavior, conditional blocker explanations, rearming after a session-start edge, authority-before-conditional-argument failures, exact goal-round completion, autonomous-only terminal stopping, the configured blocking threshold, and immediate human blocking. A keyless replay snapshot mounts the goal domain and tools into the real headless one-shot application, drives `create_goal` and `get_goal` through the shipped loop and persistence stack, pins its stream-json transcript, and inspects the externally persisted goal change. The echo-agent fixture is intentionally not used as an application-UX surrogate.

## Alternatives considered

- **Rely on prompt instructions for authority** — rejected because text can guide model judgment but cannot authenticate the live caller, turn, or source event.
- **Expose every goal-service verb as a separate tool** — rejected because a compact read/create/update surface reduces schema cost and keeps compare-and-set behavior uniform.
- **Require exact command phrases** — rejected because natural-language intent, including languages other than English, should be interpreted by the model; execution authority depends on provenance rather than spelling.
- **Authorize from persisted root or fork metadata** — rejected because a fork that becomes an independently resumed top-level session should accept new human authority, while a currently owned child should not.
- **Let autonomous rounds edit or resume the goal** — rejected because continuation authority is narrower than authority to redefine or restart the human objective.
- **Treat the blocked threshold as an evaluator** — rejected because event counts cannot prove that an obstacle is semantically unchanged or truly terminal.

## Consequences

- Models receive a stable, compact lifecycle surface without direct access to the goal service.
- State-changing calls are constrained by live runtime provenance as well as durable compare-and-set references.
- Human requests can create and rearm goals through ordinary natural language, while restored sessions remain inert until such input arrives.
- Goal rounds can finish or report a repeated blocker but cannot broaden their own mandate.
- Deployment policy selects the blocking lower bound; the same resolved value controls enforcement and prompt guidance.

## Known limitations and deferred work

- Semantic classification of a substantial goal, a request to continue, objective completion, and the same blocking condition remains model judgment. An independent evaluator or completion certificate is deferred.
- These tools mutate goal state but do not schedule goal rounds, classify abnormal driver stops, or cancel an active turn; the same-session driver owns those behaviors.
- Goal-round authority is dormant unless a separately mounted continuation driver admits goal-sourced user turns; this tool package never manufactures that authority itself.
- Human slash-command discovery and rendering are owned by the separate [`dsh-command-goal`](../../../../packages/goal/command-goal/README.md) plugin.
- A scope can hide tool registrations while leaving the independently registered prompt section visible unless the deployment scopes both together.
