# Agent Note: Bundle dsh-auth as the built-in subscription OAuth plugin

Status: implemented

English | [中文](2026-08-26-bundle-dsh-auth.zh.md)

## Problem

The 0.9.2 renderer bundles upstream `dsh-auth` (subscription OAuth sign-in
for ChatGPT/Codex, Claude Pro/Max, and SuperGrok as LLM provider routes),
but only the TUI surface loaded it — through the renderer's own `oauth`
patch row. Desktop and Web users had no path to subscription accounts.

## Decision

- Stage the pinned package from `upstream/dsh-TUI/dsh-auth` under its npm
  name for the Desktop and Web surfaces and mount it with the upstream's own
  row shape (`- id: dsh-auth`, entry-level `inject: [llm, commands]`) in the
  root and `web/` patch layers — the same stage-the-upstream-manifest,
  no-adapter pattern the [dsh-context bundling](2026-08-25-bundle-dsh-context.md)
  established. The TUI keeps loading it through the renderer's row, so no
  surface mounts it twice.
- The plugin is host-only: `/auth` interacts entirely over the DSH
  `user-questions` seam and the commands registry, so Desktop and Web need
  no client code — the surfaces' existing question UI carries the login
  flow, and a non-interactive environment degrades to a clear refusal.
- All peers resolve from the staged runtime's hoisted tree — including
  `@deepseek-ai/dsh-llm-pi-ai` and `@earendil-works/pi-ai`, which the
  0.1.1-rc.2 runtime already ships.
- `BUNDLED_DESKTOP_HOST_PLUGINS` gains the package; the collection test now
  asserts host plugins enroll no browser half (`dsh.client` absent) instead
  of no `dsh` key at all, because upstream bundle manifests declare their
  patch layer. The desktop smoke host loop resolves `main` from each staged
  manifest (`lib/index.js` here), and the web smoke asserts the `dsh-auth`
  row in the composed profile dump.
- Marketplace protection covers the plugin id, package name, and
  `ccch1mneyyy/dsh-auth` repository, with a refusal test mirroring the
  dsh-context one.
- Nix mounts the published tarball at the repository-shaped staging root's
  `upstream/dsh-TUI/dsh-auth` (npm release layout); the shared runtime
  assembler (`installDesktopPackages` in `scripts/stage-runtime-lib.mjs`)
  registers it for the full and web surfaces. The full `oh-dsh` package
  builds clean with both `@deepseek-harness-tui/dsh-auth` and `dsh-context`
  registered. The renderer's private `dsh-auth` dependency is copied into
  its package-local `.oh-dsh-store` by the same dependency installer the
  release pipeline runs, so it never resolves through the immutable
  bundle-store source path.

## Alternatives considered

**An `@oh-dsh/auth` adapter package.** Rejected: nothing is adapted — the
upstream package is consumed unmodified, and a wrapper manifest would only
drift from the upstream version, exactly the trade the dsh-context decision
already recorded.

**Mount the renderer's oauth row on Desktop/Web.** Rejected: that row is the
TUI renderer's own export; mounting a foreign package's subpath row would
couple Desktop/Web staging to the renderer package the TUI surface owns.

**Wait for a DSH-native subscription login.** Rejected: the upstream package
is designed against DSH core seams (llm registry, commands, user-questions)
and works unchanged on every surface today.

## Consequences

- `/auth` works on all three surfaces against the same stored credentials
  in the Oh-DSH data directory.
- `tests/stage-runtime-lib.test.ts` stages full and TUI fixtures through the
  shared assembler and requires `dsh-auth` host peers to resolve from the
  staged runtime graph.
- The Nix assembly mechanism now lives in the shared runtime assembler (see
  2026-08-27-nix-packaging-shares-stage-dsh-assembly); this note keeps the
  surface-membership and private-copy decisions.
- Upgrading the renderer pin moves the dsh-auth source with it; the
  standalone staging spec follows the nested submodule path, so a future
  move of the nested package breaks staging loudly.
- If upstream adds a client half, the package leaves
  `BUNDLED_DESKTOP_HOST_PLUGINS` for the client list and the smokes gain
  client-bundle assertions.
