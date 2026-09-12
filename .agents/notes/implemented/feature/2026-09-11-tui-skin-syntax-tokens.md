# Agent Note: Skin-owned syntax tokens for TUI markdown code blocks

Status: implemented

English | [中文](2026-09-11-tui-skin-syntax-tokens.zh.md)

## Problem

The user reported the installed `ohdsh tui` (0.2.1, dsh-TUI beta.4)
renders markdown with washed-out colors. Forensics against the installed
build: the active skin resolves correctly (`theme.json` →
`oh-dsh-skin-deep-current` through the registered static resolver), and
headings/inline code carry the skin accent. The faint elements are fenced
code blocks: dsh-TUI's markdown renderer maps highlight.js token classes
onto the theme keys `syntaxKeyword/String/Comment/Number/Function/Type/
Variable/Operator/Punctuation/Constant`, and the Oh-DSH skin palettes
defined none of them. Every code block therefore inherited the terminal
builtin `dark` palette's fixed grays — comments rgb(116,128,141),
punctuation rgb(122,134,148), operator rgb(147,161,176) — near 3:1 on a
dark background. dsh-TUI v0.10.0 ships the same builtin values, so the
runtime bump alone does not change this.

## Decision

`tuiColors()` in `plugins/skins/src/skins.ts` now emits all ten syntax
tokens from each skin's shared tokens: keyword=brand-primary,
string=success, comment=label-tertiary, number=warn,
function=brand-hover, type=the skin's merged accent (matching upstream's
violet-for-types convention), variable=label-primary,
operator/punctuation=label-secondary, constant=error. The browser skins
already color code blocks from the same token families, so the terminal
and browser code blocks agree per skin. Light skins (Porcelain) get dark
syntax on the light base through the same mapping.

## Consequences

- Plaintext and fenced code blocks follow the skin: variable/identifier
  text renders at the skin's primary label instead of the builtin's fixed
  gray; comments lift from the builtin rgb(116,128,141) to the skin's
  tertiary label.
- The installed 0.2.1 keeps its old theme files: its skins plugin rewrites
  `~/.ohdsh/tui/themes/*.json` on every launch, so the improvement lands
  with the release that carries this change (manual edits to the theme
  files would be reverted on next launch).
- Verified end-to-end against the installed beta.4 renderer with the new
  theme JSONs: plaintext blocks emit the skin's label-primary, `const`
  emits the skin accent, comments emit the skin tertiary.

## Alternatives considered

- **Fix the builtin palette contrast upstream.** Rejected for this round:
  pinned source must not be edited here, and v0.10.0 kept the same
  builtin values, so the skin layer is the lever Oh-DSH owns today.
- **Override only `subtle`/`inactive`.** Rejected: those keys are not on
  the code-block path; the fence line already carries the skin tertiary,
  and the report was specifically about markdown content contrast.

## Testing

`tests/skins.test.ts`, `tests/model-catalog.test.ts`, `tests/tui.test.ts`
pass; full suite 402 tests, 0 failures; a harness under the task audit
directory replays `applyMarkdown` through the installed beta.4 renderer
with the regenerated theme JSONs and shows the new token colors in the
emitted ANSI.
