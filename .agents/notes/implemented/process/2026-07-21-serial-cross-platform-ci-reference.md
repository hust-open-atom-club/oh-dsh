# Agent Note: Serial cross-platform CI reference

Status: implemented

English | [中文](2026-07-21-serial-cross-platform-ci-reference.zh.md)

## Problem

The pull-request workflow reaches its latency targets by partitioning static checks, lint, coverage, snapshot replay, and artifact validation across explicit GitHub jobs. Those partitions are exhaustively checked in code, but the optimized workflow still should not be its own only completeness oracle: a defect shared by shard selection and its inventory test could omit work while every optimized lane stays green.

Encoding the one-minute non-Windows target and three-minute Windows target as job timeouts creates a separate failure mode. Hosted-runner startup and performance vary, so a correct gate can be cancelled at the target boundary before it emits useful diagnostics. The performance objective needs measurement against GitHub timestamps, while correctness needs enough time to finish.

Reviewers also need a direct answer to a simpler question: what happens when the repository's complete primary Node CI aggregate runs without matrix selection, shard variables, or concurrent gates on each selected hosted operating system?

## Decision

[CI](../../../../.github/workflows/ci.yml) accepts `workflow_dispatch` in addition to its normal push and pull-request events. A manual dispatch skips the optimized and compatibility jobs and exposes three explicit jobs named `serial / linux`, `serial / macos`, and `serial / windows`. They intentionally duplicate their short checkout, runtime setup, and immutable install sequences instead of hiding the operating systems behind a matrix or reusable workflow.

Each reference job runs `pnpm run check:ci` without any shard selector. `DSH_GATE_CONCURRENCY=1` makes the top-level aggregate execute one ready gate at a time; coverage, snapshot replay, built-bin smoke, and publication validation also receive worker counts of one. The three operating-system jobs may run beside one another, but each host's repository gates are serial and complete. Linux installs bubblewrap before replaying snapshots, and Windows enables Developer Mode before installing the symlinked workspace.

Manual reference jobs are diagnostic and do not participate in the required `all checks passed` result. Pull-request and push events continue to run only the optimized lanes. The one-minute non-Windows and three-minute Windows objectives are evaluated from completed hosted-job timestamps and reported as measurements; they are not `timeout-minutes` values.

The portable reference uses GitHub's standard `ubuntu-latest`, `macos-latest`, and `windows-2025` labels. A higher-core hosted runner remains a possible future benchmark, but it is not the default: larger runners require organization-owned labels and provisioning, while a reference oracle should remain runnable without repository-external runner configuration. Provisioning one later can change the performance experiment without changing this correctness baseline.

## Alternatives considered

- **Set each timeout equal to its latency target** - rejected because scheduling variance would cancel correct work and suppress the evidence needed to diagnose a regression.
- **Trust only the optimized shard inventory** - rejected because selection and validation share implementation assumptions; an unsharded aggregate is an independent completeness check.
- **Run the serial references on every pull request** - rejected because they deliberately trade wall time and runner consumption for simplicity and are not needed in the fast feedback loop.
- **Use one operating-system matrix** - rejected because three named jobs make the reference surface visible without another selection mechanism.
- **Move the fast workflow to larger runners now** - rejected as the portable default because it would couple ordinary CI to organization-specific runner capacity. It remains an opt-in experiment after such capacity has an owned label and budget.

## Consequences

The workflow contains duplicated setup steps and a manual reference run can take much longer than the optimized pull-request path. That duplication is deliberate: reviewers can inspect each operating system's complete command without resolving a matrix or shard inventory.

The reference may expose platform failures that the optimized blocking set does not yet claim to support, especially on Windows. Such a failure is evidence about current cross-platform behavior rather than a reason to weaken or silently skip the aggregate.

Removing strict duration timeouts means a latency regression is observed rather than automatically cancelled. Hosted measurements must therefore accompany performance changes, while the completed logs retain the information needed to optimize the slow lane.
