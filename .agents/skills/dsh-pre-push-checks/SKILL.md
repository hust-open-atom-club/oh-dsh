---
name: dsh-pre-push-checks
description: Use before pushing, force-pushing, marking ready for review, or claiming checks pass on a deepseek-harness branch to select focused implementation evidence and preserve the mandatory primary-CI pre-push gate.
---

# DSH Pre-Push Checks

Use this skill to run relevant implementation evidence once and the complete local publication baseline once before a `deepseek-harness` push. Pre-commit fixes staged lint, checks staged whitespace, and guards vendored-source metadata; pre-push invokes `pnpm run check:pre-push`, which selects the same primary Node inventory as `pnpm run check:ci`. Hosted CI still owns platform- and provider-specific evidence.

## Inspect the outgoing change

1. Confirm the checkout and branch.

```sh
git status --short --branch
git rev-parse --show-toplevel
```

2. Inspect the diff against its actual base.

```sh
git diff --stat
git diff --name-only origin/$(git branch --show-current)...HEAD
```

If the branch has no upstream or that range is not meaningful for the stack, compare with the PR base branch. After merging a changed base, reassess which behavior the combined diff can affect and rerun only checks invalidated by the merge.

## Select relevant evidence

Every behavior change needs the narrowest available test or purpose-built check that would fail for its regression. Run that evidence while iterating; the hook supplies the universal publication baseline.

- **Package or script behavior:** run the owning Vitest file or focused test name. Add adjacent package tests when a shared contract changes; leave repository-wide coverage to pre-push unless the change is genuinely cross-cutting or the user requests it earlier.
- **Documentation, Agent Notes, catalogs, or doc-linked comments:** run `pnpm run doc-sync`; run full lint when the documentation workflow requires it.
- **Model-, editor-, CLI-, or terminal-visible output:** run the focused keyless snapshot or real runnable-example scenario that owns the output.
- **Package manifests, public exports, build configuration, worker/bin entries, or built runtime paths:** run `pnpm run build`, the relevant hygiene checks, and the owning built-artifact smoke.
- **Real provider or agent behavior:** run the relevant `pnpm run test:e2e` target when credentials are available; never print secrets.

Do not manually repeat a passing check merely because commit or push follows. In particular, do not run `check:pre-push` immediately before a normal push and then repeat the same aggregate in the hook.

### Focus unit coverage on the affected source

Test selection and coverage selection are separate. A Vitest file filter chooses which tests run, while the repository configuration otherwise measures every `packages/*/*/src/**/*.ts` file. When unit coverage is relevant, name both the owning tests and the source files or package whose coverage those tests must prove:

```sh
pnpm exec vitest run packages/<group>/<package>/tests/<behavior>.spec.ts \
  --coverage \
  --coverage.include='packages/<group>/<package>/src/**/*.ts'
```

Use an exact source file when the behavior is truly confined to one module. Repeat `--coverage.include` for multiple affected files or packages, and pass every owning test file needed to exercise that scope. The configured per-file 100% thresholds still apply inside the selected source scope.

When the owning tests are unclear, use Vitest's dependency graph to discover a candidate set, then inspect the selected tests before treating the run as evidence:

```sh
pnpm exec vitest related packages/<group>/<package>/src/<changed>.ts \
  --run \
  --coverage \
  --coverage.include='packages/<group>/<package>/src/<changed>.ts'
```

`vitest related` cannot discover behavior reached only through configuration, dynamic loading, subprocesses, workers, built artifacts, or external providers; select those owning tests explicitly. Do not use `--passWithNoTests`, lower coverage thresholds, or narrow `--coverage.include` merely to hide an uncovered affected file. If a selected package scope fails because one focused test does not cover it, add its other relevant owning tests or narrow the source scope only when the excluded modules cannot be affected by the change.

## Mandatory publication gate

The normal push runs the complete keyless primary Node inventory through Lefthook:

```sh
pnpm run check:pre-push
```

Invoke the command directly only when the user requests a rehearsal independent of publication or when diagnosing the hook itself. Add the relevant `pnpm run test:e2e` target when credentials are available and behavior depends on a real provider; real-API e2e is not part of the keyless primary inventory.

## Handle failures

If a relevant check or the publication gate fails, stop and fix or explain the blocker. Do not push and hope CI differs.

If a failure looks environment-specific, prove it:

- Record the exact command, failing test, and platform-specific mismatch.
- Confirm the relevant non-platform evidence.
- Prefer fixing cross-platform nondeterminism when the check is required.
- Bypass a local hook only when the user explicitly asks or agrees, and report exactly what failed and why CI is expected to differ.

## Push procedure

1. Run the selected focused checks once during implementation.
2. Commit normally and inspect any files changed by the pre-commit fixer before continuing.
3. Push normally so the complete primary Node hook runs once.
4. Verify the remote ref matches local `HEAD`.

```sh
git rev-parse HEAD origin/$(git branch --show-current)
```

For GitHub PRs, inspect remote CI after the push:

```sh
gh pr checks
```

Report pending checks as pending. Inspect failures before attributing them to the branch or the environment.
