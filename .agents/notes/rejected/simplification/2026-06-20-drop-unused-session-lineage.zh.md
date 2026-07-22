# Agent Note: 移除未使用的会话血缘元数据

Status: rejected — `parentSession` 是已记录的 fork/subagent seam 的一部分，并已由 agent/session 恢复路径保留。该字段面向未来，但并非意外遗留的死状态。

[English](2026-06-20-drop-unused-session-lineage.md) | 中文

## 问题

`SessionHeader.parentSession` 记录新会话从哪个会话 fork 而来。它在 `dsh-session` 中定义，被持久化后端保留，在恢复流程中复制，作为血缘元数据被文档记录，并有往返测试覆盖。然而仓库中没有任何生产环境的 fork UI 或 subagent 流程读取它。计划中的 subagent/fork seam 仍是 TODO，因此该字段目前只是预存的未来形状。

单个文件的成本虽小，但在格式层面影响面广：每个后端 schema 和元数据序列化器都在保留一个尚无已完成功能读取的值。由于 header 是磁盘契约，即使是占位字段也会成为未来重构必须维护、迁移或有意打破的东西。

## 提案

移除 `parentSession`，使其不再属于 `SessionHeader`，直到真正的 fork/恢复功能需要血缘信息时再引入。如果存在相应 API，fork 仍然可以用先前事件来初始化新会话，但持久化的父指针应当与读取它的功能和解释它的 UX 一同引入。

如果血缘信息回归，届时再决定它应放在不可变 header 中、会话图索引中，还是作为一等事件。当前字段不应预先锁定那个设计。

## 验收标准

- `SessionHeader` 仅包含 version、id、createdAt 和可选的 cwd。
- JSONL 与 SQLite 元数据 schema 不再存储 parent-session id。
- 恢复与列表 API 不再往返传递 `parentSession`。
- 文档和测试移除没有生产消费方支撑的 fork 血缘声明。
- 会话格式版本、后端 schema 版本与记录的 fixture（测试前置数据）按需刷新；按预发布格式策略，非当前版本的存储数据将被拒绝，不提供迁移路径。

## 放弃了什么

代码库失去了一个为未来 fork/subagent UX 预备的现成血缘钩子。这是有意为之。该字段在功能存在时很容易重新引入，而未发布的立场允许格式变更无需迁移。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
