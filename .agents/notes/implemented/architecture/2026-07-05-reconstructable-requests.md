# Agent Note: Every LLM request is reconstructable from the session log

Status: implemented

## Problem

The request pipeline did not guarantee prefix stability for provider caching, and the session log could not reconstruct what the model saw. It omitted model, system prompt, and tool schemas while allowing per-call request rewrites. Cache behavior and replay equivalence therefore depended on whichever plugins happened to be loaded.

The reference shape for the happy path is MiniCode's `LLMClient`: a stateful conversation client, appended to — never rebuilt — as the conversation advances, resetting only when the system prompt, tool set, or compaction genuinely changes what the model must see. The design question this Agent Note answers is how to get that discipline without giving up event-sourcing.

## Decision

### The principle

**Model-visible ⟺ logged.** Anything that reaches a model request must be recorded in the session log. The checkable consequence: **every conversation request the loop sends is a pure function of the session log** — anyone holding the log reconstructs it byte-for-byte. Scope, stated precisely: the guarantee covers the loop-built `GenerateOptions`; provider wire bytes follow from it because both adapters' serialization is a pure per-message function at a pinned code version; direct one-shots (compaction's summarize call) log their envelope scalars (`compact/summary.{provider, model, maxTokens}`) and their input is deterministic code over the logged region — reconstructable from log + code, outside the invariant by the unfrozen-request marker.

Prefix-cache stability is corollary #1, not the headline: an append-only log projected by a per-node pure function yields requests that are append-extensions of their predecessors whenever the header is unchanged — stability is emergent, not managed. Byte-exact audit/replay is corollary #2; resume and fork with *attributable* drift is corollary #3.

### The mechanism

**Messages.** `Session.deriveMessages()` is cached: each surface entry is projected exactly once, when first seen, through the public per-event function `deriveEventMessage(event)`; a surface rewrite (a compaction `replace` — `SurfaceManager.replaceGeneration`) rebuilds. Callers get a fresh array per call over shared, deep-frozen messages: mutating logged history through a projection is unrepresentable (it throws), replacing the old clone-per-call isolation. External reconstructors fold the same public function over a log prefix, so no two paths can disagree.

`EpochHeader` records the request's non-history state: call config, rendered system prompt, tool schemas, and session prefix, with empty values canonicalized to absence. `request/header` always writes a full snapshot: the first loop instance uses reason `initial`, later instances use `resume`, and an in-instance change uses `change`. `foldRequestHeader` selects the latest snapshot. Legacy `request/header-delta` events and the removed `fallback` reason are rejected when appended or loaded.

Each step rebuilds prompt assembly. On the instance's first step, `agent/session-prefix` extends a frozen empty seed with request-only opener messages; the result is frozen and cached for that loop instance before the generic `agent/pre-step` checkpoint and boundary snapshot. The first call config starts from explicit `AgentOptions`, preserving fork overrides and resume reconfiguration; later calls start from the folded header. `agent/request` may replace only that frozen config seed, while model-visible content enters through logged channels. The loop records the owed header event—the prefix's only durable home—builds `GenerateOptions` from prefix, snapshot, and header, and deep-freezes it while leaving `AbortSignal` live. Per-instance state is only the cached prefix and whether its anchoring snapshot has been written.

**`step/start` is the reconstruction boundary.** A step derives messages from events before that sequence. Injection after the snapshot joins the next request, and reentrant appends are rejected during event publication. `agent/pre-step(agent, turn, step, signal)` remains the generic seam for content needed by the current request. Header reconstruction selects the step's `request/header`, or carries the prior snapshot when no new header is written.

**Enforcement.** In development, `dsh-invariants` independently rebuilds each loop request through a fresh `Session`, so the live cache cannot vouch for itself, then compares messages and folded header fields at `llm/stream`. Loop requests are identified by their frozen shape and session id; direct one-shots are excluded. Correctness depends on sequence-bounded reconstruction rather than listener order. A with-key e2e requires positive cache-read tokens after the first request; per-step usage is the production signal, and a header change or compaction appears as a cache-read drop on the next step.

