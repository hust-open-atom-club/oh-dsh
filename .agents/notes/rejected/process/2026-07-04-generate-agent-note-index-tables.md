# Agent Note: Generate the Agent Note index tables

Status: rejected — a centralized generated list is merge-prone and adds little discovery value

English | [中文](2026-07-04-generate-agent-note-index-tables.zh.md)

## Problem

Per-lifecycle/per-class tables would list facts that are fully derivable: an Agent Note's path encodes lifecycle and class, its filename encodes the first-proposed date, and its H1 carries the title. A hand-maintained copy of those facts would also be a high-contention docs hotspot because concurrent Agent Note branches append rows to the same few lines. [The classification Agent Note](../../implemented/process/2026-06-20-agent-note-classification.md) makes the tree itself authoritative.

## Proposal

Keep the curated prose and generate the list as a fully generated `.agents/notes/INDEX.md`. A shared `scripts/agent-note-index.ts` module would own both the tree walker and the renderer. Two thin consumers would share it:

- `scripts/gen-agent-note-index.ts` (`pnpm run gen-agent-note-index`) would rewrite INDEX.md in full from the tree.
- `scripts/verify-agent-note-classification.ts` would check structure and assert that the committed INDEX.md byte-matches a fresh render.

Adding, moving, or deleting an Agent Note would mean editing the Agent Note file and running the generator.

## Alternatives considered

### Why not marker-delimited regions inside README.md?

Marker-delimited tables inside README.md would mix generated and curated text, requiring splice mechanics and protection for the surrounding contract. A dedicated generated file would at least keep those concerns separate.

### Why not the verifier-only model?

It catches mistakes but still makes every proposal edit a shared hotspot in a hand-maintained table. The author has already named and placed the file, so the index copy adds no information. This is the same hand-list-versus-derivation judgment the [package-inventory proposal](../../proposed/process/2026-06-20-discover-package-inventory.md) applies to tsconfig references and knip stanzas.

## Consequences

- The generated file would be explicit and contain no curated region.
- A malformed or missing H1 would be a hard error because the H1 supplies each row title.
- Concurrent branches would still modify the same committed artifact, even if conflicts could be resolved by rerunning the generator.

## Related

The implemented [no-index decision](../../implemented/process/2026-07-19-remove-generated-agent-note-index.md) keeps the tree and repository search as the discovery mechanisms.
