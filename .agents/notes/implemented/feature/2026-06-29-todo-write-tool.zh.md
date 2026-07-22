# Agent Note: `todo_write` 工具——将模型任务列表作为事件溯源的会话状态

Status: implemented

[English](2026-06-29-todo-write-tool.md) | 中文

## 问题

harness 为模型提供了 bash 和 subagent 工具，却没有办法记录结构化的任务列表。todo 列表有两个同等重要的用途：引导模型规划多步骤工作并保持当前活跃任务明确（最多一个活跃，有剩余工作时恰好一个）；同时为人类提供实时进度清单。ACP（Agent Client Protocol）协议原生支持 `plan` sessionUpdate，编辑器（Zed）已能渲染它，但 bridge 从未发出过。调研的所有参考编码 agent（智能体）（claude-code、opencode、codex、oh-my-pi、pi）都提供了某种形式的此功能；本 harness 此前没有。

## 决策

新增一个面向模型的 `todo_write(todos: [{ content, status }])` 工具，其整列表状态作为新的 `todo/write` `SessionEventMap` 变体存储在事件溯源的会话日志上。stdio UI 和 ACP bridge 均从现有的 `session/event` 渲染；ACP bridge 将列表映射为 `plan` sessionUpdate。

### 整列表替换，三态 status

模型每次调用发送完整列表；新列表替换旧列表（回放时 last-write-wins）。这是 claude-code V1、opencode 和 codex `update_plan` 共同采用的形状，也是模型训练最多的形状——没有逐项 id，没有 delta 协议。`status` 恰好是 `pending | in_progress | completed`：与 codex `update_plan` 相同的三元组，且关键的是**与 ACP `PlanEntryStatus` 完全一致**，bridge 因此可以 1:1 映射，无需有损转换。

### 状态在会话日志上，而非服务

列表作为 `todo/write` 事件追加到日志，携带完整的 `{ todos }` 快照。harness 是事件溯源的——LLM（大语言模型）历史、工具调用和轮次结构都在日志上——所以 todo 列表也在那里。这免费获得了持久性、回放和 `session/load` 重建：重新打开的会话从最后一条 `todo/write` 重新推导当前列表，ACP bridge 在加载时重新发出 `plan`，无需独立的持久化后端、无需重新注水的内存服务、无需额外接线。一个内存中的 `ctx.todos` 服务需要重新发明以上所有。

### 不是 surface 事件

`todo/write` 被有意排除在 `SurfaceEventType` 之外。surface 是产出 LLM 消息历史（`deriveMessages()`）的投影；todo write 不产生对话消息。因此它不携带 `surfaceOp`，不加入有序 surface，不进入 `deriveMessages()`——它是持久、可回放的 *UI* 状态，与对话并行传输但不属于对话的一部分。（dev-mode 不变式仍要求它位于一个打开的轮次内，而它始终如此：它在工具调用的步骤中途追加。）

### Priority 仅在 ACP 边界合成

ACP 的 `PlanEntry` 要求 `content` + `priority` + `status`，但 `TodoItem` 没有 priority——模型从不推理它。与其在 schema 中增加一个模型每次都必须提供的字段，bridge 在构建 `plan` 时为每条条目合成常量 `priority: 'medium'`。Priority 是 ACP 协议格式（wire format）的要求，不是 harness 概念，因此它恰好存在于需要它的边界上。

### 相比 claude-code V1 舍弃的字段：`activeForm`、id、priority

claude-code V1 的条目是 `{ content, status, activeForm }`；后来（V2）增加了 id、依赖和所有权——但仅为支持 agent *集群*（磁盘持久、锁保护、逐项变更）。本工具将条目保持在最小集：`{ content, status }`。不要 `activeForm`（现在进行时标签）——UI 直接展示 `content`；不要 id——整列表替换不需要稳定标识；不要 priority——见上文。每舍弃一个字段，模型每次调用就少产出一项。

### 单一所有者——无集群机制（YAGNI）

每个列表属于调用它的 agent 会话，非 agent 调用被拒绝。没有共享作用域、resolver 或 delta 协议。跨 agent 列表需要逐项日志 delta 和显式作用域选择，因此留作未来独立设计。

### 校验：低成本的中间路线

schema 强制 type/required/enum。在此之上，`execute` 拒绝为空或重复的 `content`，以及超过一个 `in_progress` 任务。claude-code 将单一 in_progress 交给 prompt 约束；oh-my-pi 在代码中强制。我们取中间路线：强制执行使计划*连贯*的低成本不变式（无空任务、无重复、最多一个活跃），但将排序和保持列表最新的纪律通过工具描述交给模型。被拒绝的写入返回 `isError` 结果，使模型自行修正。

## 为何没有 cordis-catalog 条目 / 没有 `@mode`

`todo/write` 是 `SessionEventMap` 的成员，不是一等的 cordis `interface Events` 事件。catalog 生成器（`scripts/gen-cordis-catalog.ts`）扫描 `interface Events` 声明；`SessionEventMap` 变体搭载现有的 `session/event` emit，不产生新的 catalog 行。因此它不携带 `@mode` 标签（生成器仅对 `interface Events` 成员要求该标签）——添加一个毫无意义。

## 测试

四个层级，预先设计：
- **单元测试**——会话事件（append/snapshot-clone/last-write-wins/not-on-surface）；工具（schema 形状、通过真实 `ctx.tools.execute` 的参数校验、值校验、事件追加与替换、非 agent 拒绝、`presentCall`、HMR（热模块替换）安全性）；ACP `todosToPlan` 映射；stdio 渲染分支。
- **真实 Loader 路径**——插件通过 `Loader.unwrapExports` 运行，断言命名空间导出形状存活（它有 `inject`，因此一个意外的 default 导出会在加载时崩溃——postmortem/0001）。
- **全循环集成**——一个脚本化的 mock 模型通过真实 agent loop（智能体循环）调用 `todo_write`；`todo/write` 事件落地，第二次调用替换它。
- **`session/load` 回放**——持久化的 `todo/write` 在新的 ACP bridge 加载会话时重新发出 `plan` 更新。
- **带密钥 e2e + 快照**——真实 prompt 诱导一次 `todo_write`；快照预期输出获得 `plan` 通知和日志事件。

## 曾考虑的替代方案

- **内存中的 `ctx.todos` 服务**——需要重新发明日志免费提供的持久性、回放和 `session/load` 重建。
- **逐项 delta 协议**——仅在共享多所有者列表时需要，超出当前范围；整列表替换更简单，且与参考实现一致。
- **工具放在 `core/` 中**——`todo_write` 是注册在 `ctx.tools` 上的扩展工具，不属于主干；它像其他工具族一样位于自己的 `packages/todo/` 分组中。

## 后果

todo 列表是持久、可回放的会话状态：持久化的 `todo/write` 在 `session/load` 时重新发出编辑器的 `plan` 更新，日志（而非插件内存）是唯一真源。整列表替换意味着每次更新一次工具调用，last-write-wins；没有需要协调的 delta 协议。事件不进入 surface，因此 todo 更新永远不会扰动推导出的模型历史——模型只看到自己的工具调用和结果。
