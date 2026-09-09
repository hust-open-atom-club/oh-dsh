# Agent Note: `ohdsh update` upgrades every installed surface, desktop included

Status: implemented

English | [中文](2026-09-09-ohdsh-update-upgrades-all-installed-surfaces.zh.md)

## Problem

A machine routinely carries several Oh-DSH surfaces — the desktop app in
`/Applications`, and web/tui payloads under the XDG data home — but
`ohdsh update` upgraded only the surface its launcher payload belonged to.
Users reasonably read "update" as "update this machine": after running it,
the desktop and web stayed on the old release while the TUI silently moved
ahead, and `ohdsh update desktop` only printed a pointer to the
application's update window. The per-surface split lived in the launcher's
update command (`runUpdateCommand`), not in the installers, which already
handle every surface.

## Decision

`ohdsh update` now resolves its targets from the machine, not from the
running payload: with no surface argument it probes desktop, web, and tui
through `surfaceIsInstalled` and upgrades every installation found, in that
order; with an explicit surface it upgrades that one alone, desktop
included. The desktop is detected through the `DESKTOP_EXE` launcher record
first, then the recorded `DESKTOP_DEST`/`desktop.env` destination and the
platform's app-image name, mirroring what `install.sh`/`install.ps1` probe.
`selfUpdatePlan` grew a desktop branch that reconstructs `DESKTOP_DEST`,
`DESKTOP_REPO`, and `BIN_DIR` exactly like the web/tui branches, so a
desktop upgrade lands where the installer put the app and keeps fork
provenance.

`runSelfUpdate` delegates to a new `runSelfUpdates` that runs one installer
per surface, announcing each before it starts and continuing past a failure
(the surfaces are independent payloads; a partial upgrade is still
progress, and the first nonzero installer exit becomes the command's exit
code). On Windows the detached helper chains every surface's installer
sequentially in one PowerShell command — spawning one helper per surface
would let concurrent installers race their `launcher.env` and dispatcher
writes — and the persisted download changed from one fixed
`update-install.ps1` to per-surface `update-install-<surface>.ps1` because
surfaces from different forks may need different scripts.

The old special cases are gone: `ohdsh update desktop` no longer prints the
pointer (the in-app update window remains the guided path inside a running
desktop session), and `installerOwnsRoot` was removed — the implicit path
used it to insist the *running* payload be installer-owned, a guard the
per-surface probe now expresses directly. The source-checkout refusal is
unchanged.

## Alternatives considered

- **Keep the pointer and upgrade web/tui only.** Rejected: it is exactly
  the confusion this change removes — a machine-partial upgrade that looks
  like a failure.
- **One installer invocation with a multi-surface flag.** Rejected:
  `install.sh`/`install.ps1` are deliberately one-surface-per-run (asset
  selection, staging, and records are per-surface); looping them keeps the
  installers simple and failures isolated.
- **Spawn one detached Windows helper per surface.** Rejected: they would
  all wake after process exit and race the same record and launcher files;
  the chained single helper keeps Windows semantics identical to Unix.
- **Abort the remaining surfaces on the first failure.** Rejected: a
  permission-blocked desktop must not strand web/tui on an old release;
  sequential best-effort with a nonzero summary exit reports the failure
  without losing the rest.

## Consequences

- Upgrading the desktop through the installer quits and replaces the app
  bundle (the installers' existing behavior); a user running `ohdsh update`
  while the desktop is open gets the app restarted-into-new by their next
  launch, not by the update itself.
- Detection trusts the installer records. A stale record — for example a
  `BIN_DIR` pointing at a deleted directory — is faithfully replayed into
  `--bin-dir`, and the installer then fails loudly at its dispatcher write;
  repairing records means rerunning the installer for one surface. This
  session hit exactly that on a probe-polluted machine, which is also why
  three update tests now pin isolated `HOME`/`USERPROFILE` roots instead of
  inheriting the developer's real records.
- The running launcher's own payload no longer gates the implicit update:
  a manually extracted launcher will happily upgrade every *recorded*
  installation while itself staying stale. The dispatcher — the normal
  entry — always routes to recorded payloads, so this only affects
  hand-placed launchers.
- Windows users watching `update.log` now see per-surface start/exit lines
  instead of a single unnamed run.

## Testing

`tests/cli.test.ts` covers the command contract with an injected updater:
no-arg upgrades desktop+web+tui when all three are recorded (and only the
installed subset otherwise), an explicit surface requires that surface to
be installed, unknown surfaces / empty machines / source roots refuse with
guidance. `tests/self-update.test.ts` covers the desktop plan (destination,
fork, bin-dir reconstruction), desktop detection (`DESKTOP_EXE`, then
record/marker destinations per platform), and `runSelfUpdates` ordering
with continue-past-failure and first-nonzero exit; three older tests were
isolated from the real user records that had made them machine-dependent.
