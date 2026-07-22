---
name: dsh-find-simplifications
description: 'Use when working in the deepseek-harness repo to find non-obvious simplification candidates and write proposed Agent Notes or inline TODO/FIXME/XXX notes for dead, duplicated, speculative, or over-built code surfaces; especially for requests like "find simplification Agent Notes", "look for unnecessary complexity", "audit for removal-style cleanups", or "fold worthwhile simplification ideas from another PR".'
---

# Finding DeepSeek Harness Simplifications

This skill helps turn a broad "find things to simplify" request into evidence-backed Agent Notes that remove or collapse existing harness surface area. It is guidance, not a checklist: follow the code, keep judgment active, and prefer a few well-proven candidates over a pile of thin guesses.

## Start With Repo Context

- Read `AGENTS.md`, especially the pre-release stance and the conventions (including the tests-are-not-golden-truth and Agent Notes-are-not-golden-truth doctrines), plus [docs/defensive-patterns.md](../../../docs/defensive-patterns.md) and [docs/testing.md](../../../docs/testing.md).
- Skim [docs/architecture.md](../../../docs/architecture.md) before judging anything under `packages/`; simplifications that fight the service map or event taxonomy need extra evidence.
- Use the Agent Note tree and its [contract](../../notes/README.md) to understand intentional architecture. The most relevant implemented examples are [drop mutable session summary](../../notes/implemented/simplification/2026-06-19-drop-mutable-session-summary.md), [shared persistence write coordinator](../../notes/implemented/architecture/2026-06-18-shared-persistence-write-coordinator.md), [capability seams](../../notes/implemented/architecture/2026-06-13-capability-seams.md), and the twin adapter / dual persistence backend Agent Notes.
- Treat dual LLM adapters and dual persistence backends as intentional by default. Do not propose deleting either twin/backend as "low effort" unless the user explicitly overrides that constraint. Removing an unused method or hook inside a protected seam can still be valid if it does not collapse the protected design.

## What Counts As A Strong Candidate

A strong simplification removes, folds, or demotes something real and has clear evidence that the current shape costs more than it buys:

- A public method, event, config knob, registry notification, helper, package, durable event, or test artifact has no production consumer.
- Tests or docs are the only consumers, and the behavior they pin is not load-bearing.
- Two representations mirror the same fact, especially across durable session events and transient `agent/*` events.
- A seam has methods every implementation must support but no consumer uses.
- A package boundary exists only for test/demo/support code and adds publish or dependency overhead.
- A feature implements speculative product generality: multi-session/session-load, background task rosters, live registry invalidation, mid-turn steering, tool-owned UI rendering, and similar shapes with no product owner.
- An invariant, rollback path, set of expected outputs, or special-case test exists only to protect an unused surface.
- The simplified behavior may differ slightly, but the new behavior is still reasonable and easier to explain.

Thin candidates are usually not enough for an Agent Note: deleting one typo, running `knip` once, removing an intentionally documented backend/adapter, or flagging "this looks complex" without call-site proof.

## Survey Broadly

Use parallel subagents when the user asks for breadth or many candidates. Give each agent a domain and require evidence, not guesses. Useful domains:

- Agent loop and session log: turn/step boundaries, steering, abort/cancel, durable events, replay, load/resume.
- ACP and UI surfaces: `session/*` methods, terminal `_meta`, transcript rendering, single vs multi-session state.
- LLM/tools/system prompt: stream/generate surfaces, assemblers, registries, tool schema defaults, presentation hooks.
- Bash and tool execution: foreground/background split, task ownership, output spill files, executor methods.
- Packages/examples/scripts/tests: package boundaries, static inventories, redundant snapshot expected outputs, support packages.

If subagents are unavailable, simulate the same breadth yourself. Do not let the first good candidate stop the survey.

Start with the largest production-code deltas. A broad simplification audit that stops after obvious unused symbols can miss the files where duplicated lifecycle or defensive machinery carries most of the cost.

## Audit Trust And Lifecycle Boundaries

Classify every defensive copy, freeze, validator, and callback capture by the boundary it crosses. Same-process typed service/plugin calls ordinarily borrow readonly values; parser/config, queue, model/tool JSON, durable/file, worker, process, and wire boundaries own or validate data. Tests built around hostile getters, fake typed objects, callback replacement, or mutation after a same-process handoff are evidence of a potentially speculative contract, not automatic justification for keeping it.

