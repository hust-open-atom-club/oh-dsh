# Agent Note: Bilingual documentation via paired sibling files and a pairing gate

Status: implemented

English | [中文](2026-07-02-bilingual-docs-and-pairing-gate.zh.md)

## Problem

This repo's README and docs tree are read by people and agents inside and outside the company, in both English and Chinese. Maintaining a second language by hand, with no mechanism, is how translations rot: one side moves on, the other silently lies, and no gate notices. The repo's standing answer to invariants of this kind is to encode them as a mechanical check (see [quality gates](2026-06-11-quality-gates.md) and [doc-sync enforcement](2026-06-11-doc-sync-enforcement.md)), so the bilingual policy ships with one.

## Decision

- **Paired sibling files with equal authority.** A documentation pair is three sibling files: English `foo.md`, Chinese `foo.zh.md`, and a consistency record `foo.i18n.yaml`. Neither language is canonical — a document may be authored and reviewed Chinese-first and translated to English afterwards, or the reverse; what binds the pair is that both sides must say the same thing, and pairs merge whole (both languages plus the record, never one alone). Policy: [docs/i18n/README.md](../../../../docs/i18n/README.md); translation rules: [docs/i18n/translation-rules.md](../../../../docs/i18n/translation-rules.md); terminology source of truth: [docs/i18n/terminology.md](../../../../docs/i18n/terminology.md).
- **A sidecar record of both blob hashes makes consistency checkable.** `foo.i18n.yaml` holds the full git blob hash of each side as of the last confirmed-consistent state. An edit to either side without re-confirming the pair is then mechanically detectable as a pure content comparison — no history lookup — and the hashes are computable for files edited in the same PR, which a commit-hash record is not. Re-recording (`verify-translation-pairing --write`) produces a reviewable yaml diff: confirming consistency is an explicit, visible act in the PR.
- **`verify-translation-pairing` joins `doc-sync`.** The gate ([scripts/verify-translation-pairing.ts](../../../../scripts/verify-translation-pairing.ts)) enforces: required pairs exist, every existing pair is complete (all three files) and consistent (both hashes match, switcher links both ways, structural signatures identical), excluded (generated or bilingual-by-construction) files stay unpaired, and date-named documents on or after the manifest's `requiredSince` cutoff have complete pairs. The `required` list in [scripts/translation-pairing.manifest.json](../../../../scripts/translation-pairing.manifest.json) is a ratchet: each merged translation batch adds its files, so coverage only grows.
- **Translation is agent work with human review.** The committed workflow is [.agents/skills/dsh-translate-docs](../../../skills/dsh-translate-docs/SKILL.md), following the same pattern as [dsh-code-review](../../../skills/dsh-code-review/SKILL.md): the skill carries the workflow and defers to the docs as sources of truth. The skill directs the orchestrating agent to delegate translation writing to a subagent.

## Alternatives considered

- **English as the canonical source with a fingerprint inside the translation** — the design first proposed for this Agent Note: `.zh.md` files carried an HTML comment recording the English source's blob hash, and translation flowed EN → ZH only. Revised in review: the team wants Chinese-first authoring (write and review a Chinese Agent Note, then translate to English) with the two languages holding equal authority, which a one-directional canonical model cannot express. The sidecar record covering BOTH sides replaced the in-file one-directional fingerprint; the blob-hash mechanics survived unchanged.
- **Locale directories (`docs/en/` + `docs/zh/`, the Kubernetes/ECharts model)** — rejected: this repo has no docs-site framework to map locales to routes, moving every English file would churn every existing cross-reference, and `verify-md-links`/`verify-doc-refs` would need path-mapping logic instead of working unchanged.
- **A separate translation repo (the PingCAP `docs`/`docs-cn` model)** — rejected: right for a docs product with independent release trains, overkill for a monorepo's own documentation; it also puts the translation outside the reach of this repo's gates.
- **Interleaved bilingual files (single file, both languages)** — rejected: doubles every diff, breaks the one-line-per-paragraph convention's diff ergonomics, and makes partial inconsistency invisible.
- **Commit-hash records (the MDN `l10n.sourceCommit` model)** — rejected in favor of blob hashes: a same-PR edit has no commit hash yet, so the MDN model cannot express "consistent as of the state this PR introduces", and verifying it requires git history instead of file content.
- **Comparing git timestamps of the pair (no record)** — rejected: formatting-only edits would false-positive, and a counterpart committed after an unrelated edit would false-negative; content identity is the only signal that means what the gate claims.

## Industry precedent

Paired sibling files with locale suffixes are the dominant Chinese big-tech convention (ant-design `index.zh-CN.md`/`index.en-US.md`; arco-design `README.zh-CN.md` with a top-of-file switcher; Apache ShardingSphere's 387 `.cn.md`/`.en.md` pairs) — but none of those repos *enforce* pairing or consistency in CI; the convention holds by review alone. Consistency automation exists outside China: MDN's `l10n.sourceCommit` front-matter fingerprint, Vue's Ryu-Cho action (upstream-commit watcher that opens issues/PRs for stale translations), Kubernetes' localization drift scripts, and Microsoft's Azure co-op-translator (source-hash-driven LLM re-translation in CI). This design combines the two: the Chinese-ecosystem file layout with a hash-pair gate, plus a committed agent skill in place of a bot service.

## Consequences

- Editing either side of a paired document obligates the same PR to update the counterpart and re-record the pair — the gate makes the doc-sync rule bilingual, and CI (not reviewer memory) carries the invariant.
- Every pair adds a third file to the tree. The record is machine-written (`--write`), so the cost is directory noise, not maintenance effort; in exchange, "who confirmed these consistent, and when" is answerable from git blame on the yaml.
- When the two sides disagree, no mechanical rule picks a winner — the PR review does. That is the price of equal authority, accepted deliberately: the alternative (a canonical language) forbids Chinese-first authoring.
- Generated docs (`cordis-catalog/`, `tool-catalog/`, `module-graph.md`) are excluded for now; the planned follow-up is to teach their generators to emit Chinese alongside English, at which point they leave the exclusion list.
- Rollout is incremental by design: documents outside `required` are visible backlog (`--list`), not red CI, so pairs land in reviewable batches without a big-bang PR. A date-named document dated on or after the manifest's `requiredSince` cutoff merges bilingual or not at all, so new date-named Agent Notes do not enlarge that backlog.
- The recorded hashes double as the update tool (`git cat-file -p <hash>` recovers either side's last-confirmed text for a minimal diff-based update), so re-translation of whole files is never forced by the mechanism.
