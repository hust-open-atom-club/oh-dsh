# Agent Note: Portable required pull-request CI

Status: implemented

English | [中文](2026-07-23-portable-required-pull-request-ci.zh.md)

## Problem

Required pull-request jobs assigned to organization-owned runner labels remain queued when GitHub cannot allocate those pools. The workflow is valid and standard GitHub-hosted jobs can still pass, but `all checks passed` never starts and an otherwise healthy pull request cannot satisfy branch protection.

Billing health, a runner definition's `Ready` state, and a large autoscaling ceiling do not prove that a named pool can receive a job. Required correctness checks need a portable execution path that does not depend on repository-external runner provisioning.

## Decision

[CI](../../../../.github/workflows/ci.yml) runs every required pull-request job on GitHub's standard `ubuntu-latest` or `windows-2025` capacity. The primary Node and Windows jobs keep their complete consolidated inventories, while top-level gates, coverage, ESLint, publint, and snapshot replay use one worker on the smaller hosts. Node versions are selected through `actions/setup-node`, and the Windows job enables Developer Mode before installing the symlinked workspace.

The `node 24 / complete`, Node compatibility, Python SDK, and `windows node 24 / complete` jobs remain dependencies of `all checks passed`; no gate is removed or made observational to recover availability. Branch protection continues to require `e2e` and `all checks passed`.

The two manual larger-runner suites and all twelve organization-owned labels remain available for measurement. They do not participate in ordinary pull requests. The [larger-runner measurements](2026-07-22-evidence-based-larger-hosted-runners.md) remain evidence for future performance work, while the [serial cross-platform reference](2026-07-21-serial-cross-platform-ci-reference.md) remains the independent master-push completeness check.

## Alternatives considered

**Wait for organization-runner allocation to recover.** A queue with no assigned runner emits no repository diagnostic and can block every pull request indefinitely, so an external recovery is not a correctness path.

**Use only the smallest organization-owned pools.** Every named pool crosses the same organization allocation boundary; reducing core count does not remove the dependency that caused the queue.

**Skip or demote checks while capacity is unavailable.** This would make the status green by dropping evidence rather than by running the repository's required contracts.

**Keep larger-host worker limits on standard runners.** Concurrent full-repository gates and their inner worker pools can oversubscribe the smaller memory and CPU allocation, turning an availability repair into contention failures.

## Consequences

Ordinary pull requests can acquire runners without organization-specific configuration, and a live exact-head run proves the same commands that branch protection consumes. The trade-off is longer elapsed time and more rounded standard-runner minutes than the measured larger-runner topology.

Manual larger-runner benchmarks can remain queued without blocking pull requests. Restoring larger runners to the required path needs a separate evidence-based decision after exact-head jobs receive nonzero runner IDs and complete reliably; changing a definition's status alone is insufficient.
