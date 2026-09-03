# Agent Note: inline update flow on the About page

Status: implemented

English | [中文](2026-09-02-about-inline-update-flow.zh.md)

## Problem

Issue #178 asks for a self-upgrade entry in Settings. The first pass put a
button on the About page that opened the separate software-update window;
the follow-up added an inline check with an explicit status, but the actual
download and install still happened in the window. That split confused the
flow: the page answered "is there an update?" but sent the user elsewhere
to act on it, and the update window's presentation did not match the About
page's structure.

The earlier notes ([Settings About page](2026-08-31-settings-about-page.md),
[inline update check](2026-09-01-about-inline-update-check.md)) had kept
downloads and installs inside the sandboxed update window by exposing only
a read-mostly projection to the main window.

## Decision

The About page now drives the complete update flow inline. The projection
(`AboutUpdateSnapshot`) carries download progress (percent, transferred,
total, speed), and the command surface (`AboutUpdateCommand`) is exactly
three steps: `check`, `download`, `install-now`. The main-process handler
`desktop:about-update:command` parses that closed set with
`parseAboutUpdateCommand` and maps `install-now` onto the same
`scheduleImmediateUpdateInstall` path the update window uses (quit, then
run the staged installer).

The About card renders the flow as one state machine: "Check for updates"
(idle / not-available / after error) → "Checking..." (disabled) →
"Version X is available" with "Download update" → "Downloading N% — a of b"
(no button, progress driven by the mirrored state push) → "Version X is
ready to install" with "Install update" → quit-and-install. Web renders no
update card (no desktop bridge); `unsupported` shows a dev-build notice
with no button.

## Alternatives considered

**Keep downloads and installs in the update window** (the previous
decision). Rejected by the product owner: the split flow — check here,
act there — read as broken behavior, and the issue asks for a self-upgrade
entry in Settings, not a launcher for a second window.

**Reuse the update window's gated `desktop:update:command` channel by
relaxing `assertUpdateWindowSender`.** Rejected: that would turn a
single-sender gate into a two-sender surface. Instead About gets its own
channel with its own closed command set, so the update window's gate is
untouched and neither surface can invoke the other's commands.

**Auto-download when a check finds an update.** Rejected: the card keeps
download as an explicit button step, matching the requested interaction.

## Consequences

- The About page satisfies #178's self-upgrade criterion end to end:
  check, download with progress, and install all happen from one card.
- The main window can now trigger downloads and installs — the earlier
  note's central guarantee ("the main window cannot start downloads") is
  superseded. The boundary that remains: the updater's feed stays
  GitHub-only with a release-mirror detour (`gh-proxy` generic provider)
  when GitHub is unreachable, downloads are verified by electron-updater's
  signature/checksum checks, and install runs through the same
  quit-and-staged-installer path as the update window.
- The mirror serves exactly one update cycle (the fallback check plus its
  download); the next check restores the GitHub feed, so a transient
  outage cannot pin the client to the third-party mirror. Mirror retries
  also cover Node-style network codes (`ENOTFOUND`, `ETIMEDOUT`, ...),
  not only Chromium's `ERR_*` codes; local-environment failures such as
  `ENOSPC` never trigger it.
- The update window continues to work unchanged with its own channels;
  both surfaces observe the same manager, so states stay consistent.
- `tests/about-page.test.ts` pins the closed command set
  (`check | download | install-now`), the three IPC channels, and that the
  plugin only invokes those commands.

## Testing

- `pnpm run typecheck`, `pnpm test` (283 pass; 9 pre-existing Windows
  symlink-EPERM failures), `pnpm run build`.
- Local end-to-end: packaged 0.0.1 build against the 0.1.11 GitHub release
  — the check fell back to the gh-proxy mirror after GitHub timed out,
  reported "Found version 0.1.11", and the download started through the
  mirror with a full-download fallback for the missing differential
  blockmap.
