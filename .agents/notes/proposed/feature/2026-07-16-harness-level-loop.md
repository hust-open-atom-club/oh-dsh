# Agent Note: harness-level goal-based loop

Status: proposed

English | [中文](2026-07-16-harness-level-loop.zh.md)

## Problem

`packages/core/agent-loop` runs only the inner loop: reasoning plus tool calls within one turn, ending when the model returns `end_turn`. Its README explicitly writes "No built-in turn budget"—budget is a gap it acknowledges itself. Cross-round scheduling falls on the harness layer: iterating until tests all pass, revising drafts against a rubric, splitting a PRD into beads and driving them one by one, running unattended for a whole night. None of these tasks has a first-class implementation today.

The existing code offers three "just enough to run" alternatives, none of them adequate:

| Alternative | Problem |
|---|---|
| A `packages/workflow` script expressing `while (!done)` | The README explicitly writes "No token-budget vocabulary" and "No journaling or resume"; the parent turn blocks until the script settles. Fine for orchestration lasting minutes, unusable for tasks lasting hours |
| An external shell `while :; do dsh-sdk …; done` | Ralph-style scheduling can be written this way today. It lacks a shared vocabulary for stop condition, budget, and evaluator, so every user reinvents them; the loop itself has no durable object for post-hoc diagnosis or recovery |
| The `sendMessage`/`resume` capabilities on the `packages/subagent` seam | The README explicitly writes "Runtime steering and continuation are seam-only capabilities". There is no model-facing consumer, so the model can only start a fresh subagent |

Three typical use cases. **Automated fix**: a failing test suite in front of you, and you want a process to keep modifying code, running tests, and modifying again against the failure messages, until everything is green or the budget cap is hit. **Rubric-driven iterative revision**: a document, code, or translation must meet a set of scoring criteria; the loop repeatedly adjusts, an independent evaluator scores, and the loop stops when the criteria are met or the round budget is exhausted. **Unattended long runs**: for example, porting a repository from one tech stack to another overnight, kicked off before leaving work and reviewed the next morning, with the budget as the only safety net. Common shape across all three: minutes to hours, evaluator decides success, budget is a hard constraint, and post-run review and recovery are required.

## Proposal

**Loops come in four trigger shapes**, distinguished by who starts a round and when:

| Shape | Who triggers | When | Existing comparable | This RFC |
|---|---|---|---|---|
| **turn-based** | The user sends a message in the session | Every user reply | `packages/core/agent-loop`'s existing reasoning-plus-tools cycle within one turn | Not covered; already implemented |
| **goal-based** | The user or the agent specifies "run until some condition" | One start, evaluator decides when to stop | Claude Code's `/goal`, Codex's `/goal`, the Ralph family | **This RFC covers it** |
| **time-based** | A scheduler | On cron or fixed interval | Claude Code's `/loop` (periodic), `/schedule` | Deferred to a `dsh-schedule` RFC |
| **proactive** | The agent itself | When the agent realizes during reasoning that a loop is needed | The proactive tier in Anthropic ClaudeDevs's four-way taxonomy | **Naturally included** (an agent calling the `loop` tool is already proactive) |

This RFC only **adds a capability seam `packages/loop/`** for the goal-based shape. Proactive reuses the same `loop` tool—an agent invocation is a trigger by itself, with no extra machinery. Time-based needs an independent scheduler package and belongs to a separate RFC; this RFC only reserves a hook on the cordis leaf trigger surface for the future `dsh-schedule` integration.

Three packages:

- `@deepseek-ai/dsh-loop`: types, the `LoopDriver` service, the `StopCondition` discriminated union, the Phase 1 service definitions (`Evaluator` / `BudgetPolicy` / `RoundHandoff`), and the event schema; `GoalReflector` joins in Phase 2 with its first caller
- `@deepseek-ai/dsh-loop-driver`: the default driver implementation
- `@deepseek-ai/dsh-loop-tool`: the model-facing `loop` tool plus the CLI `dsh-sdk loop`

The design is organized around four concrete problems, addressed by service seams or explicit driver policies in the phase where each has a caller:

