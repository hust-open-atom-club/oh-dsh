# Agent Note: The dsh CLI and personal config overlays from the Harness home

Status: implemented

English | [中文](2026-07-20-dsh-cli-personal-config.zh.md)

## Problem

A developer's own preferences — which provider and model the TUI uses, personal credentials, a private adapter route — had nowhere to live except edits to committed files. Pointing the TUI demo at a personal Anthropic-proxy Opus route meant patching `examples/tui-agent/cordis.yml` and `.env` in the working tree, which risks committing secrets and repeats per checkout. There was also no installable command: running the agent in an arbitrary project directory required invoking the repo's demo script from the repo root. Loader metadata is static, so "conditional composition uses overlays" (AGENTS.md) — but overlays only existed as committed sibling files, not as a machine-level layer.

## Decision

Two coupled pieces, aligned with the `apps/` assembly tier proposed by the `dsh web` PR (#443):

**The `dsh` CLI (`apps/cli`, npm name `@deepseek-ai/dsh`).** `apps/*` joins the workspaces as the product-assembly tier over `packages/*` libraries. The bin's dispatch reserves `web` and `-p`/`--prompt` for PR #443 (they exit with a pointer) so the two branches merge as a near-union; everything else runs the default surface: the interactive TUI, booting the shipped `examples/tui-agent/cordis.yml` (or an explicit config argument) with the invoking directory as the workspace. The committed `bin/dsh` launcher resolves the checkout through its own real path and runs the bin **from source** via the repo's tsx (with `--expose-internals` for the config's HMR entry), so `ln -sf "$(pwd)/bin/dsh" ~/.local/bin/dsh` installs a command that always executes the current working tree. `pnpm run demo:tui` runs the same entry.

**Personal config (`dsh-app-boot`).** The personal overlay lives in the Harness home — `$DSH_HOME`, else `~/.dsh` — resolved by the shared [`resolveDshHome`](../architecture/2026-07-24-single-harness-home-resolver.md) (`@deepseek-ai/dsh-paths`), the same single root skills and AGENTS.md resolve against. The dsh TUI surface consumes its two optional files; the demo bins boot their committed trees verbatim:

- `.env` — loaded after the invoking directory's `.env`; `process.loadEnvFile` never overrides, so precedence is ambient > project `.env` > personal `.env`.
- `config.yaml` — a top-level YAML array of `@cordisjs/plugin-include` `PatchOptions`, parsed with the include's own `!!js` dialect (`loadPersonalPatches`) and passed to `boot()`, which forwards it as the root include's `patches`. Patch semantics are exactly the committed overlay semantics (the Code Mode overlay is the template): an id-targeted patch replaces the named entry's whole `config`, `insert` appends entries, an unmatched id warns and is skipped.
- A missing file means no overlay; a present-but-unreadable, unparsable, or non-array file throws at boot (misconfiguration fails loud, never a silent skip).

The PTY smoke's launcher isolates `$DSH_HOME` to a per-test directory, exactly as it already isolates `DSH_AGENTS_HOME`, so a developer's real personal overlay cannot leak into fixtures; only the dsh CLI reads personal config, so no other test launcher needed changes.

## Alternatives considered

**A standalone `bin/dsh` wrapper owning the `dsh` name.** Rejected after reading PR #443: that PR establishes `apps/cli` as the `dsh` CLI with subcommand dispatch (`web`, `-p`) and leaves the default slot unclaimed. Two competing `dsh` entrypoints would collide in `$PATH` and in product identity; claiming the default slot inside the same package shape confines the eventual merge conflict to the small dispatch chain.

**A pi-style typed settings file (`defaultProvider`/`defaultModel`/`providers`).** Rejected by the user in favor of patch semantics: the personal file is a cordis overlay over the shipped default config, not a second config vocabulary to own and translate.

**A personal full `cordis.yml` that includes the requested config.** Rejected: the personal file would have to name the leaf config's path, which varies per checkout; patches invert the dependency so the bin keeps choosing the tree and the personal layer only amends it.

**Deep-merging personal patches into entry configs.** Rejected: it would fork the patch semantics from the committed overlays and the vendored include; whole-config replacement is already the documented contract.

**Opt-in via env flag instead of presence.** Rejected: personal config that is off by default never gets used; presence plus explicit per-test isolation gives live runs the overlay and tests hermeticity.

## Consequences

- `dsh` from any directory (and `pnpm run demo:tui`) boots the personal provider/model with zero repo changes; verified end-to-end against a personal Anthropic proxy with Opus 4.8, including a bash tool round trip.
- Because an id-targeted patch replaces the whole `config`, a personal override restates the base fields it keeps and can drift when the base entry changes shape; the loader's entry-not-found/name-mismatch warnings are the only diagnostics.
- Personal patches resolve ids against the booted file's own tree, so nested-include overlays (Code Mode) are not personalized; live-run parity for those leaves is deferred.
- `dsh-app-boot` depends on `js-yaml` (plus a load-only copy of the include's `!!js` YAML type) and, like `apps/cli`, on `@deepseek-ai/dsh-paths` for `resolveDshHome`.
- When PR #443 lands, `apps/cli/src/bin.ts`'s dispatch chain and `apps/cli/package.json`'s dependency list conflict textually; both resolve as unions (their `web`/`-p` branches plus our default-TUI branch).

## Testing

`packages/ui/app-boot/tests/personal-config.spec.ts` pins `!!js` preservation and end-to-end interpolation through a booted tree, insert entries, the default directory resolving from `$DSH_HOME`, the absent/empty no-op paths, and the three fail-loud shapes (unreadable, unparsable, non-array). `examples/tui-agent/tests/tui-keyless-smoke.e2e.ts` boots the dsh bin in a PTY three ways: default config with no overlay, a personal `.env` + `config.yaml` chain whose patched welcome renders in the banner, and an invalid personal file failing the boot loudly. The pre-existing smokes and snapshot suites pass on a machine whose real `~/.dsh` overlay would change the booted model — the isolation, not luck.
