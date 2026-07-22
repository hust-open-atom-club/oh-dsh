# Agent Note: 移除轮次中途引导

Status: rejected — mid-turn steering 是一项有意设计的 agent 能力，用于接收 between-step 的用户/插件输入以及未来的 goal/loop 工作流。它是面向产品方向的复杂度，而非 `send()` 的意外重复。

[English](2026-06-20-retire-mid-turn-steering.md) | 中文

## 问题

agent（智能体）暴露了两条用户消息路径，外观相近但生命周期语义不同：`send()` 将一条普通用户轮次排入队列，而 `steer()` 在当前运行轮次的步骤之间注入一条消息，空闲时则回退为 `send()`。这一区分贯穿整个栈：`Agent.steer()` 是公开 API；会话日志有持久化的 `steering/message` 事件；agent 事件分类体系有 `agent/steering`；agent loop（智能体循环）在排队消息 FIFO 之外还维护一个 steering FIFO；取消操作需要清空两个队列；`deriveMessages()` 必须将 steering 渲染为带标签的合成用户消息，而非普通提示词。

续行 seam 进一步放大了成本。`agent/turn-continuation` 默认条件为 `hadToolCalls || steeringInjected`，因此同一轮次内的 steering（中途引导）消息即使模型未请求工具调用，也会强制循环再次调用模型。注释中提到了未来 `/goal`、`/loop` 和预算守卫的用途，但当前仓库没有生产级监听器；只有测试注册了该 waterfall（瀑布式事件）。另外，唯一调用 `steer()` 的生产 UI 是 stdio 演示。ACP（Agent Client Protocol）在轮次运行期间已经通过普通队列发送提示词。

## 提案

暂时删除轮次中途的用户 steering。`Agent.send()` 成为提交用户内容的唯一公开方式；当 agent 正在运行时，内容等待下一个轮次。循环仅因工具调用而在轮次内继续，不因用户在某个步骤运行期间输入内容而继续。调用方若要中断当前轮次，使用 `cancel()` 后再 `send()`。

移除 `Agent.steer()`、steering FIFO、`steering/message`、`agent/steering`、由 steering 驱动的续行逻辑，以及取消操作中区分排队消息与 steering 消息的逻辑。除非实现 PR（Pull Request）发现了生产级监听器，否则在同一变更中一并移除 `agent/turn-continuation`；没有 steering 后，当前仓库不再有具体的续行消费方。如果将来真正的预算或目标插件需要强制续行，应以该插件为具体消费方重新引入一个更窄的 seam。

## 验收标准

- `Agent` 暴露唯一的用户消息入口 `send()`。
- 持久化会话事件词汇不再包含 `steering/message`。
- `deriveMessages()` 渲染普通用户消息和上下文注入，不存在 steering 标签路径。
- 循环只有一个排队消息 FIFO，没有同轮次用户消息续行路径。
- `agent/turn-continuation` 被移除，或收窄到有具名的生产级消费方。
- stdio UI 和文档将运行期间的输入描述为「排入下一轮次的输入」。
- 会话格式版本和已录制的 fixture（测试前置数据）已刷新；非当前版本的存储日志按预发布格式策略被拒绝。

## 放弃了什么

用户无法在模型处于工具步骤之间时添加同轮次 steering 内容。这种行为在理论上对「你已经在工作了，也考虑一下 X」的场景有用，但它不是 ACP 当前暴露的行为，且使轮次边界更难推理。更简单的行为是合理的：用户输入成为下一条提示词，取消操作仍是替换进行中工作的显式手段。

## 相关

本提案与[移除持久化步骤边界](2026-06-20-drop-durable-step-boundaries.md)天然配对，因为移除同轮次 steering 和 `agent/turn-continuation` 后，工具调用成为一个轮次包含多个模型步骤的唯一原因。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
