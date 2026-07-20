# Agent Note: Project steering messages as plain user content

Status: implemented

English | [中文](2026-07-20-unwrap-steering-message-projection.zh.md)

## Problem

`Session.deriveEventMessage` rendered `steering/message` inside a `<steering source="…">…</steering>` envelope, mirroring the `context/message` framing. But the two events differ in kind: context injection is ambient, non-conversational material (file-change notices, workspace instructions) where the envelope tells the model "this is not the user speaking", while steering *is* the user (or a plugin acting for the user) speaking mid-turn — "also reply with SECOND", "focus on tests". Wrapping that direction in an XML label distances the model from an instruction it should treat as a first-class user message; recorded transcripts show models reasoning about whether to obey "the steering input" as if it were third-party metadata.

## Decision

`steering/message` projects to a plain user-role message carrying its content blocks verbatim — identical to `user/message` projection. The `<context>` envelope on `context/message` (with its `raw` opt-out) is untouched. The former `renderTagged` helper in `packages/core/session/src/index.ts` is now the context-only `renderContextEnvelope` with no tag parameter. The compaction renderer's `[Steering: …]` label is unaffected: that is a summarization-input format, not model-visible history.

The `source` attribution that the envelope carried is not lost — it remains on the durable `steering/message` event; it just no longer renders into the model transcript.

## Alternatives considered

- **Keep the envelope for plugin-sourced steering only** — splits one projection into two on `source.kind` for no observed benefit; a plugin steering the agent (hook-bridge continuation reasons) also wants the instruction followed, not attributed.
- **Move the unwrapping into adapters** — the canonical projection is the model-visible contract ("model-visible ⟺ logged"); per-adapter divergence on framing would make the derived transcript adapter-dependent.

## Consequences

- Mid-turn steering reaches the model with the same weight as an ordinary user prompt.
- The transcript no longer distinguishes a steering injection from a user message; consumers that need the distinction read the durable event log, which keeps `steering/message` and its `source` intact.
- The [content-block-vocabulary Agent Note](../architecture/2026-06-11-content-block-vocabulary.md)'s tagged-envelope clause now covers `context/message` only and is amended to point here.
