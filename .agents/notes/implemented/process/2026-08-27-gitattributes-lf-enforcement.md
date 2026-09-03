# Agent Note: .gitattributes enforces LF across platforms

Status: implemented

English | [中文](2026-08-27-gitattributes-lf-enforcement.zh.md)

## Problem

The repository had no `.gitattributes`, so checkout line endings followed each
contributor's `core.autocrlf`. On Windows the common `autocrlf=true` turned
every text file CRLF in the working tree. The bilingual pairing tooling hashes
exact working-tree bytes, so a sidecar recorded with `--write` on such a
checkout captured CRLF blob hashes while Git stored LF blobs; CI on Linux then
failed `verify-translation-pairing` with "out of sync" for content that looked
consistent locally. The same conversion made every `.i18n.yaml` parse as
malformed locally, so the gate could never pass on that machine: the CRLF
checkouts silently disabled the local evidence loop and pushed byte-level drift
detection entirely onto CI.

## Decision

`.gitattributes` now declares `* text=auto eol=lf`: text files are normalized
to LF in the index and checked out with LF on every platform regardless of
`core.autocrlf`. Windows script extensions (`.bat`, `.cmd`, `.ps1`) are pinned
to working-tree CRLF because cmd.exe and some PowerShell execution policies
misparse LF-only scripts (both existing Windows scripts already ship LF and
keep working; the rule protects future ones). Common binary assets (`*.icns`,
`*.png`) are marked `binary` so normalization can never touch them; all other
binaries in the tree are already detected as `-text` by auto-detection. The
eleven source files whose committed blobs contained CRLF (eight sidebar plugin
files and three tests, CRLF since their first commit) and two Agent Notes with
mixed endings were renormalized to LF in this same change, and both affected
pairing sidecars were re-recorded against the normalized bytes. Per-checkout
behavior no longer depends on personal Git config; CI and contributor
machines hash identical bytes.

## Alternatives considered

- **Fix only the recorded `usage.i18n.yaml` hashes and document "don't use autocrlf".** Rejected: it leaves the failure one fresh clone or one misconfigured contributor away from recurring, and a README instruction cannot make a checkout deterministic — exactly why this kept reappearing.
- **Require `autocrlf=input` per-contributor setup docs.** Rejected for the same nondeterminism: attributes travel with the repository and apply to every clone and every future surface (editor formatters, archive exports), while config does not.
- **Exclude the pairing corpus from hashing instead of fixing checkout bytes.** Rejected: the byte-exact consistency record is what caught real drift between languages; weakening the contract to tolerate CRLF would hide future encoding damage.
- **LF-only everywhere including Windows scripts.** Rejected: cmd.exe batch parsing has documented quirks around LF-only labels, and PowerShell execution policies vary; pinning the three script extensions to CRLF removes that risk at zero cost.

## Consequences

- Every platform checks out identical bytes; `verify-translation-pairing` produces the same verdict on contributor machines and CI, restoring the pre-push evidence loop on Windows.
- One-time diff noise: renormalization touched files whose committed bytes changed (CRLF/mixed sources to LF); blame for those lines points at this commit once.
- Tooling that reads exact bytes (pairing sidecars) is stable again; contributors who previously relied on `autocrlf=true` need no action after re-checkout, since attributes override config.
- Files added later inherit the rules automatically; a new genuinely-binary format without an extension match must add its own `binary` attribute or rely on `-text` detection.
- Known survivors of normalization: none among tracked blobs, verified by `git ls-files --eol` showing only `i/lf`, `i/-text`, and submodule entries after this change.
