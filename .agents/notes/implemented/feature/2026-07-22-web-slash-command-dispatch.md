# Agent Note: Web slash-command dispatch

Status: implemented

English | [中文](2026-07-22-web-slash-command-dispatch.zh.md)

## Problem

The [human `/goal` command](2026-07-19-human-goal-command.md) shipped with two dispatch points: the TUI and ACP adapters intercept leading-`/` prompts and execute them through the command registry without a model turn. The web UI had no interception anywhere on its path — composer, client runtime, RPC, and host all passed the text through — so `/goal fix the flaky test` reached the model as an ordinary user message. The command cost a model turn, produced no deterministic state change, and could be reinterpreted, while the web host composition never even mounted the command registry or the `/goal` producer.

## Decision

The web host dispatches slash commands at its own adapter boundary, symmetric with ACP: inside the api-proxy `sessions.prompt` handler in `packages/host/runtime/src/api-proxy.ts`, before `agent.send`/`agent.steer`. `bootHost` mounts `CommandService` and `command-goal` right after the goal stack, so the registry and producer share the host composition's lifecycle.

A prompt whose content is exactly one text block starting with `/` is the command candidate. The web composer only ever sends that shape, and multi-block content is never flattened into a command line. Dispatch is mode-agnostic: commands consume no turn, so queue and steer execute identically and neither reaches the agent.

The execution outcome maps onto the RPC result the composer choreography already understands. A successful command returns ok with `{ accepted: true, command: { kind: 'success', text? } }` — the draft stays cleared. A usage or state error (bare `/goal edit`, a redundant `/goal pause`) returns an RPC error with the new code `command-error`, and an unrecognized name returns `unknown-command`; both make the client restore the composer's draft and show the message on the error strip, which is the right UX for a malformed command. The two codes are new rows in `RpcErrorDetailsMap` with matching error-schema branches, and the `session.prompt` response value gains the optional command slot in both the signature layer and the zod schema.

The success text travels on the wire but the web UI does not render it yet; the state change — the goal bar appearing, a paused goal resuming — is the feedback. Handler defects still propagate out of `commands.execute` and become carrier-level 500s, matching the api-proxy rule that implementations never throw business errors.

## Testing

`packages/host/runtime/tests/api-proxy-command.spec.ts` mounts the real command registry, agent registry, goal service, and `/goal` producer against a structural idle agent whose `send`/`steer` calls are recorded. It covers `/goal <objective>` creating the goal with the command slot carried and no model turn, mode-agnostic dispatch under `steer`, the `unknown-command` (with and without trailing input) and `command-error` RPC errors, a registered command whose success carries no text, a non-command prompt reaching `agent.send` unchanged, and degenerate shapes — multi-block content, an empty array, a single non-text block — never being treated as a command. The existing `rpc-schemas.spec.ts` gates the extended wire shape.

## Alternatives considered

- **Intercept in the browser client** — rejected because the command registry and goal domain live in the host process; the client has no plugin runtime, and duplicating command ownership client-side would drift from the host's composition.
- **Render command output as a synthetic assistant message** — rejected because fabricating a model-visible event would violate the model-visible ⟺ logged rule and invent a second audit record; the wire carries the text for a future dedicated surface instead.
- **Dispatch only in queue mode** — rejected because commands consume no turn, so mode is meaningless to them; ACP likewise executes commands outside its prompt-turn machinery.
- **Flatten multi-block content into a command line like ACP** — rejected because the web composer sends exactly one text block; a lossy flattening path would have no caller.

## Consequences

- `/goal` and any future registered command work from the web composer without a model turn; unknown or malformed commands restore the draft with an error instead of reaching the model.
- The RPC error vocabulary gains `command-error` and `unknown-command`, and `session.prompt` responses may carry a command slot.
- Command success text is on the wire but unrendered in the web UI; a dedicated output surface remains deferred.
- Multi-block prompts are never command candidates, so richer composer content cannot accidentally dispatch.
- Commands dispatched in the web host run under a fresh, never-aborted AbortController: an async command (the registry permits them) cannot be cancelled from the UI, and `session.cancel` does not reach it (ACP keeps the controller on the session record for exactly this).
- The single-block predicate rejects any lone text block starting with `/` that is not a registered command (e.g. `/etc/hosts`, `/Goal`) as `unknown-command` rather than letting it reach the model — deliberate and symmetric with ACP, mitigated by the draft restore.
