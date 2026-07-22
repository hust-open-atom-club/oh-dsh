# Agent Note: 保留单一公开停止原语

Status: implemented

[English](2026-06-20-public-agent-stop-surface.md) | 中文

> **实现说明：** 仅移除了 `abort()`。`whenIdle()` 予以保留，因为它是公开的静默信号，能安全处理等待者结算与替换轮次竞态；消费方不应从状态转换中自行重建该行为。

## 问题

公共 `Agent` handle 暴露了两种相互重叠的在途工作停止方式：仅针对 step 的 `abort()` 和感知队列的 `cancel()`。前者保留已排队输入，后者则清除已排队和 steering（中途引导）工作，并中止活动 turn。在生产中，ACP（Agent Client Protocol）对 `session/cancel` 使用 `cancel()`，生命周期拥有者则通过 `AgentHandle.dispose()` 拆除 agent（智能体）。没有生产调用方需要一个裸的、仅针对 step 的 abort。

行为差异确实存在，但已发布代码不需要较窄的操作。AgentLoop 改为为整个 turn 拥有一个私有取消 holder。`cancel(cause?)` 携带类型化的 `user` 或 `parent` 原因，默认为 `user`，并丢弃待处理输入；释放仍是单独的生命周期中断。完整的归属与传播契约位于[显式 turn 取消 Agent Note（agent 决策记录）](../architecture/2026-07-16-explicit-turn-cancellation.md)。

多余的公开接口使得循环不得不承载一个本质上属于内部拆卸的公开动词：`abort()` 必须被文档描述为有别于队列感知的取消，尽管 UI 取消几乎总是需要更广泛的操作。

## 决策

`cancel()` 是 `Agent` 上唯一的公共*停止*原语。生命周期拥有者使用 `AgentHandle.dispose()` 停止并注销 agent；非拥有者使用 `cancel()` 放弃当前和已排队工作。实现保留一个私有 turn 取消 holder，但它不属于面向插件的 `Agent` 契约。

`whenIdle()` **保留**为公开的静默观测原语（agent 从 `running` 状态稳定后 resolve，已处于 idle 时立即 resolve，dispose 后等待循环退出）。它不是停止动词；它是非所有者在不 dispose agent 的前提下观测停止*完成*的方式。它的活跃消费方是 ACP 和通过此公开 seam 等待结算的 agent 测试（`packages/ui/acp/tests`、`packages/core/agent-loop/tests`）；生产环境的 ACP 桥接层拥有其 agent 并通过 `AgentHandle.dispose()` 销毁它们，因此 `packages/ui/acp/src` 本身没有 `whenIdle()` 调用。

公共 `abort()` 已不存在，disposer 仍为异步并等待循环停止。测试通过公共类型化原因和显式 signal 接缝验证取消，而不会伸入 holder 内部。

## 曾考虑的替代方案

**同时移除 `whenIdle()`**：最初提案的形态，在对照代码验证前提后被推翻（上方的实现说明记录了完整过程）：它是承重的静默原语，迫使消费方手动观测 `running`→`idle` 转换正是防御性模式所警告的脆弱路径。

## 验证

`Agent` 不再暴露公开的 `abort()`，而 `cancel()`、`whenIdle()` 和 `steer()` 保留；ACP 取消调用 `cancel()`；拆卸通过 handle disposal 等待静默，`whenIdle()` 在静默时为非所有者观测者 resolve；测试套件覆盖取消和 disposal 作为两条受支持的停止路径。

## 后果

未来的插件无法通过公开接口仅中止当前模型/工具步骤而保留队列中的提示词。如果该用例变为现实需求，它应当带着一个具名消费方和更窄的契约回归。目前它是将私有循环机制保持公开的潜在泛化。

## 相关

本 Agent Note 只移除冗余的停止动词。turn 中途 steering 仍是一条有意保留的消息路径；静止观察仍通过 `whenIdle()` 完成。最终公共表面包括 `send()`、`steer()`、`inject()`、`cancel()`、`whenIdle()`、status、options、session 和 identity。
