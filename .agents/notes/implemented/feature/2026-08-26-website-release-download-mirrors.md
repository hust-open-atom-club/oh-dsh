# Agent Note: Explicit release download mirrors

Status: implemented

English | [中文](2026-08-26-website-release-download-mirrors.zh.md)

## Problem

The website resolved its platform-specific release asset only from GitHub.
GitHub may be slow or unreachable on some mainland China networks, while the
same release assets are copied to AtomGit. Replacing the existing download or
routing visitors by inferred location would either remove a working path or
hide which host supplies the binary.

## Decision

The download dialog presents three explicit actions: Star the repository on
GitHub and continue the GitHub download, download directly from GitHub without
the Star step, or download from the AtomGit mirror. Both GitHub actions share
the asset selected from GitHub's latest Release response. The AtomGit action
resolves the matching platform and architecture independently from AtomGit's
latest Release response and falls back to the AtomGit Releases page.

The page does not infer a visitor's country or automatically switch providers.
AtomGit is a mirror only: choosing it never opens GitHub or asks for a Star.
Installer and in-application update traffic remain outside this website choice.

## Alternatives considered

**Route automatically by IP address.** Rejected because VPNs, proxies, travel,
and geolocation errors make country an unreliable signal, and automatic
routing conceals the selected artifact host from the visitor.

**Replace direct GitHub download with AtomGit.** Rejected because the existing
no-Star GitHub path remains useful and the mirror is an additional recovery
path, not the new source of truth.

**Attach the Star prompt to AtomGit.** Rejected because AtomGit only mirrors
the GitHub Release and does not require a repository-promotion side effect.

## Consequences

Visitors choose the host that works for their network without losing either
GitHub workflow. Each provider can fail or lag independently, so the dialog may
temporarily resolve different latest versions; provider-specific fallback
links remain usable in that state. The website performs one latest-Release
request per provider and reuses the same platform and architecture matching
for both responses.

## Testing

JavaScript syntax, typecheck, the Pages build, provider-selector inspection,
Agent Note format and classification, and bilingual pairing gates cover the
shipped dialog and its decision record.
