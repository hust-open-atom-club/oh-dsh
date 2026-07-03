---
name: dsh-translate-docs
description: Use when creating or updating Chinese (.zh.md) translations of this repo's documentation — orients the translator to the bilingual pairing contract, the terminology source of truth, the translation rules, and the freshness gate that verifies the result
---

# Translating DeepSeek-Harness docs

**This skill is guidance, not a translation memory.** It is the workflow map for producing `.zh.md` files that pass the pairing gate and read as natural technical Chinese. You are the translator: the rules below say what must hold, not how to phrase any particular sentence — phrasing judgment is yours, terminology is not.

## Sources of truth (read, don't re-summarize)

These are authoritative; read them at the source so this skill never drifts out of sync.

- **[docs/i18n/README.md](../../../docs/i18n/README.md)** — the pairing contract: sibling `foo.md ↔ foo.zh.md`, the `i18n-source` fingerprint format, the language-switcher lines, scope/exclusions, and the rollout manifest.
- **[docs/i18n/translation-rules.md](../../../docs/i18n/translation-rules.md)** — how to translate: faithfulness, structure preservation, terminology discipline, typography (MUST/SHOULD levels).
- **[docs/i18n/terminology.md](../../../docs/i18n/terminology.md)** — the terminology table. Load it BEFORE translating, not when a term feels uncertain; the terms you don't notice are the ones that drift.

## Find the work

- `pnpm run verify-translation-pairing --list` prints every in-scope document as missing / stale / ok — the work list for a translation batch.
- In a PR that edits English docs, the work list is the diff itself: every changed `.md` with an existing `.zh.md` sibling needs its translation updated in the same PR, and the gate goes red if you forget.

## Triage by change type

Do not process every file the same way:

- **New translation** (no `.zh.md` yet): translate the whole file, section by section for long documents — keep each section's structure locked to the source as you go rather than fixing structure at the end.
- **Update** (`.zh.md` exists but stale): do NOT re-translate the file. The fingerprint names the exact source text the translation was based on — recover it and diff:

  ```sh
  git cat-file -p <hash-from-fingerprint> > /tmp/old-source.md
  git diff --no-index /tmp/old-source.md docs/foo.md
  ```

  Apply the smallest Chinese edits that cover that diff. A minimal update preserves the reviewed phrasing of everything that didn't change; a re-translation throws that review away.
- **Deleted or renamed source**: delete or rename the `.zh.md` alongside it — the gate reports it as an orphan otherwise.

## Translate

- Work through the document applying [translation-rules.md](../../../docs/i18n/translation-rules.md). Internally: first render faithfully, then re-read the Chinese alone for awkward or ambiguous phrasing, then polish — but write ONLY the final Chinese to the file, never drafts or notes.
- Every term in [terminology.md](../../../docs/i18n/terminology.md) renders exactly as specified, including first-occurrence annotations. A term the table misses: translate only with a citable precedent from a major Chinese OSS/vendor doc; otherwise keep the English and add it to the PR's 「待定术语」 list with your suggested rendering. Never invent a rendering inline — that decision belongs to a human and then to the table.
- Code blocks are byte-identical to the source, comments included. Relative links keep their English targets; only the switcher line links `.zh.md`.

## Finish the pair

1. Fingerprint: compute the source's current blob hash and write the comment as the FIRST line of the `.zh.md` — `git hash-object docs/foo.md` → `<!-- i18n-source: docs/foo.md@<first 12 hex> -->`.
2. Switcher: `[English](foo.md) | 中文` immediately after the translation's H1; confirm the English file carries `English | [中文](foo.zh.md)` after its own H1 — add it if this is the pair's first translation.
3. New batch landed? Add the English paths to `required` in [scripts/translation-pairing.manifest.json](../../../scripts/translation-pairing.manifest.json) so the gate ratchets forward.

## Verify — the gate, not your eyes

Run `pnpm run verify-translation-pairing`, then the rest of the Markdown gates (`pnpm run verify-md-wrap && pnpm run verify-md-links`, or full `pnpm run doc-sync` before the PR). Fix what they report; do not hand-check what they cover. What they can NOT check — translation quality, terminology judgment calls, tone — is exactly what the PR reviewer will read for, so keep the PR reviewable: state which files are new translations vs minimal updates, and list 「待定术语」 prominently.

## How to respond to translation review

Same discipline as any review in this repo (see [dsh-code-review](../dsh-code-review/SKILL.md) § How to respond): evaluate each comment on its merits, and for terminology comments, remember the table is the contract — a reviewer's rendering decision gets applied to [terminology.md](../../../docs/i18n/terminology.md) so it binds every future translation, not just patched into one file.
