# Agent Note: Parallel pre-push gates

Status: implemented

[Local primary CI before push](2026-07-23-local-primary-ci-before-push.md) now owns the local-hook contract: pre-push selects the same primary inventory as CI. The bounded gate scheduler and package-level `publint` parallelism remain in force for CI, `doc-sync`, and explicit local commands.

## Problem

Aggregate jobs such as documentation synchronization hide long sequential chains whose members are read-only and independent. Duplicating their leaf inventory in workflow YAML gives future script changes multiple places to drift, while running package publication checks serially makes one gate consume time proportional to the package count.

## Decision

[scripts/run-gates.ts](../../../../scripts/run-gates.ts) owns the bounded scheduler used by CI, `doc-sync`, and the opt-in `check:all` command. It expands named modes into leaf gates, respects artifact dependencies, buffers attributable output, and accepts `DSH_GATE_CONCURRENCY` when a caller needs a different worker bound.

[scripts/publint-all.ts](../../../../scripts/publint-all.ts) discovers packages from `packages/<group>/<pkg>` and runs `publint` with a worker pool sized from `availableParallelism()`. `DSH_PUBLINT_CONCURRENCY` can cap or raise the worker count for local machines and CI runners with different resource profiles. Results are buffered per package and printed in deterministic package order, so parallel execution does not scramble each package's log block.

The per-gate package scripts remain the vocabulary for ad hoc local runs. `hygiene` stays an aggregate `&&` chain, while `doc-sync` owns its member list in the scheduler ([doc-sync through the gate scheduler](2026-07-21-doc-sync-through-gate-scheduler.md)).

## Alternatives considered

- **Keep aggregate jobs serial** — simpler execution but makes wall clock equal the sum of independent checks and repeats command-wrapper startup.
- **Declare one CI job per leaf gate** — exposes maximum workflow parallelism but repeats checkout, setup, and install overhead and duplicates the scheduler inventory in YAML.
- **Background subcommands inside shell scripts** — parallelizes work but loses per-gate timing, deterministic failure grouping, and straightforward signal handling.
- **Declare one `publint` job per package** — exposes maximum package parallelism but creates a hand-maintained package inventory that drifts when packages change.
- **Run `publint` with unbounded concurrency** — minimizes elapsed time on small repositories only by gambling with process count, memory pressure, package tarball creation, and readable logs.

## Consequences

Scheduler-backed commands take the slowest dependency chain instead of the sum of independent gates and report the gate that dominates. The cost is a custom scheduler with an explicit mode inventory.

`publint-all.ts` is asynchronous and buffers command output instead of inheriting stdio live. The payoff is package-level parallelism with stable output order and one environment variable for resource tuning.
