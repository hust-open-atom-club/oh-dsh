# Agent Note: Evidence-based larger hosted runners

Status: implemented

English | [中文](2026-07-22-evidence-based-larger-hosted-runners.zh.md)

## Problem

The shard-heavy CI topology met its latency targets by spreading primary Node work across 40 Linux jobs and Windows work across nine jobs. Most gates were shorter than checkout, runner setup, cache restore, and dependency installation, so repeated setup waves created both cost and latency variance. One hosted run finished its slowest Linux job in 49 seconds yet took 231 seconds for a Windows lint shard whose checkout, cache restore, and install alone consumed 158 seconds.

Larger runners make it possible to pay setup once and parallelize inside the repository scheduler, but the useful size cannot be selected from core counts alone. Critical-lane benchmarks did not scale monotonically, and a whole-repository aggregate exposed different bottlenecks from isolated typecheck or site builds.

## Decision

The organization keeps twelve x64 larger-runner pools in the repo-restricted `dsh-larger-ci` group: Ubuntu 24.04 and Windows 2025 at 4, 8, 16, 32, 64, and 96 cores. Public IPs are disabled. Each pool has an autoscaling ceiling of 256; the ceiling does not allocate idle machines or remove the need to bound workflow demand.

Production CI uses three larger-runner jobs and keeps Node compatibility, Python, and the final aggregator on standard runners:

- `node 24 / complete` uses the 96-core Linux pool. One checkout, setup, cache restore, and install feeds the complete unsharded 40-gate primary inventory. `run-gates` starts up to 32 independent gates, ESLint uses 32 workers, snapshots use up to 32 subprocesses, and coverage uses 16 forks. Build starts beside typecheck; snapshot and artifact consumers still wait for emitted output. Coverage stays below 32 forks because that setting twice caused Node 24's CJS lexer to terminate a Vitest worker and invalidate coverage.
- `windows / blocking builds` uses the 16-core Windows pool. Build and the production VitePress site run concurrently after one setup.
- `windows node 24 / observational` uses the 32-core Windows pool. Its complete unsharded 37-gate static, lint, and artifact inventory runs with 32 outer scheduler slots and remains non-blocking. ESLint itself stays single-threaded because 16 ESLint worker threads increased full-lint time to 174.54 seconds; with outer concurrency and no ESLint workers, the same full lint took 31.67 seconds.

The two Windows jobs deliberately use different pools. A first candidate put both on the 16-core pool and GitHub took 93 seconds to provision the second same-label runner despite the configured autoscaling ceiling. Using the 16-core and 32-core pools let every production job begin within two seconds in the final validation run.

The workflow retains four manual diagnostics. `suite=larger-runner-benchmark` compares isolated critical lanes across every size, `suite=consolidated-runner-benchmark` compares whole aggregates, `suite=sharded-reference` preserves the former production shard topology, and `suite=serial-reference` remains the unsharded cross-platform completeness oracle. `suite=optimized-larger-runners` runs the exact production topology against a branch ref when a pull request cannot form a merge commit.

The first [twelve-size critical-lane benchmark](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29895295659) used a workflow-only commit on top of the standard-runner [baseline](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29850033610), so the code, lockfile, and commands were identical:

| Critical job | Standard | 4 cores | 8 cores | 16 cores | 32 cores | 64 cores | 96 cores |
|---|---:|---:|---:|---:|---:|---:|---:|
| Linux typecheck | 56 s | 38 s | 35 s | 40 s | 35 s | 44 s | 40 s |
| Windows production site | 160 s | 117 s | 103 s | 113 s | 75 s | 105 s | 108 s |

Those isolated results showed that setup dominated but did not identify the production size. A [whole-aggregate benchmark without native ESLint concurrency](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29897826082) found a 69-second single-threaded Linux lint gate. After enabling native Linux ESLint concurrency, the [second whole-aggregate benchmark](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29898331705) produced these active job times:

| Aggregate job | 4 cores | 8 cores | 16 cores | 32 cores | 64 cores | 96 cores |
|---|---:|---:|---:|---:|---:|---:|
| Linux complete primary | 147 s | 104 s | 95 s | failed at 57 s | 66 s | 60 s |
| Windows blocking builds | 137 s | 127 s | 113 s | 107 s | 105 s | 131 s |

The Linux 32-core failure was the first CJS-lexer worker crash. The 96-core aggregate was the only successful all-size result at the one-minute boundary. Windows gained little above 16 cores, so the blocking job uses 16 cores; the observational job uses a separate 32-core pool to avoid same-label provisioning delay and to start all outer gates together.

The exact production [validation run](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29899733584) passed every job at the tested branch head:

| Production job | Active time | Repository work | Result |
|---|---:|---:|---:|
| Linux complete primary | 50 s | 40 gates in 23.23 s | passed |
| Slowest standard non-Windows job | 40 s | Node 26 compatibility | passed |
| Windows blocking builds | 91 s | 2 gates in 28.69 s | passed |
| Windows observational | 153 s | 37 gates in 31.83 s | passed |

The Windows observational job spent 57 seconds restoring its pnpm cache, so its remaining margin measures hosted setup variance as well as repository work. The final run still stays below one minute for every non-Windows job and below three minutes for both Windows jobs.

## Alternatives considered

**Keep the former shard topology in production.** The shards can be fast when provisioned together, but 49 larger-runner jobs repeat setup and create more chances for a cold outlier. The 231-second Windows control demonstrated that a short lint shard does not protect the end-to-end job target.

**Select a production size from the critical-lane benchmark.** Four cores looked cost-effective for isolated typecheck and site builds, but the full aggregate found repository-wide lint and dependent artifact work that those commands did not represent.

**Prebuild before starting the Linux aggregate.** This moved build onto the setup path and produced a 66-second candidate. Starting build eagerly inside `run-gates` preserves artifact dependencies while overlapping it with unrelated checks; the final aggregate completed in 23.23 seconds.

**Use native ESLint worker concurrency on Windows.** Sixteen workers made lint more than five times slower than the final single-threaded result. Outer gate parallelism uses the 32-core runner without multiplying ESLint's Windows worker startup and TypeScript project loading.

**Move compatibility, Python, and aggregation to larger runners.** These standard-runner jobs all completed in 40 seconds or less. Paid capacity would not shorten the critical path.

## Consequences

The final production validation consumed one billed 96-core Linux minute, two billed 16-core Windows minutes, and three billed 32-core Windows minutes. At the configured larger-runner rates, its larger-runner cost was $0.902. The all-size critical benchmark cost $2.936. GitHub rounds each larger-runner job up to a whole minute, so reducing paid job count from 49 to three matters as much as shortening repository work.

The existing zero-dollar Actions budget did not block larger-runner jobs. The repo-only runner group, bounded workflow topology, manual benchmark triggers, and job timeouts are the observed cost controls; the budget is not treated as an execution guard.

Production CI depends on the organization-owned runner names in this note and in `.github/workflows/ci.yml`. Missing or renamed pools leave jobs queued instead of falling back to standard capacity. Manual all-size and former-shard suites remain available so image, dependency, scheduler, or pricing changes can be remeasured before changing production labels.
