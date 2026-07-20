# Agent Note: Keep the Code Mode result card complete

Status: implemented

English | [中文](2026-07-20-code-mode-result-card-completeness.zh.md)

## Problem

The outer `run_code` tool persisted complete rendered content, but its editor presenter ignored that content and rebuilt the card body from a logs-only `presentationMeta` projection. A result-only run appeared correct because an empty presenter body let ACP and TUI fall back to `tool/result.content`. Once the program emitted a log, the presenter supplied non-empty content, that fallback stopped, and the returned value disappeared from the completed card. Failure text and a spill policy's final head/tail preview were vulnerable to the same split ownership.

Nested Code calls never owned cards, so producing metadata for the outer call solely to reconstruct one incomplete card also obscured the intended one-card boundary.

## Decision

The `run_code` output renderer remains the single owner of model-facing outer content. It renders captured logs followed by the return value, the explicit no-output marker, or the failure content produced by the canonical tool pipeline. Post-execute policy and spill may replace that content before it is persisted.

`run_code.presentResult` now forwards the final `result.content` into one generic result card. It deliberately omits the title so the pending card retains the program text. The existing logs metadata remains in `tool/result` for transcript compatibility, but the presenter no longer treats it as a second content source: `tool/result.content` is the durable, replayable, post-policy projection.

Nested dispatch remains unchanged. Calls marked by `exec.parent` emit bounded `tool/code-dispatch` diagnostics but no `tool/call` or `tool/result` surface cards, so one outer `run_code` invocation still produces exactly one card.

## Testing

Presenter unit coverage pins logs-only, result-only, logs-plus-result, no-output, failure, and spilled-result content. Every case proves stale metadata cannot replace the final content.

The keyless ACP and TUI Code Mode snapshots execute one outer program that performs two nested bash calls, logs `captured output`, and returns `CODE_ONE+CODE_TWO`. Both surfaces show one completed outer card containing both lines and no nested cards.

## Alternatives considered

**Append the return value to logs metadata.** Rejected because metadata would duplicate the renderer, need a second stable formatting contract for every JSON root, and still miss post-policy content replacement or spill previews.

**Merge presenter metadata with `result.content`.** Rejected because the rendered content already contains the logs; merging would duplicate them and require brittle deduplication.

**Create one card per nested dispatch.** Rejected because intermediate values are intentionally execution-local and never model-facing. Multiple cards would expose an implementation trace instead of the single Code Mode operation the model and user invoked.

## Consequences

ACP and TUI now display the same complete content the model receives and replay persists, including post-policy spill previews. The change adds or removes no event fields and requires no session-format bump. Existing and future replay records remain valid because the presenter ignores logs metadata when choosing card content and reads their durable rendered content.