For complex asynchronous code, draw the ownership graph and map each sentinel, readiness promise, cancellation path, disposer, and state flag to a distinct owner or transition. When several mechanisms mirror the same liveness or settlement fact, propose one transaction or lifecycle controller instead. Preserve separate machinery where it protects a real boundary: synchronous publication and rollback, callback containment, first-terminal-outcome arbitration, worker/process ownership, or dispose-to-quiescence.

## Prove Or Reject Each Candidate

For every symbol or behavior, classify consumers before writing:

- Production corpus: `packages/*/src`, `examples/*/src`, `examples/**/*.yml`, runtime scripts, and loader/config paths.
- Non-production corpus: tests, README/docs, Agent Notes, snapshots, generated expected outputs, and comments.
- Ambiguous corpus: examples and scripts that may be product smoke paths. Inspect usage before classifying.

Use `rg` first. Good searches include the exact symbol, event name, package name, config key, method name with both `.name(` and `name(`, and any wire strings. Then read the call sites. `knip` can help, but it is not a substitute for understanding public interfaces, dynamic event names, tests, docs, and Cordis loader paths.

Reject or downgrade a candidate when:

- A production caller exists and the simplification would be a feature decision rather than a cleanup.
- The surface is explicitly justified by an implemented Agent Note or a hard-won defensive pattern, and the new evidence does not beat that reason.
- The removal would force unrelated churn without actually making the contract smaller.
- The idea is correct but tiny. Add a targeted TODO/FIXME/XXX instead, using the urgency semantics in [docs/development.md](../../../docs/development.md).

## Write The Agent Note

Create one file per durable proposal under `.agents/notes/<lifecycle>/<class>/yyyy-mm-dd-topic.md`, following the lifecycle/classification contract in `.agents/notes/README.md`. Keep prose paragraphs on one physical line and use relative Markdown links.

Prefer this shape, adjusting when the idea needs it:

- `# Agent Note: <action-oriented title>`
- `Status: proposed`
- `## Problem`: name the current surface, cite the relevant files, and state the consumer evidence. Separate production callers from tests/docs.
- `## Proposal`: say exactly what to remove, fold, demote, or rehome. Include tests, docs, READMEs, JSDoc, event-taxonomy, snapshot, and generated-file cleanup when relevant.
- `## Why not keep it?` or `## What we give up`: make the strongest counterargument legible.
- `## Acceptance criteria`: observable end state and gates.
- `## Risks`: public API changes, behavior changes, future product wants, and why the tradeoff is still reasonable.

Be concrete enough that an implementing PR can follow the trail. Avoid vague "simplify this package" Agent Notes. When a proposal overlaps an existing Agent Note, consolidate the useful details into the existing one rather than creating a duplicate.

## Inline TODO Notes

Use inline TODO/FIXME/XXX only for small, local cleanups that are clearly useful but not durable design decisions. Keep them short and actionable:

- Name the smell with a stable tag, e.g. `TODO(double-default)` or `XXX(unused-default)`.
- Explain why it is safe to revisit and what action would simplify it.
- Do not add TODOs for speculative complaints or for behavior that needs an Agent Note-level decision.

## When Folding Another PR Or Branch

Diff the sibling branch against `origin/master`, not against the current PR branch, so you see its independent contribution. For each item:

- Port non-overlapping Agent Notes or TODOs that meet the quality bar.
- Consolidate overlapping material into the existing Agent Note that owns the topic.
- Do not port duplicate or lower-confidence proposals just to preserve the count.
- Update the PR body so reviewers see the true candidate count and scope.
- Close the duplicate PR only when the user asked you to, or when you clearly own that housekeeping.

## Validation And PR Hygiene

For docs-only Agent Note work, run at least `pnpm run doc-sync`, `pnpm run lint`, and `git diff --check`. For code comments or skill changes, also run the relevant validator when one exists. Before pushing, expect the pre-push hook to run module graph freshness, unit tests, snapshots, doc-sync, and hygiene.

When opening or updating a PR, summarize:

- How many Agent Notes and inline notes were added.
- The main areas surveyed.
- What was intentionally excluded.
- Which checks passed.

Use a draft PR while the survey is still expanding; mark ready only when the candidate set, review responses, and validation are settled.
