# Agent Note: Evidence-based larger hosted runners

Status: implemented

English | [中文](2026-07-22-evidence-based-larger-hosted-runners.zh.md)

## Problem

The shard-heavy CI topology met its latency targets by spreading primary Node work across 40 Linux jobs and Windows work across nine jobs. Most gates were shorter than checkout, runner setup, cache restore, and dependency installation, so repeated setup waves created both cost and latency variance. One hosted run finished its slowest Linux job in 49 seconds yet took 231 seconds for a Windows lint shard whose checkout, cache restore, and install alone consumed 158 seconds.

Larger runners make it possible to pay setup once and parallelize inside the repository scheduler, but the useful size cannot be selected from core counts alone. Critical-lane benchmarks did not scale monotonically, and a whole-repository aggregate exposed different bottlenecks from isolated typecheck or site builds.

## Decision

The organization keeps twelve x64 larger-runner pools in the repo-restricted `dsh-larger-ci` group: Ubuntu 24.04 and Windows 2025 at 4, 8, 16, 32, 64, and 96 cores. Public IPs are disabled. Each pool has an autoscaling ceiling of 256; the ceiling does not allocate idle machines or remove the need to bound workflow demand.

Production CI uses five larger-runner executions and one standard-runner aggregator. The primary Node inventory is not sharded:

- `node 24 / complete` uses one 96-core Linux runner. One checkout, direct selection of the image's preinstalled Node 24 toolcache, pnpm- and ESLint-cache restore, and install feeds all 42 primary gates. `run-gates` starts up to 10 independent gates; ESLint and coverage use at most 16 workers, and snapshot replay uses at most 8. Build starts as soon as the first short gates release scheduler slots, while snapshot replay and publication consumers retain explicit dependencies on emitted `lib/` output. Pull requests restore both caches without saving them, so cache compression and upload do not extend the required job; the master serial reference refreshes those caches outside the pull-request critical path. An uncached exact-head trace put ESLint at 38.11 seconds and coverage at 37.10 seconds, so the small ESLint restore remains useful on the critical path. The read-only job does not persist checkout credentials.
- Node 22.19 and Node 26 use the 4- and 32-core Linux pools for their runtime compatibility smokes. Python 3.10 uses the 8-core Linux pool for the complete keyless SDK suite. These are environment contracts, not slices of the primary Node gate inventory.
- `windows node 24 / complete` uses one 32-core Windows runner. One preparation wave feeds the required package build, required production site build, and complete observational portability inventory. Required failures fail the job; observational failures are reported as non-blocking. ESLint stays single-threaded because 16 ESLint workers took 174.54 seconds, coverage uses at most 12 workers, and the outer scheduler retains 16 slots. The job restores only the small master-refreshed ESLint cache and performs a clean pnpm install instead of restoring or saving the many-file package store. All six Windows larger-runner sizes completed install and the production-site benchmark without mutating the machine-wide Developer Mode registry key, so the pull-request critical path omits that redundant step.

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

The larger client package graph makes cache mechanics and scheduler pressure part of the measured workload. In [one exact-head production run](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29912577681), Linux spent 39 seconds in repository gates but 69 seconds in the complete job, while Windows spent 117 seconds in repository gates and 228 seconds in the complete job. The Windows pnpm cache downloaded its 154 MB archive in about two seconds but spent 27 seconds extracting it, followed by a 23-second install and a 14-second post-job save. A [cacheless all-size trace](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29913033155) completed the same 32-core Windows install in 27 seconds. Production therefore avoids the Windows package-store cache, uses restore-only caches on latency-critical pull-request jobs, and bounds outer concurrency so typecheck, lint, coverage, and build do not oversubscribe one host.

Three host effects remain part of the decision. A standard Node 26 job once spent 36 of its 67 seconds in `Set up job`, which is why environment contracts use distinct larger-runner pools instead of standard capacity. The setup-node action later spent 3.68 seconds printing cached Linux environment details and 46.56 seconds doing the same on Windows after both had already found Node 24.18.0 in the hosted toolcache. The two latency-critical jobs select the newest preinstalled 24.x directory directly, verify its major, and fail loud if the image no longer carries it; compatibility jobs retain setup-node because selecting a non-default runtime is their contract. A Linux candidate also spent 18 seconds registering a 50 KB Bubblewrap package because the hosted image scanned 202,507 package-database files. [`scripts/prepare-ci-bubblewrap.sh`](../../../../scripts/prepare-ci-bubblewrap.sh) instead verifies and extracts the pinned payload into the ephemeral runner directory, runs a functional confinement probe, and overlaps that preparation with dependency installation.

