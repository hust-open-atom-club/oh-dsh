# Agent Note: Collect coverage and expand stability regression tests

Status: implemented

English | [中文](2026-08-31-coverage-collection-and-stability-regression.zh.md)

## Problem

The stability regression task (branch
`chore/add-coverage-collection-and-expand-stability-regression`) had to pick
a testable surface. The behaviors named by the task largely live in Electron
DOM code (`src/update-dialog.ts`, the `pinned-summary` client, `src/main.ts`
menus) that exports no pure functions, while the repo runs `node:test` with
no DOM environment.

## Decision

The expansion ships behavior-level tests for the stability-critical paths:
the desktop update state machine (cancel, retry, verify failures, command
dispatch), the install scripts (`install.sh` through real subprocesses
against the mock GitHub release server, `replaceMacBundle` for the mac
bundle), the marketplace transaction manager (protected-action rejection,
catalog filtering), and the `resolveProductVersion` fallback chain. The
tests drive dependency-injection fakes (`FakeUpdater`, `MockGitHub`) on
`node:test` and keep production code as shipped; DOM behavior keeps its
source-regex assertions.

The CI collects coverage on the Linux job into `coverage/lcov.info` with
`tests/**` excluded from the denominator, uploads the raw report as a run
artifact, and forwards it to Codecov as a report-only service without
thresholds; `fail_ci_if_error: false` keeps fork PRs green where
`CODECOV_TOKEN` is unavailable.

## Alternatives considered

**Introduce jsdom/happy-dom and test the DOM layers.** Rejected: a new test
dependency plus tests that chase rendering details instead of contracts.

**Refactor production code for testability** (export `latestSummary`, inject
a timestamp into `availableBackupPath`, export `parseUpdateCommand`).
Rejected: the smallest coherent diff beats widening test reach; DOM behavior
keeps its source-regex assertions until a real regression demands a seam.

**Enforce coverage thresholds** (`--test-coverage-lines`). Rejected: the task
asked for report-only coverage; thresholds would gate on an unstable
denominator while the suite grows.

## Consequences

The update manager state machine, install script failure and idempotency
paths, marketplace transaction rejection, and the version fallback chain are
pinned by the new behavior tests. DOM behaviors (update dialog button
visibility, pinned-summary rendering states, About panel assembly) keep
their source-regex assertions, so behavior coverage there starts with an
explicit seam rather than regex extensions. The mac backup-name exhaustion
test seeds a wide window of candidate paths in parallel, so it stays correct
under slow CI even though the timestamp itself is not injectable.
