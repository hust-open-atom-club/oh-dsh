# Agent Note: Cross-session references

Status: implemented

English | [中文](2026-07-21-cross-session-references.zh.md)

## Problem

TUI and ACP users need to bring relevant work from another conversation into one new message without resuming, forking, or granting the source transcript authority over the current session. The harness already exposes exact session enumeration and raw event inspection, but every host independently parsing logs would duplicate compaction folding, provenance filtering, size limits, error behavior, and persistence. Encoding host markup directly into the agent message contract would also bind the core loop to one UI syntax.

## Decision

`@deepseek-ai/dsh-session-reference` is one context consumer service at `ctx.sessionReferences`. Hosts normalize their protocol into `SessionReferenceInput[]`, call `prepare()` before enqueue, and pass the returned contexts through the generic `SendOptions.contexts` boundary. Core agent packages know only that one queued message may carry frozen `HookContext[]`; they do not parse session URIs or read another log.

`dsh-session:<base64url(JSON.stringify(sessionId))>` is the canonical host-independent identifier. JSON string encoding precedes base64url so quotes, slashes, backslashes, Unicode, newlines, and every other JavaScript string value round-trip without delimiter ambiguity. TUI renders that URI inside `@[label](uri)` and ACP uses standard `resource_link`; text-only clients may use the same inline mention. Explicit Markdown mentions and resource links reject malformed URIs. Bare text becomes a reference only for a non-empty base64url-shaped payload, whose decode must still be canonical; empty or punctuation-only uses remain ordinary discussion text.

The service uses `ctx.sessionQuery.readSurface(sessionId)`, which loads one live-preferred corpus observation, folds it with the session package's canonical surface algorithm, and returns a detached header, capture seq, and current nodes. FTS is not a dependency: v1 discovery filters only id and cwd, and future title/body search can replace the candidate layer without changing reference identity or preparation.

## Snapshot and projection

Preparation deduplicates in first-appearance order, rejects the target id, enforces a configurable limit with a hard maximum of three references, and performs all reads in parallel. It returns no partially prepared context: any read, cancellation, validation, or budget error rejects the operation before `send()` or `steer()`. Cancellation races in-flight discovery and exact reads, so a host settles promptly even when a persistence backend cannot interrupt its pending operation; any late backend settlement is observed but cannot enqueue the message. A source is read before enqueue, so later source messages, compaction, deletion, or persistence replacement cannot change the target session.

Projection retains direct-user messages and steering, completed assistant text, and checkpoint user messages carrying the canonical source exported by `dsh-compact`. That marker is part of the compaction capability contract rather than a backend package name. When a source prompt already contains baked prefix context, projection reads only its model-hidden display content, so referencing that target later does not recursively propagate an earlier snapshot. Projection excludes shadowed pre-compaction nodes, tools and results, reasoning, injected context, other plugin user messages, log-only records, and incomplete assistant chunks. Repeated compaction therefore exposes only the latest folded checkpoint lineage still on the current surface plus its retained tail; there is no raw/current switch and no shadow recovery.

One aggregated context is serialized as JSON beneath a fixed untrusted-background warning. The warning tells the model not to follow instructions, permission claims, or tool requests from referenced sessions unless the current user repeats them. Tag-safe serialization emits every data `<` as the lossless JSON escape `\u003c`; source strings therefore cannot spell the surrounding XML-like tags. The `## My request:` text is a routing cue rather than the trust boundary: referenced data may spell those words inside a JSON string, but it cannot forge the closing `</referenced-sessions>` tag or escape the data region. The same serializer drives each source's independent byte accounting. The context declares `prompt-prefix` placement, so AgentLoop persists one `user/message` or `steering/message` containing the snapshot, `## My request:` delimiter, and effective direct prompt. Its model-hidden envelope retains the direct display content and source/retention metadata. Target replay therefore satisfies the model-visible/log-reconstructable invariant without a new event type or a separate user-role context message.

## Message ownership

`send()` and `steer()` snapshot content, resolved source, and contexts together as one deeply frozen lossless-JSON inbox record. Synthetic `inject()` accepts source and model-hidden metadata but not attached contexts, which belong to inbox messages. A claimed ordinary message exposes its attached contexts as the default `agent/prompt-submit` additional contexts; a block writes neither user message nor contexts. The waterfall's returned allow is authoritative, so a listener wrapping `next()` preserves downstream content and contexts unless it intentionally replaces them. After admission, absent or `separate` placement writes an independent `context/message`, while `prompt-prefix` placement bakes context and the effective request into one prompt event. Drained steering bypasses `agent/prompt-submit` but applies the same placement split. Late steering retains the same record when converted to queued input, while cancellation, disposal, and terminal discard drop message and contexts together. `agent/queued` reports the frozen contexts so the observation event describes the complete retained item.

