# Agent Note: Claude Code and Codex subagent backends (out-of-process delegation to external coding agents)

Status: proposed

English | [中文](2026-07-07-claude-code-and-codex-subagent-backends.zh.md)

## Problem

The subagent seam ([the seam Agent Note](../../implemented/feature/2026-06-21-subagent-capability-seam.md)) hosts multiple named providers on `ctx.subagents`, and the ACP backend ([the ACP backend Agent Note](../../implemented/feature/2026-06-22-acp-subagent-backend.md)) proved the seam generalizes across a process boundary; its Future-providers section explicitly named the Codex app-server and the Claude Code Agent SDK as mechanically similar siblings. Those two are the engines actually worth delegating to today: a harness turn should be able to hand a self-contained task to a real Claude Code or a real Codex — a separate product with its own model, tools, and sandbox — and get back one final answer, without the parent deployment leaking its secrets into the child or the child's behavior silently depending on whatever `~/.claude` / `~/.codex` state exists on the host machine.

## Proposal

Two sibling provider packages, structural variants of the ACP backend, plus one extraction:

- `@deepseek-ai/dsh-subagent-claude-code` — drives a Claude Code child through `@anthropic-ai/claude-agent-sdk`'s `query()` (the SDK runs in the parent process and spawns its bundled `claude` CLI as the subprocess). Provider name `claude-code`: the child is the Claude Code *product*, not an Anthropic model adapter — "claude" stays reserved for a future `dsh-llm` adapter.
- `@deepseek-ai/dsh-subagent-codex` — spawns `codex app-server` and drives one thread/turn over its JSON-RPC-over-stdio protocol with a hand-rolled newline-JSON client (~200–300 lines) in the package.
- `@deepseek-ai/dsh-subagent-process` — a pure library (the `subagent-inprocess` precedent) extracting what `dsh-subagent-acp` already carries and both new backends need: the credential env scrub (`buildChildEnv`), the EOF → SIGTERM → SIGKILL dispose ladder, and new isolated-config-dir helpers (`mkdtemp` create, best-effort remove). The ACP backend migrates onto it; `bash-local`'s sibling copy is left alone to bound the change.

Both providers copy the ACP backend's seam posture verbatim: fresh child per `start`, exactly one prompt round-trip, capabilities all `false`, `inheritsParentContext: false`, `request.parent`/`request.agentOptions` ignored, `id = SessionId(randomUUID())`, `result` never rejects — child-level failure flattens to a stop reason and the original error goes to `ctx.logger` via an `onError` spec callback. Model exposure is zero new code: `dsh-tool-subagent` is loaded once per provider with a distinct `toolName` (`subagent_claude_code`, `subagent_codex`). No new session events are needed — the only model-visible artifact is the tool result, so reconstructability holds exactly as it did for ACP. To be explicit about the boundary: the session log reconstructs the model-visible transcript, not workspace mutation history — a child granted write access mutates files as an ambient side effect outside the log, exactly as the bash tools and the ACP backend already do; replay reproduces requests, not the disk.

## Verified interface facts (pinned versions)

Both integration surfaces were verified against pinned implementations before this proposal — types and bundled source read, keyless spikes run — not from vendor docs alone. The pins are the verification baseline, not a runtime contract: the backends perform no runtime version probe (no `codex --version` gate, no SDK version sniffing). Compatibility is enforced at development time — every dependency bump re-runs the keyless suites against the real load path — and at runtime by failing loudly: a protocol-level surprise settles `error` via `onError`, never a silent misbehavior.

**`@anthropic-ai/claude-agent-sdk` 0.3.202.** `options.env` REPLACES the child environment (no merge with `process.env`), which is exactly what the scrub needs. `settingSources` defaults to loading ALL filesystem settings — isolation requires explicitly passing `[]`. Result subtypes are `success` | `error_during_execution` | `error_max_turns` | `error_max_budget_usd` | `error_max_structured_output_retries`. On abort the SDK escalates the CLI child itself: stdin EOF immediately, SIGTERM ~2s later if the child ignores it (observed; no leftover processes) — no bespoke kill fallback needed. `outputFormat: {type: 'json_schema'}` and an `agents` option exist, giving future landing points for the seam's `outputSchema` capability and named subagent types; both are out of scope here.

**codex CLI 0.142.5, `codex app-server` (v2 vocabulary).** LF-delimited JSON, JSON-RPC 2.0 shapes with the `"jsonrpc"` header omitted.

