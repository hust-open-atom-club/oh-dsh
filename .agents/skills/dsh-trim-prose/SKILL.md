---
name: dsh-trim-prose
description: Use when trimming, restoring, or auditing prose in the deepseek-harness repo, including Markdown, JSDoc, code and test comments, prompts, descriptions, diagnostics, and CLI or UI strings; especially for generated-sounding narration, duplicated explanation, or an earlier edit that may have removed contract detail.
---

# Trim DeepSeek Harness Prose

Preserve the contract while removing reasoning transcripts, repetition, and decoration. This skill owns editorial judgment; use [dsh-doc-standards](../dsh-doc-standards/SKILL.md) for placement, budgets, bilingual pairs, and documentation gates. It is guidance, not a script.

## Inputs and exclusions

Require an explicit `scope`. If it is missing, report the required input and stop; do not infer a repository-wide scope or begin an interview.

Accept `mode: automatic | interactive`; default to `automatic`. Enter interactive mode only when the user explicitly requests questions or calibration.

Always exclude `vendor/` from discovery, review, and edits, even when the requested scope is the whole repository. Do not follow a symlink into it. Put exclusions after inclusion globs so a later include cannot re-admit it: for example, end ripgrep commands with `--glob '!vendor/**'`, and give Git commands an explicit `:(exclude)vendor/**` pathspec. If the requested scope contains only `vendor/`, report that no eligible files remain.

Treat generated catalogs, translations, snapshots, and fixtures as derivative. Edit the owning source or scenario first, then regenerate or synchronize the derivative artifact. Follow the bilingual workflow when either side of a documentation pair changes.

## Preserve the complete proposition

Before editing, identify every proposition in the passage. Preserve each relevant:

- actor and action;
- condition, timing, and ordering;
- modality such as must, may, or never;
- negative guarantee and exception;
- ownership, side effect, failure mode, and consequence.

Remove adjectives, repetition, and narration only when every factual clause survives and the result is clearer. A smaller word count alone is not an improvement.

Keep a complete local contract at the point of use: behavior, failure, ownership, and consequence that a caller or maintainer needs there. Aggressively link to the owning document for architecture, rationale, algorithms, history, or extended examples. One explanation has one home; essential contract facts may repeat locally.

Keep non-obvious rationale when omitting it could plausibly cause misuse or an incorrect simplification. Otherwise state the consequence and link the rationale home.

## Calibrate by prose surface

- **Public JSDoc:** retain caller-visible return distinctions, throws or rejections, side effects, ownership, timing, cancellation, and durability.
- **Internal comments:** retain orientation for non-local structure and obviously complicated local structure. Delete control-flow narration and code restatement.
- **Module comments:** retain the module's role, boundaries, and non-obvious architecture choices; link architecture choices to their owning explanation.
- **Tests:** retain only non-obvious test design—why a fixture, assertion, platform accommodation, real entry path, or indirect observation is necessary. Delete walkthroughs and inventories.
- **Cookbooks:** retain prerequisites, required actions, the real entry path, observable verification, and concise warnings.
- **READMEs:** retain the consumer contract: configuration, semantics, failures, limitations, extension points, and model-visible effects. Link algorithms and design rationale.
- **RFCs:** presume unique rationale, mechanisms, alternatives, consequences, shipped verification contracts, and named coverage gaps are load-bearing. Implemented RFCs state shipped reality in the present tense; remove planning checklists, not evidence of what pins the decision.
- **Postmortems:** retain the incident sequence, evidence, causal chain, impact, and prevention. Remove repeated persuasion or implementation detail that does not establish causality.
- **Skills and agent instructions:** preserve behavioral guardrails and explicit scope statements such as “guidance, not a script/checklist.” Keep the workflow concise and link its source of truth.
- **Examples and configuration comments:** retain boundaries, non-obvious wiring or load order, security stance, replay behavior, exceptions, and likely misuse. Do not narrate entries that the configuration already shows.
- **Prompts and visible strings:** treat wording as behavior. Inspect generated output and run behavior validation or state why no snapshot applies.
- **Diagnostics:** retain the failing subject or path, violated rule, and correction when it is non-obvious. Remove internal execution narration.

Preserve searchable mechanism names and meaningful modal, temporal, or negative emphasis. Normalize decorative emphasis only.

## Workflow

1. Confirm the scope, mode, current branch or PR base, and applicable `AGENTS.md` files. Do not inspect unrelated branches.
2. Read [the documentation standard](../../../docs/AGENTS.md) and the owning code or document before judging a passage. For calibration or unfamiliar cases, read [the distilled examples](references/examples.md).
3. Inspect the requested scope, not only the largest files. Use searches and word counts to find candidates, then judge passages semantically.
4. Classify each candidate as keep, trim, restore, restructure, or defer. Apply clear changes; do not manufacture edits to satisfy a deletion target.
5. Update the owner before derivative artifacts. Re-check analogous passages after learning a new rule.
6. Run the narrow relevant checks, documentation gates, `git diff --check`, and behavior tests for visible strings. Verify the final diff contains no `vendor/` path and report any accidental vendor match rather than claiming a clean exclusion history.
7. Report the inspected scope, clear changes, deliberate keeps, deferred cases, and checks actually run.

## Borderline decisions

A case is borderline only when at least two versions satisfy the complete-proposition rule but trade accepted principles, and this skill does not already resolve the tradeoff. A new prose shape with one contract-preserving answer is not borderline.

In automatic mode, apply clear edits and report genuine borderline cases without asking questions. Do not weaken a proposition to make progress.

In interactive mode, group analogous passages under the governing principle. Present two or three viable versions, recommend one, and state the factual or structural difference. Do not offer inferior distractors. Use the user's requested channel; when calibrating a PR through inline comments, place the recommended provisional version in the diff and attach the alternatives to that exact line.

After the user decides, distill the principle and versions into [the examples](references/examples.md), without PR history or reviewer narration, and apply the learned rule to every analogous passage in scope.
