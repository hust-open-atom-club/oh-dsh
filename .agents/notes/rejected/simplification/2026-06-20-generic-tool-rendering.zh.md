# Agent Note: 收拢工具自有的 UI 展示逻辑

Status: rejected — tool-owned presentation should wait for more real tools before being generalized or deleted. Bash and ACP currently need the existing richer presentation path.

[English](2026-06-20-generic-tool-rendering.md) | 中文

## 问题

工具可以定义 `presentCall()` 和 `presentResult()` 回调，返回 `ToolCallPresentation`、`ToolResultPresentation` 以及可选的 `ToolTerminal` 字段。代码本身就标记了这个设计的混乱：title、kind、raw input、content、terminal cwd、terminal output、exit code 和 signal 逐步增长为一堆可选字段。ACP（Agent Client Protocol）随后维护 pending call 状态以将 result 与原始 args 配对，在 `session/load` 时创建仅用于回放的 presenter，并将 terminal 子字段映射为 Zed 特有的 `_meta`。`dsh-tool-bash` 甚至从渲染后的文本中反向解析退出状态，因为纯回放安全的 presenter 已经拿不到结构化的 `BashRunResult`。

真正的第一方用途是为 ACP 提供 bash 展示。这不足以作为冻结一个跨包 UI 展示 API 的依据。

## 提案

暂时移除工具自有的 UI 展示回调。规范的工具事件已经携带工具名、原始参数字符串、结果内容和错误状态。UI 从这些字段渲染一个通用的工具卡片。工具特有的富展示可以在至少有两个真实工具和两个真实消费方来验证词汇之后，以带标签的 render-intent union 形式回归。

## 曾考虑的替代方案

作为更小的替代方案，可以在一个 PR（Pull Request）中将当前的可选字段集合替换为一个显式 union；但如果目标是简化，更彻底的做法是删除回调、保留通用路径。

## 验收标准

- `ToolDefinition` 移除 `presentCall` 和 `presentResult`。
- `ToolCallPresentation`、`ToolResultPresentation`、`ToolTerminal` 和 `ToolCallKind` 消失，除非一个最小的通用 UI 类型仍需要其中之一。
- ACP 不再维护 presenter pending 状态，也不再在实时流式输出/加载回放期间调用工具回调。
- `dsh-tool-bash` 不再解析渲染文本来恢复退出状态以供 UI pill 使用。
- 快照预期输出展示通用工具卡片和文本结果。

## 放弃了什么

Bash 失去其自定义的终端风格卡片和模型生成描述的放置位置。回退方案仍然合理：命令作为工具输入展示，输出作为文本展示。富展示应当在产品拥有足够的 UI/工具多样性、足以支撑一份稳定的展示契约时再行设计。

## 相关

这是[移除 ACP terminal 元数据](2026-06-20-drop-acp-terminal-meta.md)的宽泛版本。如果本 Agent Note（agent 决策记录）被接受，那个更窄的 Agent Note 就不再必要。
