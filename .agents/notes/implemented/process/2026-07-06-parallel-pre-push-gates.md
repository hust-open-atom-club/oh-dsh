# Agent Note: Parallel pre-push gates

Status: implemented

## Problem

The pre-push hook is the last local checkpoint before a branch leaves the machine, so its wall clock directly shapes whether contributors keep it enabled and trust its signal. Lefthook already runs top-level jobs in parallel, but aggregate jobs such as `pnpm run hygiene` and `pnpm run doc-sync` hide long sequential chains inside one job. The hook can therefore be configured as parallel while still waiting on serial subcommands whose members are independent.

Flattening those members directly into `lefthook.yml` solves the local hook only. CI has the same scheduling problem, and duplicating a long leaf list in YAML gives future script changes two places to drift.

`publint` has the same shape one level lower. Each package is linted independently against its own manifest and built output, but the runner loops through every package in order. On this repo that makes one package-publication gate consume time proportional to the number of packages even though the checks do not share mutable state.

## Decision

[lefthook.yml](../../../../lefthook.yml) keeps one pre-push job named `full check` and runs `pnpm run check:pre-push`. That package script delegates to [scripts/run-gates.ts](../../../../scripts/run-gates.ts), the same bounded scheduler CI uses.

The `pre-push` mode expands into leaf gates for the unit suite, snapshot suite, build, `hygiene` members, `doc-sync` members, and module-graph freshness. The leaf list keeps the same gate vocabulary as the package scripts, including Agent Note classification and Agent Note format, while the runner schedules independent checks with four active top-level workers by default; `DSH_GATE_CONCURRENCY` overrides that bound.

The build gate makes the hook self-contained from a clean worktree. `publint`, `verify-node-next-types`, and the pre-push form of `doc-typecheck` wait for that build output, while source-only gates continue in parallel.

[scripts/publint-all.ts](../../../../scripts/publint-all.ts) discovers the package list from `packages/<group>/<pkg>` and runs `publint` with a worker pool sized from `availableParallelism()`. `DSH_PUBLINT_CONCURRENCY` can cap or raise the worker count for local machines and CI runners with different resource profiles. Results are buffered per package and printed in deterministic package order, so parallel execution does not scramble each package's log block.

The aggregate package scripts remain the source of truth for ad hoc local runs. The scheduler is a parallel execution plan over their member gates, not a replacement vocabulary.

## Alternatives considered

- **Keep aggregate `hygiene` and `doc-sync` jobs in the hook** - simpler config, but it leaves most of the pre-push wall clock inside serial command chains that lefthook cannot see or schedule.
- **Declare one lefthook job per leaf gate** - exposes parallelism through lefthook's native job model, but it makes the hook file carry a long member list that CI cannot reuse.
- **Require developers to build before pushing** - avoids one hook gate, but it makes `publint` fail in a clean worktree and turns the final local checkpoint into a convention instead of a runnable check.
- **Background subcommands inside shell scripts** - can parallelize work, but it loses lefthook's job names, per-job timing, and failure grouping, and makes signal handling harder to reason about.
- **Declare one publint lefthook job per package** - exposes maximum parallelism, but it turns the hook into a hand-maintained package inventory that drifts exactly when new packages are added.
- **Run publint with unbounded concurrency** - minimizes elapsed time on small machines only by gambling with process count, memory pressure, package tarball creation, and readable logs.

## Consequences

The hook's critical path becomes the slowest real gate instead of the sum of hidden gate chains. Lefthook reports one `full check` job, and the runner reports per-gate timing inside that job, so a slow local checkpoint still points at the gate that dominates the run.

The hook file stays short, and the duplicated member list lives in [scripts/run-gates.ts](../../../../scripts/run-gates.ts), where CI and pre-push can share it. The cost is a custom scheduler script instead of pure lefthook configuration, plus a build in the local pre-push path.

`publint-all.ts` becomes asynchronous code and buffers command output instead of inheriting stdio live. The payoff is package-level parallelism with stable output order and one environment variable for resource tuning.
