# Agent Note: The `todo_write` tool — model task list as event-sourced session state

Status: implemented

English | [中文](2026-06-29-todo-write-tool.zh.md)

## Problem

The harness gives the model bash and subagent tools but no way to record a structured task list. A todo list serves two co-equal purposes: it steers the model to plan multi-step work and keep the active task unambiguous (at most one active, exactly one while work remains), and it gives the human a live progress checklist. The ACP protocol has a native `plan` sessionUpdate that editors (Zed) already render, but the bridge never emitted one. Every reference coding agent surveyed (claude-code, opencode, codex, oh-my-pi, pi) ships some form of this; the harness had nothing.

## Decision

Add a model-facing `todo_write(todos: [{ content, status }])` tool whose whole-list state lives on the event-sourced session log as a new `todo/write` `SessionEventMap` variant. Both the stdio UI and the ACP bridge render off the existing `session/event` — the ACP bridge maps the list to a `plan` sessionUpdate.

### Whole-list replace, three-state status

The model sends the ENTIRE list every call; the new list replaces the old (last-write-wins on replay). This is the shape claude-code V1, opencode, and codex `update_plan` all use, and the shape the model is most trained on — no per-item ids, no delta protocol. `status` is exactly `pending | in_progress | completed`: the same triple as codex `update_plan` and, crucially, **identical to the ACP `PlanEntryStatus`**, so the bridge maps it 1:1 with no lossy translation.

### State on the session log, not a service

The list is appended as a `todo/write` event carrying the full `{ todos }` snapshot. The harness is event-sourced — the LLM history, tool calls, and turn structure all live on the log — so the todo list lives there too. This buys durability, replay, and `session/load` reconstruction for free: a reopened session re-derives the current list (the last `todo/write`) and the ACP bridge re-emits the `plan` on load, with no separate persistence backend, no in-memory service to rehydrate, and no extra wiring. An in-memory `ctx.todos` service would have had to reinvent all of that.

### NOT a surface event

`todo/write` is deliberately excluded from `SurfaceEventType`. The surface is the projection that produces the LLM message history (`deriveMessages()`); a todo write produces no conversation message. So it carries no `surfaceOp`, never joins the ordered surface, and never reaches `deriveMessages()` — it is durable, replayable *UI* state that travels alongside the conversation without being part of it. (The dev-mode invariants still require it to sit inside an open turn, which it always does: it is appended mid-step during a tool call.)

### Priority synthesized only at the ACP boundary

ACP's `PlanEntry` requires `content` + `priority` + `status`, but a `TodoItem` has no priority — the model never reasons about it. Rather than burden the schema with a field the model must always supply, the bridge synthesizes a constant `priority: 'medium'` on every entry when it builds the `plan`. Priority is an ACP wire requirement, not a harness concept, so it lives at exactly the boundary that needs it.

### Dropped vs claude-code V1: `activeForm`, id, priority

claude-code V1's item is `{ content, status, activeForm }`; later (V2) it grew ids, dependencies, and ownership — but only to support agent *swarms* (disk-backed, lock-guarded, per-item mutation). This tool keeps the item at the minimum: `{ content, status }`. No `activeForm` (the present-continuous label) — the UI shows `content`; no id — whole-list replace needs no stable identity; no priority — see above. Each dropped field is one less thing the model must produce on every call.

### Single owner — no swarm machinery (YAGNI)

Each list belongs to the calling agent session, and non-agent calls are rejected. There is no shared scope, resolver, or delta protocol. Cross-agent lists would require per-item log deltas and explicit scope selection, so they remain a separate future design.

### Validation: the cheap middle

The schema enforces type/required/enum. Beyond that, `execute` rejects empty or duplicate `content` and more than one `in_progress` task. claude-code leaves single-in-progress to the prompt; oh-my-pi enforces it in code. We take the middle: enforce the cheap invariants that make a plan *coherent* (no blank tasks, no dupes, at most one active), but leave ordering and the discipline of keeping the list current to the model via the tool description. A rejected write returns an `isError` result so the model self-corrects.

## Why no cordis-catalog entry / no `@mode`

`todo/write` is a member of `SessionEventMap`, not a first-class cordis `interface Events` event. The catalog generator (`scripts/gen-cordis-catalog.ts`) scans `interface Events` declarations; a `SessionEventMap` variant rides the existing `session/event` emit and produces no new catalog row. So it carries no `@mode` tag (which the generator requires only on `interface Events` members) — adding one would be meaningless.

## Testing

Four tiers, designed up front:
- **Unit** — the session event (append/snapshot-clone/last-write-wins/not-on-surface); the tool (schema shape, arg validation via the real `ctx.tools.execute`, value validation, the event append + replacement, no-agent rejection, `presentCall`, HMR-safety); the ACP `todosToPlan` mapping; the stdio render arm.
- **Real-Loader path** — the plugin run through `Loader.unwrapExports`, asserting the namespace export shape survives (it HAS `inject`, so a stray default would crash at load — postmortem/0001).
- **Full-loop integration** — a scripted mock model calls `todo_write` through the real agent loop; the `todo/write` event lands and a second call replaces it.
- **`session/load` replay** — a persisted `todo/write` re-emits the `plan` update when a fresh ACP bridge loads the session.
- **With-key e2e + snapshot** — a real prompt induces a `todo_write`; the snapshot expected output gains the `plan` notification and the log event.

## Alternatives considered

- **In-memory `ctx.todos` service** — would reinvent durability, replay, and `session/load` reconstruction the log gives for free.
- **Per-item delta protocol** — only needed for a shared multi-owner list, which is out of scope; whole-list replace is simpler and matches the references.
- **Tool in `core/`** — `todo_write` is an extension tool registering on `ctx.tools`, not part of the spine; it lives in its own `packages/todo/` group like other tool families.

## Consequences

The todo list is durable, replayable session state: a persisted `todo/write` re-emits the editor's `plan` update on `session/load`, and the log — not plugin memory — is the single source of truth. Whole-list replace means one tool call per update with last-write-wins; there is no delta protocol to reconcile. The event stays off the surface, so a todo update never perturbs the derived model history — the model sees only its own tool call and result.
