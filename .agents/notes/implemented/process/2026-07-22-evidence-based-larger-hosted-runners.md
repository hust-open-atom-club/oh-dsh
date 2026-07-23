# Agent Note: Evidence-based larger hosted runners

Status: implemented

English | [中文](2026-07-22-evidence-based-larger-hosted-runners.zh.md)

## Problem

The shard-heavy CI topology met its latency targets by spreading primary Node work across 40 Linux jobs and Windows work across nine jobs. Most gates were shorter than checkout, runner setup, cache restore, and dependency installation, so repeated setup waves created both cost and latency variance. One hosted run finished its slowest Linux job in 49 seconds yet took 231 seconds for a Windows lint shard whose checkout, cache restore, and install alone consumed 158 seconds.

Larger runners make it possible to pay setup once and parallelize inside the repository scheduler, but the useful size cannot be selected from core counts alone. Critical-lane benchmarks did not scale monotonically, and a whole-repository aggregate exposed different bottlenecks from isolated typecheck or site builds.

## Decision

The organization keeps twelve x64 larger-runner pools in the repo-restricted `dsh-larger-ci` group: Ubuntu 24.04 and Windows 2025 at 4, 8, 16, 32, 64, and 96 cores. Public IPs are disabled. Each pool has an autoscaling ceiling of 256; the ceiling does not allocate idle machines or remove the need to bound workflow demand.

The pools are measurement infrastructure, not a dependency of ordinary pull requests. The [portable required-CI decision](2026-07-23-portable-required-pull-request-ci.md) runs branch-protection jobs on standard GitHub-hosted capacity; `suite=larger-runner-benchmark` compares isolated critical lanes across every provisioned size, and `suite=consolidated-runner-benchmark` compares whole aggregates. Each benchmark reports its observed processor and memory capacity before running repository work.

The former gate-level and coarse primary shard jobs are absent from the workflow. Their static, lint, coverage, snapshot, and scenario shard selectors are also absent from the repository, so an unused diagnostic path cannot preserve a second CI architecture.

An [exact-head all-size benchmark](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29908491351) ran the complete unsharded primary Node aggregate on every Linux pool before the eager-build correction:

| Complete Linux primary | 4 cores | 8 cores | 16 cores | 32 cores | 64 cores | 96 cores |
|---|---:|---:|---:|---:|---:|---:|
| Active time | 243 s | 144 s | 103 s | 87 s | 62 s | 65 s |

The 96-core trace spent 39.14 seconds in repository gates. Typecheck occupied 25.71 seconds, then a scheduler dependency delayed the 2.13-second build and 11.29-second snapshot replay until it finished. The same run already proved build and typecheck independently, and the former CPU lane ran them concurrently. Removing that dependency makes lint at 33.30 seconds the measured critical gate while preserving dependencies only for consumers of build output. The 64-core trace exposed the same idle chain: typecheck, build, and snapshot consumed 44.85 seconds in sequence while its independent lint and documentation builds finished in 36.83 and 36.15 seconds. More cores therefore become useful only after the repository scheduler can feed them.

The same benchmark measured the required Windows build surfaces across every provisioned size:

| Windows blocking builds | 4 cores | 8 cores | 16 cores | 32 cores | 64 cores | 96 cores |
|---|---:|---:|---:|---:|---:|---:|
| Active time | 152 s | 104 s | 104 s | 92 s | 103 s | 110 s |

Repository work gains little above 16 Windows cores, but the 32-core pool can start the complete outer inventory together. A [retargeted production validation](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29907581119/attempts/2) completed the full one-box Windows inventory in 173 seconds, including coverage and snapshot replay, so Windows remains consolidated.

The larger client package graph makes cache mechanics and scheduler pressure part of the measured workload. In [one exact-head candidate run](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29912577681), Linux spent 39 seconds in repository gates but 69 seconds in the complete job, while Windows spent 117 seconds in repository gates and 228 seconds in the complete job. The Windows pnpm cache downloaded its 154 MB archive in about two seconds but spent 27 seconds extracting it, followed by a 23-second install and a 14-second post-job save. A [cacheless all-size trace](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29913033155) completed the same 32-core Windows install in 27 seconds. A future larger-runner rollout therefore needs complete-job measurements rather than gate-only timing.

