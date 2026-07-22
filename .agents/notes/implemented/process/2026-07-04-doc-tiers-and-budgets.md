# Agent Note: Documentation tiers, budgets, and the ceiling gate

Status: implemented

English | [中文](2026-07-04-doc-tiers-and-budgets.zh.md)

## Problem

Standing docs accumulated repeated rules, retold incidents, duplicated package maps, and stale Agent Note summaries despite existing writing guidance. Because review alone did not prevent that growth, the repository needed a mechanical budget alongside its documentation taxonomy.

## Decision

- **A tier taxonomy with one home per fact.** [docs/AGENTS.md](../../../../docs/AGENTS.md) is the documentation standard: it assigns every Markdown tier a single job (standing orders, system map, type catalog, decision records, incident stories, how-tos, per-package contracts, generated catalogs, workflows), forbids restating a fact outside its home tier (link instead), and carries the slop checklist used when writing or reviewing any doc.
- **A narrow, hard budget gate.** [scripts/verify-doc-budgets.ts](../../../../scripts/verify-doc-budgets.ts) joins `doc-sync`: every doc listed in [scripts/doc-budgets.manifest.json](../../../../scripts/doc-budgets.manifest.json) must stay under its word ceiling (`wc -w` semantics, whole file), and a budgeted file that is missing fails the gate so a rename cannot silently orphan its budget. Scope is deliberately only the accretion-prone standing docs — the root and subtree `AGENTS.md` files, `architecture.md`, `packages/README.md`, and the standing policy docs they evict content into (`docs/testing.md`, `docs/defensive-patterns.md`). Reference docs, Agent Notes, and package READMEs are unbudgeted: length is legitimate there when every row is a fact, and review plus the slop checklist govern them.
- **Ceilings are an enforcement frontier that ratchets.** A ceiling sits at least 5% above the doc's current size — working headroom, so routine wording edits pass while real growth still trips the gate — and ratchets down, keeping that margin, as the doc is brought to its target budget (root `AGENTS.md` ≤ 1,500 words; `architecture.md` ≤ 1,800; subtree `AGENTS.md` ≤ 600; `packages/README.md` ≤ 600) — the same rollout mechanism as the [translation-pairing `required` list](2026-07-02-bilingual-docs-and-pairing-gate.md). When the gate goes red the fix is to relocate or condense per the taxonomy; raising a ceiling is permitted only with explicit justification in the PR description, the manifest diff being the reviewable act.
- **A thin workflow skill, contracts in docs.** [.agents/skills/dsh-doc-standards](../../../skills/dsh-doc-standards/SKILL.md) carries the placement/audit/red-gate workflow and defers to the standard as its source of truth, the same split as [dsh-translate-docs](../../../skills/dsh-translate-docs/SKILL.md) over the i18n contract.

## Alternatives considered

- **Skill and review discipline without a gate** — rejected: the accretion above happened while the current-state rule and reviewer attention already existed; a prose rule with no mechanical backstop demonstrably does not hold here, and this repo's own [quality-gates stance](2026-06-11-quality-gates.md) says invariants worth keeping are worth encoding.
- **A broad gate over every doc tier** — rejected: a blanket ceiling punishes exactly the right kind of long doc (a feature matrix or type catalog where every row is a fact, e.g. `packages/ui/acp/acp-feature-support.md`) and generates per-file override churn that trains contributors to rubber-stamp raises.
- **Housing the standard inside the skill** — rejected: contracts live in docs and workflows in skills; a standard packed into SKILL.md is invisible to an agent that edits docs without invoking the skill, and `docs/AGENTS.md` already loads as subtree instructions for anyone working under `docs/`.

## Consequences

- Adding to a budgeted doc now requires displacement: relocate the addition to its taxonomy home with a pointer, or condense existing prose to pay for it. Growth without pruning fails CI.
- The bring-under-target rewrites land as stacked follow-ups that ratchet the manifest down as they merge; until each lands, its doc's frozen ceiling only prevents further growth.
- Word count is a crude proxy accepted deliberately: it cannot judge quality, but it forces the relocation decision at exactly the moment content is being added, which is when the author has the context to place it correctly.
