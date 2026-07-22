# RFC: 停止将持久化边界镜像为 agent 事件

Status: implemented

[English](2026-06-20-remove-agent-boundary-mirror-events.md) | 中文

## 问题

agent loop（智能体循环）通过可回放的 `SessionEvent` 日志和实时 `agent/*` 镜像两条路径暴露持久化的轮次与步骤边界。消费方不得不在同一事实的两个来源之间做选择，并协调二者的时序。ACP（Agent Client Protocol）和持久化层已经使用日志；stdio UI 是唯一仍在消费镜像的组件，而它已经从 `session/event` 渲染工具调用和工具结果。

这种重复并非零成本。每次生命周期变更都需要同时更新会话事件、镜像事件、文档、不变式、测试和快照预期。重复的边界事件还使失败排序变得微妙：一个轮次可能在实时 `agent/turn-end` 监听器运行之前就已被持久化关闭，因此边界之后的监听器失败在日志中已没有合法位置可以插入，只能带外上报。

## 决策

将 `session/event` 作为唯一的实时边界/transcript（文本记录）流。需要渲染轮次、工具调用、工具结果、助手消息和持久化边界的消费方统一订阅 `session/event`，从持久化层使用的同一套事件词汇中派生 UI。

移除 `agent/turn-start`、`agent/turn-end`、`agent/step-start` 和 `agent/step-end`。边界消费方改为订阅 `session/event`。如果 UI 需要 agent 标签，则通过 `agent/created` 和 `agent/disposed` 维护一份 session 到 agent 的映射，因为持久化的 `turn/start` 携带轮次编号但不携带 agent id。

步骤镜像已无消费方，由 [event-domain-semantics RFC](../architecture/2026-06-30-event-domain-semantics.md) 先行移除。该决策保留了轮次镜像供 stdio UI 使用；本 RFC 在将测试 REPL 迁移到 `session/event` 加 id 映射之后，将轮次镜像也一并移除。

## 范围：移除什么、不移除什么

本决策仅涉及持久化的轮次与步骤边界。`agent/steering` 镜像的是一条控制记录，`agent/stream-chunk` 镜像的是 token 流，因此各自单独处理：[steering](2026-07-04-remove-agent-steering-mirror.md) 与 [stream chunks](2026-07-02-remove-stream-chunk-mirror.md)。`agent/created`、`agent/disposed`、`agent/status`、`agent/error` 和 `agent/queued` 仍作为实时生命周期或控制事件保留，而非 transcript 镜像；排队中的输入可能在任何持久化事件产生之前就被取消。

## 曾考虑的替代方案

- **在同一个变更中一并移除 `agent/steering`**：否决，因为它是控制记录的镜像而非边界镜像。
- **为 stdio UI 保留轮次镜像**：否决，因为 UI 可以渲染 `session/event` 并通过 id 映射恢复 agent 标签。

## 后果

插件不再能从便捷的 `Agent` 优先事件中观察轮次/步骤边界，必须订阅 `session/event` 或自行维护 session 到 agent 的关联。这是可接受的取舍：边界消费方不应依赖一条可能与持久化日志产生漂移的第二事件源。