- Lifecycle: `initialize{clientInfo}` + `initialized` → `thread/start` (accepts `cwd`, `model`, `sandbox`, `approvalPolicy`, `ephemeral`; succeeds unauthenticated) → `turn/start{threadId, input:[{type:'text',text}]}` returns an `inProgress` turn immediately; the terminal signal is the `turn/completed` notification carrying `Turn{status: completed|interrupted|failed|inProgress, error}`.
- Approvals are server-initiated requests — `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request` — answered with `accept`/`decline`-family decisions.
- Auth: `account/login/start{type:'apiKey', apiKey}` is a first-class RPC and `account/read` reports `requiresOpenaiAuth` — and an unauthenticated `turn/start` does NOT fail fast (it hangs in retry), so the backend MUST pre-check auth and settle `error` loudly instead of waiting on the turn.
- Isolation: `CODEX_HOME` redirection is honored (the `initialize` response echoes it, so tests can assert isolation), and `ephemeral: true` threads leave no session files at all.

## Isolation and credentials

Deployments authenticate with API keys only, and the child must not see the host user's Claude Code / Codex configuration: behavior has to be a function of `cordis.yml` alone. Each run gets a fresh `mkdtemp` config dir — `CLAUDE_CONFIG_DIR` for Claude Code (paired with an explicit `settingSources: []`), `CODEX_HOME` for Codex — removed best-effort on dispose; a config field can pin a persistent dir instead. The child env reuses the ACP backend's `buildChildEnv` semantics verbatim via the extraction: the ambient env is forwarded MINUS credential-shaped vars (`/KEY|SECRET|TOKEN/i`), with `config.env` layered on top — so `PATH`, `HOME`, `TMPDIR`, locale, and proxy vars survive and the CLIs run normally, while only credential-shaped ambient vars are scrubbed (`ANTHROPIC_API_KEY` enters explicitly through `config.env` for Claude Code), and the Codex key travels via the `account/login/start` RPC into the isolated `CODEX_HOME` rather than a hand-written `auth.json`.

## Permission and approval policy

Instead of collapsing to ACP's single `permission: allow|reject` knob, each backend exposes its engine's native vocabulary as config, with conservative defaults: Claude Code gets `permissionMode` (default `default`) plus `permission: allow|reject` (default `reject`) as the `canUseTool` auto-answer for whatever falls through; Codex gets `sandboxMode` (default `read-only`) and `approvalPolicy` (default `never`) plus the same `permission` fallback for approval requests that still arrive. Defaults are deliberately do-no-harm (the out-of-box child cannot write files); examples demonstrate opening up (`acceptEdits` / `workspace-write`). The mechanical rule: EVERY server-initiated request is settled programmatically and promptly — the enumerated approval/user-input/elicitation requests by the configured policy, an unknown request method with a JSON-RPC method-not-found error response (never left pending), unknown notifications consumed — so no child request can wedge a turn waiting on an answer that will never come. Prompts never reach a human in this cut, matching ACP.

## StopReason mapping

Claude Code: `success` → `completed`; `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries` → `error` (aligning with the ACP call on `max_turn_requests`: an unfinished task is not success); generator abort → `aborted`; anything unknown → `error`. Codex: `Turn.status` `completed` → `completed`; `interrupted` → `aborted`; `failed` with `codexErrorInfo: 'contextWindowExceeded'` → `max-tokens`, any other `failed` → `error`; transport/spawn/auth-precheck failure → `error` (or `aborted` if cancel was requested). In both, `cancel()` is the ACP shape: flag + abort/interrupt + a cancel-settled race arm so an uncooperative child cannot stall the result.

Liveness posture, stated explicitly: teardown timing is config, turn duration is not. Both backends take the dispose ladder's grace periods as defaulted validated config fields (the ACP backend's `disposeEofGraceMs`/`disposeGraceMs` shape, carried by the extraction), but there is deliberately NO turn-duration or startup timeout — matching ACP, liveness during a turn belongs to the caller via `cancel()`/the abort signal, a subagent turn is legitimately minutes long, and the Codex auth precheck removes the one verified guaranteed-hang; a deployment wanting a wall-clock bound cancels from the parent.

## Testing

Named at every tier per the root AGENTS.md rule, and de-risked up front:

- **Keyless unit/integration**, mirroring the ACP spec list per backend (round-trip and output accumulation, every stop mapping, both cancel paths, already-aborted, permission auto-answer under both policies, unknown-message tolerance, bad-command spawn failure, HMR provider cleanup, export shape, isolation assertions on child env and temp-dir removal; Codex adds the auth-precheck failure path). Claude Code's harness is a scripted fake `claude` executable behind `pathToClaudeCodeExecutable` driven by the REAL SDK — a spike already passed end-to-end keyless in 24ms (the fake CLI answers one `control_request/initialize` and speaks plain stream-json, ~40 lines). Codex's harness is a scripted mock app-server subprocess speaking the verified wire protocol, the `mock-acp-server.ts` shape.
- **With-key e2e** per backend: the real engine does real file work verified on disk, under a pinned opened-up config so acceptance and the do-no-harm defaults don't collide — `permissionMode: 'acceptEdits'` for Claude Code, `sandboxMode: 'workspace-write'` + `approvalPolicy: 'never'` for Codex; self-skips report exactly what is missing (binary vs key). CI has no secrets, so these run locally per the with-key policy.
- **Snapshot**: deferred as `TODO(claude-code-subagent-replay)` / `TODO(codex-subagent-replay)` — the same distinct replay shape the ACP backend deferred ([the per-session replay Agent Note](../../implemented/testing/2026-06-22-subagent-snapshot-replay.md)); the keyless suites carry deterministic coverage meanwhile.

