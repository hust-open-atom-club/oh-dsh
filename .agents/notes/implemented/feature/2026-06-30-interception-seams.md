# Agent Note: Interception seams — the typed-Decision surface a hook programs against

Status: implemented

## Problem

The harness needs a hooks subsystem: users extend or gate the agent at lifecycle points the way Claude Code (CC) and Codex do. The key reframe driving this design is that **"native hooks" are not a package** — a native hook is just an ordinary Cordis plugin subscribing to the canonical lifecycle events. So the real product is a *powerful, well-typed canonical event surface*; the CC/Codex bridges (the `dsh-hooks-claude` / `dsh-hooks-codex` packages) are merely translators that map an external shell-hook protocol onto that same surface. Anything a bridge can do, a plain plugin can do directly — more powerfully (no serialization boundary, full `ctx`, typed returns).

The surface needs distinct contracts for per-prompt policy (CC's `UserPromptSubmit`), session-start observation (CC's `SessionStart`), pre-tool policy, around-dispatch control, post-tool transformation, final-result observation, and continuation with a model-facing reason. Conflating those phases gives plugins mutation channels they do not need and makes finality depend on listener ordering. The [event-domain-semantics Agent Note](../architecture/2026-06-30-event-domain-semantics.md) supplies the three-domain rule and the typed-Decision idiom; this Agent Note applies them to the lifecycle seams.

## Decision

The canonical surface separates transformable policy, around-dispatch control, and observe-only notification. Policy waterfalls return small seam-specific **typed Decision unions**; wrappers return normalized results; notifications receive immutable snapshots and cannot affect the outcome. The set covers the hook points in scope (`session-start`, `prompt-submit`, `pre-tool`, `post-tool`, `stop`-via-continuation) while leaving non-hook execution policy independently composable.

**Agent events** (`dsh-agent`):
- `agent/session-start(agent, source)` — emit, once before turn 1, carrying a `SessionStartSource` (`startup` for a fresh/forked create, `resume` for a reloaded persisted session; `clear`/`compact` reserved). A pure notification — it CANNOT block startup (a deliberate gap: a bridge logs/injects, it does not gate startup). A listener seeds context via `agent.inject()`.
- `agent/prompt-submit(agent, content, source, next) → PromptDecision` — waterfall, fired per drained queued message inside the open turn, before the `user/message` append. `allow` (optionally rewriting the prompt `content` or attaching separately sourced `additionalContexts[]`) or `block` (dropping the prompt; the loop appends a durable `prompt/blocked` in its place — see the dispatch note below).

**`agent/turn-continuation`** receives and returns a `ContinuationDecision`. A `{action:'continue', reason?}` may carry model-facing content and source recorded as next-step steering in the same turn — the typed twin of the `/goal` step-end-steer pattern. It is not a `context/message`, so its type does not offer durable context metadata.

### The tool pipeline gives each phase one kind of authority

Every call follows `tools/pre-execute` → guards → `tools/execute` → dispatch → `tools/post-execute` → `tools/result`. The registry snapshots caller input, materializes and freezes arguments, and assigns an opaque token. Nested calls carry only the parent token. Identity remains immutable; only `signal` may change around dispatch. The log, UI, and tool body therefore agree on what ran.

- **`tools/pre-execute`** is the extensible waterfall gate. Its `PreToolDecision` allows, denies, or asks. Deny skips `tools/execute` and core dispatch. Ask resolves through the optional approval seam: only `allowed-once` continues through guards and dispatch; rejection, cancellation, an unavailable channel, a missing approval service, or an agent-less call becomes a normalized denial. Every outcome still reaches post-policy and final observers.
- **`ctx.tools.guard()`** installs synchronous scope-aware policy after the whole pre-execute waterfall. A guard may deny or abstain, never force-allow, so listener ordering cannot resurrect an operation that a final invariant forbids.
- **`tools/execute`** is the around-dispatch waterfall for timeout, retry, and metrics plugins. A wrapper delegates to core dispatch with `next()`, may add, replace, or remove only `exec.signal` before doing so, and receives the already-normalized result of a thrown or unknown tool; returning its own valid result short-circuits dispatch.
- **`tools/post-execute`** is the inspect/transform waterfall. Its `PostToolDecision` accepts, blocks with feedback, optionally replaces content, or attaches `additionalContexts`. The returned decision is the supported transform channel; after the waterfall, the registry materializes the complete outcome once before final observation.
- **`tools/result`** is the synchronous contained notification after every transform, lossless-JSON materialization, and the outer error boundary. It receives the same frozen execution identity and an immutable snapshot of the authoritative result; observer failures are contained per listener and cannot change or reject `ToolRegistry.execute()`'s returned outcome.