1. A long-running loop that goes wrong leaves no systematic diagnosis or recovery. **Loop as an independent session** addresses this.
2. Whether the PASS at loop end is trustworthy determines whether hours of work are wasted. An architecture where the same LLM both generates and self-evaluates is not trustworthy on its face. **Making Evaluator and Budget into service seams** addresses this.
3. Short and long tasks need opposite memory strategies; hardcoding one mode makes the other class of scenario unusable. **Making RoundHandoff into a service seam** addresses this.
4. The user's initial goal is not always correct. An agent stubbornly pursuing a wrong goal exhausts the budget doing wrong work. **Goal concern events and policies cover Phase 1; the GoalReflector service arrives with the Phase 2 `reflect` path**.

Beyond the four seams, one principle threads through the whole document: **one loop handles one atomic goal**. Large goals should be split into several small loops chained in sequence, not stuffed into one loop with the evaluator judging multiple things. A rule of thumb for whether granularity is right: if you cannot say what a finished loop actually accomplished, granularity is too large and should be split. Phase 2 adds a `loop_split` model-facing tool so the agent can split an oversized goal itself.

Terminology: **inner loop** refers to the existing per-turn reasoning-and-tools cycle in `packages/core/agent-loop`; **harness loop** refers to the outer scheduler introduced by this RFC, iterating around the inner loop. This RFC does not modify `agent-loop`, matching AGENTS.md's "Plugins, not loop changes".

`StopCondition` is a discriminated union with `assertNever` closing the switch:

```ts
interface EvaluatorReport { criteria: readonly { name: string; pass: boolean; evidence: readonly string[] }[] }

type StopCondition =
  | { kind: 'goal-met'; evidence: EvaluatorReport }
  | { kind: 'budget-cap'; scope: 'usd' | 'tokens' | 'rounds'; observed: number; maximum: number }
  | { kind: 'stuck'; pattern: 'repeat-action' | 'no-progress' | 'error-loop' }
  | { kind: 'approval-required'; reason: string }
  | { kind: 'user-cancel' }

export {}
```

### Loop as an independent session

Once a long-running loop goes wrong, the user has no systematic diagnostic method. A failure hours in leaves only scattered log files to sift through. Discovering that some middle round went off track and wanting to roll back to re-run means starting over from scratch. An agent wanting to consult its own experience from past loops has no API to reach it.

The driver opens an independent loop-session (a new session id) for each loop. Every round's inputs, inner-loop results, evaluator reports, and stop decisions are persisted as session events, reusing the SQLite backend from `packages/session-persistence`. This yields three diagnostic and replay capabilities.

- **Replay conversation from a recorded round**: while the source session is live, discover round 78 went off and fork the round-77 event prefix with a different prompt or evaluator; persisted replay needs a separate trusted load-and-seed path. Both forms replay conversation state against the current workspace, not the files and external side effects that existed at round 77
- **Post-hoc diagnosis**: through the existing `ctx.sessionQuery` exact-read service, inspect the round where the evaluator started hanging on the same criterion
- **Meta-loop learning**: the proposed [SQLite FTS5 search](2026-07-10-sqlite-session-query-provider.md) can later find related historical loops before a new run—"have I fixed a similar bug before? Which round did it fail on?"

Claude Code's and Codex's `/goal` are one-off objects: discarded when the run ends, so the agent starts from zero when facing a similar problem again.

**Storage and recovery boundary**. A few KB of events per round, roughly 100–500 KB per 100-round loop; thousands of loops reach GB scale. Mitigated by the `logDetail: 'summary' | 'full'` config, defaulting to `full` with long-run users able to switch to `summary`. Persisting all intermediate state also writes generated keys, passwords, and similar secrets to disk—the same class of risk as an ordinary session but amplified 10–100×, and the README calls this out clearly. Exact live and persisted reads already exist through `ctx.sessionQuery`; FTS5 is an optional discovery improvement, not a Phase 1 dependency. Exact execution-world restore is not promised: `SessionStore.fork()` accepts a live session, and session events do not restore files, processes, environment, or external side effects. Restoring those requires a separate Git/worktree/checkpoint design.

### Pluggable Evaluator and Budget

A loop's value ultimately depends on whether the final PASS is trustworthy. If the evaluator can be hacked or hallucinates PASS, hours of work are wasted. An architecture where the same LLM both generates and self-evaluates is not trustworthy on its face: the model has the means to talk itself into PASS. Even letting an independent subagent be the evaluator only mitigates the problem; as long as the evaluator is still an LLM, it retains a systematic bias for the same class of content—an independent subagent is a mitigation, not a cure.

