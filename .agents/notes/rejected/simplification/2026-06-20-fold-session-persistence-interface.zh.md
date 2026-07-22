# Agent Note: 将持久化接口合并进 dsh-session

Status: rejected — the separate persistence interface package is the intended modular capability seam for durable backends. Folding it into `dsh-session` would reduce package count at the cost of a cleaner backend boundary.

[English](2026-06-20-fold-session-persistence-interface.md) | 中文

## 问题

`dsh-session-persistence` 是一个接口包（package），其核心概念已经由 `dsh-session` 拥有：`SessionHeader`、`SessionEvent`、`SessionId`、`session/event` 与 `session/flush`。该包额外添加了抽象的 `SessionPersistence` 服务、共享写入协调器和契约辅助工具。后端包依赖它，`agent-loop`（智能体循环）也需要可选地查找一个同级服务来实现恢复。

当持久化还是一个全新的可替换后端设计时，能力 seam 的拆分是合理的。但在可变摘要被移除之后，这个接口包基本上只是包装了会话日志自身的存储关切。继续保持独立可能带来的仪式感多于清晰度。

## 提案

将抽象的 `SessionPersistence` 服务、协调器和持久化契约辅助工具移入 `dsh-session`。JSONL 和 SQLite 仍作为独立的后端包，注册由 session 包拥有的服务。这样既保留了后端可替换性，又删除了一个支撑包和一条跨包 seam。

实施 PR（Pull Request）应更新[能力 seam](../../implemented/architecture/2026-06-13-capability-seams.md) 指南，补充此例外：持久化不同于 bash 或 LLM（大语言模型），因为它的词汇和生命周期事件本就属于 session 包的核心领域。

## 验收标准

- `@deepseek-ai/dsh-session-persistence` 作为包被移除。
- `dsh-session` 导出持久化服务类型、协调器和契约辅助工具。
- JSONL 和 SQLite 后端包直接依赖 `dsh-session`。
- `agent-loop` 的恢复功能使用 session 包拥有的服务键。
- [会话持久化](../../implemented/architecture/2026-06-14-session-persistence.md)、[共享持久化写入协调器](../../implemented/architecture/2026-06-18-shared-persistence-write-coordinator.md)与[包文档](../../../../packages/session-persistence/session-persistence/README.md)说明后端实现为何仍保持独立。

## 放弃了什么

`dsh-session` 变得更重：它同时拥有内存日志和持久化接口。这就是代价。如果第三方持久化后端已经形成公开生态，独立的接口包会是更清晰的 SDK 边界；但在预发布阶段，在尚无外部消费方时，多出的包看起来更像是过早的抽象。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
