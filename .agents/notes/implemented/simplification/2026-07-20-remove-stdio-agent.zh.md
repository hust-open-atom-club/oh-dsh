# Agent Note: 移除面向行的 stdio agent

Status: implemented

[English](2026-07-20-remove-stdio-agent.md) | 中文

## 问题

全屏 TUI 交付后，DeepSeek Harness 同时存在两个终端 agent。`@deepseek-ai/dsh-tui` 负责交互式 coding 体验，而 `@deepseek-ai/dsh-stdio` 仍为普通 stream 保留面向行的多轮聊天协议。后者已不再对应独立的产品需求：交互用户使用 TUI；脚本需要的是具有明确输出和退出语义的有界 Headless 任务，而不是与模型和工具输出混在一起的提示符。

重复 surface 不只涉及一个 UI 插件。`@deepseek-ai/dsh-stdio-demo` 在两种终端模式间选择，`examples/repl-agent` 维护第二份 coding 组装，`demo:repl` 对外暴露它，Loader 与 built-bin 测试驱动其提示符协议，SDK 生成器还提供可以创建旧包新用户的 `stdio` interface。保留其中任何路径，都会间接保留面向行的 agent。

ACP、SDK JSON-RPC bridge、子进程和测试 fixture 同样使用标准输入输出作为 transport。这些字节通道是协议边界，并不是面向行的 agent；因此，删除所有通用进程 stream 用法会混淆彼此无关的设计。

## 决策

移除面向行的 agent，不提供兼容 package 或 mode alias。删除 `packages/ui/stdio` 插件、`@deepseek-ai/dsh-stdio-demo` package identity、`examples/repl-agent` 叶节点、`demo:repl` 命令、提示符/渲染测试，以及相关 manifest、catalog、graph 和文档条目。

保留的两个应用角色均改为显式选择：

- [`@deepseek-ai/dsh-tui-demo`](../../../../packages/examples/tui-demo/README.md) 是唯一的终端交互式 app。`examples/tui-agent` 直接拥有完整 coding 组装及其 Code Mode overlay，不再 include 或 patch 另一个终端叶节点。
- [`@deepseek-ai/dsh-cli-demo`](../../../../packages/examples/cli-demo/README.md) 负责非交互式执行。`examples/headless-agent` 拥有真实模型的单次组装和通用真实 agent e2e suite，`examples/echo-agent` 则提供 keyless mock 任务与 CI smoke。

SDK project model 与 create/config workflow 将 `stdio` run-interface 选项替换为 `tui`；生成的 TUI 工程组合 `@deepseek-ai/dsh-tui`，并继续创建或恢复一个确切 session。仓库处于 pre-release 阶段且没有兼容性承诺，因此不会接受旧选项。

ACP 和 JSON-RPC 保留各自的 stdio transport。描述操作系统 I/O 而非已移除 agent 的子进程 `stdio` 设置与 stream 读取 API 也继续保留。

## 验证

TUI Loader 覆盖在 source 与 built 两种模式下通过伪终端运行真实 app。Headless Loader 覆盖验证 mock 工具往返；多轮测试 driver 在没有 UI 协议的情况下驱动同一个 app-owned agent；CLI built-bin suite 固定 text、JSON、stream-JSON、持久化、失败和 signal 行为。生成的 package/config/module graph 会拒绝陈旧的 package 引用。

## 曾考虑的替代方案

- **仅为 pipe 保留面向行的 agent**：不予采纳，因为 Headless 已提供更清晰的有界任务契约、格式纯净的 stdout、持久完成边界和进程退出状态。
- **保留 package，并将其作为 Headless 的兼容 wrapper**：不予采纳，因为多轮提示符协议无法通过委托给单次 CLI 来诚实地保持行为，而且 pre-release 策略优先选择正确的公开 surface。
- **让 TUI 在 stream 不是 TTY 时回退**：不予采纳，因为静默切换 interface 会掩盖部署错误；TUI 会快速失败，由调用方显式选择 Headless。
- **移除 stdio 这个术语或机制的所有用法**：不予采纳，因为 ACP 与 JSON-RPC 有意使用标准 I/O 作为分帧 transport，并不暴露已移除的面向行 agent。

## 后果

- 终端交互只有一个 owner、一个 app package、一个 coding 叶节点和一套测试策略。
- 自动化使用显式 task/result 契约，不再解析提示符或通过 EOF 控制对话。
- 现有面向行的 agent 配置和 SDK `--interface=stdio` 调用会直接失败，不会被转换。
- TUI 要求成对的 TTY；非交互环境根据协议需要使用 Headless、ACP 或 JSON-RPC。
