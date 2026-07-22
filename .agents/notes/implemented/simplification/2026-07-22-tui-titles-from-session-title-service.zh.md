# Agent Note: TUI 标题来自 session-title 服务

Status: implemented

[English](2026-07-22-tui-titles-from-session-title-service.md) | 中文

## 问题

tui-staging 分支合入 master 后，两套模型标题实现并存。TUI 自带 `autoTitle` 特性：在首条用户消息后发起一次 fire-and-forget 的 `ctx.llm.stream` 调用，通过 OSC 0 设置终端窗口标题，带有一次性闩锁、自己的提示词、自己的 40 字符截断和自己的恢复重推导（[auto-title Agent Note](../feature/2026-07-21-tui-auto-pane-title.md)、[default-on Agent Note](../feature/2026-07-21-tui-auto-title-default-on.md)）。而 master 已落地[日志承载的会话标题](../feature/2026-07-21-log-backed-session-titles.md)：一个 `sessionTitle` 能力，其被接受的修订是持久的 `session/title` 事件，带确定性回退和可选的模型 provider。TUI 已经消费 `session/title` 作为横幅副标题和窗口标题，于是一个会话可能被两种策略各标题一次，且 TUI 的进程本地标题对其他所有消费者（ACP、恢复列表、fork）不可见。

## 决策

移除 TUI 本地生成；session-title 服务是唯一的标题来源。`TuiConfig.autoTitle`、闩锁、abort controller、标题提示词和 `titleLine` 全部从 `dsh-tui` 删除。终端重命名保留：TUI 在挂载时折叠最新的已记录标题（`foldSessionTitle`），将其渲染为横幅副标题，并在每个被接受的 `session/title` 事件上把终端窗口标题设为 `<会话标题> — <配置标题>` —— 包括恢复的会话，其标题现在从日志回放而不是重新生成。

模型生成的标题是组合选择：`examples/tui-agent/cordis.yml`（以及脚本化 PTY fixture）挂载 `@deepseek-ai/dsh-session-title-first-message-llm`，它继承主请求的确切路由，用简短的模型摘要替换 spine 的确定性回退。未挂载该 provider 的部署保留 `dsh-agent-spine-demo` 内置 `SessionTitleService` 的回退标题。

## 备选方案

**两者并存，已记录标题胜出。** 这是第一版合并决议：auto-title 独占整个窗口标题，直到已记录的 `session/title` 以后缀形式到达。它保留了行为，但每个新会话产生双倍模型调用，且 TUI 的标题在日志中不可观察，实质上违反 model-visible ⟺ logged，并把标题契约拆给两个所有者。

**把 auto-title 的提示词和截断移植为服务的第三个 provider。** first-message-llm provider 已经存在，节奏相同，且有经过评审的提示词契约、持久的请求记录和替换围栏；再造一个近乎相同的 provider 纯属重复。

## 影响

标题管线归一：持久、可回放、对所有消费者可见，并由服务对过期完成设防。TUI 削减约 90 行及其 `llm` 流式路径。代价是模型质量的标题现在需要在组合中挂载 provider 插件 —— 这是叶配置选择，不是 TUI 默认值 —— 且终端标题形状从裸模型摘要变为日志路径一贯使用的 `<标题> — <产品>` 后缀形式。被取代的 auto-title Agent Note 携带指向本文的指针。
