---
name: dsh-translate-docs
description: Use when creating or updating the bilingual counterpart of a doc in this repo (English ↔ Chinese pairs) — orients the translator to the pairing contract, the terminology source of truth, the translation rules, and the consistency gate that verifies the result
---

# Translating DeepSeek-Harness docs

**This skill is guidance, not a translation memory.** It is the workflow map for keeping `foo.md ↔ foo.zh.md` pairs consistent and natural in both languages. Both languages carry equal authority — a change is authored in either one, and that side is the source for that update. You are the translator: the rules below say what must hold, not how to phrase any particular sentence — phrasing judgment is yours, terminology is not.

## Sources of truth (read, don't re-summarize)

These are authoritative; read them at the source so this skill never drifts out of sync.

- **[docs/i18n/README.md](../../../docs/i18n/README.md)** — the pairing contract: the three-file pair (`foo.md`, `foo.zh.md`, `foo.i18n.yaml`), the consistency record's both-side blob hashes, the language-switcher lines, scope/exclusions, and the rollout manifest.
- **[docs/i18n/translation-rules.md](../../../docs/i18n/translation-rules.md)** — how to translate: faithfulness, structure preservation, terminology discipline, typography (MUST/SHOULD levels).
- **[docs/i18n/terminology.md](../../../docs/i18n/terminology.md)** — the terminology table, binding in both directions. Load it BEFORE translating, not when a term feels uncertain; the terms you don't notice are the ones that drift.
- **[docs/i18n/translation-prompt.md](../../../docs/i18n/translation-prompt.md)** — the automated pipeline's machine-consumed template. Agents using this skill do not render it; keep rules shared with this skill synchronized.
- **[dsh-prose-standard](../dsh-prose-standard/SKILL.md)** — required prose coverage and editorial judgment. Apply it to both sides without adding or dropping source propositions.

## Find the work

- `pnpm run verify-translation-pairing --list` prints every in-scope document as missing / out-of-sync / ok — the work list for a translation batch.
- In a PR that edits paired docs, the work list is the diff itself: every changed side of a pair needs its counterpart updated and the pair re-recorded in the same PR, and the gate goes red if you forget.

## Triage by change type

Do not process every file the same way:

- **New pair** (no counterpart yet): whichever language exists — English or Chinese — translate the whole file into the other, section by section for long documents, keeping each section's structure locked to the source as you go rather than fixing structure at the end.
- **Update** (pair exists, one side edited): do NOT re-translate. The consistency record names the exact last-confirmed text of both sides — recover the edited side's previous state and diff:

  ```sh
  git cat-file -p <hash-from-i18n-yaml> > /tmp/last-confirmed.md
  git diff --no-index /tmp/last-confirmed.md docs/foo.md
  ```

  Apply the smallest counterpart edits that cover that diff. A minimal update preserves the reviewed phrasing of everything that didn't change; a re-translation throws that review away.
- **Deleted or renamed doc**: delete or rename the counterpart and the `.i18n.yaml` alongside it — the gate reports an incomplete pair otherwise.

## Translate

- **Pass 1 — write, don't transpose.** Read a semantic unit, then restate it as a native technical author in the nearest [style sample's](../../../docs/i18n/style-samples.md) register. Preserve the required frame without forcing sentence-by-sentence correspondence.
- **Pass 2 — verify against the source, clause by clause.** Fidelity is checked here, not written in: confirm nothing was added or dropped, every term follows the table, and each code span survived verbatim. Fix by rewriting the sentence natively, not by patching words into it.
- Write only the final text to the file, never drafts or notes.
- Every term in [terminology.md](../../../docs/i18n/terminology.md) renders exactly as specified, in both directions, including first-occurrence annotations. A term the table misses: translate only with a citable precedent from a major Chinese OSS/vendor doc; otherwise keep the English and add it to the PR's 「待定术语」 list with your suggested rendering. Never invent a rendering inline — that decision belongs to a human and then to the table.
- Code blocks are byte-identical across the pair, comments included. Relative links keep their `.md` targets; only the switcher line links `.zh.md`.

## Finish the pair

1. Switcher: `[English](foo.md) | 中文` immediately after the Chinese file's H1, `English | [中文](foo.zh.md)` after the English file's H1 — add both if this is a new pair.
2. Record consistency: `pnpm run verify-translation-pairing --write` recomputes and records both sides' full blob hashes in `foo.i18n.yaml`. The yaml diff in your PR is the reviewable statement "I confirmed these two say the same thing" — only run it after you actually have.
3. New batch landed? Add the `.md` paths to `required` in [scripts/translation-pairing.manifest.json](../../../scripts/translation-pairing.manifest.json) so the gate ratchets forward.

## Verify — the gate, not your eyes

Run `pnpm run verify-translation-pairing`, then the rest of the Markdown gates (`pnpm run verify-md-wrap && pnpm run verify-md-links`, or full `pnpm run doc-sync` before the PR). Fix what they report; do not hand-check what they cover. What they can NOT check — whether the two sides truly say the same thing, terminology judgment calls, tone — is exactly what the PR reviewer will read for, so keep the PR reviewable: state which pairs are new vs minimally updated, and list 「待定术语」 prominently.

## How to respond to translation review

Follow the [code-review reporting guidance](../dsh-code-review/SKILL.md#reporting-findings): evaluate each comment on its merits, and for terminology comments, remember the table is the contract — a reviewer's rendering decision gets applied to [terminology.md](../../../docs/i18n/terminology.md) so it binds every future translation, not just patched into one file.
