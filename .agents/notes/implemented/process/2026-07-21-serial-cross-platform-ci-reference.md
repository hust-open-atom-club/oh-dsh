# Agent Note: Serial cross-platform CI reference

Status: implemented

English | [中文](2026-07-21-serial-cross-platform-ci-reference.zh.md)

## Problem

The pull-request workflow consolidates required checks into dedicated Linux and Windows jobs. Those jobs still should not be the only completeness oracle: a defect in their gate inventory or dependency graph could omit work while the required aggregate stays green.

Encoding the one-minute non-Windows target and three-minute Windows target as job timeouts creates a separate failure mode. Hosted-runner startup and performance vary, so a correct gate can be cancelled at the target boundary before it emits useful diagnostics. The performance objective needs measurement against GitHub timestamps, while correctness needs enough time to finish.

Reviewers also need a direct answer to a simpler question: what happens when the repository's complete primary Node CI aggregate runs without matrix selection, shard variables, or concurrent gates on each selected hosted operating system?

## Decision

[CI](../../../../.github/workflows/ci.yml) gives pull-request and master-push events complementary responsibilities. Pull requests run consolidated Linux and Windows jobs plus the Node compatibility and Python contracts on standard GitHub-hosted capacity. A push to `master` skips those jobs and runs three explicit references named `serial / linux`, `serial / macos`, and `serial / windows`. They intentionally duplicate their short checkout, runtime setup, and immutable install sequences instead of hiding the operating systems behind a matrix or reusable workflow. `workflow_dispatch` is reserved for runner benchmarks.

Each reference job runs `pnpm run check:ci` without any shard selector. `DSH_GATE_CONCURRENCY=1` makes the top-level aggregate execute one ready gate at a time; coverage, snapshot replay, built-bin smoke, and publication validation also receive worker counts of one. The three operating-system jobs may run beside one another, but each host's repository gates are serial and complete. Linux installs bubblewrap before replaying snapshots, and Windows enables Developer Mode before installing the symlinked workspace.

Master reference jobs are diagnostic and do not participate in the pull request's required `all checks passed` result. A pull request runs only its required jobs; a master push runs only the three serial references. Performance is evaluated from completed hosted-job timestamps and reported as a measurement; it is not encoded as a `timeout-minutes` value.

The portable reference uses GitHub's standard `ubuntu-latest`, `macos-latest`, and `windows-2025` labels. Required pull-request jobs use the same portable Linux and Windows capacity under the [required-CI decision](2026-07-23-portable-required-pull-request-ci.md). Higher-core hosted runners remain manual benchmarks because a correctness path must remain runnable without repository-external runner configuration.

## Alternatives considered

- **Set each timeout equal to its latency target** - rejected because scheduling variance would cancel correct work and suppress the evidence needed to diagnose a regression.
- **Trust only the concurrent primary inventory** - rejected because scheduling and validation share implementation assumptions; a serial aggregate is an independent completeness check.
- **Run the serial references on every pull request** - rejected because they duplicate complete cross-platform aggregates and add macOS work to every change; the required jobs already execute the blocking Linux and Windows contracts.
- **Use one operating-system matrix** - rejected because three named jobs make the reference surface visible without another selection mechanism.
- **Run the serial reference on larger runners** - rejected because both required CI and its independent reference must remain runnable when organization-owned pools cannot allocate jobs.

## Consequences

The workflow contains duplicated setup steps and a master reference run can take much longer than the optimized pull-request path. That duplication is deliberate: reviewers can inspect each operating system's complete command without resolving a matrix or concurrent scheduler.

The reference may expose platform failures that the optimized blocking set does not yet claim to support, especially on Windows. Such a failure is evidence about current cross-platform behavior rather than a reason to weaken or silently skip the aggregate.

Removing strict duration timeouts means a latency regression is observed rather than automatically cancelled. Hosted measurements must therefore accompany performance changes, while the completed logs retain the information needed to optimize the slow lane.
