# Agent Note: One harness home resolver

Status: implemented

English | [中文](2026-07-24-single-harness-home-resolver.zh.md)

## Problem

The harness had three inconsistent conventions for "where does DeepSeek Harness user data live":

- `@deepseek-ai/dsh-home` resolved `configured ?? $DSH_HOME ?? ~/.dsh`.
- `@deepseek-ai/dsh-paths` shipped a **second** `resolveDshHome` with the same precedence plus tilde expansion — a near-duplicate of `dsh-home` that no gate flagged because the two lived in different packages and had already drifted (only one expanded tildes).
- `@deepseek-ai/dsh-telemetry`'s `globalConfigDir` used a *different* policy entirely: `DSH_CONFIG_HOME > $XDG_CONFIG_HOME/deepseek-harness > %APPDATA%/deepseek-harness > ~/.config/deepseek-harness`.

So most of the product parked everything under one `~/.dsh` root while telemetry alone stored its anonymous id elsewhere, under a `deepseek-harness` namespace that contradicts the repo-wide `dsh` shorthand (`DSH_HOME`, `@deepseek-ai/dsh-*`, `~/.dsh`). Two resolvers plus a divergent third policy means no single home fact.

## Decision

One resolver owns the harness home, in `@deepseek-ai/dsh-paths`, single-root:

```
explicit configured path  >  $DSH_HOME  >  ~/.dsh
```

An empty or whitespace-only `$DSH_HOME` is treated as unset, matching the guard telemetry's old resolver carried: without it `resolve('')` would silently place the home at the current working directory. The harness keeps all user data under one root; there is no XDG config/data/cache split. `dshHomeDisplay()` names a resolved root symbolically for user-facing paths — `~/.dsh` for the default home, `$DSH_HOME` for any configured home — so the user-global `AGENTS.md` label never leaks an absolute machine path. It replaces workspace-context's bespoke default-vs-`$DSH_HOME` check.

`@deepseek-ai/dsh-home` is deleted. Its three importers (`dsh-tool-bash`, `dsh-skill-local`, `dsh-agent-spine-demo`) now import `resolveDshHome` from `dsh-paths`. `dsh-telemetry`'s `globalConfigDir` delegates to `resolveDshHome`, dropping its second resolver, the `DSH_CONFIG_HOME` override, the XDG/`%APPDATA%` branches, and the `deepseek-harness` namespace; the anonymous id now lives directly under the harness home.

## Alternatives considered

**Leave the two `resolveDshHome` copies in place.** They had already drifted (one expands tildes, one didn't) and encode the same cross-cutting fact twice. Consolidation is the point of the `util/` layer; a duplicate resolver is a latent divergence bug.

**Adopt XDG (honor `$XDG_CONFIG_HOME`, or split config/data/cache into separate trees).** Considered and dropped in favor of one obvious root. A single `$DSH_HOME || ~/.dsh` ground truth matches `~/.claude` / `~/.aws`, needs no per-kind reclassification of every `~/.dsh` consumer, and leaves no resolver asymmetry to reconcile. Telemetry aligning onto the same root — rather than keeping its own XDG path — is precisely the divergence this removes.

**Keep telemetry's own config dir.** Its `deepseek-harness` namespace and separate XDG policy were the lone exception to the `dsh`/`~/.dsh` convention. Folding it onto the shared resolver is what makes "one home fact" true. The cost is that the anonymous id becomes scoped to `$DSH_HOME` rather than the machine: a project that points `DSH_HOME` at a repo-local path (or a command that loads a project `.env` before telemetry) gets a home-local id, so the id counts harness homes, not machines. This is accepted as the intended meaning of single-root — a relocated `$DSH_HOME` moves *all* harness state, telemetry identity included — and the module contract is stated as per-harness-home rather than per-machine. A machine-global identity that ignored `$DSH_HOME` would reintroduce exactly the second home policy this Note removes.

## Consequences

- One home fact, one resolver. `dsh-paths` is the sole owner; the `util/` group loses the `home` package.
- Telemetry's anonymous id moves from `~/.config/deepseek-harness/telemetry.json` to the harness home (`~/.dsh/telemetry.json` by default). Under the pre-release "backends reject old formats" stance this needs no migration: an orphaned old id simply regenerates once, and the id is anonymous by construction.
- Telemetry drops Windows `%APPDATA%` handling. `resolveDshHome` uses `os.homedir()`, which is correct on Windows; the harness does not special-case `%APPDATA%` for its single root.
