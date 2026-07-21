# Agent Note：调用后压缩压力与上下文溢出恢复

Status: implemented

[English](2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md) | 中文

## 问题

`agent/pre-step` 运行在最终请求路由之前，也早于 assistant 输出、工具结果、缓冲上下文与 steering 的产生。即使它接收已装配提示词与会话前缀，压力视图仍是临时的，因为 `agent/request` 还可以改变路由或调用配置，工具 schema 也没有与这些输入一同冻结。增加字段无法让调用前状态描述已完成调用，还会把通用 seam 与压缩耦合。

成功调用也不是唯一的压力信号。提供方可能在返回 usage 之前就因上下文窗口超限拒绝请求，一些成功调用也不提供 usage。因此，系统需要可回放的调用后压力，以及一条狭窄的失败恢复路径；当压缩无法证明取得有效进展时，必须保留原始提供方错误。

## 决策

### 成功压力移动到持久 post-step 检查点

`agent/pre-step` 收窄为 `(agent, turn, step, signal)`。它仍是 `step/start` 之前的通用串行检查点，但不再携带压缩专用的提示词或前缀字段。

循环在 assistant 输出、所有已分发或合成的工具结果、工具后上下文与 steering 都持久化之后、`step/end` 之前，触发等待式串行 `agent/post-step(agent, turn, step, signal)`。该位置让压力策略看到完整的成功调用状态，同时不会拆开 assistant 工具调用与其结果。向外传播的监听器失败属于普通 turn 失败，绝不会进入模型请求恢复；compact-basic 会按下文所述在内部处理其预期的操作性失败。

`dsh-compact-basic` 从持久请求头读取精确的最新实际路由模型，只用它确认已经存在完整路由，随后让单例 `ctx.tokenMeter` 计量规范日志信封与当前表层。自动压力不会回退到 `AgentOptions.model`。没有请求头的会话尚无已完成路由请求可供判断，因此不执行工作；任意持久记录的非空模型名都使用同一个估算器。操作性的计量或摘要失败会发出警告，并从最新持久表层继续：任何替换发生前使用完整历史；若剪枝已经落盘，则使用已剪枝表层。

### 请求恢复只覆盖最终模型边界

`RequestError`、`RequestErrorDecision` 与 `agent/request-error` waterfall 表示最终适配器已经选定之后的失败。每个返回的流句柄都绑定一个私有失败集合；该集合在分发、异步迭代器构造与迭代过程中保留原始抛出错误的身份，同时防止把嵌套调用的错误来源误归到外层调用。终止性的带内 `error` 或 `aborted` finish 进入同一路径。提示词装配、请求中间件、请求日志、结果处理、工具、post-step 监听器与清理仍属于普通失败。

恢复运行前，失败 step 已经关闭。重试会打开下一个编号 step，并从持久日志重建请求；连续恢复尝试计数只在提供方请求成功后重置。两个 DeepSeek 适配器都把识别出的提供方上下文限制错误规范化为 `CONTEXT_WINDOW_EXCEEDED`。

如果取消发生在 assistant 工具调用已经持久化之后、所有调用完成分发之前，循环会为每个尚未分发的调用记录一对合成的 `tool/call` 与 aborted `tool/result`，随后进入正常中止路径。因此，表层不会仅因取消赢得竞态而留下孤立的持久工具调用。

### CompactService 暴露意图，而不拥有 token 核算

`CompactService.compactIfNeeded(agent, trigger, signal)` 接收 `trigger: 'pressure' | 'context-overflow'`。接口不增加估算方法或 token 类型；`ctx.tokenMeter` 继续作为可复用的核算所有者。

对于 `pressure`，compact-basic 把服务级阈值与保留尾部策略应用到一次统一的 `ctx.tokenMeter.measure()` 结果。低于压力时直接返回，不执行剪枝。压力达到条件后，可选的 `ctx.toolResultPrune` 会改写当前表层中过大的工具结果，compact-basic 再通过同一个 meter 重新计量；若压力恢复安全则跳过模型调用，否则从已剪枝表层选择范围并生成摘要。范围定价、来源、被遮蔽 token 数与非缩小摘要拒绝也由同一个单例 meter 完成。通用默认值保持为阈值比例 `0.8`、保留历史 `floor(contextWindow × 0.16)`、摘要提供方/模型 `''`、`maxTokens: 8192`、`compactionRetries: 1` 与 `auto: true`。

