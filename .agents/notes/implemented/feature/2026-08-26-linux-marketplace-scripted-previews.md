# Agent Note: Linux Marketplace scripted preview confinement

Status: implemented

English | [中文](2026-08-26-linux-marketplace-scripted-previews.zh.md)

## Problem

Marketplace lifecycle scripts need process-level write confinement. The previous
implementation only recognized macOS Seatbelt, so Linux users could not preview
or install scripted plugins even though the packaged Linux runtime included a
Landlock launcher.

## Decision

Linux x64 Marketplace and preview runtime processes use the staged
`landlock-run` launcher with read access to the host runtime, one writable
transaction root, and an explicit write rule for /dev/null so build scripts
can use ordinary null redirects. macOS Web, TUI, and Desktop previews use
Seatbelt through the same `previewRuntimeLauncher` helper; the Landlock
environment variable is Linux-only and is not treated as a universal
launcher. Other platforms remain fail-closed for scripted previews.

When the safe launcher is unavailable, a separate unsandboxed *build*
confirmation is exposed only to direct human UI transitions; Agent
transitions cannot authorize it. That confirmation applies only to
lifecycle scripts. Preview `plugin add`/`plugin install`/`plugin remove`
commands and the preview runtime stay confined whenever a launcher exists,
and stay unconfined together when it does not. An unconfined runtime is
reported as `isolated: false` and is never described as an isolated
preview.

## Alternatives considered

**Run Linux scripts directly as the user** — rejected because environment
redirection is not process confinement and would expose host files and user
credentials to third-party build code.

**Treat the generic high-risk or build-script confirmation as sufficient** —
rejected because it would allow Agent or stale serialized commands to authorize
unsandboxed execution.

**Reuse the unsandboxed-build confirmation for the preview runtime** —
rejected because the permission wording covers third-party build scripts,
not unrestricted plugin activation.

## Consequences

Linux x64 packaged runtimes must contain an executable Landlock launcher,
and the Nix assembly registers the same desktop-frame/marketplace plugins as
the staged runtime so candidate profiles resolve identically. The launcher
provides filesystem confinement but not network isolation. The unsafe
build mode remains a deliberate user-permission escape and must never be
described as an isolated preview or implicitly enabled by another
confirmation.
