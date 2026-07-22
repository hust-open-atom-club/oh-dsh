# Agent Note: Plugin-owned human command registration

Status: implemented

English | [中文](2026-07-19-plugin-command-registration.zh.md)

## Problem

The TUI owns seven slash commands, while ACP defines a standard command catalog and invocation shape. Keeping command names, help text, autocomplete, dispatch, and cancellation inside each adapter makes every new command an adapter edit, prevents optional plugins from contributing commands, and lets the two front doors drift. Treating slash input as an ordinary model prompt is also unsafe: a user-visible direct action can unexpectedly consume tokens or let the model reinterpret an unknown command.

A shared mechanism must remain a UI concern rather than a model tool or agent-loop branch. It also needs exact per-agent visibility, HMR-safe removal, per-session ACP discovery, direct result rendering, and request-scoped cancellation without adding command text or output to model history.

## Decision

`@deepseek-ai/dsh-commands` in `packages/ui/commands/` is the product command registry. The terminal and ACP app bundles mount it beside their consuming front door, and the SDK project helper emits the same service when scaffolding ACP directly; the executor-less, UI-less agent spine remains independent. TUI and ACP inject the service, while command producers depend only on the registry and any domain they operate.

### Registry contract

A `CommandDefinition` contains a lowercase name without `/`, a non-empty description, an optional unstructured-input hint, and an abortable handler. Registration validates and detaches the metadata, freezes the effective definition, and returns the exact Cordis effect disposer. Duplicate names fail within one layer. Every adapter consuming the registry sees every effective definition; a command plugin that cannot operate in a deployment omits its registration there instead of encoding adapter identities in the shared domain.

`list(agent)` returns immutable name-sorted descriptors after scoped shadowing. `find(agent, name)` resolves the effective definition. `execute(agent, line, signal)` parses and runs a known definition, returning a detached `success` or `error` result; invalid syntax and unknown names return `undefined` so the adapter owns its direct error text.

`parseCommand(line)` requires `/` at byte zero, a lowercase ASCII name containing letters, digits, `_`, or `-`, then whitespace or end-of-input. It preserves the complete adapter-delivered suffix as `rawInput`, including separator whitespace. Command-specific plugins own every further grammar decision.

### Scope and lifecycle

An unscoped registration is global. A command-injected plugin mounted beneath an agent context inherits that agent's scope key and lifetime, so its definition shadows a same-named global only for that exact agent. The child declares its own `commands` injection because `agent.ctx` intentionally inherits the core agent-loop dependency surface; adding a UI service to the loop merely to enable scoped registration would invert the dependency graph.

Registration and removal emit the unfiltered, non-vetoing `commands/change` registry notification. Adapters recompute each live agent's effective view rather than trying to infer which sessions a change affects. The registry contains and logs each observer failure independently, so a broken UI refresh cannot roll back another plugin's mutation or starve a later observer. Cordis ownership removes definitions when their producer, UI instance, or agent scope unloads, so HMR cannot leave stale discovery entries or handlers.

### Direct dispatch and cancellation

Commands run in a human-only command plane. Their input does not become `user/message`, their output does not become a session event, and neither is sent to the model. A handler receives the exact target agent, raw input, and request-owned `AbortSignal`. The registry stops awaiting an uncooperative handler when the signal aborts; the handler remains responsible for stopping external side effects already started.

Expected handler failures return `CommandResult.error`. Thrown or malformed results remain adapter-visible command failures, not model messages. This boundary deliberately separates UI output from durable domain mutation: a goal command may change `ctx.goals`, for example, but the goal service owns that persisted state.

### TUI mapping

The TUI registers `help`, `clear`, `cancel`, `reasoning`, `tools`, `redraw`, and `exit` as agent-scoped command definitions instead of switching on strings. Its autocomplete and help view read the live catalog, so plugin commands appear and disappear with their effects. Any submitted line beginning with `/` stays in the command plane; unknown input produces a terminal warning rather than falling through to `Agent.send()` or `Agent.steer()`.

Each submitted command owns an `AbortController`. TUI disposal aborts outstanding dispatches, removes the local definitions, and waits for the command-producing fiber before completing teardown.

