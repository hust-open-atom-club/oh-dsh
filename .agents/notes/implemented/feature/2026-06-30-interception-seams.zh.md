# Agent Note: 拦截 seam——钩子编程所面对的类型化 Decision 表面

Status: implemented

[English](2026-06-30-interception-seams.md) | 中文

## 问题

harness 需要一套钩子子系统：用户像 Claude Code（CC）和 Codex 那样在生命周期节点扩展或管控 agent（智能体）。驱动本设计的关键视角转换是：**「原生钩子」不是一个包**——原生钩子只是一个普通的 Cordis 插件，订阅规范的生命周期事件。因此真正的产品是一个*强大、类型完备的规范事件表面*；CC/Codex 桥接（`dsh-hooks-claude` / `dsh-hooks-codex` 包）只是将外部 shell-hook 协议映射到同一表面的翻译层。桥接能做的事，普通插件可以直接做——而且更强大（无序列化边界、完整 `ctx`、类型化返回值）。

该表面需要为以下场景提供各自独立的契约：逐 prompt 策略（CC 的 `UserPromptSubmit`）、会话启动观测（CC 的 `SessionStart`）、工具执行前策略、环绕调度控制、工具执行后变换、最终结果观测，以及携带面向模型的原因的继续执行。如果把这些阶段混为一谈，插件就会获得不需要的 mutation 通道，而终结性将依赖监听器的注册顺序。[事件域语义 Agent Note](../architecture/2026-06-30-event-domain-semantics.md)提供了三域规则与类型化 Decision 惯用法；本 Agent Note 将其应用于生命周期 seam。

## 决策

规范表面将可变换策略、环绕调度控制与仅观测通知分离。策略 waterfall（瀑布式事件）返回小型的、seam 专属的**类型化 Decision 联合类型**；包装层返回规范化结果；通知接收不可变快照，无法影响结果。覆盖的钩子点包括 `session-start`、`prompt-submit`、`pre-tool`、`post-tool`、通过 continuation 实现的 `stop`，同时将非钩子的执行策略留作独立可组合。

**Agent 事件**（`dsh-agent`）：
- `agent/session-start(agent, source)` ——emit，在第 1 轮次之前触发一次，携带 `SessionStartSource`（`startup` 表示全新/fork 创建，`resume` 表示重新加载的持久化会话；`clear`/`compact` 保留）。纯通知，不能阻塞启动（这是有意的空白：桥接可以记录/注入，但不管控启动）。监听器通过 `agent.inject()` 注入上下文。
- `agent/prompt-submit(agent, content, source, signal, next) → PromptDecision` ——waterfall，在轮次唯一取得所有权的排队消息追加为 `user/message` 之前触发。显式轮次 signal 位于最后的 `next` 之前；`allow` 可以重写 prompt `content` 或附加来源各自独立的 `additionalContexts[]`，而 `block` 会追加一条持久的 `prompt/blocked`，并拒绝这个零步骤轮次。

**`agent/turn-continuation`** 接收并返回一个 `ContinuationDecision`。`{action:'continue', reason?}` 可携带面向模型的内容和来源，记录为同一轮次内的下一步 steering（中途引导）——与 `/goal` step-end-steer 模式互为类型化孪生。它不是 `context/message`，因此其类型不提供持久上下文元数据。

### 工具流水线为每个阶段赋予一种权限

每次调用遵循 `tools/pre-execute` → guards → `tools/execute` → dispatch → `tools/post-execute` → `tools/result`。注册表快照调用方输入、实体化并冻结参数、分配一个不透明 token。嵌套调用仅携带父 token。身份始终不可变；只有 `signal` 可在环绕调度时改变。日志、UI 和工具体因此对「执行了什么」达成一致。

- **`tools/pre-execute`** 是可扩展的 waterfall 门禁。其 `PreToolDecision` 允许、拒绝或询问。拒绝跳过 `tools/execute` 与核心调度。询问通过可选的审批 seam 解析：只有 `allowed-once` 继续通过 guards 和调度；拒绝、取消、通道不可用、审批服务缺失或无 agent 调用均规范化为拒绝。每种结果仍会到达后策略与最终观测者。
- **`ctx.tools.guard()`** 在整个 pre-execute waterfall 之后安装同步的、作用域感知的策略。guard 可以拒绝或弃权，永远不能强制允许，因此监听器顺序无法复活一个被最终不变式禁止的操作。
- **`tools/execute`** 是用于超时、重试和指标插件的环绕调度 waterfall。包装层通过 `next()` 委托给核心调度，在此之前可以替换并恢复必需的 `exec.signal`，但不能移除它；包装层接收已规范化的抛出或未知工具结果，返回自己的有效结果则短路调度。
- **`tools/post-execute`** 是检查/变换 waterfall。其 `PostToolDecision` 接受、以反馈阻止、可选地替换内容，或附加 `additionalContexts`。返回的 decision 是受支持的变换通道；waterfall 结束后，注册表会在最终观测前一次性实体化完整结果。
- **`tools/result`** 是在所有变换、无损 JSON 实体化和外层错误边界之后的同步封闭通知。它接收相同的冻结执行身份和权威结果的不可变快照；观测者的失败按监听器隔离，无法改变或拒绝 `ToolRegistry.execute()` 返回的结果。

