# Agent Note: dsh-hook-protocol — the shared Claude Code / Codex hook wire-protocol core

Status: implemented

## Problem

The hooks subsystem ships two bridge plugins: one that runs a user's existing Claude Code (CC) hooks, one for Codex hooks. Studying the reference implementations (`~/repos/refs/claude-code`, `~/repos/refs/codex`) surfaced a decisive fact: **Codex deliberately reimplements a SUBSET of the CC hook protocol.** Its engine reads the same `hooks.json`, uses the same matcher-group shape, the same exit-code/structured-stdout output contract, and the same command-hook execution model — Codex's source even names the engine after Claude's and comments where it "intentionally diverges." So the two bridges would otherwise duplicate the bulk of the protocol.

This Agent Note introduces `@deepseek-ai/dsh-hook-protocol`, a **library** (not a plugin — it registers and injects nothing) holding the genuinely-identical primitives both bridges build on. The split between shared and per-dialect is the design's center of gravity.

## Decision

A new `packages/hooks/` group with `hook-protocol` as a pure library. It owns four primitive families and the `hook/*` session events; each bridge plugin (`dsh-hooks-claude`, `dsh-hooks-codex`) owns what genuinely differs.

**Shared (here):**
- **Matcher** — `matchesMatcher(pattern, query, mode)`. The ONE axis the dialects differ on is collapsed to the `mode` parameter: `claude` treats a pure `[A-Za-z0-9_|]+` pattern as a literal (pipe = exact-match alternation) and anything else as a regex; `codex` is always an unanchored regex. Match-all on absent/`''`/`'*'`; an invalid regex matches nothing (never throws into the loop).
- **Execution** — `runHook(bash, hook, options)`. Runs a command hook through the `ctx.bash` seam rather than a bespoke `spawn`: the executor already provides the scrubbed-but-overridable env, process-group kills, and timeout the protocol needs, and `dsh-bash`'s `stdin`/`env` fields (added for exactly this) are the trusted-plugin surface an in-process bridge is allowed to use. It serializes the bridge-built payload to stdin (trailing newline iff CC), honors the hook's `timeoutSec` (else `DEFAULT_HOOK_TIMEOUT_MS`, the 10-minute reference default both dialects share), and never throws (an executor rejection becomes a non-blocking-error `HookOutput`).
- **Decode** — `parseHookOutput(exit, stdout, stderr)`, the exit-code + structured-stdout codec, producing a dialect-neutral `HookOutput`. Exit `0` → lenient JSON parse of stdout; exit `2` → blocking error with `stderr` as the reason (surfaced as `decision: 'block'` so no caller needs a separate exit-code branch); other → non-blocking error. Parses the CC structured-stdout fields that have a consumer on some path (`continue`/`stopReason`/`decision`/`hookSpecificOutput.{permissionDecision,additionalContext,updatedInput}`/`systemMessage`); the bridge honors only the subset meaningful for its dialect. Fields with no consumer on any path are not parsed at all (CC's `suppressOutput` — hook stdout never enters a transcript here, so there is nothing to suppress; see [the tighten-hook-protocol-contract Agent Note](../simplification/2026-07-04-tighten-hook-protocol-contract.md)).
- **Merge** — `mergeHookOutputs(outputs)`, folding multiple matched hooks into one most-restrictive `MergedHookOutcome`: permission precedence **deny > ask > allow**, halt sticky on the first `continue:false`, block reasons joined `\n\n`, context/system-messages accumulated in order.
- **`hook/*` session events** — `hook/invoked` / `hook/result`, declaration-merged into `SessionEventMap` (log-only, like `compact/*` — NOT `SurfaceEventType`s), with `appendHookInvoked`/`appendHookResult` helpers so the invoked/result pairing and turn-enclosure stay consistent across bridges. `appendHookResult` also owns the durable record's semantics — the decision string (the hook's parsed decision, else `'stop'` on `continue:false`, else `'pass'`) and the 500-character `stderrSummary` truncation derive from the `HookOutput` here, not per-bridge.

**Per-dialect (the bridge plugins):** building each event's stdin payload (CC's base+per-event field sets vs Codex's snake_case with `turn_id`/`model` extras), the dialect's env + `${CLAUDE_PLUGIN_ROOT}` substitution (CC) vs none (Codex), and mapping the neutral `HookOutput`/`MergedHookOutcome` onto the harness's seam-specific typed Decisions (`PreToolDecision`, `PromptDecision`, `ContinuationDecision`, `PostToolDecision`).

## Alternatives considered

**One parameterized engine.** Rejected because payload construction and decision mapping genuinely differ by dialect. Matchers, codecs, execution, merge rules, and events remain shared; each bridge keeps its payload and mapping explicit so its wire behavior is readable in place.

## Consequences

Each bridge parses config, builds its dialect payload, invokes the shared runner and merge logic, maps the decision, and appends `hook/*`. Protocol tests cover every matcher mode, exit-code and codec field, runner plumbing, merge precedence, and audit helper at per-file 100%; bridge tests exercise the library's real load path. `updatedInput` is parsed but only logged and warned until the [input-rewrite proposal](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md) lands.
