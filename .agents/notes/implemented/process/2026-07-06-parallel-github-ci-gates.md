# Agent Note: Parallel GitHub CI gates

Status: implemented

## Problem

The keyless GitHub CI gates are mostly orthogonal: typecheck, lint, documentation freshness, coverage, snapshot replay, build, package-publication hygiene, demo smoke, and built-bin smoke fail for different reasons and do not need each other's runtime state. Running them as one ordered command chain makes the workflow wall clock equal the sum of those gates, while splitting every leaf gate into its own GitHub job repeats checkout, Node setup, pnpm restore, and install work until orchestration overhead becomes the bottleneck.

The hard part is the artifact boundary. `publint`, `verify-node-next-types`, and built-bin smoke tests need the built `lib/` outputs, while most gates only need source and dependencies. A blind fan-out either races those artifact consumers before `pnpm run build` has emitted declarations and bundles, or repeats the build in every artifact-dependent job.

## Decision

[CI](../../../../.github/workflows/ci.yml) groups keyless checks into broad primary-runtime lanes plus a compatibility matrix. The workflow file owns the current lane and runtime inventory.

Each lane delegates to [scripts/run-gates.ts](../../../../scripts/run-gates.ts), which schedules independent gates with bounded concurrency and prints an attributable result block for each one. Artifact consumers depend on one build within their lane, while compatibility jobs combine typechecking with a real unbuilt worker launch to cover runtime-specific loader behavior.

Generated `.sessions/` logs and `.doc-typecheck-*` temp directories are ignored by lint. The aggregate local CI mode still runs demo smoke after lint, while the split GitHub static lane can run demo smoke directly because lint is isolated in its own lane.

Build output is produced once inside the Node 24 artifact lane. The artifact consumers (`publint`, `verify-node-next-types`, and built-bin smoke) declare a dependency on `build`, so there is no upload/download handoff and no consumer can race ahead of declarations or bundles. The CI coverage reporter is text-only while local coverage keeps the HTML report.

Both workflows cache the pnpm store. The real-API workflow uses the shared bounded Vitest file pool rather than a separate job per test group.

## Alternatives considered

- **Keep the full serial chain in a Node matrix** - simplest to reason about, but it duplicates repo-wide gates that do not produce Node-version-specific signal and leaves every PR waiting for the sum of all gates.
- **Run every gate as a separate GitHub job** - maximizes GitHub-visible fan-out, but it creates too many checks and pays repeated setup/install overhead for gates whose runtime is shorter than the runner preparation.
- **Upload build artifacts to artifact-dependent jobs** - preserves correctness across many jobs, but it adds artifact upload/download time and keeps the workflow wide when the artifact consumers can run behind a local dependency in the primary job.
- **Run `typecheck` and `build` concurrently** - exposes more work to the scheduler, but both commands invoke `tsc -b`; sharing incremental build state between them is a needless race for a small wall-clock gain.
- **Use unbounded real-API e2e parallelism** - rejected because the suite includes many live model/tool scenarios; the worker pool needs an explicit `DSH_E2E_MAX_WORKERS` cap so CI and local runs can fan out without hiding quota or resource problems behind flaky rate-limit failures.

## Consequences

PR feedback arrives as a few GitHub checks with structured per-gate log blocks inside each broad job. That keeps runner setup overhead bounded and the Actions UI compact, at the cost of losing one status check per leaf gate.

The broad-lane split repeats checkout, setup, and install more often than a single primary job. That setup cost is intentional: on GitHub's hosted runner, running lint, coverage, and snapshot replay in one process pool oversubscribes CPU badly enough that the single-job critical path is longer than the repeated setup.

The split introduces a maintenance obligation: when `package.json` adds or removes a gate that belongs in CI, [scripts/run-gates.ts](../../../../scripts/run-gates.ts) needs the matching leaf. That obligation is intentional because the runner is the parallel execution plan for the same gate vocabulary, not a separate quality policy.

The compatibility signal is narrower than the primary Node 24 signal. It proves that the source graph typechecks and that the real unbuilt workflow-worker launch path executes on every advertised runtime line without doubling documentation, coverage, publication, snapshot replay, and unrelated smoke checks whose failures are not expected to vary by Node version.
