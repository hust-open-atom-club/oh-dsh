# Agent Note: Keep provider credential copy aligned with DSH_HOME

Status: implemented

English | [中文](2026-08-30-provider-credential-copy-follows-dsh-home.zh.md)

## Problem

The pinned dsh-TUI `/provider` wizard displayed
`~/.dsh/.credentials.yaml` in its API-key prompt, success summary, rollback
diagnostic, and module comment. Oh-DSH launches the renderer with its shared
data root as `DSH_HOME`, which defaults to `~/.ohdsh`, while the Harness
credentials service follows that effective root. The wizard therefore named
the wrong file and promised a file write even when a launch-time environment
variable shadows the credential and causes the write to be skipped.

## Decision

The guarded compiled-renderer adapter rewrites the copied provider strings
without modifying the pinned submodule. The API-key prompt says that the
Harness credentials service manages the key and keeps it out of the
transcript; it does not promise a file write. The success summary, rollback
diagnostic, and module comment name `$DSH_HOME/.credentials.yaml`, while the
existing environment-shadow summary continues to say that the write was
skipped.

The adapter uses exact, idempotent replacements. An upstream wording or file
layout change fails adaptation instead of silently restoring the fixed path.
This extends the compiled-renderer ownership established by the pinned
[dsh-TUI upgrade](../feature/2026-08-26-upstream-tui-0.9.2-upgrade.md).

## Alternatives considered

**Display `~/.ohdsh/.credentials.yaml`.** Rejected because `OH_DSH_HOME` and
`DSH_HOME` may select another shared root; another fixed path would preserve
the same defect for configured installations.

**Display the resolved absolute path.** Rejected because `$DSH_HOME` states
the storage contract without exposing a machine-specific home path and stays
accurate for every supported override.

**Edit or fork the upstream renderer.** Rejected because the wording is an
Oh-DSH integration concern and the pinned source stays pristine. The existing
compiled-renderer adapter is the owned compatibility boundary.

**Keep the file-write promise and only replace the path.** Rejected because a
credential already present in the process environment intentionally skips the
credentials document write.

## Consequences

- Default and custom data roots receive accurate bilingual provider guidance.
- The input prompt no longer claims mode `0600`, because no file is necessarily
  written at that step; file-backed success and rollback messages still name
  the managed document.
- The TUI adapter regression test copies the pinned compiled renderer, runs the
  real adapter twice, and rejects both the fixed legacy path and the
  unconditional Chinese write promise.
- A future upstream renderer upgrade must preserve or deliberately revise this
  adapter seam.
