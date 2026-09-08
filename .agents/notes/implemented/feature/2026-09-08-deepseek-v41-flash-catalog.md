# Agent Note: DeepSeek-V4.1-Flash in the default model catalog — a surface-patch composition row

Status: implemented

English | [中文](2026-09-08-deepseek-v41-flash-catalog.zh.md)

## Problem

DeepSeek serves a new `DeepSeek-V4.1-Flash` model (id
`deepseek-v4.1-flash-expires-on-0910`, text+image input, retired after
2026-09-10). It must appear in every Oh-DSH surface's model picker by default,
with no user configuration.

The default advisory catalog is compiled inside the pinned runtime plugin
`@deepseek-ai/dsh-llm-deepseek@0.1.2-alpha.3` (`DEFAULT_MODELS`:
deepseek-v4-flash, deepseek-v4-pro, deepseek-v4-flash-vision-exp). The
runtime arrives as an npm tarball pinned by `dsh-source.json`; newer runtime
releases (checked through 0.1.3-alpha.2) still ship the same three entries,
and `upstream/` is pinned source that Oh-DSH must not edit. So the extra
model can only come from this repository's composition layers.

## Decision

Give the `llm-deepseek` dsh-base row an entry config in each of the three
surface bundle patches — the root `cordis.patch.yml` (Desktop),
`web/cordis.patch.yml` (Web), and `plugins/tui/cordis.patch.yml` (TUI) —
setting `config.models` to the runtime's three shipped models plus the new
`deepseek-v4.1-flash-expires-on-0910` entry (contextWindow 1000000,
text+image, imagePixelBudget 640000, imageMaxBytes 1048576 — the runtime's own
vision-model image limits).

This uses the layering dsh-base itself documents: a later bundle patch
addresses the row by id and replaces its whole `config`, and the plugin layers
its entry config under the optional `llm-deepseek:` user-settings section.
Because settings resolution is schema defaults → entry base → user section
(arrays replace whole), the entry list becomes the distribution's default
catalog, a user's own `llm-deepseek.models` still overrides it live without a
restart, and every other field of the section keeps falling back to schema
defaults. The catalog stays advisory —
[catalog discovery](../architecture/2026-07-15-llm-model-catalog-and-acp-selection.md)
never validates requests, so unlisted model ids keep passing through.

The existing three entries restate the runtime's ids verbatim. The incoming
request's `deepseek-v4-flash-exp` (text+image) was read as the runtime's
vision entry `deepseek-v4-flash-vision-exp` — the id the endpoint serves —
rather than introducing a second near-duplicate id. The default agent model
selection (`agent-default-model` → `deepseek-v4-flash`) is unchanged: the
change adds a picker option, not a new default.

`tests/model-catalog.test.ts` pins the three patch layers to identical
catalogs and asserts the V4.1 entry's facts, so the deliberate 3× repetition
(matching the existing per-surface plugin-row idiom) cannot drift silently.

## Alternatives considered

- **Editing the pinned runtime or `upstream/` to extend `DEFAULT_MODELS`.**
  Rejected: `upstream/` is pinned source and the runtime ships as an npm
  tarball; Oh-DSH adapts behavior in its own composition layers.
- **Bumping the pinned runtime to a release that lists the model.** Rejected:
  no published runtime release (through 0.1.3-alpha.2) contains a V4.1 entry,
  and a runtime bump is a larger, unrelated pin change.
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

- All three surfaces list DeepSeek-V4.1-Flash by default; the model id embeds
  its retirement date, so after 2026-09-10 the entry should be dropped from
  all three layers (and the contract test) in one change — the id will keep
  passing through to the endpoint either way.
- The entry list shadows the pinned runtime's `DEFAULT_MODELS`: a future
  runtime release that adds or retunes its own defaults will not surface here
  until the three rows are updated. That is the cost of a distribution-owned
  catalog; the contract test at least keeps the three surfaces identical.
- A user's saved `llm-deepseek.models` section (if present) still wins over
  the distribution defaults, including hiding the new entry; nothing in this
  change touches user state.

## Testing

`tests/model-catalog.test.ts` parses all three patch layers (with the TUI
file's `!!js` expression scalars kept as raw strings) and asserts catalog
equality across surfaces, the exact four-entry id order, catalog invariants
the adapter enforces (unique ids; image limits only on image-capable models),
and the V4.1 entry's name, context window, modalities, and image limits.