Core dispatch and the tool body sit inside normalization boundaries, so tool, listener, malformed-result, non-JSON result, and identity-shape failures resolve as JSON-safe `isError` results rather than escaping the turn. A post-execute listener can therefore inspect a thrown tool, and a final observer sees exactly what the caller receives and the session log can persist.

**`TurnEndReason.rejected`** (`dsh-session`): a turn whose entire prompt batch was blocked by `prompt-submit`.

### Three load-bearing loop decisions

1. **Open the turn before prompt policy.** A fully blocked batch becomes a zero-step `rejected` turn, preserving enclosure and giving ACP a durable terminal event. Every veto also records `prompt/blocked` with the original prompt and reason, so mixed batches retain blocked inputs. Every allowed `additionalContexts` entry is injected into the open turn.

2. **Post-tool `additionalContexts` and asynchronous injections enter the active-batch FIFO and append when that batch settles.** `content`/`feedback` shape the result `execute()` returns, but each context is a separate `context/message`, and a single step or composite tool can produce many. Appending context immediately would interleave `result(c1) → context → result(c2)` or place nested context before its outer result, breaking tool-call/result adjacency. `ToolRunContext.deferContext()` therefore collects nested-dispatch context through failures, `execute()` surfaces the ordered array on `ToolExecutionResult`, and the loop accepts it into the same FIFO as `agent.inject()` calls made during execution. The FIFO appends after every recorded result when the batch settles, including before an interrupted turn closes. An accepted outer call preserves deferred contexts before decision contexts; an outer block discards deferred contexts and exposes only contexts explicitly supplied by the blocking decision.

3. **A forced `continue` `reason` is enqueued through the steering channel**, so the next step's top-of-loop drain records it as steering for the continued turn — next-*step* steering within the SAME turn, not a next-*turn* prompt (matching the existing `hasSteering` force-continue override).

### Pre-tool input rewrite is a separate consistency decision

`PreToolDecision` cannot rewrite arguments. History and the audit call are logged before execution, and ACP presentation reads the same input, so the registry seals arguments before policy. A valid rewrite must update history, audit, presentation, and execution before identity is created; that contract belongs to the [input-rewrite proposal](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md).

### Boundaries

The seam package does **not** declare `hook/*` session events (the durable hook-invocation log); those belong to `dsh-hook-protocol`, because a native plugin uses typed decisions without an external hook log. The native-plugin integration test (`packages/core/agent-loop/tests/interception.spec.ts`) composes the seams through the real loop with no `hook/*` protocol. Compaction (`PreCompact`/`PostCompact`), Notification, and Codex `PermissionRequest` remain outside this decision. The [approval seam](2026-07-06-approval-seam.md) resolves `ask` decisions through `ctx.approval`, while terminal monotonic stopping is owned separately by `agent/turn-stop`.

## Alternatives considered

- **Shipping pre-tool INPUT rewrite as part of this seam set** — deferred as the over-reach signal; the section above carries the consistency problem (audit, history, and presentation all read `tool/call.arguments` logged before execution), and [the pre-tool input-rewrite proposal](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md) owns the design.
- **Declaring the durable `hook/*` SessionEvents alongside the seams** — rejected: a native plugin uses the typed Decisions with no hook log at all (the worked example proves it), so the durable log belongs to [the hook-protocol library](2026-06-30-hook-protocol-lib.md), not the seam surface.

## Consequences

The canonical interception surface is uniformly typed without giving every extension the same power: hooks return decisions, execution wrappers wrap, terminal guards only deny, and final observers only observe. The loop owns session-start, prompt-submit, post-tool context buffering, and continuation; `dsh-tools` owns identity sealing and the five-phase execution pipeline. Their contracts are documented in [architecture.md](../../../../docs/architecture.md), package READMEs, [core interception decisions](../../../../docs/core-data-structures/core.md#interception-decisions), and [tool structures](../../../../docs/core-data-structures/tools.md). The ACP bridge maps `rejected` turns to its `cancelled` codec value, while hook-driven snapshots verify the observable bridge behavior end to end.
