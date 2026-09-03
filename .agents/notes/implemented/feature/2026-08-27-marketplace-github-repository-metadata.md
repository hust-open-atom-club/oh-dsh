# Agent Note: Marketplace displays cached GitHub repository metadata

Status: implemented

English | [中文](2026-08-27-marketplace-github-repository-metadata.zh.md)

## Problem

Marketplace cards identify plugins by their source repository, but the catalog
alone does not provide useful repository context such as the description,
stars, forks, or latest activity. Fetching this information directly from each
renderer would duplicate network policy, expose credentials or provider
assumptions to clients, and make the catalog view inconsistent during outages.
The popularity numbers are also easy to mistake for evidence that a plugin is
safe to install.

## Decision

The host obtains public GitHub repository metadata for Marketplace entries and
caches the normalized result in the existing shared data-root cache. Clients
consume the host-owned snapshot rather than calling GitHub themselves. Cache
reads are used when the network is unavailable, and refreshes replace only
validated metadata; missing, stale, rate-limited, or malformed responses do not
turn a card into an installation approval.

The displayed metadata is presentation context: repository identity and URL,
description, stars, forks, GitHub's combined open issue and pull-request count,
primary language, license, and repository update time when available.
Popularity is never a security signal or trust grant. Installation safety
continues to come from the Marketplace source, provenance, permissions,
preview, explicit approval, and transaction/recovery controls. GitHub values
are labeled and may be absent or stale rather than converted into a ranking or
an implicit allowlist.

## Alternatives considered

**Fetch GitHub from each client surface.** Rejected because Desktop, Web, and
other clients would duplicate caching, error handling, and rate-limit behavior,
while increasing the number of places that could accidentally handle provider
responses or credentials.

**Put repository metadata into the published catalog only.** Rejected because
it makes the catalog publisher responsible for freshness and causes every
metadata change to require a catalog publication; host retrieval keeps the
catalog identity authoritative while allowing bounded refresh and offline
fallback.

**Do not cache and show metadata only after a successful request.** Rejected
because transient GitHub failures would make the Marketplace flicker or lose
useful context, and repeated surface loads would spend the same network budget.

**Rank or approve plugins by stars, forks, or other popularity measures.**
Rejected because popularity is mutable, gameable, and unrelated to the code's
provenance, requested permissions, or behavior. Treating it as trust would
turn a social metric into a security boundary.

## Consequences

Marketplace presentation gains useful GitHub context while all surfaces share
one host-side fetch, validation, and cache policy. Cached values make offline
and rate-limited browsing useful, at the cost of explicitly tolerating stale
or incomplete fields and paying host storage and refresh complexity. Public
GitHub access remains subject to availability and rate limits; a failed lookup
must leave the catalog usable.

The UI must not imply endorsement: metadata is informational and cannot bypass
source verification, permission review, preview, approval, or recovery. A
future trust or ranking feature would require a separate decision and an
independent security model rather than reusing these fields.
