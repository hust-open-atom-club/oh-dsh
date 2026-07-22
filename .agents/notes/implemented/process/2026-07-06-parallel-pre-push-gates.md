# Agent Note: Parallel pre-push gates

Status: implemented

## Problem

The pre-push hook is the last local checkpoint before a branch leaves the machine, so its wall clock directly shapes whether contributors keep it enabled and trust its signal. Lefthook already runs top-level jobs in parallel, but aggregate jobs such as `pnpm run hygiene` and `pnpm run doc-sync` hide long sequential chains inside one job. The hook can therefore be configured as parallel while still waiting on serial subcommands whose members are independent.

Flattening those members directly into `lefthook.yml` solves the local hook only. CI has the same scheduling problem, and duplicating a long leaf list in YAML gives future script changes two places to drift.

`publint` has the same shape one level lower. Each package is linted independently against its own manifest and built output, but invoking the CLI separately also asks the package manager to compute the same manifest-bounded publication view once per package. On this repo process and packing overhead dominate the publication checks.

## Decision

[lefthook.yml](../../../../lefthook.yml) keeps one pre-push job named `full check` and runs `pnpm run check:pre-push`. That package script delegates to [scripts/run-gates.ts](../../../../scripts/run-gates.ts), the same bounded scheduler CI uses.

The `pre-push` mode expands into leaf gates for the unit suite, snapshot suite, build, `hygiene` members, `doc-sync` members, and module-graph freshness. The leaf list keeps the same gate vocabulary as the package scripts, including Agent Note classification and Agent Note format, while the runner schedules independent checks with four active top-level workers by default; `DSH_GATE_CONCURRENCY` overrides that bound.

The build gate makes the hook self-contained from a clean worktree. `publint`, `verify-node-next-types`, and the pre-push form of `doc-typecheck` wait for that build output, while source-only gates continue in parallel.

[scripts/publint-all.ts](../../../../scripts/publint-all.ts) discovers the package list from `packages/<group>/<pkg>` and calls publint's supported API against an in-memory view of each manifest's declared publication files plus npm's mandatory metadata files. That keeps unpublished workspace files invisible to publint without a package-manager subprocess per package. A worker pool sized from `availableParallelism()` bounds parallel file loading and linting; `DSH_PUBLINT_CONCURRENCY` can cap or raise it, and results print in deterministic package order.

The per-gate package scripts remain the vocabulary for ad hoc local runs. `hygiene` stays an aggregate `&&` chain the scheduler mirrors, while `doc-sync` has since moved its member list into the scheduler itself ([doc-sync through the gate scheduler](2026-07-21-doc-sync-through-gate-scheduler.md)).

## Alternatives considered

- **Keep aggregate `hygiene` and `doc-sync` jobs in the hook** - simpler config, but it leaves most of the pre-push wall clock inside serial command chains that lefthook cannot see or schedule.
- **Declare one lefthook job per leaf gate** - exposes parallelism through lefthook's native job model, but it makes the hook file carry a long member list that CI cannot reuse.
- **Require developers to build before pushing** - avoids one hook gate, but it makes `publint` fail in a clean worktree and turns the final local checkpoint into a convention instead of a runnable check.
- **Background subcommands inside shell scripts** - can parallelize work, but it loses lefthook's job names, per-job timing, and failure grouping, and makes signal handling harder to reason about.
- **Declare one publint lefthook job per package** - exposes maximum parallelism, but it turns the hook into a hand-maintained package inventory that drifts exactly when new packages are added.
- **Run publint with unbounded concurrency** - minimizes elapsed time on small machines only by gambling with file descriptors, memory pressure, and readable logs.

## Consequences

The hook's critical path becomes the slowest real gate instead of the sum of hidden gate chains. Lefthook reports one `full check` job, and the runner reports per-gate timing inside that job, so a slow local checkpoint still points at the gate that dominates the run.

The hook file stays short, and the duplicated member list lives in [scripts/run-gates.ts](../../../../scripts/run-gates.ts), where CI and pre-push can share it. The cost is a custom scheduler script instead of pure lefthook configuration, plus a build in the local pre-push path.

`publint-all.ts` becomes asynchronous code and formats API results after each package completes. The payoff is package-level parallelism with stable output order, one environment variable for resource tuning, and no repeated package-manager packing.
