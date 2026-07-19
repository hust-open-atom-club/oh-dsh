# Agent Note: Classify Agent Notes by kind via path-encoded subdirectories

Status: implemented

## Problem

`.agents/notes/` grouped Agent Notes by **lifecycle** only — `proposed/` / `implemented/` / `rejected/`. Nothing recorded what *kind* of decision each Agent Note was. The index was one flat list per lifecycle, with no way to scan "show me every simplification" or "every testing-strategy decision." A wave of simplification Agent Notes landing on the same day made the gap concrete: a reader skimming `proposed/` could not tell a new capability from a removal from a tooling-policy change without opening each file.

The repo's standing bias is [mechanical quality gates over prose guidelines](2026-06-11-quality-gates.md): a convention that isn't machine-checked rots. So a classification scheme here had to be enforceable, not an honor-system header.

## Decision

Add a second axis — the Agent Note's **class** — and encode it in the path: `{lifecycle}/{class}/yyyy-mm-dd-topic.md`. The folder *is* the label. A file's location declares its class, the closed set is "these folders and no others," and the existing [verify-md-links](2026-06-18-markdown-cross-link-lint.md) gate already protects the path rewrites the move required.

### The closed set of six classes

| Class | Covers |
|---|---|
| `feature` | A new user- or model-facing capability. |
| `bug-fix` | Corrects a defect or closes a gap a postmortem surfaced. |
| `simplification` | Removes code, behavior, or surface area without adding a capability. |
| `architecture` | A structural decision about the **shipped source** — how packages relate, what the runtime vocabulary is. |
| `process` | Tooling, policy, or workflow **around** the code, not runtime behavior. |
| `testing` | Test infrastructure and strategy. |

The `architecture` / `process` line: **architecture** is about the source we ship; **process** is the surrounding tooling and workflow. This Agent Note is itself a `process` decision — it changes how the repo is organized and gated, not what the harness does at runtime — so it lives under `implemented/process/`.

### Two gates

Both are `doc-sync` members, in the `verify-md-wrap` style (tsx ESM, verify-don't-generate, exit non-zero on the first violation):

- **`scripts/verify-agent-note-classification.ts`** — the closed set and index freshness. It asserts every file under a lifecycle folder lives in a class folder from the canonical set (a loose `.md` at a lifecycle root, or an unknown class folder, fails), and that the generated [INDEX.md](../../INDEX.md) byte-matches a fresh render from the tree (see [generate the Agent Note index tables](2026-07-04-generate-agent-note-index-tables.md)). The canonical class set lives as a `const` in `scripts/agent-note-index.ts` — the machine source of truth shared with the generator — and [the README](../../README.md) documents it in prose; the class *descriptions* stay hand-written, the index is generated.
- **`scripts/verify-doc-refs.ts`** — source comments that cite docs. Agent Note paths are referenced not only from Markdown but from TypeScript doc comments (root-relative prose like `.agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.md`). `verify-md-links` never saw those, so the reorg could have silently orphaned them. This gate scans repo-authored `.ts` under `packages/**` and `examples/**` (excluding built `lib/` and `vendor/`) for `docs/….md` tokens, resolves each root-relative, and asserts it exists. It requires the `.md` extension so extensionless prose (`docs/postmortem/0001`, `docs/architecture.md § Extending The Harness`) is left alone.

## Alternatives considered

- **A `Classification:` prose line** in each file (next to `Status:`), parsed by the gate. Workable, but it duplicates into the file a fact the path can already carry, and a line can disagree with its folder. Path-encoding makes the label and its storage the same thing — there is nothing to keep in sync.
- **A `refactor` class.** It overlaps `simplification` almost entirely; the only discriminator anyone reached for was "does observable behavior change?", which `simplification` already encodes (it does not). One class, not two.
- **Auto-generating the index** from the filesystem. Rejected here to keep the index hand-written; superseded by [generate the Agent Note index tables](2026-07-04-generate-agent-note-index-tables.md) once stacked proposal waves made the hand-written tables the repo's most conflict-prone docs region — the list is now the fully generated [INDEX.md](../../INDEX.md) while the README prose stays curated.

## Consequences

- Every Agent Note now sits under a class folder, and the index groups by class within each lifecycle. A reader scans one heading to see all simplifications, or all testing decisions.
- Two more fast tsx scripts in the `doc-sync` chain; no new dependency (the mdast/GFM stack was already present for `verify-md-wrap`/`verify-md-links`).
- Adding a class is a deliberate act: amend the `const` in `scripts/agent-note-index.ts` and the [Classification section](../../README.md#classification), not just `mkdir` a folder. The gate rejects an unknown folder, so an ad-hoc class can't slip in.
- Source-comment doc references are now gated too — a moved or renamed doc that a `.ts` comment cites fails the pre-push hook, closing a drift class `verify-md-links` structurally could not see.
