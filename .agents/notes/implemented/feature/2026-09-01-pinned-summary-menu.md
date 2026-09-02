# Agent Note: Refine the pinned-summary menu

Status: implemented

English | [中文](2026-09-01-pinned-summary-menu.zh.md)

## Problem

The pinned-summary plugin exposes useful session context, but its floating
menu is only a plain-text snapshot. Long summaries are difficult to scan,
Markdown and code lose their structure, and the user cannot copy the summary,
open the owning session, or inspect the complete text. The surface also gives
little feedback while session data is loading or unavailable, and its current
focus and ARIA behavior is too weak for keyboard users. Any refinement must
remain a small Web-client feature and must not destabilize the sidebar or the
existing pinned-summary service contract.

## Decision

The pinned-summary client remains a browser-only plugin backed by the existing
`locale` and `sessions` services. The public `PinnedSummary` interface stays
unchanged (`isOpen`, `setOpen`, `subscribe`, and `toggle`); richer behavior is
implemented inside the floating surface and does not require a second state
store or a new host API.

The surface derives its content from the selected session snapshot. A non-empty
compaction summary is preferred, with the latest assistant text as a bounded
fallback. Session-list and conversation data supply the available metadata:
title, status, working directory, provider/model, tool activity, and update or
message times. Missing fields remain absent rather than being guessed. Loading,
error, blank, no-session, and no-summary states each have explicit localized
copy.

Summary text is rendered with DOM nodes and `textContent` plus a small,
dependency-free Markdown presentation layer for paragraphs, lists, block
quotes, inline code, and fenced code blocks. It truncates the preview at a
stable 480-character limit and keeps the content in a 220px scrollable
viewport inside a panel capped at 500px, so the action controls remain visible
without scrolling the whole menu. A localized control reveals or collapses the
full summary within that bounded viewport. Untrusted HTML is never assigned to
`innerHTML`; links are emitted only for `http` and `https` URLs. Copy uses the
browser clipboard when it is available and reports success or failure without
making clipboard access a requirement for rendering.

The menu adds explicit actions for copying the current summary and opening the
corresponding session through the existing `sessions.open(id)` method. A
refresh or regenerate action is intentionally omitted until the runtime
exposes a real summary-generation operation. Opening and closing preserve the
existing outside-pointer and Escape behavior, make the close control the
initial keyboard target, restore the previously focused element on close, and
expose dialog labeling, hidden state, button names, and live status updates
through ARIA attributes. The panel remains non-modal so normal application
keyboard navigation can continue outside it. The existing
`data-oh-dsh-summary-pinned` marker and toolbar toggle continue to provide the
sidebar/summary mutual exclusion.

The change is deliberately limited to Issue #180's pinned-summary surface and
its focused tests. It does not add an unrelated feature, a new runtime API, or
a refresh button without a backing operation. Shared helpers are kept small,
and the tests are intentionally minimal and behavior-focused rather than
duplicating every rendering branch.

## Alternatives considered

**Add a full Markdown dependency.** Rejected because this small preview needs
only a bounded subset of Markdown, while a renderer dependency would increase
bundle size and introduce another HTML sanitization boundary.

**Continue using `innerHTML` for all content.** Rejected because summaries and
links originate in session data; constructing nodes explicitly keeps markup and
URL policy auditable and prevents accidental HTML or script execution.

**Extend `PinnedSummary` or add a new runtime summary API.** Rejected because
the requested interactions can use the existing service and session binding;
changing the public contract would widen the Desktop/Web integration surface
for no immediate benefit.

**Show a refresh/regenerate button that only re-renders local data.** Rejected
because it would imply work the runtime cannot perform. The menu should gain
that action only when a genuine, observable generation API exists.

**Replace the floating menu with a separate route or heavy modal.** Rejected
because the current anchored panel is part of the sidebar workflow and already
has the required positioning and mutual-exclusion hooks; a route would make a
quick glance slower and duplicate navigation state.

## Consequences

The pinned summary becomes useful for scanning and keyboard operation without
adding a new package or changing the service boundary. Users can move from a
preview to the source session and copy the complete summary, while
long or malformed input remains bounded and safe. The menu has more localized
strings and a little more DOM/CSS state to maintain, and clipboard behavior
still depends on browser permissions.

The implementation deliberately treats provider/model, tool, and timing data
as optional presentation context. It does not rank sessions, infer trust, or
turn a popularity or status field into a security decision. Markdown coverage
is intentionally limited; unsupported constructs remain readable text rather
than being silently interpreted.

## Testing

Pure derivation tests pin compaction precedence, assistant fallback, preview
truncation, metadata extraction, and lifecycle state. The existing layout
contract test was updated for the bounded summary body; no separate DOM
regression test or test-only source scan was added because the repository has
no DOM test harness for this plugin. The normal repository gates were run on
the Node 24
project runtime: `pnpm run typecheck`, the focused pinned-summary/layout tests,
`pnpm test` (330 passed,
10 platform skips), `pnpm run build`, `pnpm run verify:agent-notes`,
`pnpm run verify-translation-pairing`, and `git diff --check` all passed. The
browser smoke command was attempted but cannot start on the headless server
because Chromium has no X server or `$DISPLAY`; this is an environment gap,
not a source or bundle failure.
