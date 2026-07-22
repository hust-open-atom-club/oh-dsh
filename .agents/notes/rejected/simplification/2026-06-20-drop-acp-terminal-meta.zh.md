# RFC: 移除 ACP 终端 `_meta` 渲染

Status: rejected — Zed is the current target client, and the terminal `_meta` convention is intentional Zed UX with a plain ACP fallback for other clients.

[English](2026-06-20-drop-acp-terminal-meta.md) | 中文

## 问题

ACP 桥接层通过 `_meta.terminal_info`、`_meta.terminal_output` 和 `_meta.terminal_exit` 实现了一套 Zed 特有的终端卡片约定。已实现的[富 ACP bash 渲染 RFC](../../implemented/feature/2026-06-18-acp-terminal-and-tool-rendering.md) 刻意回避了 ACP 客户端侧的 `terminal/create`（因为 bash 执行属于 harness 职责），但仍采用了参考 agent（智能体）的纯展示 `_meta` 约定。这在 Zed 中带来了更好的卡片效果，代价是桥接状态、能力协商、终端 id、特殊的 update 映射、文本回退测试，以及 `dsh-tool-bash` 中的 exit-pill 解析。

回退路径已经存在：将工具调用和完成输出渲染为普通 ACP 内容块。非 Zed 客户端本来就依赖这条路径，但 Zed 终端卡片是当前目标客户端的功能特性，而非推测性装饰。

## 提案

忽略 `clientCapabilities._meta.terminal_output`，通过纯 ACP 内容路径渲染 bash 结果。执行仍由 agent 侧的 `dsh-bash` 完成；仅移除展示相关的终端元数据。如果 ACP 日后标准化了 agent 执行的终端，或产品决定 Zed 特有展示值得其维护成本，终端卡片可以再回来。

本提案比[收拢工具自有 UI 展示](2026-06-20-generic-tool-rendering.md)更窄：如果通用的 `presentCall`/`presentResult` 保留，本提案不影响它们，只移除终端子形态与 `_meta` 映射。

## 验收标准

- ACP 不再读取或存储 `_meta.terminal_output` 能力状态。
- `TerminalRendering`、终端 id、终端 cwd 解析与 `_meta.terminal_*` update 映射从 `@deepseek-ai/dsh-acp` 中消失。
- `ToolTerminal` 从 `@deepseek-ai/dsh-tools` 中消失，或在展示清理中因未使用而删除。
- Bash 结果展示不再为终端 pill 解析退出状态。
- 已实现的[富 ACP bash 渲染 RFC](../../implemented/feature/2026-06-18-acp-terminal-and-tool-rendering.md) 作为已交付历史保留在 `implemented/` 中；如被本提案取代，则加上交叉链接。

## 放弃的内容

Zed 用户将失去专用终端卡片：没有 cwd 头部、终端展示或 exit pill。他们仍能以纯内容形式看到命令和输出。在 ACP 桥接层尚未发布、`_meta` 键只是约定而非标准的阶段，这是合理的简化。

<!-- rfc-format: alternatives-not-recorded (pre-format RFC) -->
