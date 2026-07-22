# Agent Note: Two LLM adapters as a design-verification twin

Status: implemented

English | [中文](2026-06-13-twin-llm-adapters.zh.md)

## Problem

`dsh-llm` owns a provider-neutral streaming vocabulary — the `StreamChunk` protocol (`block-start`, `text-delta`, `reasoning-delta`, `tool-call-delta`, `block-end`, `usage`, `finish`) and the content-block types ([the content-block vocabulary](2026-06-11-content-block-vocabulary.md)). A vocabulary defined against a single adapter risks baking that adapter's quirks into the "neutral" contract: anything the one implementation happens to do becomes the de-facto spec, and the abstraction is unverified until a second provider arrives — by which point the leak is expensive to fix.

## Decision

Ship **two** adapters against the one contract from the start, deliberately built on different internals:

- `dsh-llm-deepseek` — hand-rolled `fetch` + SSE parsing against the DeepSeek API.
- `dsh-llm-pi-ai` — the same endpoint through the `@earendil-works/pi-ai` library (its own event vocabulary).

The rule they enforce: **anything the StreamChunk vocabulary cannot express for BOTH implementations is a core-vocabulary bug**, caught immediately rather than at the next provider. The pair pinned down conventions now documented on `StreamChunk` in `dsh-llm/src/types.ts`: usage emitted before finish, nothing after finish, tool-call `arguments` as raw JSON strings end-to-end, and the two sanctioned error paths (throw from `stream()` *or* end with `finish {kind:'error'|'aborted'}`) that a consumer must handle on both sides — a divergence the library-backed adapter surfaced that a single hand-rolled adapter would have hidden.

## Alternatives considered

- **A single adapter** — less code and half the e2e cost, but leaves the "provider-neutral" claim unverified; the vocabulary would encode DeepSeek-via-fetch assumptions silently.
- **A mock second adapter** — cheaper but doesn't exercise a real provider's wire quirks, so it proves little. The twin is real-on-real.

## Consequences

The twin doubles adapter and key-gated e2e maintenance—both cover V4 Flash and Pro across representative reasoning modes—in exchange for continuous seam-neutrality validation and a second implementation example. Both use `apiKey`, `baseURL`, and `models`; the hand-rolled adapter exposes `thinking`/`reasoningEffort`, while pi-ai exposes one `reasoning` level. A future conformance suite could justify retiring one adapter through a superseding Agent Note.
