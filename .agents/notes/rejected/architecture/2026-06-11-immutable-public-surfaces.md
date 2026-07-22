# Agent Note: Deep-readonly public surfaces

Status: rejected — the pervasive `DeepReadonly<T>` type flip is replaced by source-owned runtime immutability in `Session` plus relational development assertions. See [source-owned session immutability and dev-mode invariants](../../implemented/architecture/2026-06-11-dev-invariants-over-deep-readonly.md).

## Problem

The rejected proposal targeted an ownership hole that a `readonly SessionEvent[]` type alone cannot close: its elements remain mutable at runtime, so a cast or plain JavaScript can rewrite nested history. The implemented design closes that hole in `Session` by materializing and deep-freezing every accepted event and returning frozen array snapshots. In-flight prompt waterfalls remain intentionally transformable, so immutability is an ownership boundary rather than a blanket type rule.

## Proposal

> **Implemented differently — see the Status line and [source-owned session immutability and dev-mode invariants](../../implemented/architecture/2026-06-11-dev-invariants-over-deep-readonly.md).** The `DeepReadonly<T>` design below is rejected as written: it is compile-only, noisy across consumers, and castable. `Session` instead snapshots and deep-freezes accepted events and public log snapshots in every composition; `deriveMessages()` returns detached frozen projections; the development plugin checks cross-record and cross-seam relationships.

Make immutability part of the type where mutation is corruption:

- `SessionEvent` data becomes `DeepReadonly` on the way OUT of a session (`events`, `session/event` listeners); `append()` keeps taking plain mutable input. A `DeepReadonly<T>` utility type lands in dsh-llm next to the brand/never helpers.
- `deriveMessages()` returns deep-readonly messages; the loop clones before handing a mutable request to the `agent/request` waterfall (mutation there is sanctioned — the clone makes the boundary explicit and cheap, once per step).
- `PromptAssembly` stays mutable through its waterfall (sanctioned) but the registry's internal section list is cloned per assembly (already true).

## Plan

Introduce `DeepReadonly`, flip the session read paths, and fix the resulting compile errors in consumers.

## Risks

`DeepReadonly` types can produce noisy errors at waterfall boundaries where mutation IS the API — keep the mutable/readonly boundary exactly at "logged vs in-flight" and document it in the session README.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
