# Agent Note: Loopback auth-cookie accumulation starves the client graph

Status: implemented

English | [中文](2026-09-11-dsh-auth-cookie-accumulation.zh.md)

## Problem

After roughly sixty runtime launches, the desktop shell booted to a blank
white page. The renderer logged `failed to import loader entry
(@deepseek-ai/dsh-client-hmr): client-modules: bundle script /plugins/??…
failed to load`, and Resource Timing showed the combined client-bundle
request dying with HTTP 431 while the same URL succeeded via curl.

Root cause chain: the runtime server plants one `dsh-auth-<random>`
session cookie (~225 bytes) on 127.0.0.1 per boot; Chromium cookie
storage is shared across all ports and persists across launches in the
Electron default session; the cookies carry a 30-day expiry, so dead
tokens roll up (63 cookies / 14,173 bytes on the affected machine). The
0.1.5 client graph's initial bundle URL lists every plugin entry — about
4.6KB of request line — which together with the accumulated Cookie header
crosses Node's 16KB `maxHeaderSize`, and the server answers 431 before
any route runs. The failure looks like a renderer bug and only appears
on machines with enough launch history, which is why it surfaced late as
"the client graph stopped mounting".

## Decision

Three layers, one per blast radius:

1. `src/main.ts` prunes every `dsh-auth-*` cookie for the runtime origin
   in the default session before each surface load (main and preview);
   the boot flow replants a live one immediately. Non-destructive to
   every other cookie.
2. `scripts/smoke-client.cjs` runs in a throwaway non-persistent
   partition (`ohdsh-smoke`), so smoke runs stop feeding the jar and
   become deterministic regardless of machine history.
3. The task diagnostics harness does the same (`ohdsh-diag`), which is
   what let the failure reproduce reliably during forensics.

## Alternatives rejected

- Chunking the bundle URL or splitting batches: a runtime-side change in
  pinned upstream code; the accumulation would still grow unbounded.
- Raising the server's `maxHeaderSize`: not exposed by the runtime's
  server bootstrap, and it only delays the cliff.
- Purging the whole cookie jar: destroys unrelated user state for a
  problem owned by one cookie family.

## Consequences

- The desktop app self-heals on the next launch after upgrade; no user
  action needed.
- Any other Electron tool that drives the runtime (custom harnesses)
  still shares the default-session jar and should adopt a partition or
  the same prune.
- The runtime itself keeps planting per-boot cookies; if upstream later
  reuses or expires them, the prune becomes redundant but harmless.
- Known remaining gap: the browser-based Web surface (a real browser
  visiting the loopback origin) accumulates the same cookies in the
  browser jar; browser-side cleanup is out of the desktop app's reach
  and unaddressed.
