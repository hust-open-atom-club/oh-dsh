---
name: dsh-doc-standards
description: 'Use when writing, moving, reviewing, or auditing documentation in the deepseek-harness repo — choosing where content belongs, trimming doc slop, responding to a verify-doc-budgets gate failure, or requests like "improve the docs", "audit the docs for slop", "where should this be documented", "this doc is too long".'
---

# Applying the DeepSeek Harness Documentation Standard

The contract lives in [docs/AGENTS.md](../../../docs/AGENTS.md). This workflow covers placement, corpus audits, budgets, and validation across Markdown, JSDoc, and code comments. It is guidance, not a script; use [dsh-prose-standard](../dsh-prose-standard/SKILL.md) for required coverage and editorial judgment, and never treat length alone as a defect.

## Sources of truth (read, don't re-summarize)

- [docs/AGENTS.md](../../../docs/AGENTS.md) — the taxonomy ("one home per fact"), budgets, slop checklist.
- [docs/rfc/README.md](../../../docs/rfc/README.md) — when a decision earns an RFC, how to file it, and what goes inside one (the header block, per-lifecycle skeleton, and Alternatives-considered mandate, gated by `verify-rfc-format`); [docs/postmortem/README.md](../../../docs/postmortem/README.md) — when an incident earns a postmortem.
- [docs/i18n/README.md](../../../docs/i18n/README.md) — the bilingual pairing contract; editing either side of a pair obligates the counterpart in the same change.
- Root [AGENTS.md](../../../AGENTS.md) — the standing orders whose budget discipline this skill protects.

## Placing content

Run the placement test in the standard's taxonomy table, then check the constraints that make a placement expensive or wrong:

- Paired docs (`pnpm run verify-translation-pairing --list`) cost a zh counterpart update and a `--write` re-record on every edit — prefer an unpaired home for content that will churn.
- Generated catalogs are never hand-edited; if the fact belongs there, change the generator's source.
- Before renaming or moving any doc, grep for inbound references: `verify-md-links` catches Markdown links, `verify-doc-refs` catches `docs/*.md` citations in TypeScript comments, but nothing catches heading-anchor fragments — grep `#the-heading` across the repo yourself (one anchor is hardcoded in `scripts/gen-cordis-catalog.ts`).
- A move is atomic: remove from the old home, add to the new home, and fix every inbound link in the same change.

## Auditing the corpus

The audit is a hunt for the standard's slop checklist, cheapest probes first. Establish the PR's current base first; after a retarget or base merge, repeat the audit for prose introduced by the new base rather than relying on the earlier result.

1. Measure: `pnpm run verify-doc-budgets --list`, then `git ls-files '*.md' ':(exclude)vendor/**' | xargs wc -w | sort -rn | head -30` to spot unbudgeted outliers.
2. Hunt narrated history: `rg -n "no longer|used to|previously|was moved|renamed" --glob '*.md' --glob '*.ts' --glob '!vendor/**'` and keep only contrasts against a live alternative. Keep the vendor exclusion last so include globs cannot override it.
3. Inspect long comments for reasoning transcripts: control-flow narration, test walkthroughs, proof of obvious branches, review findings, rejected local alternatives, and the same rationale repeated beside sibling methods. Preserve only a non-obvious contract or durable rationale; otherwise delete the comment.
4. Hunt duplication by grepping distinctive phrases. Keep one home and replace other copies with links.
5. Replace hand-written catalogs, test/status inventories, and JSDoc restatements with the authoritative tree, script, or generated reference.
6. In `implemented/` RFCs, remove migration plans, acceptance-task checklists, and future-tense spec language. Keep concise verification contracts that identify the behaviors and tiers pinning the shipped decision, plus named coverage gaps.
7. If removing prose changes a promised behavior rather than its explanation, use a proposed RFC first (follow [dsh-find-simplifications](../dsh-find-simplifications/SKILL.md)).

Keep every load-bearing rule, preferably as one to three lines plus a link to its rationale. Cut stories, duplicates, status notes, and the path used to derive the rule. Do not create a new explanation merely to relocate disposable reasoning.

## When verify-doc-budgets goes red

Apply the ordered relocate-condense-raise policy in [docs/AGENTS.md](../../../docs/AGENTS.md); this skill only supplies the workflow probes above.

## Validation and PR hygiene

Run at least `pnpm run doc-sync`, `pnpm run lint`, and `git diff --check`; JSDoc changes may regenerate catalogs. If a paired doc changed, follow [dsh-translate-docs](../dsh-translate-docs/SKILL.md) and run `pnpm run verify-translation-pairing --write`. The PR body should give word deltas, explain any deliberately long exception, and list checks.
