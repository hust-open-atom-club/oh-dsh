# Agent Note: Save as image for finalized assistant responses

Status: implemented

English | [中文](2026-09-02-save-as-image-action.zh.md)

## Problem

Issue #181 asks for a per-response "save as image" action so a finished answer can leave the app as a picture — the way people actually paste an AI answer into a chat, a ticket, or a slide. The transcript already renders everything the image needs (Markdown, code blocks, tables, inline images), but nothing could turn that rendered subtree into a file: DSH has no client-side capture surface, and its Host protocol has no export verb.

The natural home for the control already existed. `ui-conversation` declares the `conversation.chat.assistant-actions` list slot and renders it through `TurnTailNodeView` into `MessageIconActions`, skipping the slot entirely when the assistant node carries no `messageId` — the seam the message-feedback package [already uses](2026-08-11-message-feedback-web-surface.md). What nobody had done was point that slot at something other than a remote call, and get a pixel-accurate copy of a *different* DOM node than the one the control renders in.

## Decision

A new browser-only plugin, `@oh-dsh/save-as-image`, contributes one `conversation.chat.assistant-actions` entry (id `save-as-image`, order 20, after feedback) and captures the response from the DOM the app already drew.

**The capture target is located structurally, not by filtering.** Every chat node renders as a sibling `<div class="flowItem" data-chat-anchor-key=… data-chat-flow-kind=…>` under the conversation list, and the action strip lives in a *different* sibling whose root carries `data-turn-tail`. The control walks from its own button up to that turn-tail row and then across `previousElementSibling` (bounded at ten hops) to the nearest `data-chat-flow-kind="assistant-step"` element. Because the strip is a separate sibling node, the captured subtree excludes the action controls by construction — no `filter` callback, no hidden-marker plumbing, nothing to keep in sync with the strip's own markup. There is no `data-message-id` attribute in the DOM to key off, and asking upstream to add one would mean editing pinned source.

**Rendering is `html-to-image`, bundled into the client bundle.** `toBlob` at `pixelRatio: 2` produces the PNG; the same call retries once at `pixelRatio: 1` for responses tall enough to blow the canvas budget, and a second failure propagates into the row's failure feedback rather than being swallowed. Fonts are pre-resolved with `getFontEmbedCSS` and handed to the render as `fontEmbedCSS`; if that pre-pass throws, the render degrades to `skipFonts: true` — the issue explicitly asks that a font-embedding failure cost fidelity, not the export. The package is an ordinary npm dependency bundled by esbuild, while `@deepseek-ai/*` stays external and resolves through the host ModuleLoader at runtime, exactly like the feedback package's primitives dependency.

**The result never leaves the machine.** The blob is downloaded through an object URL under `dsh-response-<sanitized message id>.png`. The plugin declares no Host Remote, registers no tool, and adds no endpoint: the manifest's `dsh.client.inject` is the feedback list minus `api-remotes`. A source-level contract test pins this by asserting the plugin sources contain neither `fetch(` nor `XMLHttpRequest`.

**Feedback states mirror the shared action row.** The control is a 28px icon button in a `Tooltip` from the host primitives package (`IconDownloadOutline16`, swapping to `IconCheckOutline16` for ~1.5s after a save), disabled with a `status.capturing` label while the render runs, and reporting failure through the same `role="status"` inline text pattern feedback uses. Its dictionaries live in an `oh-dsh.save-as-image` locale namespace with zh as the key-set source of truth, so both surfaces get copy in both languages.

Enrolling the plugin touches the whole Oh-DSH registration surface, which is larger than a first-time contributor expects: `scripts/build.mjs` (build outputs + `clientExternal`), the root `cordis.patch.yml` and `web/cordis.patch.yml` compositions, `src/profile.ts`'s bundled client plugin roster, `web/package.json`'s client inject list, `scripts/stage-runtime-lib.mjs`'s staged-package file list, and `scripts/stage-dsh.mjs`'s required-artifact gate. Each one is fail-loud somewhere downstream (build, `verify-translation-pairing`-adjacent roster tests, staging, or the runtime smoke), so a missed entry cannot ship silently.

## Alternatives considered

**A Host-side headless renderer.** Render the message's Markdown in the Host (or a bundled headless browser) and serve the PNG. Rejected: it reintroduces a network hop and a browser binary into a plugin that needs neither, duplicates the client renderer's exact styling stack to stay pixel-consistent with what the user sees, and turns a purely local convenience into an attack-relevant image-producing endpoint.

**Re-rendering the Markdown into a detached node, then capturing that.** Rejected: the host's renderer handles code highlighting, tables, KaTeX, and inline images with its own stylesheets; a parallel "clean" renderer would drift from the transcript on every upstream styling change, and the user would export something other than what they read.

**Adding a capture affordance to upstream `ui-conversation`.** Rejected: `upstream/` is pinned source and Oh-DSH adapts upstream behavior from `plugins/`. A `data-message-id` attribute plus a built-in button would also be a permanent API commitment by upstream for a need one plugin satisfies today with a slot contribution.

**Capturing the whole conversation list and filtering out the strip.** Rejected: a `filter` callback keyed on marker attributes couples the export to the strip's internal markup and silently includes whatever the filter misses. The sibling-node walk gets exclusion for free and fails loud when the expected shape is absent.

## Consequences

The export is only as stable as the host's DOM contract: `data-chat-flow-kind="assistant-step"` and the `data-turn-tail` root are upstream rendering details, and a rename breaks capture at click time. The failure path is deliberately loud — the row shows "could not export image" — but nothing detects the breakage before a user hits it, and no test exercises a real capture (that needs a live browser surface).

Capture fidelity inherits `html-to-image`'s limits. Content the renderer draws outside the captured subtree's stylesheets, or resources it cannot inline, can land differently in the PNG; very tall responses consume the retry, and a response that fails at both pixel ratios is simply not exportable. Because the image is inlined locally, nothing is uploaded — but inlining means the render may fetch same-document resources (images, fonts) that the page itself already loaded.

The control appears only where the runtime renders the slot, so an interrupted turn offers nothing to save — the same finality rule feedback obeys. The plugin ships in both the Desktop and Web compositions and is absent from the TUI, which has no assistant-actions strip to host it.
