# Agent Note: Drop the `image` content block until a path can honor it

Status: implemented

## Problem

`ImageBlock` (`packages/llm/llm/src/types.ts`) had no production producer, and every consumer on every path DROPPED it: the deepseek adapter's serializer skipped image blocks (a documented MVP limitation), the pi-ai converter skipped them as unrepresentable, the ACP codec neither advertises image prompt capability nor forwarded image blocks outbound and REJECTS image prompt content inbound, and the compaction estimator charged a flat token constant and rendered `[image]`. An `ImageBlock` constructed then would silently vanish from the wire — the vocabulary advertised a capability no path honored, which is the silent-data-loss shape AGENTS.md's defensive patterns warn against. The only constructors anywhere were tests pinning the skip/drop/estimate branches.

## Decision

Remove `ImageBlock`, its map entry, and image-specific branches from adapters, ACP rendering, and compaction. Update the owning vocabulary docs and generated references in the same change. Unknown extension blocks still exercise default branches, and ACP continues to reject inbound image prompt content independently of the harness vocabulary.

## Alternatives considered

### Why not keep it?

`ContentBlockMap` can reintroduce images when adapters, ACP, and compaction all support them. Keeping a core type whose only implementation is rejection would advertise an unusable surface; absence gives producers an immediate compile-time failure instead.

The recorded fallback, had review landed on keeping the slot: keep `ImageBlock` but replace every silent skip with a loud rejection, and document that policy in the vocabulary — the silent drop was the one state with no defender. Review landed on removal; the fallback stands as the documented alternative should the slot ever return ahead of a full feature.

## Verification

No harness `ImageBlock` is constructed outside Agent Note records. ACP's independent inbound-image rejection remains tested, while adapter, codec, and compaction default branches are covered with plugin-defined block types.

## Consequences

Re-adding a core vocabulary type later touches several packages at once — but that coordinated change is the shape a real multimodal feature needs anyway (adapter mapping, ACP advertisement, compaction pricing), and none of it existed to preserve.