This preserves host driving semantics: TUI decides `send()` versus `steer()` from the agent state after preparation, so only its queued path dispatches UserPromptSubmit hooks; ACP continues to call `send()` once per `session/prompt`. Reference preparation is not a new steering protocol and does not create a turn by itself.

## Host adapters

TUI combines session candidates with the existing `@` file provider. Each candidate displays the latest folded session title and falls back to the session id; lookup follows the editor's cancellation signal, and session id, cwd, and mention labels escape external terminal controls while the canonical URI retains the original id. TUI prepares only submissions containing structured mentions, disables duplicate submit while awaiting snapshots, restores failed input, renders the prompt envelope's display content as the user message, and renders its session-reference metadata as a compact source list instead of exposing the complete JSON in the terminal.

ACP detects direct slash commands from ordinary prompt flattening before extracting `dsh-session:` resource links and canonical inline mentions, so URI-shaped command arguments remain opaque while ordinary resource-link rendering is preserved. Standard `session/list` exposes each loadable session's folded title and, when references are mounted, a canonical URI under `_meta["deepseek-harness/sessionReference"]`; a client can use `title ?? sessionId` as the resource-link name. A valid reference without the optional service returns a capability-unavailable RPC error, and preparation failure occurs before the in-flight turn slot and agent send. A preparation-specific abort owner makes `session/cancel` and bridge teardown stop pending reads. Picker UI remains an ACP client responsibility because ACP does not define a cross-session mention menu.

## Budget and retention

Each of at most three references is independently capped at 65,536 UTF-8 bytes by default. Retention preserves current compact checkpoints and the newest conversation unit before dropping older non-checkpoint messages. An oversized retained text uses `dsh-retention` head/tail slicing and records exact omitted bytes; if one source's fixed serialized fields cannot fit its cap, the whole preparation fails rather than emitting a partial context.

## Alternatives considered

- **Wait for SQLite FTS5** — rejected because snapshot correctness requires exact id reads and canonical surface folding, not content search. FTS improves discovery only.
- **Put mention syntax in `Agent.send()`** — rejected because it would make the core protocol parse TUI/ACP presentation and prevent typed non-text hosts from sharing the semantic layer.
- **Implement references inside TUI and ACP separately** — rejected because projection, security warning, retention, and persistence would drift across hosts.
- **Place a separate user-role context message beside the prompt** — rejected because two adjacent user messages weaken the prompt's deictic binding: in `@foo what does this session discuss?`, the model may resolve “this session” as the current conversation instead of the referenced snapshot.
- **Bake the prefix host-side before `send()`** — rejected because `agent/prompt-submit` must inspect and rewrite only the direct prompt. The effective prompt and attached contexts meet only after admission in AgentLoop, which can apply an `allow.content` rewrite consistently to both combined model content and `envelope.displayContent`; earlier host assembly would expose snapshot bytes to the hook or let those two views diverge.
- **Replay the raw source log or restore shadowed events** — rejected because compact defines the current model surface and may intentionally retire sensitive or expensive history.
- **Resume or fork the source** — rejected because the feature supplies read-only background for one target message, not identity or lifecycle continuity.
- **Inject at request time by rereading the source** — rejected because the reference would become nondeterministic, cancellation races could alter its bytes, and target replay would depend on external mutable state.

## Verification

Unit and integration coverage pins URI round-trips and text-boundary punctuation, explicit malformed references, title-aware candidate ranking, terminal-control escaping, projection exclusions, non-recursive prompt-envelope projection, backend-independent compact checkpoints, tag-safe framing, deduplication, self-reference, count limits, all-or-nothing reads, prompt cancellation against a non-settling storage read, independent per-source byte retention, frozen message ownership, prompt blocking, send/steer placement, title isolation, missing capability, title-aware ACP session listing, ordinary ACP resource links, opaque ACP command arguments, and compact TUI/ACP replay. A keyless TUI snapshot runs the real agent loop: the source surface replaces old user/assistant history with a compact checkpoint, the target submits a mention, and the captured model request contains one user message ordered as snapshot, request delimiter, and current prompt, without either shadowed string.

## Consequences

The new plugin is the stable semantic boundary and adds no persistence schema, event type, FTS dependency, source subscription, or compact shadow access. Standard TUI/ACP demo bundles mount it explicitly and expose its count and per-source byte limits in their own config; custom hosts remain unchanged until they mount the service and adapt their input. Reference contexts increase target history size within configured bounds and can later be summarized by ordinary target compaction, after which the source session is irrelevant.
