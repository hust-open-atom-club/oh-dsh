# Agent Note: Prune the unimplemented subagent seam vocabulary

Status: rejected — the deferred capability vocabulary (`outputSchema`/`structured`, `toolFilter`, `sendMessage`/`resume`) is intentionally reserved surface: the seam advertises the full intended contract ahead of its implementations by design, so providers and consumers grow into a stable shape rather than re-negotiating it per capability. The consumer-evidence analysis below records the decision-time state.

## Problem

The [subagent seam](../../implemented/feature/2026-06-21-subagent-capability-seam.md) shipped a two-tier capability design: start-time capability flags checked by the service, and optional runtime methods on `SubagentRun`. Three start-time features and both optional runtime methods have zero implementations and zero callers:

- **`outputSchema`/`structured` and `toolFilter`** (`SubagentCapabilities`, `SubagentStartRequest`, `SubagentResult` in `packages/subagent/subagent/src/types.ts`): at the decision point, every real provider declared `outputSchema: false, toolFilter: false` (`packages/subagent/subagent-spawn/src/index.ts`, `packages/subagent/subagent-fork/src/index.ts`, `packages/subagent/subagent-acp/src/index.ts`); the sole production `ctx.subagents.start` caller (`packages/subagent/tool-subagent/src/index.ts`) built `{ prompt, parent, signal?, agentOptions? }` and structurally could not set either; `structured` appeared only in the scripted test fixture. The service's capability check carried two assert rows whose only exercisers were the rejection tests.
- **`SubagentRun.sendMessage` / `SubagentRun.resume`** (same file): implemented by NO provider — not even the mock; the spawn spec asserts their *absence*.

The only reason `dsh-subagent` depends on `dsh-tools` at all is `outputSchema`'s `SchemaSpec` type. Three subsequent subagent workstreams (per-session snapshot replay, the fork seed boundary, the ACP backend) landed around this surface without growing a single consumer.

## Proposal

Remove `outputSchema`/`structured`, `toolFilter`, `sendMessage`, and `resume` from the seam; shrink `SubagentCapabilities` to `{ depthLimit }`; drop the two capability-assert rows, the all-false flags on the three providers, the scripted fixture's structured branch and capability knobs, and the tests that exist to pin the removed surface. Drop the `dsh-tools` peer/dev dependency from `packages/subagent/subagent/package.json`. Update the [subagent.md](../../../../docs/core-data-structures/subagent.md) pastes and the type-equiv manifest, plus the affected provider READMEs. The implementing PR amends the seam Agent Note's capability catalog per [implemented/AGENTS.md](../../implemented/AGENTS.md).

**Keep** `depthLimit`/`maxDepth` and capability checks. The in-process backend enforces the limit, although the shipping tool does not yet set it. Recursion is a known seam risk, so the appropriate follow-up is to supply a tool default rather than delete working enforcement.

Adjacent surface examined and deliberately left alone: `SubagentService.getProvider()`/`list()` have test-harness consumers only, but the [prune-dead-seam-methods implementation note](../../implemented/simplification/2026-06-20-prune-dead-seam-methods.md) records precisely this shape being removed from the bash executor and reverted — a test harness IS a consumer for a one-line accessor over an already-tracked map. `SubagentRunEndInfo.lastAssistantMessage` is a recorded keep (the [subagent-observe-enrich Agent Note](../../implemented/feature/2026-06-30-subagent-observe-enrich.md)'s review dropped `agentType` and kept it deliberately, as the only final-message channel for out-of-process children); its currently-unwired bridge forwarding is a gap to close or a consumer to document, not surface for this Agent Note to cut.

This is the seam-vocabulary echo of [prune dead methods from the persistence seam](../../implemented/simplification/2026-06-20-prune-dead-seam-methods.md): members every implementation must declare for nobody — weaker even, since here zero implementations exist.

## Alternatives considered

### Why not keep it?

The two-kinds-of-capability design is the seam Agent Note's headline, and re-adding `outputSchema` later touches several files. But the design survives with `depthLimit` as its live example and the Agent Notes as its record, and the seam Agent Note itself concedes the shipped `toolFilter` shape is wrong (real enforcement needs a `tools/pre-execute` deny in the child's context, not schema filtering) — that deny primitive exists on the interception seams, so re-adding against a real implementing provider will pin a better contract than the current speculative one.

## Acceptance criteria

- The removed spellings appear only in this Agent Note and the amended seam Agent Notes; `SubagentCapabilities` is `{ depthLimit: boolean }`; the `dsh-tools` dependency edge is gone (`hygiene` green).
- Depth-enforcement tests are unchanged and green.

## Risks

The subagent lifecycle events carry `lastAssistantMessage` on the end payload — that enrichment lives in the service module, not the seam vocabulary this Agent Note shrinks, and the observe-enrich Agent Note records dropping an `agentType` sibling for lacking a consumer: the judgment this Agent Note extends. The CC hooks bridge, the first outside consumer of those lifecycle events, reads only the event payloads and touches none of the surface removed here; the observe-enrich Agent Note's deferred control-flow redesign names implementing `resume` as its own future work — exactly the re-add trigger this Agent Note's pattern anticipates.
