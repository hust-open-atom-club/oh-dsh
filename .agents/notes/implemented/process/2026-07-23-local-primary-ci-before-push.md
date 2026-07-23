# Agent Note: Local primary CI before push

Status: implemented

English | [中文](2026-07-23-local-primary-ci-before-push.zh.md)

## Problem

Hosted CI can become unavailable before repository code executes because of account, billing, quota, or runner failures. A typecheck-only publication hook then permits a remote branch update without coverage, snapshot, documentation, build, package, or built-entrypoint evidence precisely when the hosted workflow cannot supply that signal.

Focused checks remain the right feedback loop during implementation, but their selection depends on the author correctly predicting every affected contract. Publication needs one complete, mechanically owned local baseline that does not depend on the hosted control plane starting a job.

## Decision

[lefthook.yml](../../../../lefthook.yml) keeps pre-commit focused on staged lint, whitespace, and vendored-source metadata. Pre-push invokes `pnpm run check:pre-push` and blocks publication on any failure.

The `check:pre-push` package script selects the `pre-push` mode in [scripts/run-gates.ts](../../../../scripts/run-gates.ts). Both `pre-push` and `ci-primary` return the same `ciPrimaryGates()` inventory, so the hook and the primary Node CI job cannot drift through separately maintained command lists. Build consumers retain their explicit scheduler dependencies, and `DSH_GATE_CONCURRENCY` remains the resource-control seam for constrained hosts.

Authors still run focused checks while iterating. They do not run the full aggregate immediately before a normal push because the hook owns that one exhaustive local execution. A hook failure is fixed or reported as a blocker; bypass requires explicit approval.

This contract is equivalent to the keyless primary Node CI aggregate on the current host. It does not claim the supported-version or operating-system matrix, Python SDK, real-provider, native, or sandbox workflow signals that require their own environments.

## Supersedes

This decision supersedes the pre-push half of [Fast local Git hooks](2026-07-22-fast-local-git-hooks.md). Its staged pre-commit design remains in force. It also restores the local publication role described by [Parallel pre-push gates](2026-07-06-parallel-pre-push-gates.md) without reviving a second gate inventory.

## Alternatives considered

- **Rely on restoring hosted CI availability** — repairs the immediate administrative failure but leaves publication without a baseline during the next control-plane or runner outage.
- **Wire pre-push to `check:all`** — reuses a broad local command, but that inventory intentionally differs from the primary CI contract and would make “CI equivalent” inaccurate.
- **Copy the CI commands into `lefthook.yml`** — makes the hook visibly comprehensive but creates a second inventory that can drift whenever CI changes.
- **Keep typecheck-only pre-push and require a manual command during outages** — preserves low latency but relies on every author noticing the outage and remembering an exceptional procedure before each update.

## Consequences

Every normal push pays the primary CI aggregate's wall time and may be blocked by a repository-wide local failure unrelated to the outgoing diff. In return, every published revision has observed coverage, snapshots, documentation, build, package, and built-entrypoint evidence from one shared inventory even when hosted jobs never start.

The result is local evidence, not a substitute for unavailable remote environments. Pull requests and handoffs report hosted billing, provider, platform, and pending states separately instead of presenting a successful macOS pre-push run as a green GitHub matrix.
