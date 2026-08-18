# Agent Note: rc7 settings namespaces, release-age policy, and smoke picker flow

Status: implemented

English | [中文](2026-08-18-rc7-settings-namespaces-and-smoke-picker.zh.md)

## Problem

Upgrading the pinned runtime to DSH 0.1.0-rc.7 surfaced three adaptations:
rc7 replaced the api-proxy's fixed settings allowlist with dynamic namespace
serving; rc7 packages are published inside pnpm's minimumReleaseAge window;
and the hero workspace picker interaction changed for browser automation.

## Decision

- **Settings namespaces**: rc7's dsh-host-apiproxy serves every registered
  namespace via settings.describe() instead of the fixed
  WEB_SETTINGS_NAMESPACES allowlist. The staging-time
  exposeVisionSettingsNamespace patch (rc6) is obsolete and was removed;
  the vision and humanize namespaces register host-side and are served
  automatically.
- **Release-age policy**: the pinned assembly's pnpm-workspace.yaml now
  mirrors the repository's minimumReleaseAgeExclude for '@deepseek-ai/*',
  so freshly published rc releases install without waiting out the age
  cutoff.
- **Smoke picker flow**: rc7 binds the hero workspace picker open on the
  trigger textarea (a card-level click no longer lands) and untrusted
  clicks land intermittently, so scripts/smoke-client.cjs alternates
  between the card and the textarea, stops clicking once aria-expanded
  flips, and never toggles an open picker shut. This keeps the browse
  interaction (CI) deterministic and makes the native interaction
  (attended macOS/Windows) complete when the OS dialog resolves.

## Consequences

- Staging no longer patches the deployed api-proxy; rc7 composition owns
  namespace exposure.
- Assembly installs work immediately after an rc publish.
- The desktop/web smokes pass on rc7 (verified locally: check:plugins and
  smoke:web green; CI runs the browse interaction on Linux).

## Alternatives considered

- Keep patching the allowlist with the rc7 anchor shape: the mechanism no
  longer exists, so there is nothing to anchor to; rejected.
- Wait for the release-age cutoff instead of excluding: blocks the upgrade
  for up to a day after every rc publish; rejected.
- Drive the native OS directory dialog from the smoke: platform-specific
  and fragile; rejected.
