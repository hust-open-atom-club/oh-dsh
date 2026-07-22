# Agent Note: Evidence-based larger hosted runners

Status: implemented

English | [中文](2026-07-22-evidence-based-larger-hosted-runners.zh.md)

## Problem

The shard-heavy CI topology met its latency targets by spreading primary Node work across 40 Linux jobs and Windows work across nine jobs. Most gates were shorter than checkout, runner setup, cache restore, and dependency installation, so repeated setup waves created both cost and latency variance. One hosted run finished its slowest Linux job in 49 seconds yet took 231 seconds for a Windows lint shard whose checkout, cache restore, and install alone consumed 158 seconds.

Larger runners make it possible to pay setup once and parallelize inside the repository scheduler, but the useful size cannot be selected from core counts alone. Critical-lane benchmarks did not scale monotonically, and a whole-repository aggregate exposed different bottlenecks from isolated typecheck or site builds.

## Decision

The organization keeps twelve x64 larger-runner pools in the repo-restricted `dsh-larger-ci` group: Ubuntu 24.04 and Windows 2025 at 4, 8, 16, 32, 64, and 96 cores. Public IPs are disabled. Each pool has an autoscaling ceiling of 256; the ceiling does not allocate idle machines or remove the need to bound workflow demand.

Production CI uses three coarse larger-runner jobs and keeps Node compatibility, Python, and the final aggregator on standard runners:

- `node 24 / core` uses the 96-core Linux pool. One checkout, setup, cache restore, and install feeds the unsharded 39-gate primary inventory other than the production site build. `run-gates` starts up to 32 independent gates, ESLint uses 32 workers, snapshots use up to 32 subprocesses, and coverage uses 16 forks. Build starts beside typecheck; snapshot and artifact consumers still wait for emitted output. Coverage stays below 32 forks because that setting twice caused Node 24's CJS lexer to terminate a Vitest worker and invalidate coverage.
- `node 24 / production site` uses the 16-core Linux pool for the longest independent primary gate. This is one coarse split, not a shard matrix: the job performs one setup and one production VitePress build.
- `windows node 24 / complete` uses the 32-core Windows pool. One setup feeds the required package build, the required production site build, and the complete observational portability inventory. The outer scheduler has 32 slots. Required failures fail the job; observational failures are printed as non-blocking and preserve their former advisory status. ESLint itself stays single-threaded because 16 ESLint worker threads increased full-lint time to 174.54 seconds; outer gate concurrency uses the runner without multiplying Windows worker startup and TypeScript project loading.

The final shape followed two cold-path observations. A first candidate used two 16-core Windows jobs, and GitHub took 93 seconds to provision the second same-label runner despite the configured autoscaling ceiling. A later [documentation-head validation](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29900502413) took 64 seconds on the combined Linux job because its production site gate lasted 29.05 seconds, while a separate Windows blocking job took 266 seconds after spending 138 seconds restoring a 153 MB pnpm cache. Moving that independent Linux gate to one coarse 16-core lane and combining all Windows work on one 32-core box removed both duplicate setup waves.

The workflow retains four manual diagnostics. `suite=larger-runner-benchmark` compares isolated critical lanes across every size, `suite=consolidated-runner-benchmark` compares whole aggregates, `suite=sharded-reference` preserves the former production shard topology, and `suite=serial-reference` remains the unsharded cross-platform completeness oracle. `suite=optimized-larger-runners` runs the exact production topology against a branch ref when a pull request cannot form a merge commit.

The first [twelve-size critical-lane benchmark](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29895295659) used a workflow-only commit on top of the standard-runner [baseline](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29850033610), so the code, lockfile, and commands were identical:

| Critical job | Standard | 4 cores | 8 cores | 16 cores | 32 cores | 64 cores | 96 cores |
|---|---:|---:|---:|---:|---:|---:|---:|
| Linux typecheck | 56 s | 38 s | 35 s | 40 s | 35 s | 44 s | 40 s |
| Windows production site | 160 s | 117 s | 103 s | 113 s | 75 s | 105 s | 108 s |

