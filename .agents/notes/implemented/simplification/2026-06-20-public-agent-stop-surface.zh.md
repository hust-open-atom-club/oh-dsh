# RFC: 保留单一公开停止原语

Status: implemented

[English](2026-06-20-public-agent-stop-surface.md) | 中文

> **实现说明：** 仅移除了 `abort()`。`whenIdle()` 予以保留，因为它是公开的静默信号，能安全处理等待者结算与替换轮次竞态；消费方不应从状态转换中自行重建该行为。

## 问题

公开的 `Agent` 句柄暴露了两种重叠的方式来停止进行中的工作：`abort(reason?)` 和 `cancel(reason?)`。`abort()` 仅终止当前步骤，不影响队列中的工作；`cancel()` 清除队列中的工作和 steering（中途引导）工作、中止正在运行的步骤，并处理步骤前竞态。在生产环境中，ACP（Agent Client Protocol）使用 `cancel()` 实现 `session/cancel`，而生命周期所有者通过 `AgentHandle.dispose()` 销毁 agent（智能体）。没有生产调用方需要裸 `abort()`。

`abort()`/`cancel()` 的区别是真实存在的：`abort()` 保留队列中的提示词和 steering，而 `cancel()` 丢弃它们。但没有任何已上线的代码调用过公开的 `abort()` 动词。循环自身的停止路径（`cancel()` 和 disposal）直接中止当前 `AbortController`，而不经由 `Agent.abort()` 路由。大多数调用 `abort()` 的测试中断的是空队列，可以改用 `cancel(reason)`；那个刻意依赖队列保留的 steering 重投递测试则直接驱动进行中的 `AbortController`，因为 `cancel()` 会丢弃它试图证明在步骤中止后仍存活的已排队 steering。无参 `abort()` 的默认原因（`'aborted'`）随该动词一起删除，而非被意外保留；`cancel()` 保留自己的 `'cancelled'` 默认值。

多余的公开接口使得循环不得不承载一个本质上属于内部拆卸的公开动词：`abort()` 必须被文档描述为有别于队列感知的取消，尽管 UI 取消几乎总是需要更广泛的操作。

## 决策

`cancel()` 是 `Agent` 上唯一的公开*停止*原语。生命周期所有者使用 `AgentHandle.dispose()` 停止并注销 agent；非所有者使用 `cancel()` 放弃当前和队列中的工作。实现内部保留一个私有的 abort controller，但它不属于面向插件的 `Agent` 契约。

`whenIdle()` **保留**为公开的静默观测原语（agent 从 `running` 状态稳定后 resolve，已处于 idle 时立即 resolve，dispose 后等待循环退出）。它不是停止动词；它是非所有者在不 dispose agent 的前提下观测停止*完成*的方式。它的活跃消费方是 ACP 和通过此公开 seam 等待结算的 agent 测试（`packages/ui/acp/tests`、`packages/core/agent-loop/tests`）；生产环境的 ACP 桥接层拥有其 agent 并通过 `AgentHandle.dispose()` 销毁它们，因此 `packages/ui/acp/src` 本身没有 `whenIdle()` 调用。

公开的 `abort()` 被删除，连同将其作为独立 API 测试的用例以及将步骤级中止描述为嵌入特性的文档。空队列中止测试迁移到 `cancel(reason)`，仍然验证取消行为；以循环内部 `AbortController` 为测试对象的用例通过包内类型转换直接驱动该 controller 的私有字段；仅固定已移除的无参 `abort()` 默认值的测试随方法一起删除。disposer 仍为异步，仍等待循环停止。

## 曾考虑的替代方案

**同时移除 `whenIdle()`**：最初提案的形态，在对照代码验证前提后被推翻（上方的实现说明记录了完整过程）：它是承重的静默原语，迫使消费方手动观测 `running`→`idle` 转换正是防御性模式所警告的脆弱路径。

## 验证

`Agent` 不再暴露公开的 `abort()`，而 `cancel()`、`whenIdle()` 和 `steer()` 保留；ACP 取消调用 `cancel()`；拆卸通过 handle disposal 等待静默，`whenIdle()` 在静默时为非所有者观测者 resolve；测试套件覆盖取消和 disposal 作为两条受支持的停止路径。

## 后果

未来的插件无法通过公开接口仅中止当前模型/工具步骤而保留队列中的提示词。如果该用例变为现实需求，它应当带着一个具名消费方和更窄的契约回归。目前它是将私有循环机制保持公开的潜在泛化。

## 相关

本 RFC 仅移除冗余的停止动词。中途 steering 仍是有意保留的消息路径；静默观测仍通过 `whenIdle()` 提供。最终的公开接口为 `send()`、`steer()`、`inject()`、`cancel()`、`whenIdle()`、status、options、session 和 identity。