Host setup remains part of any comparison. A standard Node 26 job once spent 36 of its 67 seconds in `Set up job`, while `actions/setup-node` spent 46.56 seconds printing cached Windows environment details after finding Node in the hosted toolcache. A Linux candidate also spent 18 seconds registering a 50 KB Bubblewrap package because the hosted image scanned 202,507 package-database files. [`scripts/prepare-ci-bubblewrap.sh`](../../../../scripts/prepare-ci-bubblewrap.sh) instead verifies and extracts the pinned payload into the ephemeral runner directory, runs a functional confinement probe, and overlaps that preparation with dependency installation.

Inner and outer worker limits are separate controls. An [exact-head 32-worker ESLint experiment](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29918329463) slowed lint to 52.28 seconds and coverage to 42.71 seconds, where an adapter idle-timeout test failed. A later 8-gate trace reduced coverage to 35.17 seconds but delayed the production-site build until the aggregate reached 41.06 seconds. Core count therefore does not justify copying an equally large worker limit.

The process-bound coverage project contains exactly five suite files. Thirty-two forks crashed Node 24's CJS lexer twice, and a later 16-fork run reproduced the worker loss and invalid coverage result. The single Vitest invocation therefore uses threads for the broad inventory and reserves forks for suites that exercise process-global state, `process` APIs, or timing-sensitive process I/O. That narrow fork inventory includes the local bash process-plumbing suite and the pi-ai adapter suite because aggregate contention changed timing observations in both. These failures make deterministic coverage, not advertised cores, the upper bound on worker selection.

Complete serial Linux, macOS, and Windows references run only when `master` moves. Pull requests use the portable required path, while larger-runner suites run only by manual dispatch.

## Alternatives considered

**Keep the three coarse primary Linux lanes.** The core, CPU, and production-site jobs met the latency targets, but they paid three setup waves and left primary Node work sharded after larger runners were available. The all-size trace showed that one unnecessary dependency, not a lack of host capacity, kept the single-box aggregate above one minute.

**Keep the former gate-level shard topology as a manual reference.** A dormant second topology kept hundreds of workflow lines, selector modules, and scenario-partition behavior alive. The all-size and serial suites provide timing and completeness controls without preserving production code that no required job exercises.

**Use the 64-core pool for the complete primary aggregate.** Its sampled active time was three seconds lower than the 96-core result because hosted setup was nine seconds faster, but its repository gates were 5.72 seconds slower. The benchmark suite retains both pools because a sustained image or pricing change can reverse the comparison.

**Keep build behind typecheck.** This orders independent compiler invocations and turns snapshot replay into a three-stage critical chain. Build output has its own success dependency, so only snapshot and publication consumers wait for it.

**Make larger-runner pools the required default.** This offers lower measured latency when allocation works, but a missing entitlement or delayed organization transfer leaves required jobs queued without repository diagnostics. The portable path accepts longer runtime, and manual suites preserve the performance experiment.

**Keep required and observational Windows checks in separate jobs.** The split preserves status semantics at the workflow level but pays setup twice. `run-gates` preserves the same required versus non-blocking distinction inside one process.

**Install Bubblewrap through the system package manager.** This uses the host's package database and can dominate the job even when the payload is tiny. Pinned extraction plus a confinement probe preserves the runtime contract without mutating the hosted image.

## Consequences

The benchmark topology pays one setup wave per measured aggregate and retains no shard selectors. It runs paid larger-runner executions only when manually dispatched instead of charging every pull request.

GitHub rounds each larger-runner execution up to a whole minute, so whole-aggregate measurement exposes both billed time and workflow complexity without making that cost part of branch protection.

Performance targets are observations, not cancellation deadlines or correctness requirements. Manual all-size and serial suites remain available when image, dependency, scheduler, or pricing changes need remeasurement.

Missing or renamed organization-owned labels leave only manual benchmark jobs queued. All twelve pools remain defined so the benchmark can compare sizes after allocation recovers, while required CI follows the standard-runner fallback.
