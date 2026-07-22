# Agent Note: Evidence-based larger hosted runners

Status: implemented

English | [中文](2026-07-22-evidence-based-larger-hosted-runners.zh.md)

## Problem

The shard-heavy CI topology met its latency targets by spreading primary Node work across 40 Linux jobs and Windows work across nine jobs. Most gates were shorter than checkout, runner setup, cache restore, and dependency installation, so repeated setup waves created both cost and latency variance. One hosted run finished its slowest Linux job in 49 seconds yet took 231 seconds for a Windows lint shard whose checkout, cache restore, and install alone consumed 158 seconds.

Larger runners make it possible to pay setup once and parallelize inside the repository scheduler, but the useful size cannot be selected from core counts alone. Critical-lane benchmarks did not scale monotonically, and a whole-repository aggregate exposed different bottlenecks from isolated typecheck or site builds.

## Decision

The organization keeps twelve x64 larger-runner pools in the repo-restricted `dsh-larger-ci` group: Ubuntu 24.04 and Windows 2025 at 4, 8, 16, 32, 64, and 96 cores. Public IPs are disabled. Each pool has an autoscaling ceiling of 256; the ceiling does not allocate idle machines or remove the need to bound workflow demand.

Production CI assigns each of the six Linux pool sizes exactly once, assigns one 32-core Windows pool, and keeps only the final aggregator on a standard runner. The version and language jobs are environment contracts rather than slices of one gate inventory; the primary Node work has three coarse lanes instead of a gate-level shard matrix:

- `node 24 / core` uses the 96-core Linux pool. One checkout, setup, cache restore, and install feeds 36 unsharded static, lint, documentation, hygiene, build, and artifact gates. `run-gates` starts up to 32 independent gates and ESLint uses 32 workers. Build starts eagerly; its artifact consumers still wait for emitted output.
- `node 24 / cpu` uses the 64-core Linux pool for six CPU- or dependency-critical gates: typecheck, coverage, build followed by snapshot replay, and two Node 24 compatibility smokes. Coverage and snapshot each use at most 16 workers. This lane builds separately so snapshot replay consumes same-lane output. Coverage stays below 32 forks because that setting twice caused Node 24's CJS lexer to terminate a Vitest worker and invalidate coverage.
- `node 24 / production site` uses the 16-core Linux pool for the longest independent primary gate. This is one coarse split, not a shard matrix: the job performs one setup and one production VitePress build.
- Node 22.19 compatibility, Python 3.10, and Node 26 compatibility use the 4-, 8-, and 32-core Linux pools respectively. Distinct labels avoid both standard-runner setup outliers and the delayed second allocation observed when two jobs shared one pool.
- `windows node 24 / complete` uses the 32-core Windows pool. One setup feeds the required package build, the required production site build, and the complete observational portability inventory. The outer scheduler has 32 slots. Required failures fail the job; observational failures are printed as non-blocking and preserve their former advisory status. ESLint itself stays single-threaded because 16 ESLint worker threads increased full-lint time to 174.54 seconds; outer gate concurrency uses the runner without multiplying Windows worker startup and TypeScript project loading.

The Windows shape followed two cold-path observations. A first candidate used two 16-core Windows jobs, and GitHub took 93 seconds to provision the second same-label runner despite the configured autoscaling ceiling. A later [documentation-head validation](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29900502413) took 266 seconds on a separate Windows blocking job after spending 138 seconds restoring a 153 MB pnpm cache. Combining all Windows work on one 32-core box removed the duplicate setup wave.

Two later runs set the Linux boundaries. A [standard-runner validation](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29902209492) took 67 seconds for Node 26 even though repository work took five seconds, because GitHub spent 36 seconds in `Set up job`. Moving the environment contracts to distinct larger pools removed that lottery. The next [all-larger-runner validation](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29902541203) took 68 seconds on the 96-core primary job: repository work remained 26 seconds, but setup, cache, install, and finalization consumed 42 seconds. Moving typecheck, coverage, and the build-to-snapshot dependency chain to one coarse 64-core lane reduced the 96-core lane's repository critical path to 14.81 seconds without returning to per-gate shards.

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