核心调度与工具体位于规范化边界内部，因此工具、监听器、格式错误的结果、非 JSON 结果和身份形状错误均解析为 JSON 安全的 `isError` 结果，而非逃逸出轮次。post-execute 监听器因此可以检查一个抛出异常的工具，最终观测者看到的正是调用方收到的、会话日志可以持久化的内容。

**`TurnEndReason.rejected`**（`dsh-session`）：取得所有权的 prompt 被 `prompt-submit` 阻止的零步骤轮次。

### 三个承重的循环决策

1. **在 prompt 策略之前开启轮次。** 被阻止的 prompt 成为零步骤的 `rejected` 轮次，保持封闭性并为 ACP（Agent Client Protocol）提供持久的终结事件。否决记录 `prompt/blocked`（含原始 prompt 和原因），而每个允许的 `additionalContexts` 条目都注入到已开启的轮次中。依照[一次 send 对应一个 turn 的简化](../simplification/2026-07-17-one-send-one-turn.md)，每个取得所有权的 ordinary-send 条目都是其轮次中的唯一消息；启动前丢弃不会创建轮次。

2. **Post-tool `additionalContexts` 与异步注入进入活跃批次 FIFO，并在该批次结算时追加。** `content`/`feedback` 塑造 `execute()` 返回的结果，但每项上下文都是独立的 `context/message`，而单个步骤或组合工具可以产生许多上下文。立即追加上下文会产生 `result(c1) → context → result(c2)` 的交错，或把嵌套上下文放在外层结果之前，破坏工具调用/结果邻接性。因此 `ToolRunContext.deferContext()` 会在失败路径上也收集嵌套调度上下文，`execute()` 在 `ToolExecutionResult` 上暴露有序数组，循环再把它接纳到与执行期间 `agent.inject()` 调用相同的 FIFO 中。FIFO 在批次结算时，于每个已记录结果之后追加，其中也包括被中断轮次关闭之前。被接受的外层调用将 deferred contexts 保留在 decision contexts 之前；被外层阻止时则丢弃 deferred contexts，只暴露阻止 decision 显式提供的上下文。

3. **强制 `continue` 的 `reason` 通过 steering 通道入队**，使得下一步骤在循环顶部排空时将其记录为当前轮次的 steering——同一轮次内的下一*步骤* steering，而非下一*轮次*的 prompt（与现有的 `hasSteering` 强制继续覆盖一致）。

### Pre-tool 输入重写是一个独立的一致性决策

`PreToolDecision` 不能重写参数。历史和审计调用在执行前记录，ACP 展示读取相同的输入，因此注册表在策略之前封存参数。有效的重写必须在身份创建之前同时更新历史、审计、展示和执行；该契约属于[输入重写提案](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md)。

### 边界

seam 包**不**声明 `hook/*` 会话事件（持久的钩子调用日志）；那些属于 `dsh-hook-protocol`，因为原生插件使用类型化 decision 而无需外部钩子日志。原生插件集成测试（`packages/core/agent-loop/tests/interception.spec.ts`）通过真实循环组合这些 seam，不涉及 `hook/*` 协议。压缩（compaction）（`PreCompact`/`PostCompact`）、Notification 和 Codex `PermissionRequest` 不在本决策范围内。[审批 seam](2026-07-06-approval-seam.md) 通过 `ctx.approval` 解析 `ask` decision，而终结性的单调停止由 `agent/turn-stop` 独立负责。

## 曾考虑的替代方案

- **将 pre-tool 输入重写作为本 seam 集的一部分发布**：推迟，视为越界信号；上文已阐述一致性问题（审计、历史和展示都读取执行前记录的 `tool/call.arguments`），[pre-tool 输入重写提案](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md)负责该设计。
- **将持久的 `hook/*` SessionEvents 与 seam 一起声明**：否决。原生插件使用类型化 Decision 而完全不需要钩子日志（实际示例已证明），因此持久日志属于[钩子协议库](2026-06-30-hook-protocol-lib.md)，而非 seam 表面。

## 后果

规范拦截表面具有统一的类型化，同时不给每个扩展相同的权力：钩子返回 decision，执行包装层做包装，终结 guard 只能拒绝，最终观测者只能观测。循环负责 session-start、prompt-submit、post-tool 上下文缓冲和 continuation；`dsh-tools` 负责身份封存与五阶段执行流水线。它们的契约记录在 [architecture.md](../../../../docs/architecture.md)、各 package README、[核心拦截 decision](../../../../docs/core-data-structures/core.md#interception-decisions) 与[工具结构](../../../../docs/core-data-structures/tools.md)中。ACP 桥接将 `rejected` 轮次映射为其 `cancelled` 编解码值，而钩子驱动的快照端到端验证可观测的桥接行为。