Inner and outer worker limits are separate controls. An [exact-head 32-worker ESLint experiment](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29918329463) slowed lint to 52.28 seconds and coverage to 42.71 seconds, where an adapter idle-timeout test failed. A later 8-gate trace reduced coverage to 35.17 seconds but delayed the production-site build until the aggregate reached 41.06 seconds. Production therefore retains 16 ESLint workers and admits 10 independent repository gates at once, leaving capacity for the worker pools owned by those gates without starving later independent work.

Linux coverage caps each project at 16 workers, while Windows keeps the 12-worker cap. The process-bound project contains exactly five suite files, so its fork count cannot reach either cap. Thirty-two forks crashed Node 24's CJS lexer twice, and a later 16-fork run reproduced the worker loss and invalid coverage result. The single Vitest invocation therefore uses threads for the broad inventory and reserves forks for suites that exercise process-global state, `process` APIs, or timing-sensitive process I/O. That narrow fork inventory includes the local bash process-plumbing suite: under aggregate gate contention its thread worker completed every test but intermittently missed the stdin-error callback needed for per-file function coverage. It also includes the pi-ai adapter suite after two hosted aggregate runs delayed an idle-watchdog socket-close observation past its 100-millisecond test deadline. A 32-worker all-gate run on the 96-core host slowed coverage to 44.6 seconds and made a compute-budget regression cross its one-second threshold, so production stops at 16. This preserves the suites' isolation contracts and deterministic coverage while avoiding forked execution for ordinary test files.

The workflow retains two manual measurement suites. `suite=larger-runner-benchmark` compares isolated critical lanes across every size, and `suite=consolidated-runner-benchmark` compares whole aggregates. Complete serial Linux, macOS, and Windows references run only when `master` moves; pull requests run only the optimized jobs.

## Alternatives considered

**Keep the three coarse primary Linux lanes.** The core, CPU, and production-site jobs met the latency targets, but they paid three setup waves and left primary Node work sharded after larger runners were available. The all-size trace showed that one unnecessary dependency, not a lack of host capacity, kept the single-box aggregate above one minute.

**Keep the former gate-level shard topology as a manual reference.** A dormant second topology kept hundreds of workflow lines, selector modules, and scenario-partition behavior alive. The all-size and serial suites provide timing and completeness controls without preserving production code that no required job exercises.

**Use the 64-core pool for the complete primary aggregate.** Its sampled active time was three seconds lower than the 96-core result because hosted setup was nine seconds faster, but its repository gates were 5.72 seconds slower. Production uses 96 cores for the shorter controllable critical path; the benchmark suite retains both pools so a sustained image or pricing change can reverse that choice with evidence.

**Keep build behind typecheck.** This orders independent compiler invocations and turns snapshot replay into a three-stage critical chain. Build output has its own success dependency, so only snapshot and publication consumers wait for it.

**Keep compatibility and Python on standard runners.** Warm standard runs can fit, but runner setup alone has crossed the non-Windows target. Distinct larger pools isolate these environment contracts from that allocation lottery.

**Keep required and observational Windows checks in separate jobs.** The split preserves status semantics at the workflow level but pays setup twice. `run-gates` preserves the same required versus non-blocking distinction inside one process.

**Install Bubblewrap through the system package manager.** This uses the host's package database and can dominate the job even when the payload is tiny. Pinned extraction plus a confinement probe preserves the runtime contract without mutating the hosted image.

## Consequences

Primary Node CI has one job, one setup wave, one complete gate inventory, and no shard selectors. Together with two Node compatibility executions, Python, and Windows, production has five paid larger-runner executions instead of seven coarse-lane executions or 49 gate-level executions.

GitHub rounds each larger-runner execution up to a whole minute, so eliminating setup waves reduces billed time as well as workflow complexity. The final aggregator remains on a standard runner because it begins only after the paid jobs release capacity.

The current targets are observed performance contracts, not cancellation deadlines. Exact-head production runs must show every non-Windows job below one minute and the consolidated Windows job below three minutes; manual all-size and serial suites remain available when image, dependency, scheduler, or pricing changes need remeasurement.

Production CI depends on the organization-owned runner labels in [`.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml). Missing or renamed pools leave jobs queued instead of falling back to standard capacity. All twelve pools remain provisioned so the manual benchmarks can re-evaluate the production size without an administrative setup cycle.