### The MiniCode shape: adopted, with the provenance arrow inverted

Like MiniCode, the conversation advances append-only and resets only when model-visible state changes. Unlike MiniCode, the event log remains the source of truth because it also owns persistence, recovery, boundaries, tool pairing, and provenance. `Session` caches message and header folds derived from that log, making every request independently checkable.

## Alternatives considered

- **Client as source of truth** (literal MiniCode): a second operative truth beside the log — the two drift and nothing notices; see the section above.
- **A stateful transmission client mirroring the log** — duplicates conversation state, needs rollback around listeners, leaves an unlogged edit surface, and still cannot reconstruct request headers. Session-owned caches plus logged headers avoid those split truths.
- **Per-call request scalars** (a freely mutable config handed to each `agent/request` dispatch): a listener flips the model per call with zero accounting, silently abandoning the provider cache this design exists to protect. Config is per-conversation logged state; the waterfall proposes, the log records.
- **Detect-and-report** (compare consecutive requests, warn on divergence): catches violations after the fact; a violating request is still constructible and ships. Rejected for interface-level unrepresentability.
- **Event-driven assembly** (re-render only on change signals): a missed-signal bug class — a tool registered mid-session emits `tools/change`, not `system-prompt/change`, and a third-party provider may emit nothing. Per-step render + value compare is robust with zero signal discipline.
- **A custom header-delta codec** (system line edits, name-keyed tool edits, whole config/prefix replacements): reduced repeated bytes but duplicated the representation and its diff/apply/fallback machinery. Full snapshots retain one replay representation.
- **Narrative changed-field lists on header snapshots**: derivable by comparing consecutive snapshots. The `reason` remains because an instance boundary is not derivable from the snapshot values.

## Consequences

- A request that is not explained by the log cannot be constructed by accident — not by the loop, not by a listener; mutating a built request throws; every header change is a durable, diffable log event.
- Choosing between the advisory channels is a change-frequency decision, and the design makes the stable one structural: an `agent/session-prefix` contribution is composed once per loop instance and reused verbatim, so it extends the cacheable prefix at zero marginal cost and CANNOT bust the provider cache mid-session; content that changes mid-session flows through the append-only history channels — `agent.inject()` and tool/prompt-submit `additionalContexts` — each a durable `context/message` paid once and prefix-cached thereafter, at the price of accumulating in history and the log. Route session-frozen openers to the prefix and change notices to the history channels; a per-step request-only tail slot was deliberately dropped (no consumer, and a durable append covers every current update pattern).
- What still costs full price at the provider is inherent and logged: compaction (its `compact/*` events and replacement entry), a real prompt, tool, or config change (`request/header` with reason `change`), or a process boundary with drift (a differing `resume` snapshot). The provider's own reasoning-content exclusion is managed server-side.
- The `step/start`-listener behavior change (above) is the one observable semantics change for plugins; `agent/pre-step` is the current-request seam.
- Tool-result trimming (planned) needs no new mechanism: a logged single-entry surface replace (`start === end`) carrying a trimmed `tool/result` under the same `callId` — compaction-family, replay-correct, cache-bust batched by the same pressure logic.
- Session logs grow one `request/header` snapshot per loop instance plus snapshots on real changes. This is larger than a delta codec but small beside chunk-heavy logs and retains one replay representation. `SESSION_FORMAT_VERSION` stays `0`; legacy delta events are rejected rather than migrated.
- Snapshot expected outputs changed once (every transcript gains its header events); the fs-writing fixtures are stored in the normalized authored form with cwd-relative tool arguments, because replay only round-trips cwd-independent argument paths.
- FIXME(call-config-shape): revisit `LlmCallConfig`'s exact field set — which fields are genuinely epoch-level for cache purposes (`model` certainly; the sampling scalars sit there out of caution), and where provider-specific extras (reasoning options, extra body params) belong when an adapter needs them.
