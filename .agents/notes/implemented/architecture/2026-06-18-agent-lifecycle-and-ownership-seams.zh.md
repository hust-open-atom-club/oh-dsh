# RFC: Agent 生命周期与所有权 seam

Status: implemented

[English](2026-06-18-agent-lifecycle-and-ownership-seams.md) | 中文

## 问题

ACP（Agent Client Protocol）与 tool-bash 的若干限制是同一个缺失 seam 的症状：插件可以通过 `ctx.agents` 创建或恢复 agent（智能体），但无法独立拥有和 dispose（资源释放）单个 agent，而长时间运行的 bash 任务在执行器中也没有稳定的所有者。ACP 在断连时中止并等待 agent，却无法仅注销该会话的 agent；`session/cancel` 无法取消已入队但尚未开始的工作；`tool-bash` 将任务所有权保存在插件本地的 `Map` 中，因此一次 HMR（热模块替换）重载就可能让旧任务看起来无主。

## 决策

三个 seam：队列感知的 cancel、`AgentHandle` 释放器，以及 bash 所有者令牌。

### 1. 队列感知的 `Agent.cancel(reason?)`

`cancel()` 是唯一的公开停止原语。它清除已入队和 steering（中途引导）输入、中止正在进行的步骤，并设置一个在每个轮次边界检查的轮次作用域标记。因此，已入队的 prompt 在取消后无法启动，也无法吸收后续输入。`whenIdle()` 等待取消后的静默状态，ACP 的 `session/cancel` 映射到此方法。对空闲状态的 cancel 不设置标记。

### 2. `AgentHandle` 异步释放器

`ctx.agents.create`/`resume` 和 `AgentFactory` 返回 `AgentHandle = { agent, dispose() }`。释放是消费方的能力；仅持有 `Agent` 的观察者无法将其拆除。调用方 fiber 和 factory 提供方也拥有该实例，所有路径共享一个 memoize 的拆除过程：停止循环、等待静默与刷写完成、分离 agent 和会话，然后解除其 scope。ID 在注册表条目分离后变为可复用。由配置创建的 agent 归 loop fiber 所有；ACP 存储并 dispose 每个会话的 handle。

拆除顺序对持久性至关重要。会话生命周期与循环共享一个复合 Cordis effect，因此 LIFO 释放会先停止循环并等待 `agent.done`，然后再分离会话。若使用兄弟 effect，则会并发释放，可能在关闭刷写之前就移除 append 钩子。释放通知被隔离，不会中断拆除链。

### 3. Bash seam 中的所有者令牌

后台任务的所有权属于执行器。`BashExecSpec.owner` 携带一个可选的不透明令牌，`ownerOf(id)` 读取它，`dsh-tool-bash` 在启动时盖上调用方的会话令牌。`bash_output` 和 `bash_kill` 拒绝不匹配的调用方；完成通知通过注册表按会话令牌定位存活的 agent。将所有权保存在任务上，使得这道隔离在工具插件重载后依然有效。完成监听器仍然是 effect 作用域的，因此在重载间隙到达的通知仍可能被丢弃。

## 验证

- ACP 断连或会话关闭后，不留下任何已注册的 agent 或 session-store 条目，包括 `session/load` 与拆除竞争的情况。
- 在已入队的 prompt 启动前取消，能阻止该 prompt 运行或吸收下一条 prompt。
- 重载 `dsh-tool-bash` 不会让另一个会话读取或终止已有的后台任务，因为所有权保留在执行器上。
- 由配置创建的 agent 仍归 loop fiber 所有，因此非 ACP 演示无需显式管理 handle。

## 会话所有者令牌在存活 agent 中唯一

bash 所有者令牌依赖 `session.header.id` 在存活 agent 中的唯一性。并发的同 ID 操作可以私下准备，但 `SessionStore.enter()` 拒绝重复发布，失败的事务回滚。`tool-bash` 拥有比较策略；bash seam 存储一个不透明的 `owner` 字符串，不对其做解释。

## 曾考虑的替代方案

- **公开的 `BashTask.owner` 字段**而非 `BashExecutor.ownerOf(id)` seam：否决。一条读取路径即可，无需冗余 API。
- **为 agent 的会话生命周期使用兄弟 Cordis effect**：否决。fiber 卸载时并发释放兄弟 effect（`Promise.all`），store 拥有的 append 发布钩子的移除与循环的关闭 `session/flush` 产生竞争；单一复合 effect 的有序 LIFO 链才能在两条释放路径上都捕获关闭的 `turn/end`。
- **在 `cancel()` 之外另设一个仅中止步骤的 `abort()`**：最初发布过，后因无人使用而移除；`cancel()` 是唯一的公开停止原语（见[公开停止接口 RFC](../simplification/2026-06-20-public-agent-stop-surface.md)）。

## 后果

本变更有意触及公开接口（`Agent`、`AgentFactory`、bash seam），而非作为 ACP 的局部补丁。简洁的同步 `Agent.send()` 人体工学得以保留；异步生命周期路径是增量添加的，供需要它的所有者使用。
