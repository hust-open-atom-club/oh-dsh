# RFC: ask-user 提问能力

Status: implemented

[English](2026-06-25-ask-user-question.md) | 中文

## 问题

agent（智能体）有时仅凭模型推理（inference）无法安全地继续执行：它需要人类选择路径、确认有风险的或默认的操作，或者提供缺失的信息。在此变更之前，获取答案的唯一方式是模型在 assistant 文本中提问然后停止，这打断了正常的工具调用循环：agent 没有结构化的暂停方式，没有供 UI 使用的选项元数据，没有中止/错误分类体系，也没有让非 stdio 前端一致地呈现问题的途径。

这是一个面向用户的能力，但它也跨越了包（package）边界。面向模型的工具需要一套提供方无关的请求词汇；每个 UI 界面需要决定如何展示和收集答案；agent loop（智能体循环）应保持不变，因为工具调用本身已具备正确的异步形状。

## 决策

引入 `dsh-user-interaction` 作为 `ctx.userInteraction` 的提供方无关接口包，与面向模型的消费方 `dsh-tool-ask-user` 一同放在 `packages/ui` 下。这一分组是有意为之的：向人类提问是一种由 UI 支撑的产品功能，不属于无提供方的核心主干。seam 仍然拥有稳定的请求/应答/错误词汇，而 UI 产品界面提供收集答案的具体 provider。该工具注册 `ask_user_question`，转发 `{ questions, agent, signal }`，并将 provider 计算出的结构化答案作为工具结果返回。

面向模型的请求词汇有意与产品调研 schema 对齐：`ask_user_question({ questions: [{ id, question, header?, options?: [{ label, description? }], multi_select? }] })`。`id` 按问题提供并在结果中回传，使批量请求无需依赖问题文本即可路由。`label` 既是面向用户的显示文本，也是返回给模型的选中值；没有单独的 `value`，没有 `recommended`，没有 `allow_custom`，也没有 `desc` 别名。

Provider 返回 `{ answers: [{ id, selected, custom? }] }`。`selected` 始终是选中选项 label 的数组，因此单选和 `multi_select` 的答案共享同一种结果形状。`custom` 承载自由文本的「其他」答案；无选项的问题直接收集 `custom`。当 `custom` 存在时，它覆盖任何已选择的选项，`selected` 为空。

`UserInteractionError` 继承 `HarnessError`，因此 `NO_PROVIDER`、`ASK_ABORTED`、ACP（Agent Client Protocol）取消或会话路由缺失等失败会以机器可路由的 `{ name, code }` 工具错误形式通过 `ctx.tools.execute()` 传出。这与结构化错误分类体系一致，使模型或包装插件能够区分「用户取消」与一般的抛出异常。

## UI 映射

`dsh-stdio-demo` 的包内 readline 模块渲染每个问题，在下一行显示每个选项的 `description`，支持以逗号/空格分隔的数字选择 `multi_select`，接受自由格式的自定义答案，并在中止、provider dispose（资源释放）或 stdin EOF 时拒绝待处理的问题。批量请求按顺序询问，作为一个答案对象整体解析。stdio provider 通过内部队列序列化并发请求，确保同一时刻只有一个提示占用 stdin。

`dsh-acp` 为 ACP 会话提供同一 seam。它通过 bridge 的 `agent→sessionId` 反向映射将调用方 `Agent` 的 ask 请求路由出去，并为每个问题调用 ACP `unstable_createElicitation`（附带会话范围的表单）。单选选项变为 `choice` 字符串枚举；`multi_select` 选项变为 `choice` 数组枚举；无选项的问题使用必填的 `custom` 文本字段。如果客户端同时返回 `choice` 和非空 `custom`，以 custom 答案为准。ACP `decline`/`cancel`、缺失答案、缺失会话以及客户端不支持 elicitation，都会转为结构化的 `UserInteractionError`。

ACP 映射有意使用 elicitation 而非 `session/request_permission`。`request_permission` 仍保留给独立的权限门禁：它是围绕工具执行的 yes/no 或策略式授权协议。`ask_user_question` 是一个通用的信息收集工具，支持可选的自由格式答案，因此 ACP 表单 elicitation 是更贴合的协议。bridge 的会话路由与未来的权限门禁共享，但用户意图不同。

## 曾考虑的替代方案

**Assistant 文本后跟一个停止的轮次。** 模型可以在纯 assistant 文本中向用户提问然后停止。这会丢失结构化选项元数据，UI 没有提供方无关的方式来渲染选择，且下一条人类回答只能作为新的 user prompt 到达，而非作为需要答案的那次操作的结果。

**核心拥有的 ask-user 包。** 最初实现将 seam 和面向模型的工具分别放在 `packages/core` 和 `packages/ui`，但两者描述的是同一个由 UI 支撑的人机交互功能。seam 仍然是提供方无关的，但它不是像会话、工具或 agent 注册表那样的无提供方核心基础设施。将 `dsh-user-interaction` 和 `dsh-tool-ask-user` 一起放在 `packages/ui` 下，使包的划分与产品边界一致：应用和 bridge 提供人类答案的 provider，stdio 应用选择性加载面向模型的工具。

**ACP `session/request_permission`。** 权限请求是围绕工具执行的授权；`ask_user_question` 是带可选自由格式答案的信息收集。将权限用于通用提问会混淆两个不同的产品概念，并使未来的权限门禁更难推理。

**循环级别的暂停原语。** agent loop 已经知道如何等待工具调用并从工具结果恢复。添加新的循环特殊分支会重复这一异步形状，并迫使每个循环实现都了解一个 UI 关注点。

## 后果

ACP elicitation 目前在 SDK 中标记为 unstable。回退仍然是结构化的：如果客户端未实现它，工具返回 `ASK_FAILED` 而非挂起。后续 ACP 稳定化可能重命名或重塑该方法；该迁移应限制在 `dsh-acp` 内部，因为核心 `ctx.userInteraction` 词汇是提供方无关的。

该功能赋予模型一个强大的暂停原语，因此 prompt 引导很重要。工具描述告诉模型：提问要简洁，尽可能使用选项。产品策略后续可以包装 `tools/execute` 来限制工具何时可用，但循环不应对其做特殊处理。

`dsh-user-interaction` 和 `dsh-tool-ask-user` 都位于 `packages/ui`，因为它们共同构成一个面向产品的人机交互能力。`agent-core` 不加载工具或 provider。`stdio-agent` 选择性加载 seam、其 readline provider 和面向模型的工具。`acp-agent` 默认只保留 `userInteraction` seam/provider：ACP elicitation 支持仍取决于客户端，因此 ACP 叶节点必须在其客户端能完成 elicitation 请求后才有意加载面向模型的工具。

## 测试

单元覆盖率固定了以下场景：provider 注册/释放、重复 provider 拒绝、provider 就绪前中止、空问题拒绝、通过 `ctx.tools.execute()` 传出的结构化工具错误、批量答案、多选答案、自定义答案，以及模型 schema（包括移除 `value`、`recommended`、`allow_custom` 和 `desc`）。`dsh-stdio-demo` 测试覆盖选项描述、排队请求、EOF/中止清理、无选项自由格式输入、无效选项重新提示、重复多选编号和批量问题流。ACP bridge 测试驱动一个真实的内存 ACP 连接（使用真实的 `ask_user_question` 工具），验证选中选项、custom 覆盖 choice、多选和无选项自由格式 elicitation 路径能继续 agent loop。
