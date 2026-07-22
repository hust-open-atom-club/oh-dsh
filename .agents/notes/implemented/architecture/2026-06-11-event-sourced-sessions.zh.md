# RFC: 事件溯源的会话与派生消息历史

Status: implemented

[English](2026-06-11-event-sourced-sessions.md) | 中文

## 问题

MVP 要求严格的基于事件的追踪，以及完全可回放的会话（严格的基于事件的 trace、logging 系统，session 完全可回放）。

## 决策

`Session` 是一份仅追加的、类型化的 `SessionEvent` 日志，是唯一的真源。LLM（大语言模型）消息历史从日志*派生*（`deriveMessages()`）；原始流分片被记录以保证 token 级别的回放保真度，而组装后的 `assistant/message` 事件才是派生的权威依据。回放/fork = 用已有日志初始化一个新会话。

追加操作是同步的（热路径从不阻塞于 I/O）；`session/event` 是同步通知；持久化插件在后台缓冲写入，并在每个轮次结束时触发的 `session/flush` 检查点处等待排空。

顺序契约：agent loop（智能体循环）*先*追加到会话，再发出对应的 Cordis 事件；`agent/step-result` waterfall（瀑布式事件）在 `assistant/message` 追加之前运行，因此日志记录的是工具调度实际使用的消息。回归测试固定了这一顺序。

## 曾考虑的替代方案

**可变消息数组 + 事件仅作通知发出**：更简单，但状态与日志可能分歧；采用事件溯源后，日志本身即是状态，分歧在结构上不可能发生。

## 后果

- 回放、追踪与遥测在结构上得到保证，而非事后附加。
- 持久化仍是插件关注点；内存存储随 dsh-session 一起提供。
- 事件词汇可通过合并扩展（插件可添加如压缩（compaction）事件）；[会话持久化](2026-06-14-session-persistence.md)在日志变为持久后冻结了其形状。
- 派生成本随日志长度增长，压缩（未来插件）是预期的缓解手段，而非日志变更。
