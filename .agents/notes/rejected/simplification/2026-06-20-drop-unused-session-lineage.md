# Agent Note: Drop unused session lineage metadata

Status: rejected — `parentSession` is part of the documented fork/sub-agent seam and is already preserved by the agent/session resume path. The field is future-facing, but it is not accidental dead state.

English | [中文](2026-06-20-drop-unused-session-lineage.zh.md)

## Problem

`SessionHeader.parentSession` records the session a new session was forked from. It is defined in `dsh-session`, preserved by persistence backends, copied through resume, documented as lineage metadata, and covered by round-trip tests. The repo has no production fork UI or sub-agent flow that reads it. The planned sub-agent/fork seam is still a TODO, so the field is currently stored future shape.

The cost is small per file but broad across the format: every backend schema and metadata serializer preserves a value that no completed feature reads yet. Because the header is an on-disk contract, even a placeholder field becomes something future refactors must either maintain, migrate, or deliberately break.

## Proposal

Remove `parentSession` from `SessionHeader` until a real fork/resume feature needs lineage. Forking can still seed a new session with prior events if such an API exists, but the durable parent pointer should be introduced alongside the feature that reads it and the UX that explains it.

If lineage returns, decide then whether it belongs in the immutable header, a session graph index, or a first-class event. The current field should not pre-commit that design.

## Acceptance criteria

- `SessionHeader` contains version, id, createdAt, and optional cwd only.
- JSONL and SQLite metadata schemas stop storing parent-session ids.
- Resume and list APIs no longer round-trip `parentSession`.
- Docs and tests remove fork-lineage claims that are not backed by a production consumer.
- The session format version, backend schema versions, and recorded fixtures are refreshed as needed; non-current stored data is rejected per the pre-release format policy, with no migration path.

## What we give up

The codebase loses a ready-made lineage hook for future fork/sub-agent UX. That is intentional. The field is easy to reintroduce when the feature exists, and the unreleased stance lets the format change without migrations.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
