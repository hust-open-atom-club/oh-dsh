# Agent Note: Remove the line-oriented stdio agent

Status: implemented

English | [中文](2026-07-20-remove-stdio-agent.zh.md)

## Problem

DeepSeek Harness had two terminal agents after the full-screen TUI shipped. `@deepseek-ai/dsh-tui` owned the interactive coding experience, while `@deepseek-ai/dsh-stdio` retained a line-oriented multi-turn chat protocol for ordinary streams. The latter was no longer a distinct product need: interactive users use the TUI, and scripts need a bounded Headless task with explicit output and exit semantics rather than prompts mixed with model and tool output.

The redundant surface extended beyond one UI plugin. `@deepseek-ai/dsh-stdio-demo` selected between two terminal modes, `examples/repl-agent` owned a second copy of the coding composition, `demo:repl` exposed it, Loader and built-bin tests drove its prompt protocol, and the SDK generator offered a `stdio` interface that could create new users of the obsolete package. Keeping any of those paths would preserve the line agent indirectly.

Standard input and output are also used as transport by ACP, the SDK JSON-RPC bridge, subprocesses, and test fixtures. Those byte channels are protocol boundaries, not the line-oriented agent, so removing every generic use of process streams would conflate unrelated designs.

## Decision

The line-oriented agent is removed without a compatibility package or mode alias. The `packages/ui/stdio` plugin, `@deepseek-ai/dsh-stdio-demo` package identity, `examples/repl-agent` leaf, `demo:repl` command, prompt/render tests, and supporting manifest, catalog, graph, and documentation entries are deleted.

The two remaining application roles are explicit:

- [`@deepseek-ai/dsh-tui-demo`](../../../../packages/examples/tui-demo/README.md) is the only terminal-interactive app. `examples/tui-agent` owns the complete coding composition and its Code Mode overlay directly; it no longer includes or patches another terminal leaf.
- [`@deepseek-ai/dsh-cli-demo`](../../../../packages/examples/cli-demo/README.md) owns non-interactive execution. `examples/headless-agent` owns the real-model one-shot composition and generic real-agent e2e suites, while `examples/echo-agent` supplies the keyless mock task and CI smoke.

The SDK project model and create/config workflows replace the `stdio` run-interface option with `tui`; generated TUI projects compose `@deepseek-ai/dsh-tui` and continue to create or resume one exact session. No old option is accepted because the repository is pre-release and has no compatibility promise.

ACP and JSON-RPC retain their stdio transports. Child-process `stdio` settings and stream-reading APIs also remain where they describe operating-system I/O rather than the removed agent.

## Verification

TUI Loader coverage runs the real app under a pseudo-terminal in both source and built modes. Headless Loader coverage proves the mock tool round trip, multi-turn test drivers exercise a single app-owned agent without a UI protocol, and the CLI built-bin suite pins text, JSON, stream-JSON, persistence, failure, and signal behavior. Generated package/config/module graphs reject stale package references.

## Alternatives considered

- **Keep the line agent only for pipes** — rejected because Headless already has a clearer bounded-task contract, format-pure stdout, durable completion, and process exit status.
- **Keep the package as a compatibility wrapper over Headless** — rejected because a multi-turn prompt protocol cannot honestly preserve its behavior by delegating to a one-shot CLI, and the pre-release policy favors the correct public surface.
- **Let the TUI fall back when streams are not TTYs** — rejected because silent interface changes hide deployment mistakes; the TUI fails loud and callers select Headless explicitly.
- **Remove every use of the term or mechanism stdio** — rejected because ACP and JSON-RPC intentionally use standard I/O as a framed transport and do not expose the removed line agent.

## Consequences

- Terminal interaction has one owner, one app package, one coding leaf, and one test strategy.
- Automation has an explicit task/result contract rather than prompt parsing or EOF-driven conversation control.
- Existing line-agent configurations and SDK `--interface=stdio` invocations fail instead of being translated.
- The TUI requires a TTY pair; non-interactive environments use Headless, ACP, or JSON-RPC according to their protocol needs.