对于规范化溢出，compact-basic 绕过标量压力与普通保留 token 预算。它先执行剪枝，再在保留最新不可分割单元的同时选择最大的工具配对平衡头部范围；存在范围时，才在同一 signal 下尝试一次缩小摘要压缩。自动监听器先记录 `session.surface.replaceGeneration`，剪枝或摘要让 generation 增加时就返回 `{ action: 'retry' }`。即使剪枝先落盘而后续摘要工作抛错，这条规则仍然成立；取消依然优先。后端若只返回结果但没有替换表层，不能授权重试；只有剪枝取得进展时，即使没有 `CompactionResult` 也可以授权重试。

`maxOverflowRetries` 可选且默认为 `1`；`0` 只禁用溢出恢复，不会禁用压力检查。`auto: false` 不注册任何自动监听器。非规范化错误、尝试耗尽、已经中止的 signal、缺失路由模型、没有安全范围、generation 未变化，以及在任何替换之前恢复抛错，都会委托给下一个监听器。若没有后续恢复，循环报告原始提供方错误对象与代码。generation 增加后的恢复抛错会基于持久进展授权重试；即使恢复工作并发完成，取消或销毁仍具有最终优先级。

默认摘要器依次解析显式配置、最近记录的路由与 agent options。因为直接 `llm/stream` 中间件可以重新路由该辅助调用，`compact/summary.{provider, model}` 记录分发后最终可变的 `GenerateOptions` 目标，而不是 waterfall 之前的候选值。

## 测试

单元测试覆盖最终适配器失败的来源与身份、已关闭 step 的重试编号与重置、取消与销毁、post-step 顺序、已路由信封压力、压力门控剪枝、剪枝独立解除压力、从已剪枝输入生成摘要、平衡溢出缩减、后续失败前已落盘的剪枝进展、generation 证明、上限、委托与辅助调用路由。真实循环测试覆盖抛出式和带内溢出，并验证剪枝或摘要压缩后的重试请求从替换表层重建。

## 考虑过的替代方案

- **保留临时 pre-step 压力并增加更多参数**——不予采纳，因为后续路由与请求变换仍在更早快照之外，同时通用生命周期会耦合到单个插件。
- **重试相同编号的 step**——不予采纳，因为恢复会在失败边界之后追加持久事件。新 step 保持边界配对与可重建性。
- **只要 `compactIfNeeded` 返回结果就重试**——不予采纳，因为自定义后端可能报告成功却没有改变模型可见状态。`replaceGeneration` 才是权威证明。
- **让 compact-basic 解析提供方措辞**——不予采纳，因为分类属于适配器，而且必须同时覆盖抛出式与带内交付。
- **没有持久路由时回退到 `AgentOptions.model`**——不予采纳，因为自动策略必须描述已完成且已记录的请求。没有请求头的压力检查与恢复会原样委托。

## 后果

Post-step 压力描述已完成的路由请求，包括持久工具结果与仅请求前缀字段。可选的无模型剪枝会在选择摘要前移除可预测的工具输出体积，也能独立产生足以重试的进展。当成功 usage 锚点不存在时，规范化溢出提供兜底路径。恢复有明确上限、以取消为准，并保持单调：只有模型可见的表层 generation 变化后才重试。

代价是成功 step 增加一个串行检查点，并需要适配器持续维护溢出分类。提供方措辞与启发式字符密度仍是维护风险。表层压缩依然无法修复仅信封本身就超出窗口的情况，也不能拆分不可分割的非工具节点，或修复非可剪枝剩余部分仍然过大的工具单元。若可移除的文本工具结果是主要体积，可选剪枝器仍可修复原本不可分割的工具配对。

本 Agent Note 只取代[压缩能力接缝 Agent Note](../feature/2026-06-18-compaction-capability-seam.md) 中的 pre-step 自动触发部分。服务拆分、独立 token meter、平衡范围契约、日志记录锁、摘要替换与唯一 `summarize()` 子类 hook 均保持不变。
