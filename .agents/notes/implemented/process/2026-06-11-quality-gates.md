# Agent Note: Mechanical quality gates over prose guidelines

Status: implemented

## Problem

This codebase is developed primarily by coding agents. Agents follow enforced gates far more reliably than prose conventions, and "a lot of work" is not a cost argument when agents do the labor. Early evidence: tests that didn't typecheck shipped (vitest doesn't typecheck) and were only caught by a review.

## Decision

Every AGENTS.md promise gets a command that exits non-zero, wired into git hooks and CI both calling the same package.json scripts:

- Max-strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …); examples, tests, and scripts typecheck in CI via the root no-emit `tsconfig.json` while package/vendor code stays behind its own project-reference boundary.
- ESLint strict-type-checked + @stylistic (the house style, enforced), including file-local duplicated logic checks; vendored code excluded.
- jscpd detects cross-file clones in package production TypeScript and repository scripts; narrow source-range exceptions document deliberately parallel implementations.
- Per-file 100% coverage on `packages/*/*/src` (v8); unreachable defensive guards carry `/* v8 ignore */ ` with stated reasons instead of deletion.
- knip (dead code/deps), publint (package correctness), workspace constraints (workspace rules: private, cordis peer+dev, uniform version, ESM), and a NodeNext consumer typecheck for built package declarations.
- lefthook pre-commit (lint staged, typecheck, vendor-manifest guard) and pre-push (tests, hygiene); CI runs the full matrix on node 22.19/24/26 plus a demo smoke test driving the echo-agent end to end.

## Consequences

- Conventions survive agent turnover; violations fail fast and locally.
- The gates themselves are code to maintain; config changes are reviewed like any change.
- 100%-coverage pressure can produce assertion-free tests — mutation testing is the planned counterweight (see [the mutation-testing proposal](../../proposed/testing/2026-06-11-mutation-testing.md)).

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
