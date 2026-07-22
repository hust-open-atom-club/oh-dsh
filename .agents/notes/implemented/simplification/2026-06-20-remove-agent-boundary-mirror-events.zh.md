# Agent Note: 停止将持久化边界镜像为 agent 事件

Status: implemented

[English](2026-06-20-remove-agent-boundary-mirror-events.md) | 中文

<!-- 以修订、收窄后的形式落地：
     移除了四个 turn/step 边界镜像；此处保留了 `agent/steering` 和
     `agent/stream-chunk`（它们不是持久边界镜像——参见
     “范围：移除什么、不移除什么”）。原始提案将 `agent/steering` 与其他项一并
     移除；把它排除在外，使本 Agent Note 的范围保持在边界上。后来每个保留事件
     都由各自的决策移除——参见
     [停止将 token 流镜像为 agent 事件](2026-07-02-remove-stream-chunk-mirror.md)
     和[移除 `agent/steering` 镜像 emit](2026-07-04-remove-agent-steering-mirror.md)。 -->

## 问题

循环在 `SessionEvent` 中记录规范 transcript（文本记录），同时还发出一组并行的实时 `agent/*` 边界镜像事件：`agent/turn-start`、`agent/turn-end`、`agent/step-start` 和 `agent/step-end`。这些镜像迫使消费者在同一持久事实的两个事实来源之间做选择。ACP（Agent Client Protocol）已经为面向编辑器的 transcript 选择 session log，因为它是唯一持久、可重放的记录；消费实时镜像需要把它的时序与日志中已经存储的边界进行调和。stdio UI 是唯一仍从镜像事件渲染 turn 边界的生产消费者；它已经从 `session/event` 渲染工具调用和结果。

这种重复并非零成本。每次生命周期变更都需要同时更新会话事件、镜像事件、文档、不变式、测试和快照预期。重复的边界事件还使失败排序变得微妙：一个轮次可能在实时 `agent/turn-end` 监听器运行之前就已被持久化关闭，因此边界之后的监听器失败在日志中已没有合法位置可以插入，只能带外上报。

## 决策

将 `session/event` 作为唯一的实时边界/transcript（文本记录）流。需要渲染轮次、工具调用、工具结果、助手消息和持久化边界的消费方统一订阅 `session/event`，从持久化层使用的同一套事件词汇中派生 UI。

四个持久边界镜像——`agent/turn-start`、`agent/turn-end`、`agent/step-start`、`agent/step-end`——已从 agent（智能体）事件分类中移除。希望在边界处取得 agent handle 的 UI 会保留来自 `agent/created`/`agent/disposed` 的实时目标对象，并直接比较其 session；`dsh-ui-stdio` 据此为应用拥有的 agent 标记 `[main turn N]` 头部，其他 session 则渲染其持久 id。规范记录仍是事件溯源 session log。

step 镜像（完全没有消费者）最先在[事件域语义 Agent Note（agent 决策记录）](../architecture/2026-06-30-event-domain-semantics.md) 中移除；该 Agent Note 当时以 stdio UI 需要在 turn 边界取得 `Agent` handle 为由，保留了 turn 镜像。本 Agent Note 完成余下工作：`dsh-ui-stdio` 是可随时丢弃的测试 REPL，其渲染可以自由变化，因此“ui-stdio 需要它”并不是保留镜像的理由——它读取 `session/event`，只保留自己的实时目标对象。

## 范围：移除什么、不移除什么

已移除（持久边界镜像——每项都以 session log 为权威）：`agent/turn-start`、`agent/turn-end`、`agent/step-start`、`agent/step-end`。

保留——不是持久边界镜像，因此不在本决策范围内：

- `agent/steering`——不是边界，因此不在本决策范围内（原始提案将其一并移除；在此会造成范围蔓延）。它镜像持久的 `steering/message` 控制记录，而非边界，后来由自己的后续决策移除：[移除 `agent/steering` 镜像 emit](2026-07-04-remove-agent-steering-mirror.md)。
- `agent/stream-chunk`——实时 token 流。不在本决策范围内（它镜像持久的 `assistant/chunk`，而非边界），后来由自己的后续决策移除：[停止将 token 流镜像为 agent 事件](2026-07-02-remove-stream-chunk-mirror.md)。
- `agent/created`、`agent/disposed`、`agent/status`、`agent/error`、`agent/queued`——不属于 transcript 数据的生命周期/控制事件。尤其是 `agent/queued`，它是在任何持久事件存在之前触发的 inbox 确认（取消的排队工作可能永远不会进入日志），所以有意只保留为实时事件。

## 曾考虑的替代方案

- **将 `agent/steering` 一并移除**——原始提案的形状；作为范围蔓延被排除：它镜像持久的 `steering/message` 控制记录，而非边界，后来由[自己的决策](2026-07-04-remove-agent-steering-mirror.md)移除（`agent/stream-chunk` 也由 [stream chunk 镜像 Agent Note](2026-07-02-remove-stream-chunk-mirror.md) 移除）。
- **为 stdio UI 保留 turn 镜像**——[事件域语义 Agent Note](../architecture/2026-06-30-event-domain-semantics.md) 的原始立场；在此否决，因为 `dsh-ui-stdio` 是可随时丢弃的测试 REPL，而非承载关键约束的消费者，并且它改为根据 `session/event` 加自己的实时目标对象渲染边界。

## 后果

插件不能再从便捷的 `Agent` 优先事件观察 turn/step 边界。它需要订阅 `session/event`；如果需要实时对象，则通过 `ctx.agents` 解析共享 id，或保留自己已经拥有的对象。这是可以接受的取舍：边界消费者不应依赖可能与持久日志发生漂移的第二条事件 feed。
