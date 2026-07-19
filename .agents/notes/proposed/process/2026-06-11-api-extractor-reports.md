# Agent Note: API extractor reports

Status: proposed

> Split out from the original "Doc-sync and API reports" Agent Note (2026-06-11). Parts 1-2 (doc-block typechecking, event-taxonomy verification) shipped — see [doc-sync enforcement](../../implemented/process/2026-06-11-doc-sync-enforcement.md). This is the deferred part 3, kept as a standalone proposal.

## Problem

Public API changes are invisible — nothing makes "this commit changed the public surface" an explicit, reviewable fact. A reviewer reading a diff can miss that an exported type gained a field or a method signature shifted.

## Proposal

api-extractor (or `tsc --emitDeclarationOnly` + a normalized public-surface dump) producing a checked-in `etc/<pkg>.api.md` per package; CI fails if regeneration differs. Every public-API change becomes a diff line a reviewer (or review agent) must see.

## Alternatives considered

**`tsc --emitDeclarationOnly` plus a normalized public-surface dump** — the lighter mechanism if api-extractor proves too heavy; either satisfies the checked-in, diffable report shape the proposal needs.

## Acceptance criteria

- Every package has a checked-in `etc/<pkg>.api.md`; CI fails when regeneration differs from the committed report.
- A public-API change (a new export, a widened field, a shifted signature) is visible as a report diff line in review.

## Risks

The dependency is heavy and finicky — the reason this was deferred — and the report format churns with compiler upgrades, adding a maintenance surface that buys little while the packages stay unpublished.

## Why deferred

Deferred when doc-sync landed: low value for an internal monorepo where reviewers already see the source diff, and a heavy, finicky dependency. Revisit if the packages are ever published externally — at that point a stable, diffable public surface earns its keep.