## Alternatives considered

### Why not the official `@openai/codex-sdk` instead of a hand-rolled client?

The dispose ladder and env scrub require owning the child process (spawn args, env, signals, exit await); the SDK hides the process. The wire format is trivial to frame (LF JSON), the shapes are generatable per pinned version (`codex app-server generate-json-schema`), and the repo precedent (`hook-protocol`) is to own thin protocol cores rather than wrap someone's runtime. The SDK would save protocol-evolution maintenance but costs the exact control this backend exists to have.

### Why not a model-visible `subagent_type` parameter (one Task-style tool)?

Claude Code's own Task tool puts the subagent type in the model-facing schema, selecting a prompt-plus-toolset persona. Here the choice is between EXECUTION ENGINES, and only the deployer knows which engines have credentials configured — so selection stays deployment config, preserving `dsh-tool-subagent`'s documented one-provider-per-tool contract. A persona-style type selector would be a separate Agent Note against the tool, not the backends.

### Why not login-state credentials and the user's own config?

Inheriting `~/.claude` / `~/.codex` (subscription login, user settings, skills, MCP servers) would make child behavior depend on host-machine state and punch an implicit exception through the "credentials enter explicitly via `config.env`, never ambiently" rule the ACP backend and bash executor established. API-key-only plus forced config-dir isolation keeps runs reproducible; deployments wanting shared state can point the config-dir field at a persistent directory deliberately.

### Why not a driver-injection seam for the Claude Code keyless tests?

Injecting a fake `query()` would mock our own boundary and leave the real SDK load path untested (the real-over-mock policy in docs/testing.md). The risk that justified considering it — the SDK↔CLI stream-json control protocol being internal — was retired by the spike: the fake-CLI harness works against the real pinned SDK today. If an SDK upgrade breaks the mock, the keyless suite fails the upgrade PR, which is the gate working.

### Why not ACP adapters (e.g. `claude-code-acp`) reusing the existing backend?

Community shims wrap both engines in ACP, which would make them "just config" on `dsh-subagent-acp`. But that inserts an unofficial third-party layer between the harness and the engine, erases the native control surfaces this Agent Note exposes (permissionMode, sandboxMode/approvalPolicy, config-dir isolation, apiKey RPC), and trades first-party protocol stability for a shim's release cadence. First-party surfaces — the Agent SDK and the app-server — are the supported integration points.

## Acceptance criteria

On a machine with both engines and keys configured: a REPL-driven model completes one real file task through `subagent_claude_code` and one through `subagent_codex`, the tool result being the child's final answer, with only `tool/call` + `tool/result` in the parent session log. Keyless suites pass at 100% per-file coverage in a credential-less environment, asserting isolation (scrubbed child env, no temp config dirs left after dispose) and that child behavior is unchanged by the presence or absence of `~/.claude` / `~/.codex`. Cancelling a parent turn quiesces both backends in bounded time with no leftover child processes. E2e suites self-skip cleanly, naming the missing prerequisite.

## Risks

- `codex app-server` is CLI-flagged experimental and its v1/v2 vocabularies coexist; the client pins 0.142.5, implements v2 only, and consumes unknown methods/notifications without crashing, but a future codex bump can still force rework (regenerate schemas and re-run the keyless suite on every bump — the development-time enforcement behind the no-runtime-version-probe stance above).
- The Claude Code fake-CLI mock rides an internal protocol: any SDK upgrade must go through the keyless suite, and a breaking control-protocol change means reworking the mock (fallback: the driver-injection seam rejected above becomes the escape hatch).
- The SDK's optionalDependencies weigh ~280MB per platform — accepted, and confined to the one backend package.
- The SDK's SIGKILL branch beyond EOF→SIGTERM was not observed and is trusted; e2e keeps a no-leftover-process assertion.
- Codex is a deployment prerequisite (no npm-bundled binary); a missing or incompatible binary surfaces as a loud spawn/protocol `error`, not a version probe.
- Every run pays a fresh child process and only the final answer surfaces — thoughts, tool cards, and usage are consumed and dropped; pooling, intermediate-progress surfacing, `sendMessage`/`resume`, `outputSchema` via the SDK's `outputFormat`, and named subagent types via the SDK's `agents` option are all deliberate deferrals.