The exact [all-pool validation run](https://github.com/deepseek-harness/deepseek-harness/actions/runs/29903067274) passed every job at the tested branch head:

| Production job (pool) | Active time | Repository work | Result |
|---|---:|---:|---:|
| Node 22.19 compatibility (Linux 4) | 26 s | compatibility smokes | passed |
| Python 3.10 (Linux 8) | 22 s | complete keyless SDK suite | passed |
| Production site (Linux 16) | 39 s | VitePress in 22.57 s | passed |
| Node 26 compatibility (Linux 32) | 24 s | compatibility smokes | passed |
| Primary CPU (Linux 64) | 53 s | 6 gates in 23.70 s | passed |
| Primary core (Linux 96) | 47 s | 36 gates in 14.81 s | passed |
| Windows complete (Windows 32) | 109 s | 37 gates in 32.71 s | passed |

All seven paid jobs began in the same second. The slowest non-Windows job finished in 53 seconds. The Windows job spent 20 seconds restoring its pnpm cache and 15 seconds installing dependencies, so its 109-second active time measures hosted setup variance as well as repository work. Every non-Windows job stays below one minute and the sole Windows job stays below three minutes.

## Alternatives considered

**Keep the former shard topology in production.** The shards can be fast when provisioned together, but 49 larger-runner jobs repeat setup and create more chances for a cold outlier. The 231-second Windows control demonstrated that a short lint shard does not protect the end-to-end job target.

**Select a production size from the critical-lane benchmark.** Four cores looked cost-effective for isolated typecheck and site builds, but the full aggregate found repository-wide lint and dependent artifact work that those commands did not represent.

**Run the production site inside the Linux core aggregate.** This reached 50 seconds with warm hosted setup, then crossed the threshold at 64 seconds when the site gate took 29.05 seconds. One coarse independent site job protects the target without returning to gate-level sharding.

**Keep every primary gate on the 96-core Linux runner.** Repository work completed in 26 seconds, but a 42-second cold path still pushed the job to 68 seconds. The 64-core CPU lane owns the three longest independent or dependency-critical paths; the remaining 36-gate core inventory completes its repository work in 14.81 seconds.

**Keep required and observational Windows checks in separate jobs.** The split preserved status semantics at the workflow level but paid setup twice, and a cold cache pushed the required job to 266 seconds. `run-gates` now preserves those semantics inside one process: build and production site are required, while the remaining inventory is explicitly non-blocking.

**Prebuild before starting the Linux aggregate.** This moved build onto the setup path and produced a 66-second candidate. Starting build eagerly inside `run-gates` preserves artifact dependencies while overlapping it with unrelated checks.

**Use native ESLint worker concurrency on Windows.** Sixteen workers made lint more than five times slower than the final single-threaded result. Outer gate parallelism uses the 32-core runner without multiplying ESLint's Windows worker startup and TypeScript project loading.

**Keep compatibility and Python on standard runners.** Warm runs completed in 43 seconds or less, but one Node 26 job later spent 36 seconds in GitHub setup and crossed the target despite only five seconds of repository work. Distinct larger pools stabilize those environment contracts; the three-second final aggregator remains on a standard runner because it begins only after the paid jobs release capacity.

## Consequences

The all-pool validation consumed one billed minute at each Linux size and two billed 32-core Windows minutes. At the configured larger-runner rates, its larger-runner cost was $0.896. The all-size critical benchmark cost $2.936. GitHub rounds each larger-runner job up to a whole minute, so reducing paid job count from 49 to seven matters as much as shortening repository work.

The existing zero-dollar Actions budget did not block larger-runner jobs. The repo-only runner group, bounded workflow topology, manual benchmark triggers, and job timeouts are the observed cost controls; the budget is not treated as an execution guard.

Production CI depends on the organization-owned runner names in this note and in `.github/workflows/ci.yml`. Missing or renamed pools leave jobs queued instead of falling back to standard capacity. Manual all-size, consolidated, former-shard, and serial suites remain available so image, dependency, scheduler, or pricing changes can be remeasured before changing production labels.
