# Agent Note: 移除 stdio 和 Echo agent

Status: implemented

[English](2026-07-20-remove-stdio-and-echo-agents.md) | 中文

## 问题

DeepSeek Harness 在 TUI 和 Headless coding agent 之外，还提供了两个重复的产品 agent（智能体）。面向行的 stdio agent 使用混合的提示符/输出协议，同时重复实现终端交互与非交互执行。Echo 则以无需联网的 mock 模型加一个教学工具重复实现 Headless，把测试 fixture（测试前置数据）变成面向用户的 agent 和默认快速上手路径。

两个 agent 的配套实现都不止叶节点配置。stdio 拥有 UI 插件、app 包（package）、SDK 接口、REPL 叶节点、提示符协议和 Loader 测试。Echo 拥有可运行命令、mock 适配器、工具、CI 演示门禁、图谱条目、教学引用和共享测试 fixture。保留其中任何产品路径，都会间接保留这个重复的 agent。

标准输入输出仍是 ACP、JSON-RPC、MCP 和子进程的协议边界。确定性模型适配器也仍可用于测试。这些机制不足以成为保留面向行或仅使用 mock 的产品 agent 的理由。

## 决策

彻底移除 stdio 和 Echo agent，不提供兼容包、模式、命令或别名。删除 stdio UI 包与 app 包、`examples/repl-agent`、`examples/echo-agent`、`demo:repl`、`demo:echo`、各自的专属测试，以及相关的 manifest（元数据清单）、门禁、图谱和文档条目。

保留的应用角色均有明确归属：

- [`@deepseek-ai/dsh-tui-demo`](../../../../packages/examples/tui-demo/README.md) 负责终端交互式执行。`examples/tui-agent` 拥有完整 coding 组装、Code Mode 覆盖层、PTY 覆盖和终端快照。
- [`@deepseek-ai/dsh-cli-demo`](../../../../packages/examples/cli-demo/README.md) 负责非交互式执行。`examples/headless-agent` 拥有真实模型的单次任务组装、回放快照、通用真实 agent 测试套件，以及仅供测试使用的无密钥 Loader fixture。
- [`@deepseek-ai/dsh-acp-demo`](../../../../packages/examples/acp-demo/README.md) 和 `@deepseek-ai/dsh-jsonrpc` 负责各自的分帧协议集成。

SDK 工程模型与 create/config 工作流将 `stdio` 运行接口选项替换为 `tui`；生成的 TUI 工程组合 `@deepseek-ai/dsh-tui`，并创建或恢复一个确切会话。仓库中的演示文档要求 DeepSeek API key，并优先引导到真实的 Headless 或 TUI agent。

无密钥验证由测试负责。Headless Loader 冒烟测试使用 fixture 适配器验证真实工具往返；CLI built-bin 测试套件固定输出、持久化、失败和信号语义；各包专属的 Loader 测试则将确定性适配器放在对应场景旁。其中任何一项都不会作为可运行的 mock agent 对外暴露。

## 验证

TUI 与 Headless 的 Loader 覆盖以源码和构建产物两种模式运行真实 app 包。TUI 使用伪终端；Headless 验证任务/结果契约和工具调用契约。生成图谱与仓库搜索会拒绝陈旧的包、命令、叶节点和 SDK 接口引用。

## 曾考虑的替代方案

- **仅为 pipe 保留面向行 agent**：不予采纳，因为 Headless 已提供有界任务契约、格式纯净的 stdout、持久完成边界和进程退出状态。
- **保留 Echo 作为无密钥快速上手路径**：不予采纳，因为首次产品体验应使用真实模型和受支持的 coding agent，而不是带专用工具的脚本化适配器。
- **只为 CI 演示命令保留 Echo**：不予采纳，因为由测试持有的 Headless fixture 可以覆盖相同的 Loader 和构建产物边界，无需保留 mock 产品叶节点。
- **移除所有 stdio 或 mock 机制**：不予采纳，因为分帧协议、进程 I/O 和确定性测试适配器是独立基础设施，并不是被移除的 agent。

## 后果

- 交互式与非交互式产品执行分别只有一个归属方和一个可运行的 coding 叶节点。
- 仓库没有面向用户的无密钥 agent 演示；本地 agent 演示需要 `DEEPSEEK_API_KEY`。
- CI 通过测试 fixture 保留针对真实入口的无密钥覆盖，而不是依赖产品命令。
- 既有 stdio agent 配置、Echo 命令和 SDK `--interface=stdio` 调用会直接失败，不会被转换。
