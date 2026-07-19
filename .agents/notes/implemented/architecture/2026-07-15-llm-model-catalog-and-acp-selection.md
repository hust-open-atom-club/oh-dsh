# Agent Note: Advisory LLM catalogs and per-session ACP model selection

Status: implemented

English | [中文](2026-07-15-llm-model-catalog-and-acp-selection.zh.md)

## Problem

Provider-routed adapters let every request choose `provider + model`, but `LlmService` exposed only routing and streaming. A UI could not discover which providers were registered or which models an adapter was prepared to recommend. ACP clients therefore received no `model` session config option, so Zed, JetBrains, and VS Code integrations had no model list even though the request seam already supported runtime switching.

Model discovery cannot become request validation. The hand-written DeepSeek adapter deliberately forwards arbitrary model ids to a public or private endpoint, while pi-ai has a finite installed catalog that is authoritative for its own request resolution. Treating one shared catalog as a whitelist would remove the private-endpoint behavior that provider routing was designed to preserve.

ACP selection must also preserve the provider dimension. The same model id may appear under multiple routes, and switching a global adapter or agent template would leak one editor session's choice into every other session. Prompt variables and request routing must change together; a selection that lands during asynchronous prompt assembly cannot make `{{model}}` name one model while the request reaches another.

## Decision

### Provider-neutral advisory discovery

`LlmAdapter` gains `providerInfo(provider)` and asynchronous `listModels(provider)` methods. Their provider-neutral results are `LlmProviderInfo { id, name }` and `LlmModelInfo { provider, id, name, description? }`. The defaults preserve existing adapter behavior by naming a provider after its route and advertising no models.

`LlmService.listProviders()` returns detached metadata in registration order. `LlmService.listModels(provider)` delegates to the route owner, validates non-empty ids and names, rejects a mismatched provider or duplicate model id with `INVALID_CATALOG`, and returns detached values. Unknown providers still fail with `NO_ADAPTER`. Provider metadata is validated atomically during `registerAdapter()` so a malformed display record cannot leave a partial registration.

Catalog membership is advisory. It drives selectors and diagnostics but never changes `stream()` routing and never rejects an otherwise valid request. Provider ownership remains exclusive and lifecycle-bound; model ids remain request-time adapter input.

`dsh-llm-pi-ai` maps the configured provider's installed `getModels(provider)` entries into the neutral catalog. Its existing request-time catalog lookup remains authoritative and still rejects unknown models with `UNKNOWN_MODEL`. `dsh-llm-deepseek` accepts an optional `models` config containing display entries, defaulting to `deepseek-v4-flash` and `deepseek-v4-pro`. An explicit list replaces those defaults and an empty list disables discovery. The entries improve selector UX for known public or private models, while every unlisted model id continues to pass through unchanged.

### ACP session config option

The ACP bridge advertises one select with `id: model` and `category: model` in `session/new` and `session/load` when the session has a complete target whose provider is registered. Each opaque option value encodes the full provider/model pair. Models are grouped by provider when multiple non-empty provider groups exist; a single group is flattened for clients that render simple selects better.

The session's current target is added to the displayed options when its adapter omits it. This preserves custom DeepSeek and private-endpoint models while keeping the adapter catalog advisory. A target with an unregistered provider is not advertised, and a model-less agent remains available to another `agent/request` supplier.

`session/set_config_option` accepts only values from the current catalog snapshot and updates a target reference owned by that ACP session. No global `LlmService` or `AgentOptions` state changes, so concurrent sessions may select different providers and models. The existing permission select remains independent, and every response returns the complete refreshed option state.

### Prompt/request consistency and durability

Agent setup installs scoped `system-prompt/assemble` and `agent/request` listeners. Prompt assembly snapshots the selected pair once per step, overwrites the assembled `provider` and `model` variables after downstream prompt listeners, and the request listener applies that same snapshot after downstream request listeners. A selection during asynchronous assembly therefore starts on the next step rather than splitting prompt text from routing. Other call-config fields remain untouched.

The request header remains the durable source of truth. When a selected target is actually used, the existing full `request/header` snapshot records it. `session/load` initializes the ACP selection from the folded last request header before falling back to bridge config. A selection that is never used by a request is intentionally in-memory only because it never became model-visible state.

ACP's experimental `providers/*` capability is not used. That draft surface configures provider base URLs, protocols, and headers, including secrets; it does not enumerate models and would give the UI authority to rewrite deployment-owned adapter configuration.

## Alternatives considered

**Return model strings only.** A model-only value loses the provider route and becomes ambiguous as soon as two providers expose the same id.

**Make catalogs mandatory whitelists.** This conflicts with the hand-written adapter's arbitrary model pass-through and private deployments. The selected adapter already owns authoritative request validation.

**Store selection in `AgentOptions` or `LlmService`.** Those are creation-wide or deployment-wide objects. Mutating them would couple concurrent ACP sessions and bypass the logged `agent/request` replacement path.

**Persist a new model-selection session event immediately.** An unused UI selection has not affected a model request. Recording the existing request header when the target is consumed preserves the model-visible-if-and-only-if-logged rule without adding a second source of truth.

**Use ACP `providers/*`.** That unstable API changes endpoint and authentication configuration rather than selecting a model for one session, and its lifecycle and secret-handling semantics do not match this feature.

## Consequences

- Any adapter can expose a dynamic model list without leaking provider-library types into the core seam.
- Catalog consumers must treat absence as “not advertised,” never “invalid request.”
- pi-ai-backed ACP deployments automatically inherit the installed pi-ai provider catalogs; hand-written DeepSeek deployments list known choices explicitly and retain arbitrary model support.
- ACP clients receive a standard stable model config option, with provider-aware values and per-session isolation.
- Request headers remain compatible with the provider-routed session shape; no new JSONL event or format version is required.
- A catalog read can be asynchronous. ACP reads a detached snapshot before creating or resuming an agent, so discovery failure cannot leave a partially published session.

## Testing

Unit coverage validates catalog detachment and malformed metadata, pi-ai and DeepSeek catalog projection, ACP provider grouping, custom-current insertion, invalid values, provider/model request routing, prompt-variable alignment, concurrent-session isolation, model-less fallback, and load restoration from the request header. The existing ACP transport suites verify that the additional config option does not change prompt, cancellation, replay, approval, or tool-rendering behavior.
