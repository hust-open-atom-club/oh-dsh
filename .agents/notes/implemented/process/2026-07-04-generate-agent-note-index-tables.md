# Agent Note: Generate the Agent Note index tables

Status: implemented

## Problem

The Agent Note index's per-lifecycle/per-class tables list facts that are fully derivable: an Agent Note's path encodes lifecycle and class, its filename encodes the first-proposed date, and its H1 carries the title. A hand-maintained copy of those facts is also the repo's highest-contention docs hotspot: every proposal wave appends rows to the same few lines, so concurrent Agent Note branches conflict precisely there while agreeing everywhere else, and each conflict is resolved by hand-merging rows whose content the filesystem already knows. [The classification Agent Note](2026-06-20-agent-note-classification.md) originally kept the index hand-written for curation's sake — but the curated part of the README is the prose, and the prose never conflicts; only the mechanical tables do.

## Decision

Keep the curated prose; generate the list. The tables live in [`.agents/notes/INDEX.md`](../../INDEX.md), a **fully generated file** — the curated prose stays in README.md, which carries no index rows at all. [`scripts/agent-note-index.ts`](../../../../scripts/agent-note-index.ts) is the shared source of truth — the tree walker (owning the closed lifecycle/class sets and the structure rules, including a parseable-H1 requirement) and the renderer (rows from H1 title with any `Agent Note: ` prefix stripped, plus the filename date, sorted by date then filename, grouped as `### {Class}` sections in canonical class order). Two thin consumers share it:

- [`scripts/gen-agent-note-index.ts`](../../../../scripts/gen-agent-note-index.ts) (`pnpm run gen-agent-note-index`) rewrites INDEX.md in full from the tree.
- [`scripts/verify-agent-note-classification.ts`](../../../../scripts/verify-agent-note-classification.ts) (a `doc-sync` member) checks structure, asserts the committed INDEX.md byte-matches a fresh render — the `gen-cordis-catalog`/`verify-cordis-catalog` pattern — and rejects an index-shaped row in the curated README. Freshness subsumes the index-completeness check: a generated-from-disk table is definitionally complete and correctly headed.

Adding, moving, or deleting an Agent Note means editing only the Agent Note file and running the generator; the classification Agent Note's rejected-alternatives record carries the supersession cross-link.

## Alternatives considered

### Why not marker-delimited regions inside README.md?

The first landed shape: the generator spliced the tables into README.md between `gen-agent-note-index` marker comments, under each `## {Lifecycle}` heading. Superseded by the whole-file INDEX.md once the README also absorbed the in-file format contract ([the uniform-format Agent Note](2026-07-05-uniform-agent-note-format.md)): a front-door README hosting hundreds of generated rows dwarfed its curated prose, and splice mechanics (marker pairs, heading checks, outside-region row detection) exist only to protect curated text that a dedicated generated file simply doesn't contain.

### Why not the verifier-only model?

It catches mistakes but still makes every proposal edit a shared hotspot in a hand-maintained table, and a failed verifier is strictly more annoying than a generator for a purely mechanical row: the author has already named and placed the file; the index copy adds no information. This is the same hand-list-versus-derivation judgment the [package-inventory proposal](../../proposed/process/2026-06-20-discover-package-inventory.md) applies to tsconfig references and knip stanzas — applied to the one list that demonstrably conflicts.

## Consequences

- The generated file is explicit: its banner names the generator, there is no curated region to protect inside it, and the generator refuses to run on a structurally invalid tree.
- A malformed or missing H1 is a hard error in both the generator and the gate — the H1 is now load-bearing as the index title source.
- Concurrent Agent Note branches resolve index conflicts by rerunning the generator, never by hand-merging rows.
