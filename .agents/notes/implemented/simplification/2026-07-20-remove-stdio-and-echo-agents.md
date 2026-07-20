# Agent Note: Remove the stdio and Echo agents

Status: implemented

English | [中文](2026-07-20-remove-stdio-and-echo-agents.zh.md)

## Problem

DeepSeek Harness exposed two redundant product agents beside the TUI and Headless coding agents. The line-oriented stdio agent duplicated terminal interaction and non-interactive execution with a mixed prompt/output protocol. Echo duplicated Headless as a network-free mock model plus one teaching tool, making a test fixture into a user-facing agent and the default quick-start path.

Both agents carried support surfaces beyond their leaf configurations. Stdio owned a UI plugin, app package, SDK interface, REPL leaf, prompt protocol, and Loader tests. Echo owned a runnable command, mock adapter, tool, CI demo gate, graph entry, teaching references, and a shared test fixture. Keeping any of those product paths would preserve the redundant agent indirectly.

Standard input and output remain protocol boundaries for ACP, JSON-RPC, MCP, and child processes. Deterministic model adapters also remain valid inside tests. Those mechanisms do not justify a line-oriented or mock-only product agent.

## Decision

The stdio and Echo agents are removed without compatibility packages, modes, commands, or aliases. The stdio UI and app packages, `examples/repl-agent`, `examples/echo-agent`, `demo:repl`, `demo:echo`, their dedicated tests, and supporting manifests, gates, graphs, and documentation entries are deleted.

The remaining application roles are explicit:

- [`@deepseek-ai/dsh-tui-demo`](../../../../packages/examples/tui-demo/README.md) owns terminal-interactive execution. `examples/tui-agent` owns the complete coding composition, Code Mode overlay, PTY coverage, and terminal snapshots.
- [`@deepseek-ai/dsh-cli-demo`](../../../../packages/examples/cli-demo/README.md) owns non-interactive execution. `examples/headless-agent` owns the real-model one-shot composition, replay snapshots, generic real-agent suites, and test-only keyless Loader fixtures.
- [`@deepseek-ai/dsh-acp-demo`](../../../../packages/examples/acp-demo/README.md) and `@deepseek-ai/dsh-jsonrpc` own their framed protocol integrations.

The SDK project model and create/config workflows replace the `stdio` run-interface option with `tui`; generated TUI projects compose `@deepseek-ai/dsh-tui` and create or resume one exact session. Repository-facing demo documentation requires a DeepSeek API key and leads with the real Headless or TUI agents.

Keyless validation is test-owned. The Headless Loader smoke uses a fixture adapter to exercise a real tool round trip, the CLI built-bin suite pins output, persistence, failure, and signal semantics, and package-specific Loader tests keep deterministic adapters beside their scenarios. None is exposed as a runnable mock agent.

## Verification

TUI and Headless Loader coverage run the real app packages in source and built modes. TUI uses a pseudo-terminal; Headless proves its task/result and tool-call contracts. Generated graphs and repository searches reject stale package, command, leaf, and SDK-interface references.

## Alternatives considered

- **Keep the line agent only for pipes** — rejected because Headless has a bounded task contract, format-pure stdout, durable completion, and process exit status.
- **Keep Echo as the keyless quick start** — rejected because the first product experience should exercise the real model and supported coding agent, not a scripted adapter with a bespoke tool.
- **Keep Echo only as a CI demo command** — rejected because test-owned Headless fixtures cover the same Loader and built-artifact boundaries without preserving a mock product leaf.
- **Remove every stdio or mock mechanism** — rejected because framed protocols, process I/O, and deterministic test adapters are independent infrastructure, not the removed agents.

## Consequences

- Interactive and non-interactive product execution each have one owner and one runnable coding leaf.
- The repository has no keyless user-facing agent demo; local agent demos require `DEEPSEEK_API_KEY`.
- CI retains keyless real-entry coverage through test fixtures rather than a product command.
- Existing stdio-agent configurations, Echo commands, and SDK `--interface=stdio` invocations fail instead of being translated.
