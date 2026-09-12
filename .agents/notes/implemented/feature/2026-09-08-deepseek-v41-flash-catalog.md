# Agent Note: DeepSeek V4.1 Flash in the default model catalog — a surface-patch composition row

Status: implemented

English | [中文](2026-09-08-deepseek-v41-flash-catalog.zh.md)

## Problem

DeepSeek serves the `DeepSeek-V4.1-Flash` model (text+image input, released
2026-09-10) under the official id `deepseek-flash`. It must appear in every
Oh-DSH surface's model picker by default, with no user configuration.

The default advisory catalog is compiled inside the pinned runtime plugin
`@deepseek-ai/dsh-llm-deepseek@0.1.2-rc.1` (`DEFAULT_MODELS`:
deepseek-v4-flash, deepseek-v4-pro, deepseek-v4-flash-vision-exp). The
runtime arrives as an npm tarball pinned by `dsh-source.json`; newer runtime
releases (checked through 0.1.5-rc.1) list `deepseek-flash` only from
0.1.5-rc.1 onward, a line no released dsh-TUI supports, and `upstream/` is
pinned source that Oh-DSH must not edit. So the distribution's catalog can
only come from this repository's composition layers.

## Decision

Give the `llm-deepseek` dsh-base row an entry config in each of the three
surface bundle patches — the root `cordis.patch.yml` (Desktop),
`web/cordis.patch.yml` (Web), and `plugins/tui/cordis.patch.yml` (TUI) —
setting `config.models` to the runtime's three shipped models plus
`deepseek-flash` (first position, name `DeepSeek-V4.1-Flash`,
contextWindow 1000000, text+image, imagePixelBudget 640000,
imageMaxBytes 1048576 — the runtime's own vision-model image limits; the
0.1.5-rc.1 adapter's native entry carries the same facts). The retired
`deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` ids stay listed
because the pinned runtime still ships them and the endpoint only routes
them temporarily. On the TUI layer the row restates the TUI bundle's own
keys (`apiKeyEnv`, `baseURL`, `thinking`, `reasoningEffort`) beside
`models`, because a patch row replaces the row's whole config and the
schema has no defaults for thinking/effort.

This uses the layering dsh-base itself documents: a later bundle patch
addresses the row by id and replaces its whole `config`, and the plugin
layers its entry config under the optional `llm-deepseek:` user-settings
section. Because settings resolution is schema defaults → entry base →
user section (arrays replace whole), the entry list becomes the
distribution's default catalog, a user's own `llm-deepseek.models` still
overrides it live without a restart, and every other field of the section
keeps falling back to schema defaults. The catalog stays advisory —
[catalog discovery](../architecture/2026-07-15-llm-model-catalog-and-acp-selection.md)
never validates requests, so unlisted model ids keep passing through.

The entries restate the runtime's ids verbatim. The default agent model
selection is unchanged: the change adds a picker option, not a new default.

`tests/model-catalog.test.ts` pins the three patch layers to identical
catalogs, asserts the entry facts and the exact four-entry id order
(`deepseek-flash` first), and pins the TUI layer's restated keys, so the
deliberate 3× repetition (matching the existing per-surface plugin-row
idiom) cannot drift silently.

## Alternatives considered

- **Editing the pinned runtime or `upstream/` to extend `DEFAULT_MODELS`.**
  Rejected: `upstream/` is pinned source and the runtime ships as an npm
  tarball; Oh-DSH adapts behavior in its own composition layers.
- **Bumping the pinned runtime to a release that lists the model.**
  Rejected so far: the first release whose catalog lists `deepseek-flash`
  is 0.1.5-rc.1, and no released dsh-TUI declares that line (peer ceiling
  `0.1.2-rc.1`); see
  [2026-09-11-dsh-0.1.2-rc.1-upgrade](../process/2026-09-11-dsh-0.1.2-rc.1-upgrade.md).
- **Seeding a `llm-deepseek:` section into the user's settings.yaml on first
  run.** Rejected: the settings document is user-owned state that the web
  Models page reads and writes; pre-writing a section would fight that owner
  and leave stale entries behind when the distribution catalog changes.
- **A single shared patch fragment generated into the three layers at build
  time.** Rejected: the patch files are hand-maintained source read by both
  humans and the runtime loader; hidden generation adds machinery for ~25
  lines per surface, and the drift risk is already covered by the contract
  test.

## Consequences

- All three surfaces list DeepSeek-V4.1-Flash by default under its official
  id. The original stopgap (2026-09-08) used a temporary id
  `deepseek-v4.1-flash-expires-on-0910` because the official name had not
  shipped yet; it was replaced by `deepseek-flash` on 2026-09-11 when the
  pinned runtime moved to 0.1.2-rc.1.
- The entry list shadows the pinned runtime's `DEFAULT_MODELS`: a future
  runtime release that adds or retunes its own defaults will not surface
  here until the three rows are updated. That is the cost of a
  distribution-owned catalog; the contract test at least keeps the three
  surfaces identical. The layers are deleted wholesale — rows and contract
  test together — when the runtime that natively ships `deepseek-flash`
  (0.1.5-rc.1) becomes reachable.
- DeepSeek routes the retired `deepseek-v4-flash` /
  `deepseek-v4-flash-vision-exp` ids to V4.1 Flash temporarily and will
  route `deepseek-v4-pro` the same way after 2026-09-14 12:00 CST, so the
  legacy entries are display-only history until that deletion.
- A user's saved `llm-deepseek.models` section (if present) still wins over
  the distribution defaults, including hiding the entry; nothing in this
  change touches user state.

## Testing

`tests/model-catalog.test.ts` parses all three patch layers (with the TUI
file's `!!js` expression scalars kept as raw strings) and asserts catalog
equality across surfaces, the exact four-entry id order
(`deepseek-flash` first), catalog invariants the adapter enforces (unique
ids; image limits only on image-capable models), the entry's name, context
window, modalities, and image limits, and the TUI layer's restated
thinking/effort keys.
