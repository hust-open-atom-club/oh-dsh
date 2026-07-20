# Agent Note: Ask-user question capability

Status: implemented

## Problem

The agent sometimes cannot proceed safely from model inference alone: it needs the human to choose a path, confirm a risky/default action, or provide missing information. Before this change, the only way to get that answer was for the model to ask in assistant text and then stop, which broke the normal tool-call loop: the agent had no structured way to pause, no option metadata for UIs, no abort/error taxonomy, and no way for non-stdio front doors to present the question consistently.

This is a user-facing capability, but it also crosses package boundaries. A model-facing tool needs a provider-neutral request vocabulary; each UI surface needs to decide how to show and collect the answer; the agent loop should remain unchanged because a tool call already has the right async shape.

## Decision

Introduce `dsh-user-interaction` as the provider-neutral interface package for `ctx.userInteraction`, colocated with the model-facing consumer `dsh-tool-ask-user` under `packages/ui`. The grouping is intentional: asking a human is a UI-backed product affordance, not part of the providerless core spine. The seam still owns the stable request/answer/error vocabulary, while UI product surfaces provide the concrete provider that collects the answer. The tool registers `ask_user_question`, forwards `{ questions, agent, signal }`, and returns the provider-computed structured answers as the tool result.

The model-facing request vocabulary is deliberately aligned with the product-research schema: `ask_user_question({ questions: [{ id, question, header?, options?: [{ label, description? }], multi_select? }] })`. `id` is supplied per question and echoed in the result so a batch can be routed without relying on question text. `label` is both user-facing display text and the selected value returned to the model; there is no separate `value`, no `recommended`, no `allow_custom`, and no `desc` alias.

Providers return `{ answers: [{ id, selected, custom? }] }`. `selected` is always an array of selected option labels, so single-select and `multi_select` answers share one result shape. `custom` carries a free-text "Other" answer; optionless questions collect `custom` directly. When `custom` is present, it overrides any selected choices and `selected` is empty.

`UserInteractionError` extends `HarnessError`, so failures such as `NO_PROVIDER`, `ASK_ABORTED`, ACP cancellation, or missing session routing survive `ctx.tools.execute()` as machine-routable `{ name, code }` tool errors. This matches the structured-error taxonomy and lets the model or a wrapping plugin distinguish "user cancelled" from a generic thrown exception.

## UI mappings

`dsh-stdio-demo`'s in-package readline module renders each question, shows each option's `description` on the next line, supports comma/space-separated numeric choices for `multi_select`, accepts free-form custom answers, and rejects pending questions on abort, provider disposal, or stdin EOF. A batched request is asked in order and resolved as one answer object. The stdio provider serializes simultaneous requests with an internal queue so only one prompt owns stdin at a time.

`dsh-acp` provides the same seam for ACP sessions. It resolves the calling `Agent` through `ownedRecord`, requiring the forward session-map record at `agent.session.id` to own that exact agent object, and calls ACP `unstable_createElicitation` with a session-scoped form for each question. Single-select options become a `choice` string enum; `multi_select` options become a `choice` array enum; optionless questions use a required `custom` text field. If the client returns both `choice` and non-empty `custom`, the custom answer wins. ACP `decline`/`cancel`, a missing answer, a missing session, and a client without elicitation support all become structured `UserInteractionError`s.

The ACP mapping deliberately uses elicitation, not `session/request_permission`. `request_permission` is still reserved for the separate permission gate: it is a yes/no-or-policy authorization protocol around tool execution. `ask_user_question` is a general information-gathering tool with optional free-form answers, so ACP form elicitation is the closer protocol fit. The bridge's session routing is shared with the future permission gate, but the user intent is different.

## Alternatives considered

**Assistant text followed by a stopped turn.** The model could ask the user in plain assistant text and then stop. That loses the structured option metadata, gives UIs no provider-neutral way to render a choice, and forces the next human answer to arrive as a new user prompt rather than as the result of the operation that needed the answer.

**Core-owned ask-user packages.** The first implementation split the seam and the model-facing tool across `packages/core` and `packages/ui`, but both names describe one UI-backed human-interaction affordance. The seam remains provider-neutral, but it is not providerless core infrastructure like sessions, tools, or the agent registry. Keeping `dsh-user-interaction` and `dsh-tool-ask-user` together under `packages/ui` makes the package map match the product boundary: apps and bridges provide the human-answer provider, and the stdio app opts into the model-facing tool.

**ACP `session/request_permission`.** Permission requests are authorization around tool execution; `ask_user_question` is information gathering with optional free-form answers. Using permission for general questions would collapse two different product concepts and make the future permission gate harder to reason about.

**A loop-level pause primitive.** The agent loop already knows how to await a tool call and resume from a tool result. Adding a new loop special case would duplicate that async shape and make every loop implementation learn about a UI concern.

## Consequences

ACP elicitation is currently marked unstable in the SDK. The fallback is still structured: if a client does not implement it, the tool returns `ASK_FAILED` rather than hanging. A later ACP stabilization may rename or reshape the method; that migration should stay inside `dsh-acp` because the core `ctx.userInteraction` vocabulary is provider-neutral.

The feature gives the model a powerful pause primitive, so prompt guidance matters. The tool description tells the model to ask concise questions and use options when possible. Product policy can later wrap `tools/execute` to restrict when the tool is allowed, but the loop should not special-case it.

`dsh-user-interaction` and `dsh-tool-ask-user` both live in `packages/ui` because they form one product-facing human-interaction capability. `agent-core` does not load either the tool or a provider. `stdio-agent` opts into the seam, its readline provider, and the model-facing tool. `acp-agent` keeps only the `userInteraction` seam/provider by default: ACP elicitation support is still client-dependent, so an ACP leaf must opt into the model-facing tool deliberately once its client can complete elicitation requests.

## Testing

Unit coverage pins provider registration/disposal, duplicate-provider rejection, abort-before-provider, empty-question rejection, structured tool errors through `ctx.tools.execute()`, batched answers, multi-select answers, custom answers, and the model schema including the removal of `value`, `recommended`, `allow_custom`, and `desc`. `dsh-stdio-demo` tests cover option descriptions, queued requests, EOF/abort cleanup, optionless free-form input, invalid option reprompts, duplicate multi-select numbers, and batched question flows. ACP bridge tests drive a real in-memory ACP connection with the real `ask_user_question` tool and verify selected-option, custom-overrides-choice, multi-select, and optionless free-form elicitation paths continue the agent loop.
