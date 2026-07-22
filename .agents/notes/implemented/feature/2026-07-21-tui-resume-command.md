# Agent Note: Resume command hint and `/resume`

Status: implemented

English | [中文](2026-07-21-tui-resume-command.zh.md)

## Problem

The TUI can resume a session by launch (`RESUME_SESSION_ID=<id> dsh` feeding `dsh-tui-demo`'s `resumeSessionId`), but nothing told the user the command. On exit the session id survived only in the log and `./.sessions` filenames — the [no-banner Agent Note](2026-07-21-tui-no-banner.md) removed the last place it was shown — so resuming meant hunting for the id and reconstructing the invocation. There was also no in-session way to see which sessions in this workspace are resumable.

## Decision

A single optional `resumeCommand` config field on `dsh-tui` gates both surfaces: a shell command template whose every `{session}` is replaced with the live session id (e.g. `dsh --resume {session}`). Absent, neither surface appears.

- **Exit hint.** Process-exiting shutdown prints `To resume this session: <command>` (muted label) via `runtime.terminal.write` after `ui.stop()`, before `runtime.exit`. It prints only once the session is durably persisted: `currentResumeCommand()` scans the session list for the current id and returns `undefined` if it is absent, so a session abandoned before its first flush advertises no command that would fail to load.
- **`/resume`.** Lists this workspace's persisted sessions newest-first, each with its resume command, marking the current one `(current)`. It warns when `resumeCommand` is unconfigured or no persistence backend is mounted, and notes when nothing is persisted yet. The listing is asynchronous, so the transcript updates a tick after submit.
- **Listing.** `listWorkspaceSessions()` reads the optional `sessionPersistence` service's `list()`, keeps headers whose `cwd === agent.session.header.cwd`, and sorts by `createdAt` descending. A `list()` rejection is swallowed to `[]` — a persistence failure must never block terminal exit or crash `/resume`.

`sessionPersistence` is an optional injected service reached through `ctx.get('sessionPersistence')` (not `inject`), declared as an optional peer dependency. Without a backend the field still parses; the exit hint and `/resume` degrade to nothing and the unconfigured/no-backend warnings respectively. `dsh-tui-demo` forwards `resumeCommand` to `dsh-tui`, and the runnable `examples/tui-agent` leaves set `dsh --resume {session}`. The `dsh` CLI (`apps/cli`) parses that `--resume <id>` flag through `parseResumeArg` in [`dsh-app-boot`](../../../../packages/ui/app-boot/README.md), setting `RESUME_SESSION_ID` before boot so the printed command runs back through the config's existing `resumeSessionId` intake; a mistyped or repeated flag fails loud rather than silently starting fresh.

## Alternatives considered

**Hardcode or auto-detect the resume invocation.** Rejected: the launch command is deployment-specific — the env-var name, binary, and flags all vary — so a `DEFAULT_*` constant would be a fixed tunable, not configurability. A template owned by the leaf keeps the choice where the deployment lives, and `{session}` is the only substitution the TUI must know.

**Two config fields, one per surface.** Rejected: both render the identical command, so one field keeps them symmetric and unable to drift; there is no deployment that wants the hint but not the listing.

**Print the exit hint unconditionally.** Rejected: resuming a session id that never flushed fails to load, so advertising it is a broken instruction. Gating on the id appearing in `list()` costs one scan and only ever suppresses a dead command.

**Resume in place from `/resume` (relaunch or reattach).** Rejected: the TUI does not own agent lifecycle or process spawning ([front-door Agent Note](2026-07-17-dedicated-full-screen-tui-front-door.md)). Printing a copyable command respects that boundary and matches the `pi --resume` affordance the request cited.

**Make `sessionPersistence` a required `inject`.** Rejected: the TUI must run without persistence (fixtures, ephemeral runs). An optional service that degrades preserves that, and matches the [`session-query`](../../../../packages/session-query/session-query/package.json) precedent for the same optional peer.

## Consequences

- `dsh-tui` gains an optional peer dependency on `@deepseek-ai/dsh-session-persistence` (`peerDependenciesMeta.optional`), matching `session-query`; the package still loads and passes its coverage gate without a backend mounted.
- The help line and autocomplete gain `/resume`; two existing snapshots re-recorded for the wider help line, and a new `resume-sessions` checkpoint pins the rendered listing.
- `dsh-tui-demo` and both `examples/tui-agent` leaves carry `resumeCommand`, so a real TUI run now prints its own resume command on exit, and the `dsh` CLI accepts the printed `--resume <id>` flag to run it.

## Testing

`packages/ui/tui/tests/tui.spec.ts` pins the seven behaviors: the exit hint prints only when the current session is persisted, is omitted when it is not and when `list()` rejects; `/resume` lists workspace sessions newest-first with the `(current)` marker and cwd filter, warns when unconfigured and when no backend is mounted, and notes when nothing is persisted. The `resume-sessions` snapshot verifies the full rendered frame. The harness provides a fake `sessionPersistence` through `ctx.provide`. For the `--resume` flag, `packages/ui/app-boot/tests/app-boot.spec.ts` pins `parseResumeArg` (space and inline forms, position independence, and the fail-loud on a valueless, empty, or repeated flag), and `examples/tui-agent/tests/tui-keyless-smoke.e2e.ts` boots `apps/cli` with `--resume <missing-id>` and asserts the config resume fails loud — proving the flag reaches the `resumeSessionId` intake.