Trustworthy evaluation needs both a deterministic judgment mechanism and an isolation boundary appropriate to the threat model: shell exit code, static analysis, or an external service avoids LLM self-judgment, while a separate worktree, read-only mount, container, or remote service prevents the worker from rewriting evaluator inputs. Only the user knows which checks and boundary to use: `pytest` commands differ by project, companies have private compliance checkers, and some teams also run internal lint. No number of built-in evaluators can cover them all. Evaluator therefore must be a seam the user can plug into.

Budget is the same story: product-level spending guardrails are opaque, and cannot be adjusted for team policy (personal card, team splitting, per-PR settlement).

`Evaluator` and `BudgetPolicy` are both exposed as cordis service seams, with users injecting them as plugins. `Goal` must carry an `EvaluatorSpec` at an explicit tier; the driver refuses to start a loop without a paired evaluator—vague goals ("write good code") cannot enter the loop system:

```ts
interface RubricItem { name: string; description: string }
interface EvaluatorContract { readonly name: string }

type CriteriaSpec =
  | { kind: 'single-metric'; name: string }
  | { kind: 'rubric'; criteria: RubricItem[] }
  | { kind: 'contract'; interface: EvaluatorContract }

type ExecutorSpec =
  | { kind: 'shell'; command: string }
  | { kind: 'llm-judge'; rubric: string; model: string }
  | { kind: 'provider'; name: string; config?: unknown }

type IsolationSpec = 'same-workspace' | 'separate-worktree' | 'container' | 'remote'

interface EvaluatorSpec {
  criteria: CriteriaSpec
  executor: ExecutorSpec
  isolation: IsolationSpec
}

export {}
```

**Why explicit dimensions instead of letting the user pass any function?** The spec forces the user, at start time, to declare what is judged, what executes the judgment, and what isolation boundary protects it. A free function looks flexible, but in practice it lets evaluator strength quietly regress—the user thinks they're doing a deterministic isolated check when they've actually written a same-workspace LLM judgment. In long-run scenarios the cost is hours wasted.

Criteria shape, executor, and isolation are orthogonal rather than a trust ladder: a rubric may be checked by shell, an LLM, or an external service, and a contract may run in the same workspace or in a container. `llm-judge` remains the weakest executor for soft goals where there truly is no hard signal (revision, translation quality). The documentation explicitly notes "this executor cannot defend against targeted adversarial input; long unattended runs require at least one deterministic evaluator with an isolation boundary appropriate to the threat model".

The driver enforces four structural constraints, not delegated to Evaluator implementations. Isolation strength remains an explicit property of the configured provider rather than a claim the driver can manufacture.

**Preventing "the same agent both generates and self-evaluates"**:

1. **fresh subagent for LLM evaluation**: an LLM evaluator opens a fresh subagent (via `dsh-subagent`'s `spawn`) each round, not inheriting the main loop's context

**Preventing the evaluator subagent itself from being subverted**:

2. **scoped tool set**: an LLM evaluator's model-facing tool set is stripped by the driver to reads only, with write tools disabled (reusing `SubagentProvider`'s `toolFilter`). This reduces accidental mutation but is not process isolation: shell, code runtimes, or another capability can still write unless the configured isolation boundary prevents it

**Preventing the evaluator report itself from deceiving the driver**:

3. **PASS can only flip via an evaluator report**: the `goal-met` StopCondition can only come from the evaluator; the driver and the main agent cannot construct it directly
4. **Default-FAIL**: the driver maintains each criterion's pass state at `false` internally; only an evaluator report with non-empty evidence is allowed to flip it to `true`. The evaluator cannot get the driver to accept a `{pass: true}` return with no evidence

Together, the four ensure that evaluator conclusions are structurally evidence-driven rather than confidence-driven. They do not stop the main agent from modifying evaluator inputs in a shared workspace.

**Phase 1 ships three backends**:

- `loop-evaluator-shell` implements `single-metric`: runs a shell command, `exit 0` = pass
- `loop-evaluator-rubric-judge` implements `llm-judge`: a prewritten rubric plus LLM scoring, soft goals only
- `loop-budget-preflight`: before each round starts, estimate `(promptTokens + overhead + estOutputTokens) / 1M × pricePerMTok`; refuse to start if the estimate exceeds `perRoundUsd`. The estimation model comes from MartinLoop `policy.ts:551-596`

