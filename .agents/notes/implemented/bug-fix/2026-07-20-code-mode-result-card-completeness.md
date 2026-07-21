# Agent Note: Keep the Code Mode result card complete

Status: implemented

English | [中文](2026-07-20-code-mode-result-card-completeness.zh.md)

## Problem

The outer `run_code` tool persisted complete rendered content, but its editor presenter ignored that content and rebuilt the card body from a logs-only `presentationMeta` projection. A result-only run appeared correct because an empty presenter body let ACP and TUI fall back to `tool/result.content`. Once the program emitted a log, the presenter supplied non-empty content, that fallback stopped, and the returned value disappeared from the completed card. A spill policy's final head/tail preview was vulnerable to the same split ownership whenever captured logs made the stale projection non-empty.

Nested Code calls never owned cards, so producing metadata for the outer call solely to reconstruct one incomplete card also obscured the intended one-card boundary.

## Decision

The canonical tool registry pipeline owns the final model-facing outer content. On success, the `run_code` output renderer renders captured logs followed by the return value or the explicit no-output marker. Runtime failures and pre-execution policy denials are normalized into error content by `ToolRegistry` without invoking that renderer. A post-execute block runs after successful rendering and replaces the result with error content; other post-execute policy and spill decisions may replace content before persistence.

`run_code.presentResult` now forwards the final `result.content` into one generic result card. It deliberately omits the title so the pending card retains the program text. The redundant logs-only `presentationMeta` projection is removed: `tool/result.content` is the durable, replayable, post-policy projection and the card's only result-content source.

Nested dispatch remains unchanged. Calls marked by `exec.parent` emit bounded `tool/code-dispatch` diagnostics but no `tool/call` or `tool/result` surface cards, so one outer `run_code` invocation still produces exactly one card.

## Testing

Presenter unit coverage pins logs-only, result-only, logs-plus-result, no-output, and spilled-result content. A separate integration-shaped unit drives a real runtime failure through the canonical registry result before presenting it. The successful cases prove stale metadata cannot replace final content; the failure case guards complete forwarding without claiming it reproduced the original metadata-triggered defect.

The keyless ACP and TUI Code Mode snapshots execute one outer program that performs two nested bash calls, logs `captured output`, and returns `CODE_ONE+CODE_TWO`. Both surfaces show one completed outer card containing both lines and no nested cards.

## Alternatives considered

**Append the return value to logs metadata.** Rejected because metadata would duplicate the renderer, need a second stable formatting contract for every JSON root, and still miss post-policy content replacement or spill previews.

**Merge presenter metadata with `result.content`.** Rejected because the rendered content already contains the logs; merging would duplicate them and require brittle deduplication.

**Create one card per nested dispatch.** Rejected because intermediate values are intentionally execution-local and never model-facing. Multiple cards would expose an implementation trace instead of the single Code Mode operation the model and user invoked.

## Consequences

ACP and TUI now display the same complete content the model receives and replay persists, including post-policy spill previews. New `run_code` results no longer carry the optional logs metadata, but this requires no session-format bump: existing records remain valid because the presenter ignores that field and reads their durable rendered content.
