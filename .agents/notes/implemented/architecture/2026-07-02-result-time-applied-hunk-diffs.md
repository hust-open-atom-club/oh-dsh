# Agent Note: Result-time applied-hunk diffs for file mutations

Status: implemented

## Problem

The [tagged render-intent union](2026-07-02-tool-render-intent-union.md) gave `dsh-tool-fs` write/edit a `card:'diff'` at CALL time, derived purely from the tool's args: write ⇒ `{oldText:null, newText:content}` (the whole new file), edit ⇒ `{oldText:old_string, newText:new_string}` (the bare replaced snippet). An editor renders that as an inline diff, but it is a **context-free** diff — the bare `old_string`→`new_string` with no surrounding lines, and a `replace_all` that touched five scattered sites still renders as one snippet pair.

Driving `claude-agent-acp`'s own ACP bridge shows what a full editor diff looks like: after the mutation applies, it emits a SECOND `tool_call_update` whose diff is the **applied hunk with ±3 context lines** (and one hunk per changed site for `replace_all`), reconstructed from the tool's `structuredPatch`. That result-time hunk is what makes Zed show the change *in place* in the file rather than as a floating snippet. Our tools stopped at the call-time snippet; the completed result carried only the plain "updated successfully" text, no diff.

The obstacle is a seam boundary: `presentResult(args, result)` is a **pure function of `args` + the model-facing `result` (`{content, isError}`)** — it runs on live streaming AND on session-log replay, so it must be replay-deterministic and cannot do I/O. It never sees the file's before/after content, and `FsEditOutcome`/`FsWriteOutcome` carried only a replacement count + version, not the text. So there was no way to compute — or even carry — an applied hunk to the presenter.

## Decision

Add a **persisted, tool-private presentation channel** so a tool's `execute` can attach a result-time render payload that survives replay, and use it to carry the applied-hunk diff.

### 1. A `meta` channel on the tool result (core)

`ToolDefinition.execute` may now return either its model-facing `ContentBlock[]` (unchanged, the common case) OR `{ content: ContentBlock[]; meta?: unknown }`:

```ts ignore-check
type ToolExecuteReturn = ContentBlock[] | { content: ContentBlock[]; meta?: unknown }
```

`meta` is tool-owned `unknown` that the core persists without interpretation. `Session.append` rejects non-JSON values, and replay passes the stored payload back to `presentResult`; presentations therefore reproduce without I/O or recomputation. Runtime validation avoids adding a shared serializable-value dependency to the tools core.

This is the general shape ("a tool attaches durable result presentation"), not an fs-specific one — any tool can use it.

### 2. The tool computes the hunk; the backend returns before/after (fs)

Per the [capability-seam split](2026-06-13-capability-seams.md), the storage backend returns only **storage facts** and the model-facing tool owns **presentation**:

- `dsh-fs` widens `FsEditOutcome` with `{ before: string; after: string }` and `FsWriteOutcome` with `{ before: string | null; after: string }` (`before: null` ⇒ a create, or an existing-but-undiffable binary/non-UTF-8 file). The local backend already holds both texts at write time; it returns them as raw LF-normalized text, with **no diff/UI concept** entering the seam.
- `dsh-tool-fs` stores contextual hunks in `meta: { diffs: FileDiff[] }`. Successful mutations always complete with a diff card because ACP result content replaces the pending card: creates or unchanged overwrites fall back to an args-derived whole-file diff, while edits use applied hunks. Failed mutations carry no diff metadata and render their error normally.

### 3. The bridge renders a `diff` result card

`ToolResultView` gains a `DiffResultView { card:'diff'; title?; diffs: FileDiff[] }`; the bridge's result-side `switch (view.card)` gets a `diff` arm emitting the `{type:'diff'}` `ToolCallContent` blocks (mirroring the call-side arm). An ACP `tool_call_update.content` REPLACES the call's content in an editor, so the result diff **supersedes** the call-time snippet (and keeps the model-facing result text from clobbering it) — the two-update sequence (call snippet, then result diff) matches `claude-agent-acp` exactly.

## Alternatives considered

**Hand-rolling or vendoring the diff algorithm.** Contextual hunks have established edge cases, so `dsh-tool-fs` uses the typed [`diff`](https://www.npmjs.com/package/diff) package and normalizes `structuredPatch` output in one module. The repository's vendoring policy applies to its framework source, not every leaf utility.

## Consequences

`tool/result` events may now carry a tool-private `meta` payload — part of the on-disk vocabulary, runtime-gated to JSON by `Session.append` — and any tool can attach durable result presentation without another core change. The diff card reproduces on session reload and snapshot replay for free: it is read back from the log, never recomputed. The costs: an overwrite holds both the prior and new text in memory to compute a UI-only hunk (`TODO(overwrite-diff-bound)`), and `dsh-tool-fs` carries a small, well-known runtime dependency.

## Non-goals

- **Live incremental diff streaming.** The hunk is computed once, after the mutation completes; there is no per-keystroke diff.
- **Diffing a binary/non-UTF-8 overwrite.** `before` is `null` for such a file (it has no text diff basis); the write still succeeds and the result renders a whole-file diff (`oldText: null`) rather than a contextual hunk.
- **Rename/move diffs.** Only content diffs of a single resolved path.
- **Bounding the overwrite diff basis.** An overwrite reads the whole prior file into memory to compute the contextual hunk (on top of the new content already held), so a very large text overwrite allocates both texts for a UI-only diff. A future refinement can bound the pre-read and fall back to a whole-file / no contextual diff above a size threshold; tracked as `TODO(overwrite-diff-bound)` at the read site.

## Related

- Completes the one remaining representation difference named as a non-goal in [Tagged render-intent union](2026-07-02-tool-render-intent-union.md) — that Agent Note's Non-goals section is updated to record that applied-hunk diffs shipped here.
- Builds on the [filesystem capability seam](2026-06-17-filesystem-capability-seam.md) (the before/after are storage facts the backend returns) and [event-sourced sessions](2026-06-11-event-sourced-sessions.md) (the `meta` payload persists on the `tool/result` event, so replay reproduces the card).
- The `meta` channel is deliberately generic: a future tool (a structured search, a data-table result) can attach its own durable result presentation without another core change.
