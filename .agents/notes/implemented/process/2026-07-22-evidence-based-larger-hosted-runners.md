# Agent Note: Evidence-based larger hosted runners

Status: implemented

English | [中文](2026-07-22-evidence-based-larger-hosted-runners.zh.md)

## Problem

The sharded primary CI fits its latency targets on standard GitHub-hosted runners, but the margin depends on cold setup and install variance. Larger runners may add useful headroom, yet their per-minute price rises much faster than these short lanes can use extra cores. Selecting a size from machine specifications or a synthetic benchmark would spend more without proving that repository CI becomes faster.

## Decision

The organization keeps twelve x64 larger-runner pools in the repo-restricted `dsh-larger-ci` group: Ubuntu 24.04 and Windows 2025 at 4, 8, 16, 32, 64, and 96 cores. Public IPs are disabled. Each pool has an autoscaling ceiling of 256, while the repository bounds actual demand through its workflow matrices; an idle ceiling does not allocate machines.

The `CI` workflow exposes `suite=larger-runner-benchmark` only through manual dispatch. Its six Linux legs run the critical typecheck lane, and its six Windows legs run the critical production-site lane. Every leg reports the observed CPU and memory, has a 15-minute timeout, and uses the same setup and caching policy as the production lane it represents. Push and pull-request events skip this benchmark.

The [twelve-size benchmark](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29895295659) used a workflow-only commit on top of the standard-runner [baseline](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29850033610), so the code, lockfile, and critical commands were identical:

| Critical job | Standard | 4 cores | 8 cores | 16 cores | 32 cores | 64 cores | 96 cores |
|---|---:|---:|---:|---:|---:|---:|---:|
| Linux typecheck | 56 s | 38 s | 35 s | 40 s | 35 s | 44 s | 40 s |
| Windows production site | 160 s | 117 s | 103 s | 113 s | 75 s | 105 s | 108 s |

The repository therefore uses the 4-core pools for the primary Node matrix and all Windows jobs. Linux 4-core finished within three seconds of the fastest measured size at the lowest larger-runner rate. Windows 4-core stayed below two minutes; the isolated 32-core result was faster, but adjacent larger sizes regressed and the production-site command itself varied only from 28 to 36 seconds, so setup and install noise—not scalable compute—created most of the spread. Node compatibility, Python, and the final aggregator remain on standard runners because their baseline jobs already finish well below one minute.

The workflow also exposes `suite=optimized-larger-runners` through manual dispatch. That path runs the production matrices against the branch ref itself, providing an exact-head timing check when a pull request cannot form a merge commit.

## Alternatives considered

**Keep every job on standard runners.** This meets the threshold but gives the critical lanes no cold-run margin and leaves the larger-runner suggestion untested.

**Select 8 or 32 cores from the fastest individual result.** The small differences were not monotonic, while billing grows sharply with size. Treating one noisy minimum as scaling evidence would make recurring CI substantially more expensive.

**Move every job to a larger runner.** Compatibility, Python, and aggregation were already short; paying the larger-runner premium there cannot improve the critical path enough to justify the dependency or cost.

**Use a synthetic CPU benchmark.** A microbenchmark would not include checkout, action startup, package installation, cache restore, or the repository command mix that dominates these jobs.

## Consequences

The benchmark incurred $2.936 across dedicated larger-runner SKUs, as recorded by organization billing immediately after the run. The existing zero-dollar Actions budget did not block those jobs, so the repo-only runner group, manual benchmark trigger, matrix width, and timeout are the observed cost controls; the budget is not treated as an execution guard.

Production CI now depends on the organization-owned runner names in this note and in `.github/workflows/ci.yml`. Missing or renamed pools leave jobs queued instead of silently falling back to standard capacity. The 256 autoscaling ceiling permits future concurrency but does not override the bounded matrices in the current workflow.

The selected pools buy latency headroom at a recurring per-job premium. The manual benchmark retains all sizes so a future image, dependency graph, or workload change can be measured before changing the production labels again.
