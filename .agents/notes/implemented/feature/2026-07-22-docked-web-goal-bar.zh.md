# Agent Note: 停靠式 Web 目标条

Status: implemented

[English](2026-07-22-docked-web-goal-bar.md) | 中文

## 问题

Web UI 此前没有任何目标相关的界面：目标栈已随模型工具、TUI/ACP 适配器和 `/goal` 命令交付，但浏览器客户端完全不接触它——既没有运行时动词，也没有指示器。本变更同时引入客户端目标动词（基于 RPC 的运行时会话方法）和第一个目标 UI。摆放位置遵循重新设计的前提：目标的存在感属于输入框的上下文——目标是用户即将提交的工作的属性，因此它的指示器停靠在消息输入框正上方，呈现为一条圆角顶部的横条，收进输入框卡片顶边之下。设计稿只保留一个闪光图标、一个阶段词（"Ongoing/Paused/Blocked Goal"）、截断后的目标内容，以及编辑／清除图标操作，恢复按钮仅在目标暂停时出现。

## 决策

`GoalBar`（`packages/client/ui-conversation/src/client/skeleton/GoalBar.tsx`）是一个新的、由 props 驱动的自包含组件；`ConversationRoot` 将它挂载在输入框 `InputBar` 紧上方。横条的 CSS 对齐输入框的水平几何（两侧 32px 内边距、776px 居中上限），再加上设计稿的 12px 内缩，并用 -10px 的下外边距吃掉 InputBar 的 8px 上内边距，使它方形的底边收进输入框卡片顶边之下 2px。横条的所有状态共享固定的 38px 高度，状态切换不会引起尺寸变化。加载中（`goal === undefined`）、无目标（`goal === null`）和 `phase === 'complete'` 时不渲染任何内容：已完成的目标是历史记录，不是常驻界面元素。

可见性决定标签和操作：active 状态显示 "Ongoing Goal" 并提供编辑／清除；paused 状态显示 "Paused Goal"，并增加一个恢复图标按钮；blocked 状态显示 "Blocked Goal"，并把 `blockedReason.message` 作为横条的 `title` 悬浮提示。创建目标的入口在 `/goal` 命令上，不在横条里。铅笔图标把横条切换为内联编辑表单，预填当前目标内容：Enter 或勾选按钮通过 `GoalBarActions.onEdit(objective)` 保存，Esc 取消，目标内容全为空白字符时保存按钮保持禁用。清除直接调用 `onClear`，不做确认——清除会保留 durable 墓碑，没有不可恢复的损失。一个以目标 id 为键的 effect 会在目标身份变化时丢弃编辑表单，因此存留的草稿绝不可能覆盖掉替换它的新目标。

`GoalBarActions` 位于 contract 层（`contract/slots.ts`，紧挨它所喂给的 `ConversationInjected.goalActions` 槽位），只携带实际渲染的动词：`onEdit`/`onResume`/`onClear`。`apply.ts` 把它们接到运行时会话方法上；运行时会话在内部解析当前目标的 compare-and-set ref，因此 UI 不传 ref。

运行时会话获得了横条（以及未来 UI）所需的目标表面：`fetchGoal` 在打开时填充快照；携带 `goal/change` 元数据的 live `context/message` 触发一次合并后的重新拉取——窗口重放绝不触发重新拉取，且匹配元数据 kind（而不是 goal 键）还能捕获其他客户端写入的清除墓碑。六个变更动词与所有同类会话方法一样，把传输层失败折叠为 `{ ok: false }` 结果；比在拉取途中落地的变更响应更旧的 get 结果会被丢弃。

横条的背景色用 `--dsw-alias-interactive-bg-hover`，而不是设计稿里的字面值 `#F5F6F7`：这个半透明的悬浮灰在浅色主题的白色底上正好解析为该值，而在深色模式下能把横条从输入框卡片上衬托出来，静态的浅色 token 在深色模式下会沉进去。所有颜色都是 `--dsw-*` token。

## 测试

`packages/client/ui-conversation/tests/goalbar.spec.tsx` 仅通过 props 固定这些行为：加载中／无目标／已完成时不渲染；active 横条渲染标签和目标内容并触发清除；编辑表单预填内容、拒绝空值、按 Enter 保存、按 Esc 取消，并在目标身份变化时重置；paused 横条触发恢复；blocked 横条暴露原因悬浮提示。skeleton 规格测试分别挂载带与不带 `goalActions` 的 `ConversationRoot`；未定义的情形预置了一个 active 目标，因此隐藏横条的是缺失的挂载门，而不是缺失的目标。运行时会话规格测试固定了折叠错误结果、仅 live 的合并重新拉取，以及陈旧读取守卫。

## 考虑过的替代方案

- **把横条放在会话头部**：不予采纳，因为重新设计的前提是目标的存在感属于输入框的上下文；放在头部的横条无法停靠进输入框卡片。
- **为 `undefined` 渲染 "Loading goal…" 占位**：不予采纳，每次打开会话横条都会闪现再坍缩，对一个不到一秒的状态来说只是界面噪音。
- **未设置目标时在横条内提供内联创建入口**：实现评审后不予采纳，创建目标的职责在 `/goal` 命令上，与模型按请求创建目标的模式一致；横条是状态指示器，不是创建入口。
- **在 `GoalBarActions` 中携带完整动词集合（`onPause`/`onComplete`）**：作为投机性泛化不予采纳，没有消费方调用它们，接口只携带实际渲染的动词。

## 后果

- Web UI 中目标的存在形式是停靠在输入框上方的横条：闪光图标、阶段标签、截断的目标内容，以及编辑／清除（暂停时另有恢复）——这是浏览器客户端的第一个目标界面。
- 运行时会话通过 RPC 暴露目标动词并折叠传输层错误，且在打开时和 live 目标变更元数据到达时刷新快照中的目标（合并拉取，带陈旧读取守卫）。
- 目标内容首次可以从 UI 编辑，经由 `goal.edit`，ref 由运行时持有；暂停／完成对其他界面（`/goal`、模型工具）照常可用。
- `goal === null` 时不渲染任何内容；输入框不提供常驻的创建入口，创建是 `/goal` 命令的职责。