Those isolated results showed that setup dominated but did not identify the production size. A [whole-aggregate benchmark without native ESLint concurrency](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29897826082) found a 69-second single-threaded Linux lint gate. After enabling native Linux ESLint concurrency, the [second whole-aggregate benchmark](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29898331705) produced these active job times:

| Job | 4 cores | 8 cores | 16 cores | 32 cores | 64 cores | 96 cores |
|---|---:|---:|---:|---:|---:|---:|
| Linux complete primary | 147 s | 104 s | 95 s | failed at 57 s | 66 s | 60 s |
| Windows blocking builds | 137 s | 127 s | 113 s | 107 s | 105 s | 131 s |

The Linux 32-core failure was the first CJS-lexer worker crash. The 96-core aggregate was the only successful all-size result at the one-minute boundary. Although Windows repository work gained little above 16 cores, the 32-core pool can start the complete outer inventory together and, more importantly, removes an entire paid setup from production.

The exact [reduced-fanout validation run](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29901539360) passed every job at the tested branch head:

| Production job | Active time | Repository work | Result |
|---|---:|---:|---:|
| Linux core | 52 s | 39 gates in 25.84 s | passed |
| Linux production site | 44 s | VitePress in 22.42 s | passed |
| Slowest standard non-Windows job | 43 s | Node 26 compatibility | passed |
| Windows complete | 96 s | 37 gates in 31.13 s | passed |

All three paid jobs began together. The Windows job spent 21 seconds restoring its pnpm cache and 25 seconds installing dependencies, so its margin measures hosted setup variance as well as repository work. Every non-Windows job stays below one minute and the sole Windows job stays below three minutes.

## Alternatives considered

**Keep the former shard topology in production.** The shards can be fast when provisioned together, but 49 larger-runner jobs repeat setup and create more chances for a cold outlier. The 231-second Windows control demonstrated that a short lint shard does not protect the end-to-end job target.

**Select a production size from the critical-lane benchmark.** Four cores looked cost-effective for isolated typecheck and site builds, but the full aggregate found repository-wide lint and dependent artifact work that those commands did not represent.

**Run the production site inside the Linux core aggregate.** This reached 50 seconds with warm hosted setup, then crossed the threshold at 64 seconds when the site gate took 29.05 seconds. One coarse independent site job protects the target without returning to gate-level sharding.

**Keep required and observational Windows checks in separate jobs.** The split preserved status semantics at the workflow level but paid setup twice, and a cold cache pushed the required job to 266 seconds. `run-gates` now preserves those semantics inside one process: build and production site are required, while the remaining inventory is explicitly non-blocking.

**Prebuild before starting the Linux aggregate.** This moved build onto the setup path and produced a 66-second candidate. Starting build eagerly inside `run-gates` preserves artifact dependencies while overlapping it with unrelated checks.

**Use native ESLint worker concurrency on Windows.** Sixteen workers made lint more than five times slower than the final single-threaded result. Outer gate parallelism uses the 32-core runner without multiplying ESLint's Windows worker startup and TypeScript project loading.

**Move compatibility, Python, and aggregation to larger runners.** These standard-runner jobs completed in 43 seconds or less. Paid capacity would not shorten the critical path.

## Consequences

The reduced-fanout validation consumed one billed 96-core Linux minute, one billed 16-core Linux minute, and two billed 32-core Windows minutes. At the configured larger-runner rates, its larger-runner cost was $0.618. The all-size critical benchmark cost $2.936. GitHub rounds each larger-runner job up to a whole minute, so reducing paid job count from 49 to three matters as much as shortening repository work.

The existing zero-dollar Actions budget did not block larger-runner jobs. The repo-only runner group, bounded workflow topology, manual benchmark triggers, and job timeouts are the observed cost controls; the budget is not treated as an execution guard.

Production CI depends on the organization-owned runner names in this note and in `.github/workflows/ci.yml`. Missing or renamed pools leave jobs queued instead of falling back to standard capacity. Manual all-size, consolidated, former-shard, and serial suites remain available so image, dependency, scheduler, or pricing changes can be remeasured before changing production labels.
