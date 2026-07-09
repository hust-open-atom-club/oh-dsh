---
name: dsh-doc-standards
description: 'Use when writing, moving, reviewing, or auditing documentation in the deepseek-harness repo — choosing where content belongs, trimming doc slop, responding to a verify-doc-budgets gate failure, or requests like "improve the docs", "audit the docs for slop", "where should this be documented", "this doc is too long".'
---

# Applying the DeepSeek Harness Documentation Standard

The contract lives in [docs/AGENTS.md](../../../docs/AGENTS.md) — the tier taxonomy, the word budgets, and the slop checklist. This skill is the workflow for applying it: placing content, auditing the corpus, and handling a red budget gate. It is guidance, not a script; keep judgment active and prefer a few well-proven fixes over a mass rewording pass.

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

The audit is a hunt for the standard's slop checklist, cheapest probes first:

1. Measure: `pnpm run verify-doc-budgets --list`, then `git ls-files '*.md' | grep -v '^vendor/' | xargs wc -w | sort -rn | head -30` to spot unbudgeted outliers.
2. Hunt narrated history: `rg -n -g '!vendor' -t md "no longer|used to|previously|was moved|renamed"` — judge each hit; some are legitimate (quoting a contrast against a live alternative), most are drift.
3. Hunt duplication: take each standing-doc rule, grep one distinctive phrase from it across all Markdown; more than one home means all but one become links.
4. Hunt catalog restatement: compare README event/tool tables against the generated catalogs and JSDoc; hand copies get replaced by links.
5. Hunt spec-speak in `implemented/` RFCs: migration plans, test checklists, future-tense "should" — an implemented RFC describes what is. The heading-level cases (`## Plan`, `## Acceptance criteria`, …) are mechanically gated by `verify-rfc-format`; the prose-level "should" hunt remains manual.
6. Classify each finding: a mechanical trim lands as a small PR; a restructure or removal that changes what a doc promises gets a proposed RFC first (follow [dsh-find-simplifications](../dsh-find-simplifications/SKILL.md) for the RFC shape).

Compression discipline: every load-bearing rule survives — as one to three lines plus a link to the home that carries its why. Cut stories, duplicates, and status annotations; never silently drop a rule. If a cut rule has no durable home to link, create it (usually an RFC or postmortem) in the same change.

## When verify-doc-budgets goes red

Apply the ordered relocate-condense-raise policy in [docs/AGENTS.md](../../../docs/AGENTS.md); this skill only supplies the workflow probes above.

## Validation and PR hygiene

For docs-only changes run at least `pnpm run doc-sync`, `pnpm run lint`, and `git diff --check`; if a paired doc was touched, update the counterpart (see [dsh-translate-docs](../dsh-translate-docs/SKILL.md)) and re-record with `pnpm run verify-translation-pairing --write`. Open a draft PR while the audit is still expanding; in the PR body, list what was trimmed/moved with word deltas, what was deliberately kept long and why, and which checks ran. The first audit cycle's deferred work list lives in [the doc-tiers-and-budgets RFC](../../../docs/rfc/implemented/process/2026-07-04-doc-tiers-and-budgets.md) § Deferred work.