A `PricingProvider` service injects the pricing table; a test seam can override it, and it is not hardcoded into the driver (AGENTS.md "No hardcoded tunables in plugins"). A resolved budget carries `maxRounds`, optional `maxTokens` and `maxUsd`, and optional `perRoundUsd`. The driver checks per-round admission before starting work, then accumulates worker, evaluator, compaction, and reflector usage after every request. A token or USD cap may overrun by one in-flight request because usage arrives after completion; the `budget-cap` result reports `observed` and `maximum`. The `rubric` and `contract` criteria shapes get built-in executors in Phase 2; Phase 1 exposes the shapes so third-party plugins can integrate first.

**Limitation**: `same-workspace` plus a read-only model-facing tool set is not hard isolation. The current `packages/fs` policy enforces read-before-edit and version guards, not path denial, and bash or code runtimes can bypass filesystem tools. Defending against targeted adversarial input requires a boundary across every mutation channel—such as a read-only mount, isolated worktree, container, or remote evaluator. The two-container approach (the evaluator's definition files are entirely inaccessible to the main agent, the route Anthropic patch.py takes) remains a Phase 3 item. See Risks.

### Pluggable RoundHandoff

How context passes between rounds is a dilemma. Preserving the full prior conversation (continue) reads more coherently, but the conversation keeps growing and eventually hits the context ceiling, and errors from a prior round contaminate every subsequent round. Starting each round from scratch (fresh) avoids the contamination, but has to re-understand context every time. A 3-round revision loop and an 80-round overnight bug-fix loop need opposite strategies. Claude Code and Codex both hardcode one mode, so users cannot switch by task type.

Made a service seam:

```ts
interface ContinuationRun {
  readonly id: string
  resume?(prompt: string): Promise<ContinuationRun>
}

interface PreviousRound {
  result: unknown
  evaluator: { criteria: readonly { name: string; pass: boolean; evidence: readonly string[] }[] }
  tokenUsage: number
  summary: string
  sessionId: string
  run?: ContinuationRun
}

interface RoundContext { loopId: string; round: number; previous: PreviousRound }

type NextRoundSpec =
  | { mode: 'fresh'; prompt: string }
  | { mode: 'continue'; run: ContinuationRun; prompt: string }

interface RoundHandoff {
  buildNextRound(prev: RoundContext, signal: AbortSignal): Promise<NextRoundSpec>
}

export {}
```

Phase 1 ships the fresh backend; Phase 2 adds the two continuation backends after provider continuation exists:

| Backend | Phase | Scenario | Mechanism |
|---|---|---|---|
| `handoff-fresh-with-summary` (default) | Phase 1 | Long runs, unattended | Open a fresh subagent each round, injecting only a progress summary as a system prompt append |
| `handoff-continue-with-compaction` (recommended middle) | Phase 2 | Medium length, 5–20 rounds | Retain the full conversation up to a token threshold; over the threshold, reuse [`packages/compact`](../../../../packages/compact/README.md) to compress into a summary, using summary + last K rounds as the starting point |
| `handoff-continue-raw` (advanced) | Phase 2 | ≤5 rounds, short tasks, testing | Plain continuation without truncation |

**Why default to fresh?** Every long-run loop that actually succeeded (repomirror, Kimi ralph-loop, autoresearch) uses fresh. Placing important loop state outside the context window under driver management is the correct posture for long runs. `handoff-continue-raw` violates this experience, and the README explicitly notes it is not suitable for long runs.

**Why is only this repo able to build the middle tier?** `handoff-continue-with-compaction` depends on a compaction seam—the competitors don't have one; only this repo's `packages/compact` provides that infrastructure.

**Why a seam rather than a three-choice flag?** Users can write 20-line plugins expressing hybrid strategies like "continue for the first 5 rounds, then fresh", or "auto-compact once when context hits 50%", without waiting for main-library support.

**Limitation**: `continue-with-compaction` depends on the compression quality of `packages/compact`; compression itself may write hallucinated information into the summary and propagate it forward. The README recommends fresh for long runs. The three backends' boundaries may confuse new users about which to pick; the `dsh-sdk loop` CLI defaults to fresh, so users don't have to understand the differences before hitting a concrete problem.

### Pluggable GoalReflector

The goal the user gives at loop start is not always accurate. It may be based on a wrong assumption (asking the agent to implement a feature with a since-deprecated API), it may not be clear enough (the agent discovers a clarification is needed only mid-work), or it may be invalidated by later information. Current loop-execution frameworks treat the goal as a contract frozen at start; the agent can only push down the original path, and the result is exhausting the budget on the wrong direction.

Phase 2 makes this a service seam, with responsibility separated from `Evaluator`: the evaluator asks "did we reach the goal", the reflector asks "is the goal still the same goal". Phase 1 carries concern events plus the `stop` and `notify-continue` driver policies without registering an unused `GoalReflector` service.

```ts
interface RoundContext { loopId: string; round: number }
interface GoalConcern { concern: string; severity: 'low' | 'medium' | 'high' }

interface GoalReflector {
  reflect(ctx: RoundContext, concerns: GoalConcern[]): Promise<GoalReflection>
}

type GoalReflection =
  | { kind: 'continue' }                              // goal 仍有效
  | { kind: 'revise'; newGoal: string; why: string }  // 建议修正 goal
  | { kind: 'stop-for-human'; reason: string }        // 需要人拍板

export {}
```

**Concerns have three sources**. Phase 1 ships the first two; the `GoalReflector` service and periodic source arrive together in Phase 2:

- **Agent-initiated**: via the model-facing tool `loop_flag_concern({ concern, severity })`. An agent that realizes during investigation that "the library the user assumed has been deprecated" can raise directly
- **Driver heuristic**: when budget passes 50% and zero criteria have passed, the driver auto-raises a `no-progress-toward-goal` concern
- **Periodic reflector subagent** (Phase 2): every N rounds, run an independent read-only subagent to re-audit goal validity, following the same isolation approach as the evaluator

**Response strategy is controlled by the `onGoalConcern` config**. The four settings correspond to different philosophies about loop use; users choose by their team's collaboration style, and the driver takes no default stance:

- `'stop'` (Phase 1 default): any concern triggers `StopCondition: approval-required`, and a human decides. A loop should never proceed on its own in the face of uncertainty—suitable for cautious teams and for high-impact loop scenarios
- `'notify-continue'` (Phase 1): record an ordinary `loop/goal-concern` session event, then continue; a human reviews at the end. ACP has no general high-priority marker, so dedicated concern rendering is deferred with the ACP command infrastructure. The loop internal is not interrupted—suitable for unattended long runs
- `'reflect'` (Phase 2): call `GoalReflector` to decide continue, revise, or stop. Delegates the initial judgment to an independent agent in place of a human—suitable for teams with moderate autonomy
- Not registering a `GoalReflector` and leaving `onGoalConcern` unset = the most hands-off tier: the loop stops only on traditional stop conditions

**Why default to `stop`?** In unattended scenarios, stopping one extra time is safer than running for hours in the wrong direction. Users who explicitly want unattended can switch to `notify-continue`.

A concern is itself just an ordinary session event, composing naturally with the persistence capability described earlier: a later replay can seed a new conversation from the round where the concern surfaced and swap the goal. This does not roll the workspace back to that round.

**Abuse and loss protection**. An agent could raise a concern every round; the mitigation is the `severity` field plus a minimal rate limit on the driver side (same-concern dedup within 30 seconds). The cost of that abuse is that the agent stalls itself and cannot make progress, so the incentive is weak. Once a goal has been revised, the original goal is lost; each revise persists a `loop/goal-revised` session event with rationale, and later replay can select any historical goal version without claiming workspace restoration.

### User surface

Four trigger surfaces share one driver:

- **Agent-side tool**: `loop({ goal, evaluator, maxRounds, maxUsd, onGoalConcern })` registers `kind: 'loop'` through `ctx.tasks`, returns the task id immediately, and runs the harness loop in the background. `task_output`, `task_list`, and `task_kill` provide collection and cancellation. Inside a running loop, the internal agent can call `loop_flag_concern({ concern, severity })` to raise a concern proactively. ACP rendering intent is `generic`. An agent-initiated call is proactive triggering with no extra machinery
- **CLI**: `dsh-sdk loop <prompt> --stop <shell-cmd> --max-rounds N --max-usd X --handoff fresh` is human-initiated startup, the most typical Ralph-style usage
- **cordis leaf**: declare a resident loop as a leaf in `cordis.yml`, with future `dsh-schedule` RFC integration for periodic triggering
- **ACP slash command**: `/loop <goal>` (and `/loop-flag-concern`) starts directly from within the editor or client's current session. Semantically equivalent to a human typing `dsh-sdk loop` in a shell, but happens within the ongoing ACP session context, letting the loop result inject back into the session

The ACP slash command depends on: `packages/ui/acp`'s `available_commands_update` surface is currently unbuilt ([acp-feature-support.md](../../../../packages/ui/acp/acp-feature-support.md)). Once the harness's slash-command infrastructure lands, `/loop` and `/loop-flag-concern` only need to be registered against that infrastructure; the driver and tool interfaces do not change. This RFC reserves the names and specifies the argument shape, but does not commit the infrastructure itself—that belongs to a separate ACP catch-up RFC.

The default system prompt carries two behavioral instructions, distributed with every built-in `loop` tool:

1. No writing of `TODO`, `FAKE`, or `PLACEHOLDER` placeholders to superficially pass the evaluator
2. No writing of empty `try/except` or `catch(_)` blocks so the evaluator ignores errors

Neither can be enforced at the seam layer; both are prompt-layer guidance and must not be described as hard constraints. Users may customize the system prompt; evaluators that require these rules must check them explicitly.

### Relationship with existing code

Direct reuse without modification:

- `packages/subagent`'s `spawn` provider, `toolFilter`, and `persona`—the loop spawns a subagent per round; an LLM evaluator gets a scoped model-facing tool set, not a process-isolation guarantee
- `packages/tasks`—the model-facing loop is a `loop` task producer and reuses owner isolation, `task_output`/`task_list`/`task_kill`, completion notices, cancellation, and awaited cleanup
- The SQLite backend from `packages/session-persistence`—the loop-session persists
- `packages/session-query`—exact live and persisted session reads for post-hoc diagnosis
- `packages/compact`—the implementation basis for `handoff-continue-with-compaction`
- `packages/todo`—an optional progress representation in single-session continue mode
- If [ToolExecution.reportProgress](2026-07-13-stream-workflow-progress-through-tool-calls.md) lands first, the loop tool can use it for per-round UI updates

Not touched: `packages/core/agent-loop` (the inner-loop semantics stay the same); `packages/workflow` (DAG orchestration vs. iterating one goal is an orthogonal relationship; the two READMEs cross-link in their "Related" section to describe the boundary).

One dependency is not yet landed:

- The ACP slash-command infrastructure (the `available_commands_update` surface)—see User surface. Before the infrastructure lands, the slash-command trigger is absent while the other three trigger surfaces work as normal

The proposed [SQLite FTS5 search](2026-07-10-sqlite-session-query-provider.md) is an optional Phase 2 discovery improvement over the existing exact-read query service, not a dependency for Phase 1 event access.

Continuation work can be deferred to Phase 2: the `SubagentRun.sendMessage` and `resume` methods exist as optional seam capabilities, but the current `subagent-spawn` provider deliberately exposes neither. The two `handoff-continue-*` backends therefore require provider implementations, capability checks, ownership tests, and a consumer surface—not only a new argument on `packages/subagent-tool`. Phase 1 ships only `handoff-fresh-with-summary` and does not touch subagent continuation.

### Phasing

**Phase 1** (the scope this RFC commits): the three-package seam; `StopCondition`; the orthogonal criteria/executor/isolation `EvaluatorSpec`, with built-in implementations for shell and LLM-judge execution and rubric/contract criteria shapes open for integration; Default-FAIL enforcement; evaluator and cumulative-budget backends; `handoff-fresh-with-summary`; `ctx.tasks` integration; the `loop_flag_concern` tool; the no-progress heuristic; the `onGoalConcern: 'stop' | 'notify-continue'` pair; the CLI; the tool; and the default system-prompt guidance. **Not included**: the SQLite FTS5 search surface, the ACP slash-command trigger surface (depends on the `available_commands_update` infrastructure), subagent continuation provider/tool work, the `GoalReflector` service, the stuck detector, the Reflector subagent, the `loop_split` tool, and built-in executors for every rubric/contract combination.

**Phase 2**: the SQLite FTS5 search surface; the stuck detector (reproducing OpenHands's five patterns); subagent continuation provider implementations, capability checks, and consumer surface (unlocking the two continue handoffs); the `GoalReflector` service and Reflector subagent; the `onGoalConcern: 'reflect'` tier; the `loop_split` model-facing tool; and built-in executors for additional rubric/contract combinations.

**Phase 3**: agent fleet (N parallel loops for the same goal, best result wins); integration with `dsh-schedule`; two-container evaluator isolation (evaluator definition files entirely inaccessible to the main agent, defending against reward hacking).

## Alternatives considered

**Extend `packages/core/agent-loop`**: add an "iterate on end_turn until goal" switch to the inner loop. Rejected—AGENTS.md says "new behavior goes on documented extension seams; changing agent-loop requires updating docs/architecture.md". The harness loop needs state across sessions and across agents; stuffing it into the inner loop tangles session semantics into two mixed layers.

**Ship a single slash command `/loop` (Claude Code clone)**: minimal implementation. Rejected—the slash-command layer does not resolve the harness/inner boundary; the four design points (queryable session, tiered evaluator, pluggable handoff, pluggable goal reflector) have nowhere to sit at the slash-command layer, and every capability this RFC commits is lost.

**Fully outsource to `packages/workflow`**: express the loop as a workflow node with a back edge. Rejected—workflow lacks first-class semantics for iteration, StopCondition, and Evaluator; forcing it means the evaluator has to masquerade as a phase, violating the architectural-isolation requirement that the evaluator be independent of the producer; the budget guardrail in workflow is phase-level rather than round-level, and the granularities do not match.

**Hardcode a binary choice between A (fresh) and B (continue)**: the Ralph school and the LoopTroop school each have strong scenarios. Rejected—Pluggable RoundHandoff proposes a seam plus three built-in backends that cover both schools and allow hybrids.

**Skip the evaluator seam, ship a few built-ins**: lighter. Rejected—the core value of Pluggable Evaluator and Budget is that team-private evaluators can extend the system. Hardcoding leaves long unattended users no option but to modify the main library.

**Accept a free function that lacks an explicit `EvaluatorSpec`**: allow users to pass any `(result) => boolean`. Rejected—the criteria/executor/isolation dimensions force users to declare at start time what is judged, what runs the judgment, and what boundary protects it, preventing quiet regression to a weaker setup. A free function looks flexible but lets evaluator strength quietly regress, and the cost is heavy in long-run scenarios.

**Introduce an independent memory engine (Beads / dex-style)**: an established approach to external state. Rejected—`packages/session-persistence` plus the existing exact-read `ctx.sessionQuery` already cover Phase 1 diagnosis, while SQLite FTS5 can add search later; the payoff of a new engine is far smaller than the maintenance cost.

**Fold goal reflection into the Evaluator seam** (have the evaluator return "criteria are impossible"): rejected—it conflates "was the goal achieved" with "is the goal still correct", which are orthogonal concerns. `Evaluator` should stay independent, read-only, and simple.

**Only ever add an event for goal-concern, no seam**: lighter. Phase 1 does use the event plus `stop`/`notify` policies; rejected as the final design because the Phase 2 `reflect` path needs a replaceable response strategy. The seam lands with that first caller rather than ahead of it.

**Ship the full Reflector subagent in Phase 1**: more complete. Rejected—`loop_flag_concern` tool plus no-progress heuristic plus the two-policy `onGoalConcern` already covers 80% of scenarios; running an independent subagent every round is expensive, and introducing it on demand in Phase 2 is more sensible.

**Do not ship `loop_split`; let users split themselves**: Phase 1 already does. Phase 2 adds it because long-run scenarios reveal that agents receiving an oversized goal will run it directly rather than split it, so explicit tool guidance is needed.

## Acceptance criteria

- The three packages `packages/loop/{loop,loop-driver,loop-tool}` are built as a capability seam; `dsh-loop` exports only types and registry
- `StopCondition` discrimination covers all branches (unit); `assertNever` closes the switch at compile time
- The Phase 1 services `Evaluator`, `BudgetPolicy`, and `RoundHandoff` can each be replaced by an external plugin (fixture: inject a mock implementation, driver calls it correctly); no `GoalReflector` service is registered before the Phase 2 `reflect` consumer exists
- `EvaluatorSpec`'s criteria/executor/isolation dimensions converge at compile time; the driver refuses to start a loop without a paired evaluator (fixture: `loop({ goal, evaluator: undefined })` returns a configuration error immediately)
- Default-FAIL fixture: when the evaluator report returns `{criterion, pass: true, evidence: []}`, the driver refuses that criterion flip and records an `evaluator/invalid-report` session event
- `RoundHandoff` receives the previous result, evaluator report, token usage, summary, session id, optional run handle, and cancellation signal; Phase 1's `fresh-with-summary` has unit coverage plus one pass-path e2e, while continuation backend tests wait for Phase 2 provider support
- `dsh-sdk loop` CLI e2e: given a goal plus a 3-round cap plus one shell evaluator, both the pass and exhaustion paths return a structured stop cause with a semantic exit code
- Evaluator scoping fixture: the main agent has fs.write while an LLM evaluator's model-facing tool set does not; the result and documentation still label `same-workspace` as non-isolated, and no `protectedPaths` guarantee is exposed
- Budget fixtures cover `perRoundUsd` admission plus cumulative `maxRounds`, `maxTokens`, and `maxUsd` across worker and evaluator usage; an in-flight overrun emits `budget-cap` with `observed` and `maximum`
- Goal concern fixture: `loop_flag_concern` is callable from the main agent and yields an ordinary `loop/goal-concern` session event; under `onGoalConcern: 'stop'` an `approval-required` StopCondition is emitted; under `'notify-continue'` the loop continues without nonexistent ACP priority metadata; the no-progress heuristic fires once when budget exceeds 50% with zero passes (with rate-limit dedup)
- The default system-prompt guidance (no TODO/FAKE/PLACEHOLDER, no empty catch) is distributed with the built-in `loop` tool, and a snapshot covers the prompt content without treating it as enforcement
- Each round's prompt, inner-loop result, evaluator report, and stop decision appear as session events and are readable through the existing exact-read `ctx.sessionQuery`; FTS5 search remains Phase 2
- Model-facing loop startup returns a `loop` task id immediately; `task_output`, `task_list`, `task_kill`, parent-agent disposal, cancellation, producer reload, and service disposal cover owner isolation and awaited quiescence
- The "Related" sections in `packages/loop/README.md` and `packages/workflow/README.md` cross-link and describe the "when to use workflow vs. when to use loop" boundary clearly
- Unit 100% / snapshot / e2e / doc-sync / verify-module-graph / build / hygiene all green; the ACP rendering intent (`generic`) of the new tool has a snapshot

## Risks

**Conversation replay is not workspace restore**. Exact session reads already exist, and FTS5 improves historical discovery rather than enabling correctness. Replaying a round prefix against the current workspace can diagnose or redirect a run, but reproducing the execution world at that round requires Git/worktree/checkpoint support and an explicit policy for external side effects.

**The boundary between `packages/workflow` and loop is a recurring FAQ**. "Is multi-round a loop or a workflow?"—both READMEs must state clearly: workflow is "steps known, agent to run undecided, parallel or serial orchestration"; loop is "agent decided, round count undecided, evaluator decides when to stop". Unclear docs cause users to pick the wrong one.

**Evaluator reverse-optimization (reward hacking)**. In a sufficiently long loop, the agent can identify the evaluator's pattern and optimize against it—for example, discovering that "as long as `assert True` appears in a test file, it PASSes" and bypassing real completion that way. Phase 1's `same-workspace` mode does not prevent the agent from modifying tests or evaluator configuration through bash, code runtimes, or another write channel; the current `packages/fs` policy is not a path-isolation boundary. Users needing adversarial strength must choose an isolated worktree, read-only mount, container, or remote evaluator. Phase 3's two-container approach keeps the evaluator runtime (binary, rubric, dependency libraries) entirely inaccessible to the main agent, matching what Anthropic patch.py does.

**Placeholder faking and over-defensive code**. Agents sometimes write `# TODO: implement` to sneak through a test, or write large amounts of `try/except: pass` to make the evaluator superficially PASS. These do not belong to the evaluator layer; they are prompt and training issues at the agent-generation stage. The two default system-prompt instructions in User surface are guidance only; users who add "static-check-forbid TODO and empty catch" rules to a custom evaluator get enforceable coverage. This class of problem cannot be cured at the seam layer.

**Budget estimation drift and in-flight overrun**. Pricing can change, and cumulative token/USD usage becomes exact only after each worker, evaluator, compaction, or reflector request reports usage. Preflight protects a single round; cumulative caps stop the next request and may exceed the configured maximum by one in-flight request. The README reports both observed and maximum values and states that provider billing remains authoritative.

**Background tasks are process-local**. `ctx.tasks` gives the model-facing loop owner isolation, generic collection/cancellation, completion notices, and awaited cleanup. Parent-agent or service disposal cancels and awaits the loop; a process crash cannot run cleanup, and durable restart remains outside Phase 1.

**Long-run loop log growth**. A 100-round loop reaches MB scale for one session. `logDetail: 'summary'` is a safety net but Phase 1 defaults to `full`; Phase 2 adds summary semantics.

**Pre-release allows direct evolution**. `SESSION_FORMAT_VERSION=0`; the `LoopRoundEvent` schema can change at any time. Backends reject old formats rather than maintain compatibility, matching the pre-release stance at the top of AGENTS.md.
