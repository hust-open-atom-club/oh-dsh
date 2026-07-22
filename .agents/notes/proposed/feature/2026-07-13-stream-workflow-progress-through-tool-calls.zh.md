# RFC: 通过工具调用流式传输工作流进度

Status: proposed

[English](2026-07-13-stream-workflow-progress-through-tool-calls.md) | 中文

## 问题

工作流引擎有意为 run、phase、narration 和子 agent（智能体）进度发出成对的 `workflow/*` observation 事件，但目前没有生产消费方呈现这些事件。因此，编辑器在最终结果返回之前只显示一张 pending 状态的工作流工具卡片，尽管引擎已经报告了当前活跃的 phase、脚本日志内容以及哪些子 agent 已启动或已结束。[dynamic-workflows 决策](../../implemented/feature/2026-07-05-dynamic-workflows.md)明确将 ACP（Agent Client Protocol）进度 UI 保留给这一事件流。

如果让 `dsh-acp` 直接监听工作流事件，就会反转能力边界：通用的 UI 桥接层将依赖一个可选的工作流包（package），并对一个工具名做特殊处理。工具流水线已经拥有实时更新所需的路由信息（agent 和 call id），但只暴露了纯粹的 pending/final 展示器，因此长时间运行的工具没有提供方无关的方式在二者之间报告瞬态 UI 状态。

## 提案

为 `dsh-tools` 添加一条实时进度通道。注册表所有的 `ToolExecution` 新增 `reportProgress(view): boolean`，其中 `view` 是一个独立的、提供方无关的通用进度快照，包含可选的替换标题和面向 UI 的内容块。进度不能更改调用的 args 派生卡片标签、kind、原始输入、locations、terminal intent 或 diff intent；它只更新在最初选定的展示方式内的实时标题/内容。当执行处于活跃状态时，该方法校验并快照 view，然后分发一个受限的、agent 作用域的 `tools/progress` observation，携带权威的执行标识与快照。一旦 final-result 处理开始，方法返回 `false` 且不再分发，因此迟到的异步报告者无法覆盖终态卡片。观察者异常会被记录日志，不会导致工具失败。

`dsh-acp` 以通用方式消费 `tools/progress`。它通过既有的 agent-to-session 映射解析执行所属的 agent，并为同一 call id 发出 in-progress 的 `tool_call_update`。由于报告仅在工具执行流水线内可用，持久化的 `tool/call` 及其 ACP `tool_call` 始终先于第一条 update；在 `tools/result` 之前关闭报告者，确保进度更新不会出现在 completed/failed 卡片之后。进度是实时 UI 状态，而非模型输入或持久历史：会话回放继续从 `tool/call` 和 `tool/result` 重建 pending 与 final 卡片，无需重放瞬态更新。

`dsh-tool-workflow` 成为第一个生产者。每次工具执行在调用 `ctx.workflows.start()` 之前安装一个紧凑的事件捕获器，因为合法的引擎可能在 `start()` 内部同步发出进度。在调用返回之前，捕获器将观察到的事件按 `WorkflowRunInfo.id` 归约为候选状态；随后选取返回的 `WorkflowRun.id`，丢弃其他候选，报告累积的快照，并将后续匹配事件直接路由。如果 `start()` 抛出异常，捕获器被 dispose（资源释放），其候选状态被丢弃。这在不向 `WorkflowStartRequest` 添加观察者关联、也不要求进度等到 `start()` 返回的前提下，保持了引擎的可替换性。

归约器消费既有的 start、phase、log、agent-start、agent-end 和 end 事件，报告一个替换快照，包含当前 phase、最新日志行、活跃子 agent 标签以及 completed/failed/cancelled 计数。它不累积 narration transcript（文本记录）；已结束的子 agent 离开活跃集合，变为计数器。`workflow/end`、工具结算或插件 dispose 移除归约器条目和事件捕获器。六种工作流事件及其元数据、成对的子 agent 生命周期、run handle、取消通道和观察者隔离保持不变；第三方观察者可继续直接消费这些事件。

更新工具执行/展示文档、生成的事件与 API 目录、工作流包文档以及工作流数据结构目录。ACP 集成覆盖率必须使用脚本化的模型边界测试真实的工作流工具和 worker seam；主 ACP 快照套件新增一个 workflow-progress 场景，因为这改变了面向编辑器的 transcript。

## 曾考虑的替代方案

**删除工作流 observation 表面。** 在 [collapse-workflow 简化提案](../../rejected/simplification/2026-07-12-collapse-workflow-to-foreground-core.md)中被否决：这些事件及其成对生命周期是有意设计的，缺少的是消费方。

**让 ACP 直接了解工作流。** 这可以将 `WorkflowRunInfo` 映射到会话和卡片，但会使通用桥接层依赖一个可选能力，并绕过「工具拥有展示意图」的规则。工具进度通道为每个长时间运行的工具解决了相同的路由问题。

**将每条进度更新持久化为会话事件。** 这会使实时 narration 可回放，但会用一种状态永久膨胀日志，而该状态的权威持久结果已经是工具调用/结果对。如果可恢复的工作流进度成为产品需求，需要一个工作流日志化设计，而非伪装成持久事实的 UI 快照。

## 验收标准

- `ToolExecution.reportProgress()` 由注册表所有、agent 作用域、快照化、观察者隔离，且在终态处理开始后返回 `false` 而不分发。
- ACP 将进度路由到正确的实时会话中的正确调用；不同会话中的并发工作流不能串扰，且 `tool_call_update` 不会出现在其 `tool_call` 之前或终态更新之后。
- 工作流进度显示当前 phase、最新日志行、活跃子 agent 和结果计数，同时保留所有既有 `workflow/*` 事件和 run 语义；一个在 `start()` 内部同步发出 start、phase、log、child 和 end 事件的 seam 测试引擎不会丢失任何归约器状态。
- 取消、worker 死亡、工具失败、会话关闭和插件 dispose 释放归约器状态；回放仅发出持久的 pending/final 卡片对。
- 单元测试、工作流集成测试、ACP 集成测试、快照、类型检查、覆盖率、doc-sync、module-graph、构建和 hygiene 门禁全部通过。

## 风险

本提案向工具 seam 添加了一个公开的实时进度方法和事件，因此实现方必须精确维护 active/terminal 边界，并在观察者看到快照之前将其分离。pre-start 捕获器可能短暂观察到无关的工作流 run，因此它仅按 run id 持有紧凑的候选状态，并在 `start()` 返回后立即丢弃所有不匹配的候选。一个工作流可能发出大量进度变更；有界归约器避免了 transcript 增长，但在关联完成后仍会为每个有意义的事件发送一条 UI 更新。如果经测量的客户端需要合并更新，这必须是一个带默认值的、经过校验的桥接配置，而非硬编码的节流。瞬态进度在回放时有意消失，因此最终工具结果仍是唯一持久的工作流卡片内容。
