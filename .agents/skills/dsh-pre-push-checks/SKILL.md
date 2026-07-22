---
name: dsh-pre-push-checks
description: Use before pushing, force-pushing, marking ready for review, claiming checks pass, or bypassing a local hook on a deepseek-harness branch, especially after merges, review fixes, package graph changes, docs/catalog updates, snapshots, e2e behavior, or built artifact changes.
---

# DSH Pre-Push Checks

Use this skill to choose and run the smallest sufficient verification set before a `deepseek-harness` push. Do not treat the local pre-push hook as the full CI contract: CI also runs coverage, build, and built-bin smoke.

## First Steps

1. Confirm the checkout and branch.

```sh
git status --short --branch
git rev-parse --show-toplevel
```

2. Inspect the outgoing diff.

```sh
git diff --stat
git diff --name-only origin/$(git branch --show-current)...HEAD
```

If the branch has no upstream or the command is not meaningful for the stack shape, use `git diff --name-only origin/master...HEAD` or the PR base branch.

3. If the branch was just merged with `master`, or the user says master changed, run the gates after resolving the merge and before pushing or marking ready. Do not present a conflict-resolution commit as ready with only typecheck/lint evidence.

## Required Baseline

Run these before every non-trivial push:

```sh
pnpm run typecheck
pnpm run lint
pnpm run test:coverage
```

Why `test:coverage`, not only `test`: CI enforces per-file 100% coverage. A branch can pass `pnpm run test` and still fail CI.

## Add Gates By Touched Surface

Run `pnpm run doc-sync` and `pnpm run verify-module-graph` when the diff touches Markdown docs, package manifests, package imports/exports, generated catalogs, Agent Notes, architecture docs, translation pairs, Mermaid diagrams, or comments that cite docs/packages.

Run `pnpm run build` and `pnpm run hygiene` when the diff touches any package `package.json`, dependency graph, public exports, build config, declaration surface, bundled runtime path, or code that will be consumed from built `lib/`.

Run snapshot tests when the diff changes ACP/editor-facing transcript behavior: ACP bridge updates, agent-loop observable output, tool call/result presentation, session log rendering, stdout/stderr protocol output, or snapshot fixtures.

```sh
pnpm run test:snapshot
```

Run built-bin smoke tests after `pnpm run build` when app packages, app boot, package runtime imports, bin entries, loader behavior, or published artifact paths change.

```sh
DSH_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/keyless-smoke.e2e.ts examples/tui-agent/tests/tui-keyless-smoke.e2e.ts packages/examples/cli-demo/tests/built-bin.e2e.ts packages/examples/acp-demo/tests/built-bin.e2e.ts
```

Run real e2e when behavior depends on a real model/API, tool-use loop, ACP integration, prompt injection, or end-to-end agent UX. If `.env` is available, use it; do not print secrets.

```sh
pnpm run test:e2e
```

Run a targeted test first for the changed package, but never use targeted tests as the only push evidence unless the change is test-only and cannot affect shared behavior.

## Full Local CI Approximation

Use this before high-risk pushes, after large merges, before asking for review on a major PR, or when prior pushes have caused CI churn. The authoritative command list is the root [AGENTS.md § Run the CI gates locally before marking a PR ready](../../../AGENTS.md#run-the-ci-gates-locally-before-marking-a-pr-ready); run that block rather than copying a local variant into this skill. Add `pnpm run test:e2e` when a key is available and the feature has real-agent behavior.

## Handling Failures

If a gate fails, stop and fix or explain the blocker. Do not push and hope CI differs.

If a failure looks environment-specific, prove it:

- Record the exact command, failing test, and platform-specific mismatch.
- Confirm the relevant non-platform gates pass.
- Prefer fixing the test for cross-platform determinism if the test is part of the required local gate.
- Bypass a local hook only when the user explicitly asks to push or agrees, and state exactly which hook failed and why it is not expected to fail on CI.

Known pattern to watch for: Linux CI and macOS local behavior can differ for shell utilities such as `sed -i`. Treat this as evidence to investigate, not as automatic permission to bypass.

## Push Procedure

1. Local commits may happen before the full gate set, but do not push, mark ready, or claim checks pass until the relevant gates pass or any blocker is explicitly documented.
2. Let the normal pre-commit hook run. If it changes files, inspect and commit or amend the change intentionally rather than hiding it.
3. Push normally first so the pre-push hook can run.
4. If a local hook is bypassed after user approval, use the narrow bypass and say so in the final response.
5. After push, verify the remote ref matches local HEAD.

```sh
git rev-parse HEAD origin/$(git branch --show-current)
```

For GitHub PRs, check CI after push:

```sh
gh pr checks
```

If checks are pending, say pending. If checks fail, inspect logs before claiming the push is good.
