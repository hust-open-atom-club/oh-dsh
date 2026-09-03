# Agent Note: Upgrade the pinned dsh-TUI renderer to 0.9.2

Status: implemented

English | [中文](2026-08-26-upstream-tui-0.9.2-upgrade.zh.md)

## Problem

The pinned renderer sat at 0.9.0 (decided by the
[0.9.0 upgrade](2026-08-24-upstream-tui-0.9.0-upgrade.md)); upstream 0.9.2
adds session identity (`/color`, `/recap`), paste folding, hover
interactions, a bundled OAuth sign-in package (`dsh-auth`), the `pi-ai`
subscription LLM route, `/reload` and `/restart`, and fixes a pnpm ≥ 11
`ERR_PNPM_IGNORED_BUILDS` blocker in the upstream `/update` preset.

## Decision

- Pin the submodule and the published npm renderer to v0.9.2; the nested
  `dsh-ecosystem-spec` gitlink moves to `2d0236f7`, `vendor/dsh-std` is
  unchanged, and the new nested `dsh-auth` gitlink (`fba02bcf`) is fetched
  with the recursive submodule update.
- `pnpm-workspace.yaml` `allowBuilds` records the two new transitive
  dependencies as `false`: `@google/genai` and `protobufjs` are pure-JS
  packages whose postinstall scripts are not needed to stage or run any
  surface.
- The staging dependency mirror walks the node_modules chain from the
  requiring package when a restricted `exports` map hides both
  `./package.json` and the main entry from `require.resolve`
  (`@earendil-works/pi-ai` is the first such dependency).
- The bundled `dsh-auth` is staged as the nested copy the renderer's
  `link:./dsh-auth` resolution produces; Nix mounts the published
  `@deepseek-harness-tui/dsh-auth@0.1.0` tarball into the repository-shaped
  staging root, the same published-artifact pattern as the renderer.
- The root pnpm workspace includes the nested `dsh-auth` package and records
  its importer in the shared lockfile. pnpm deploy rewrites the renderer's
  `link:./dsh-auth` as a file dependency; explicit workspace membership gives
  that dependency a locked owner while preserving the pinned submodule source.
- The guarded renderer adapter learns the new `/restart` command's
  description rewrite; every other 0.9.2 addition needed no adaptation.
- The upstream fullscreen-default flip (now on by default upstream) is NOT
  adopted: the Oh-DSH launcher keeps inline as the default and always sets
  `OH_DSH_TUI_FULLSCREEN` (the variable the Cordis patch and renderer
  adapter read; `DSH_OH_TUI_FULLSCREEN` is only the launcher's input alias)
  explicitly.

## Alternatives considered

**Adopt the upstream fullscreen default.** Rejected: Oh-DSH's inline
startup, scrollback-preserving notices, and launcher contract are built
around the inline default; the upstream flip changes nothing for users who
pass `--fullscreen`.

**Rewrite the staged `link:./dsh-auth` dependency to the published `"*"`
form.** Rejected: the nested copy already resolves at runtime and keeps the
staged manifest byte-identical to the pinned source; only the Nix assembly
needs the published form.

**Use pnpm legacy deploy for Windows dependency closures.** Rejected: legacy
deploy does not use the shared workspace lockfile and pnpm 11.21 leaves the
nested package as a link to its source. The existing copy can dereference that
link, but dependency resolution would no longer be pinned by the root lockfile.

## Consequences

- The TUI gains 0.9.2 features (session identity, recap, paste folding,
  hover interactions, OAuth sign-in via `/auth`, `/reload`, `/restart`)
  under the existing Oh-DSH launcher contract; boot verified with the
  Liangshen preset in a pty.
- The Nix assembly is verified end to end: the fetchFromGitHub tree hashes
  for the sidebar, renderer, ecosystem-spec, and dsh-auth sources, plus the
  `fetchPnpmDeps` closure hash, were refreshed from an actual `nix build`
  and the full `oh-dsh` package builds clean — the first real-build
  validation of the dsh-context Nix integration as well.
- liangshen's preset revision moves to
  `liangshen-toolcall-full-catalog-subagents-durable-hint-v5` (durable
  instruction-hint dedupe) with no Oh-DSH-side test changes.
- Windows TUI release staging preserves the renderer's bundled `dsh-auth`
  through the deterministic shared-lock deploy path. The staging contract test
  pins both workspace membership and the lockfile importer, and a
  Windows-targeted full staging run covers the real deploy path.
