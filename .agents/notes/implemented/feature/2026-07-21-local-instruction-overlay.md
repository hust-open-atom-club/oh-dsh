# Agent Note: Default local instruction overlay

Status: implemented

English | [中文](2026-07-21-local-instruction-overlay.zh.md)

## Problem

Personal, git-ignored guidance (`AGENTS.local.md` / `CLAUDE.local.md`) is a Claude Code convention for per-developer overrides that are deliberately not committed. The [workspace-context plugin](2026-06-24-workspace-context.md) loaded only one candidate per directory, so a `.local.` name could only be reached by adding it to `instructionFileCandidates`, where — because a directory has one winner — it would *shadow* the committed base file instead of supplementing it. That inverts the additive "base plus personal overlay" model the names evoke, and it was off by default.

## Decision

The plugin loads a second, independent candidate list per project directory. `localInstructionFileCandidates` defaults to `['AGENTS.local.md', 'CLAUDE.local.md']` and is resolved with the same same-directory validation as `instructionFileCandidates`. In every project directory from the root to the session cwd, the plugin loads the first existing base candidate and then, additively, the first existing local candidate; the local file is ordered after the base file so its guidance takes precedence within the byte budget. An empty `localInstructionFileCandidates` disables the overlay.

The default lives in the plugin `Config` schema rather than a product `cordis.yml`, so every embedder (TUI, ACP, headless) reads `.local.` files consistently and a deployment overrides or disables the behavior in one place. This is symmetric with the plugin-owned `instructionFileCandidates` default.

The fixed user-global `$DSH_HOME/AGENTS.md` has no local overlay and stays base-only.

## Tiered scope keys

Each directory now yields up to two logical scopes that share a path but must stay independent across baseline freezing, the pending window, the version cache, and reconciliation. `render.ts` encodes the tier into the scope key: the base tier keeps the bare directory scope (`.`, `pkg`, `user-global`) and the local tier appends a NUL sentinel (`\u0000local`) that cannot occur in a real path. `scopeKey`/`decodeScopeKey` own the encoding. `DiscoveredInstructionFile` carries a required `tier` and `LoadedInstructionFile` an optional one (absent means base); discovery tags each file, `baselineInstructionState` derives the tiered key from directory plus tier, `reconcileInstructionContext` enumerates both tiers per project directory when the local list is non-empty, and `probeScopeInstruction` decodes the key to pick the base or local candidate list. The model-facing prompt derives its human directory label from the file display path, so the sentinel never reaches the model, and existing dedup by absolute path still collapses base and local lists that resolve to the same file.

## Alternatives considered

**Higher-priority first-wins (`.local.` loaded instead of the base file).** Rejected: a personal overlay that replaces the committed file drops shared project guidance whenever the overlay exists, which is the opposite of the additive Claude Code model.

**Keep it opt-in through `instructionFileCandidates`.** Rejected: one directory has a single winner, so a `.local.` name added to that list shadows the base file rather than supplementing it. The packages guidance to keep opt-ins out of shipped defaults is outweighed here by strong prior art and the user-facing expectation that `.local.` files are always read.

**Default at the product `cordis.yml` level instead of the plugin schema.** Rejected: it would enable `.local.` only for whichever front door remembered to opt in, splitting behavior across TUI/ACP/headless and duplicating a value that belongs beside the existing candidate default.

**Reuse the bare directory as the scope key for both tiers.** Rejected: base and local files in one directory would collide in every scope-keyed map, so a change to one would suppress or overwrite the other. A sentinel-suffixed key keeps the tiers independent without widening the persisted metadata shape.

**Extend the overlay to the user-global scope.** Deferred: `$DSH_HOME` is a single fixed `AGENTS.md` with no committed base to supplement, so it stays base-only until a concrete need appears.

## Consequences

`.local.` guidance is read by default across all products with no per-deployment configuration, matching neighboring tools. Each project directory can contribute two durable scopes instead of one, so dynamic discovery, edits, and removals reconcile the base and local tiers independently. The scope-key shape changed to carry the tier; `dsh-session` keeps no compatibility promise for older sessions, so this is a free change. The user-global scope remains base-only, recorded as a Known Limitation in the package README.
