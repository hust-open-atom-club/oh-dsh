# RFC: 深度只读的公开接口

Status: rejected — the pervasive `DeepReadonly<T>` type flip is replaced by source-owned runtime immutability in `Session` plus relational development assertions. See [source-owned session immutability and dev-mode invariants](../../implemented/architecture/2026-06-11-dev-invariants-over-deep-readonly.md).

[English](2026-06-11-immutable-public-surfaces.md) | 中文

## 问题

被否决的提案针对的是一个所有权漏洞：仅靠 `readonly SessionEvent[]` 类型无法封堵该漏洞，因为其元素在运行时仍然可变，类型强制转换或纯 JavaScript 代码可以改写嵌套的历史记录。已实现的设计在 `Session` 中封堵了这一漏洞：对每个被接受的事件进行物化并深度冻结，返回冻结的数组快照。进行中的 prompt waterfall（瀑布式事件）有意保持可变换，因此不可变性是一条所有权边界，而非一条全局类型规则。

## 提案

> **实际采用了不同的实现方式——见 Status 行与[源拥有的会话不可变性与开发模式不变式](../../implemented/architecture/2026-06-11-dev-invariants-over-deep-readonly.md)。** 下文的 `DeepReadonly<T>` 设计已被否决：它仅在编译期生效、对消费方噪音大、且可被强制转换绕过。`Session` 改为在每次组合中对已接受的事件和公开日志快照进行快照与深度冻结；`deriveMessages()` 返回分离的冻结投影；开发插件检查跨记录与跨 seam 的关系。

在类型层面为「突变即损坏」的场景引入不可变性：

- `SessionEvent` 数据在从会话输出时（`events`、`session/event` 监听器）变为 `DeepReadonly`；`append()` 仍接受普通可变输入。一个 `DeepReadonly<T>` 工具类型放在 dsh-llm 中，与 brand/never 辅助类型相邻。
- `deriveMessages()` 返回深度只读的消息；agent loop（智能体循环）在将可变请求交给 `agent/request` waterfall 之前先克隆（该处的突变是被允许的——克隆使边界显式且代价低廉，每个步骤仅一次）。
- `PromptAssembly` 在其 waterfall 流经期间保持可变（被允许），但注册表内部的 section 列表在每次组装时被克隆（已有此行为）。

## 计划

引入 `DeepReadonly`，翻转会话的读取路径，并修复消费方中由此产生的编译错误。

## 风险

`DeepReadonly` 类型在 waterfall 边界处（突变本身就是 API 的地方）可能产生噪音较大的错误。应将可变/只读边界精确地划在「已记录 vs 进行中」，并在 session README 中加以说明。

<!-- rfc-format: alternatives-not-recorded (pre-format RFC) -->
