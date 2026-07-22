# Agent Note: Docked web goal bar

Status: implemented

English | [中文](2026-07-22-docked-web-goal-bar.zh.md)

## Problem

The web UI had no goal surface at all: the goal stack shipped with model tools, the TUI/ACP adapters, and the `/goal` command, but the browser client exposed none of it — no runtime verbs, no indicator. This change introduces the client goal verbs (runtime session methods over RPC) and the first goal UI together. Placement follows the redesign's premise that goal presence belongs to the composer's context: the goal is a property of the work the user is about to prompt, so its indicator docks directly above the message composer as a rounded-top strip tucked under the composer card's top edge. The mock keeps only a sparkle, a phase word ("Ongoing/Paused/Blocked Goal"), the truncated objective, and edit/clear icon actions, with resume appearing only on a paused goal.

## Decision

`GoalBar` (`packages/client/ui-conversation/src/client/skeleton/GoalBar.tsx`) is a new props-driven, self-contained component; `ConversationRoot` mounts it immediately before the composer `InputBar`. The strip's CSS mirrors the composer's horizontal geometry (32px side padding, 776px centered cap) plus the mock's 12px inset, and a -10px bottom margin eats InputBar's 8px top padding and tucks its square bottom edge 2px under the composer card's top edge. All strip states share one fixed 38px height so switching between them never resizes it. Loading (`goal === undefined`), absent (`goal === null`), and `phase === 'complete'` render nothing — a completed goal is history, not chrome.

Visibility drives the label and actions: active shows "Ongoing Goal" with edit/clear; paused shows "Paused Goal" and adds a resume icon button; blocked shows "Blocked Goal" and carries `blockedReason.message` as the strip's `title` tooltip. Goal creation lives on the `/goal` command, not in the bar. The pencil swaps the strip for an inline edit form prefilled with the current objective: Enter or the check button saves through `GoalBarActions.onEdit(objective)`, Esc cancels, and an all-whitespace objective keeps save disabled. The form closes only when the edit succeeds; a failure preserves the draft and displays the error in the bar. Resume and clear failures are displayed there as well. Clear otherwise calls `onClear` directly with no confirmation — a clear keeps a durable tombstone, so nothing is unrecoverable. An effect keyed on the goal's id drops the edit form when the goal's identity changes, so a surviving draft can never be written over the goal that replaced it.

`GoalBarActions` lives in the contract layer (`contract/slots.ts`, next to the `ConversationInjected.goalActions` slot it feeds) and carries exactly the rendered verbs: `onEdit`/`onResume`/`onClear`. Each callback asynchronously returns an explicit success/failure result so `GoalBar` owns its transitions and error display. `apply.ts` wires them to the runtime session methods; the runtime session resolves the current goal's compare-and-set ref internally, so the UI passes no ref.

The runtime session gains the goal surface the strip (and future UI) needs: `fetchGoal` populates the snapshot on open, and a live `context/message` carrying `goal/change` meta triggers a coalesced refetch — concurrent triggers share the in-flight `goal.get`, while a trigger received during that read schedules one coalesced trailing read so independently ordered notifications and GET responses cannot leave stale state. Window replays never refetch, and matching the meta kind (rather than a goal key) also catches clear tombstones written by other clients. The six mutation verbs fold transport failures into `{ ok: false }` results like every sibling session method, and a get result older than a mutation response that landed mid-flight is dropped.

The strip's background is `--dsw-alias-interactive-bg-hover` rather than the mock's literal `#F5F6F7`: the translucent hover gray resolves to that value over the white light-theme base and lifts the strip off the composer card in dark mode, where a static light token would sink. All colors are `--dsw-*` tokens.

## Testing

`packages/client/ui-conversation/tests/goalbar.spec.tsx` pins the behavior through props alone: loading/absent/complete render nothing, the active strip renders label/objective and fires clear, the edit form prefills, rejects empty, saves on Enter, cancels on Esc, and resets when the goal's identity changes, the paused strip fires resume, and the blocked strip exposes the reason tooltip. Component failure-path cases prove that a failed edit preserves its draft and that edit/resume/clear errors remain visible in the bar. The skeleton specs mount `ConversationRoot` with and without `goalActions`; the undefined case is seeded with an active goal, so the missing gate — not the missing goal — is what hides the strip. Runtime session specs pin the folded-error results, the live-only in-flight-plus-trailing refetch, and the stale-read guard. A keyless real-browser smoke boots the assembled application through `boot → RPC → runtime → GoalBar` and records an inline snapshot of the rendered label, objective, and actions.

## Alternatives considered

- **Put the strip in the session header** — rejected because the redesign's premise is that goal presence belongs to the composer's context; a header strip cannot dock into the composer card.
- **Render a "Loading goal…" placeholder for `undefined`** — rejected: the strip would flash and collapse on every session open, chrome noise for a sub-second state.
- **Include an inline create affordance when no goal is set** — rejected after implementation review: goal creation lives on the `/goal` command, matching the pattern where the model creates goals on request; the bar is a status indicator, not a creation surface.
- **Carry the full verb set (`onPause`/`onComplete`) in `GoalBarActions`** — rejected as speculative generality: no consumer calls them, so the interface carries only the rendered verbs.

## Consequences

- Goal presence in the web UI is a composer-docked strip: sparkle, phase label, truncated objective, and edit/clear (plus resume when paused) — the browser client's first goal surface.
- The runtime session exposes the goal verbs over RPC with folded transport errors, and refreshes the snapshot's goal on open and on live goal-change meta (coalesced, guarded against stale reads).
- Objective editing is reachable from the UI for the first time, through `goal.edit` with the runtime-owned ref; pause/complete remain available to other surfaces (`/goal`, model tools).
- `goal === null` renders nothing; the composer carries no persistent create affordance — creation is the `/goal` command's job.
