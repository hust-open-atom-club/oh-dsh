# Agent Note: rc7 settings namespace boundary, release-age policy, and smoke picker flow

Status: implemented

English | [中文](2026-08-18-rc7-settings-namespaces-and-smoke-picker.zh.md)

## Problem

Upgrading the pinned runtime to DSH 0.1.0-rc.7 surfaced three adaptations:
rc7's api-proxy replaced its fixed settings allowlist with dynamic
namespace serving, removing the rc.6 configuration-client boundary; rc7
packages are published inside pnpm's minimumReleaseAge window; and the
hero workspace picker interaction changed for browser automation.

## Decision

- **Settings namespace boundary**: rc7's dsh-host-apiproxy serves every
  registered namespace via settings.describe() and accepts settings writes
  to any namespace; the rc.6 staging patch (exposeVisionSettingsNamespace)
  only added one namespace to the upstream allowlist and cannot express the
  boundary anymore. staging now runs restoreSettingsBoundary(), which
  re-adds the whole explicit allowlist on the deployed api-proxy:
  settings.describe filters namespaces to the Web preferences, product, and
  plugin allowlist plus model-provider namespaces, and every settings write
  (update/replace/mutate) refuses other namespaces with
  `settings-not-exposed`. The allowlist is WEB_SETTINGS_NAMESPACES
  (agent-loop, shell, locale, permission, ui-conversation, ui-theme,
  web-search-deepseek), PRODUCT_SETTINGS_NAMESPACES (ui-onboarding,
  settings) and oh-dsh-vision, matching the rc.6 exposedNamespaces() union.
  This keeps the configuration-client boundary recorded in
  [2026-07-30-config-plane-boundaries.md](../architecture/2026-07-30-config-plane-boundaries.md),
  [2026-08-10-web-plugin-configuration.md](../feature/2026-08-10-web-plugin-configuration.md),
  and
  [2026-07-31-permission-default-for-new-sessions.md](../feature/2026-07-31-permission-default-for-new-sessions.md)
  intact: a registering plugin still cannot become remotely readable or
  writable by default.
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

- Staging patches the deployed api-proxy again; the explicit allowlist,
  not the registering plugin, decides whether a namespace reaches
  configuration clients.
- Assembly installs work immediately after an rc publish.
- The desktop/web smokes pass on rc7 (verified locally: check:plugins and
  smoke:web green; CI runs the browse interaction on Linux).

## Alternatives considered

- Trust rc7's dynamic serving as-is: settings redaction is not fail-closed
  for secrets behind unions, intersections, or transforms (see
  config-plane-boundaries), and a loaded client plugin could read or
  mutate namespaces that never underwent Web-surface review; rejected.
- Prove rc7 redaction fail-closed and keep dynamic serving: the upstream
  seam does not promise it and proving it per release is not worth the
  boundary loss; rejected.
- Wait for the release-age cutoff instead of excluding: blocks the upgrade
  for up to a day after every rc publish; rejected.
- Drive the native OS directory dialog from the smoke: platform-specific
  and fragile; rejected.
