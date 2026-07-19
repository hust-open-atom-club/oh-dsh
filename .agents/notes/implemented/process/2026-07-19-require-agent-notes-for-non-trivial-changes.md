# Agent Note: Require an Agent Note for every non-trivial change

Status: implemented

English | [中文](2026-07-19-require-agent-notes-for-non-trivial-changes.zh.md)

## Problem

A selective threshold based on whether a decision seems durable, contested, and surprising lets substantial changes land without preserving their rationale. Code and tests show what changed, but they cannot consistently preserve why an approach won, which alternatives lost, or what costs maintainers accepted.

## Decision

Every non-trivial change adds or updates at least one Agent Note in the same PR. Non-trivial changes include behavior, architecture, cross-file or cross-package contracts, process or tooling, testing strategy, on-disk, wire, or configuration formats, and other decisions a maintainer may reasonably revisit.

Updating the note that already owns a decision satisfies the rule; a new note is required only when no note owns it. Purely mechanical or local edits with no behavioral, contractual, structural, process, or rationale change are exempt. The [Agent Notes README](../../README.md#when-to-write-one) owns this boundary, while root `AGENTS.md` carries the standing order.

Review enforces the semantic boundary. No automated gate attempts to classify a diff as trivial or non-trivial, so this policy adds no gate stage or runtime.

## Alternatives considered

**Require notes only for decisions judged durable, contested, and surprising.** The threshold is subjective enough that a substantial change can be treated as obvious or local, losing the rationale Agent Notes exist to preserve.

**Require a new note for every change.** This duplicates an existing note when it already owns the decision and adds empty ceremony to purely mechanical edits.

**Add a CI diff-classification gate.** A mechanical check cannot reliably determine whether a semantic change is trivial, while another gate adds runtime and invites false positives or superficial compliance.

## Consequences

- Every substantial change preserves its rationale and rejected alternatives beside the implementation.
- Contributors maintain an existing owning note instead of creating duplicate records.
- Mechanical edits remain lightweight, and the gate topology and runtime remain unchanged.
