# Agent Note: Decoupled in-app DSH runtime updates

Status: implemented

English | [中文](2026-08-23-decoupled-runtime-updates.zh.md)

## Problem

The DSH runtime was pinned at build time and shipped inside every Desktop
application build (#123). A new DSH release — for example a new Vision
model — required a full Oh-DSH Desktop release before users could get it.

## Decision

- Publish the staged runtime as an independent Release asset
  `oh-dsh-runtime-<dshVersion>-<platform>-<arch>.tar.gz` (plus a `.sha256`
  companion) from the existing release workflow. The bundle is the same
  `.stage/dsh-runtime` tree the application packages, so pnpm assembly,
  desktop plugin injection, the settings-boundary patch, and the Linux
  landlock launcher all keep running at build time.
- `dsh-source.mjs` re-extracts the integrity-checked npm assembly before each
  stage. Tar receives the archive and extraction directory as basenames under
  their shared parent directory, so Windows Git Bash cannot interpret a drive
  letter in the archive operand as a remote host.
- `src/runtime-update.ts` adds a `RuntimeUpdateManager` in the main
  process: check GitHub Releases for the newest bundle newer than the
  active runtime, download with progress, verify the published SHA-256,
  extract with the system tar under `~/.ohdsh/runtimes/<version>/`,
  validate the manifest version, smoke-check `dsh --version` with the
  bundled Node, then write the pointer
  `~/.ohdsh/runtimes/current.json` and restart only the Harness
  supervisor.
- Runtime selection: `main.ts#runtimePaths()` prefers a validated staged
  runtime (pointer + `lib/bin.js` + matching manifest version) over the
  bundled one; an explicit `OH_DSH_RESOURCES_ROOT`/`DSH_OH_WEB_ROOT`
  override still wins. Node and pnpm stay bundled with the application —
  the runtime bundle ships only `dsh-runtime`.
- The update window gains a "DSH Runtime" section (same sandboxed preload
  and sender-validated IPC pattern as the application updater) with
  Check / Update / Use Bundled Runtime (rollback removes the pointer and
  restarts the Harness).

## Consequences

- Every bundle ships `oh-dsh-runtime-manifest.json` (`dshVersion`,
  `bundledByAppVersion`, `runtimeContract`). Compatibility is judged by
  the explicit `runtimeContract` revision declared in `package.json`
  (`ohDshRuntimeContract`), not the application package version: the
  bundle embeds this project's surface plugins, and only a matching
  contract revision guarantees their boundaries. Manifest-less or
  mismatched bundles are refused as non-retryable, and install errors
  report the failing stage (download/verify/extract/activate). Runtime
  selection revalidates the contract at every startup, so a bundle
  staged by an older application retires itself after a contract bump.
  Post-activation download cleanup is best-effort and can never turn a
  committed activation into a reported failure. A
  `workflow_dispatch` "Runtime release" workflow publishes bundles
  alone (tag pinned to the dispatched commit via `--target`), so a DSH
  bump does not need an application release. Viewer Desktops (runtime
  lock held by another surface) reject `install`/`rollback` at the IPC
  boundary.
- A failed download, checksum, or smoke check never changes the active
  runtime; rollback is one pointer removal away.
- Runtime updates require a Release that actually carries a runtime
  bundle for the platform; older Releases show "up to date".
- The pointer lives in the shared data root, so Web/TUI surfaces started
  through the Desktop-installed launchers could later honor it too (they
  currently resolve their own packaged runtimes).
- In-app `pnpm deploy` was rejected: the staged runtime embeds Oh-DSH
  plugin packages whose host dependencies are relative symlinks into that
  runtime's own pnpm store, so a runtime assembled at runtime could not
  reuse them safely.

## Alternatives considered

- Run the full `stage-dsh.mjs` pipeline inside the app: needs the repo,
  curl, git, and `dist/` artifacts; rejected.
- Reuse the marketplace plugin transaction: the marketplace swaps profile
  bundles, not the base runtime the profile runs on; rejected for the
  base-runtime swap, though the verify-then-activate shape mirrors it.
- Pass absolute Windows paths to tar with `--force-local`: rejected because
  the release uses the host tar implementation on every platform, while a
  shared working directory and relative operands need no implementation-
  specific option.