### ACP mapping

The bridge follows the current [ACP v1 slash-command contract](https://agentclientprotocol.com/protocol/v1/slash-commands). `session/new` and `session/load` emit the exact agent's full `available_commands_update` snapshot; a new session's RPC response introduces its server-generated id before the snapshot is enqueued. Every registry change emits a replacement snapshot for each live session. Names, descriptions, and optional unstructured-input hints map directly to `AvailableCommand`.

ACP permits a command prompt to contain additional supported content blocks. The bridge applies its ordinary lossless `text` and `resource_link` flattening, then enters the command plane when the result starts with `/`. Unsupported prompt blocks are rejected by the existing capability boundary. Known commands execute directly; unknown or malformed slash input returns a direct error and never reaches the model. Successful text, expected errors, and thrown-failure diagnostics stream as live `agent_message_chunk` output and settle `end_turn`.

One model prompt or direct command may be in flight per ACP session, independently across sessions. `session/cancel` aborts the direct command when one owns the request; it calls `Agent.cancel()` only for an agent prompt, so cancelling a command cannot destroy unrelated queued or injected agent work. Connection teardown aborts commands and then disposes the owned agents.

## Testing

The registry suite covers syntax boundaries, immutable normalization, runtime metadata validation, deterministic sorting, global and scoped shadowing, duplicate rejection, exact disposal, contained change-notification failures, direct invocation, expected and malformed results, synchronous and asynchronous failure, and every abort timing edge at per-file 100% statement, branch, function, and line coverage.

TUI tests exercise all migrated built-ins, live plugin discovery, help/autocomplete refresh, direct results, unknown-command rejection, raw-input delivery, definition removal, startup rollback, and disposal cancellation. ACP tests use the real SDK connection, agent factory, loop, and JSONL persistence to verify create/load snapshots, dynamic updates, scoped multi-session catalogs, supported-block flattening, direct success/error/failure, unknown-command isolation, cancellation, and the absence of model requests or session messages. The SDK helper suite pins direct-ACP composition. Keyless ACP and terminal snapshots pin the new protocol and rendered transcript shapes.

## Alternatives considered

- **Keep adapter-local switches** — rejected because optional plugins cannot contribute discovery and behavior without editing every front door.
- **Represent human commands as model tools** — rejected because discovery and direct invocation are human UI behavior; routing through the model adds latency, token cost, and reinterpretation.
- **Put the registry in the core agent spine** — rejected because headless and JSON-RPC agents do not consume it, while the two UI app bundles can compose it explicitly.
- **Make `dsh-agent-loop` inject commands** — rejected because the loop does not execute or discover human commands. Agent-scoped producers declare the UI dependency in a child plugin instead.
- **Attach adapter masks to each definition** — rejected because support is a composition fact, not command-domain state. Every composed adapter exposes a registered command; an incompatible plugin omits registration in that deployment.
- **Send unknown slash input to the model** — rejected because typoed or unavailable direct actions must fail predictably rather than change execution planes.
- **Persist generic command input and output** — rejected because adapter notices are not model-visible state. A handler that changes durable behavior calls the owning domain API, which records its own events.
- **Restrict ACP commands to one text block** — rejected because ACP v1 permits accompanying content; the bridge already has a lossless accepted-block translation.

## Consequences

- Command producers are ordinary removable plugins, and TUI/ACP share one validated catalog and dispatch contract.
- Agent-specific definitions retain existing flat scope and shadow semantics without a core-to-UI dependency.
- Unknown slash input and command output are deterministic UI behavior with zero direct model tokens.
- ACP clients receive current per-session snapshots after creation, load, registration, and HMR removal.
- Direct command cancellation is isolated from model-turn cancellation.

## Known limitations and deferred work

- Input metadata is ACP's current unstructured text hint. Typed forms, argument schemas, and completion providers remain command-owned or require a later protocol extension.
- Generic command output is live-only and is not reconstructed after TUI restart or ACP reconnect.
- Registry cancellation stops awaiting immediately, but external work stops only when a handler cooperates with its signal.
- The headless CLI and JSON-RPC SDK front doors do not expose the command plane; only TUI and ACP consume it.
