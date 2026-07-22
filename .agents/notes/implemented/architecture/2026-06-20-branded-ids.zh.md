# RFC: 在所有应有之处使用 branded ID

Status: implemented

[English](2026-06-20-branded-ids.md) | 中文

## 问题

harness 已经为三个标识符做了 brand 处理：`CallId`（`packages/llm/llm/src/brand.ts`）、`SessionId`（`packages/core/session/src/types.ts`）和 `AgentId`（`packages/core/agent/src/types.ts`），使用 `Branded<B> = string & { readonly [BRAND]: B }` 机制（由纯类型包（package） `@deepseek-ai/dsh-brand` 拥有，位于 `packages/util/brand/`，见其 [README](../../../../packages/util/brand/README.md)），并为每个类型提供零开销的 cast 工厂。`dsh-brand` 还声明了治理策略：*"Branding 用于跨包边界且可能被混淆的 id；不是每个 string 都需要 brand。"* 这条策略是正确的；问题在于它只落实了一半。两处缺口使得结构相同但语义错误的 string 今天仍能通过类型检查器。

**缺口 1：bash seam 中未 brand 的 ID。** `BashTask.id` 以及所有执行器/工具边界使用裸 `string`，尽管生成的值与默认 session id 具有相同的 `name-N` 形状。模型还通过 `task_id` 返回该值，因此混淆 task id 和 session id 既类型正确又可达。

bash **owner token** 是相关的子情形：`BashExecRequest.owner?: string` 和 `BashExecSpec.owner: string | undefined`（`packages/bash/bash/src/types.ts`）被文档描述为刻意*不透明*的隔离键，但在所有实际调用方中，该值就是所属 agent（智能体）的 `session.header.id`（`callerToken = (exec) => exec.agent?.session.header.id`，位于 `packages/bash/tool-bash/src/index.ts`），即一个穿着 `string` 外衣的 `SessionId`。它被用于访问控制比较（`owner !== callerToken(exec)`），因此一个不匹配但类型正确的 string 在此处就是一个跨会话隔离 bug，而当前类型系统无法捕获。这正是 [unify-the-agent-id-and-the-session-id](../../proposed/simplification/2026-06-20-unify-agent-and-session-id.md) 提案所称的以 `session.header.id` 作为 owner 的别名缺口（"bash owner-token alias hole"）。

**缺口 2：既有 brand 的侵蚀。** `CallId`、`SessionId` 和 `AgentId` 在注册表 map、公开查找参数、ACP 会话跟踪和持久化协调器中退化为裸 string。在查找边界丢弃 brand 会使其主要保护失效。

## 决策

纯类型变更。Brand 是零开销 cast；运行时行为、序列化、比较和协议格式（wire format）均不变。工作分三部分，全部遵循既有的"不是每个 string 都需要"策略。

- **为 bash task id 加 brand。** 在 `packages/bash/bash/src/types.ts`（*拥有*该 id 的包）中添加 `BashTaskId = Branded<'BashTaskId'>` 及其同名工厂，从 `@deepseek-ai/dsh-brand` 导入 `Branded`，方式与 `SessionId`/`AgentId` 完全一致。brand 原语位于无依赖的 `dsh-brand` 工具包中，正是为了让 `dsh-bash` 仅依赖它就能为自己的 id 加 brand，而无需引入 `dsh-llm`（或 `dsh-session`）来获取 `Branded`。将其贯穿 `BashTask.id`、`BashExecutor` seam 方法（`get`/`ownerOf`/`readOutput`/`kill`）、`dsh-bash-local` 中的生成点（在创建时对计数器输出做一次 brand），以及 `dsh-tool-bash` 的校验/访问面（`validateTaskId` 返回 `BashTaskId`；`task_id` 在模型 string 到达的工具边界处被 brand）。

- **铸造独立的 `OwnerToken` brand。** 在 `packages/bash/bash/src/types.ts` 中添加 `OwnerToken = Branded<'OwnerToken'>`；将 `BashExecRequest.owner` / `BashExecSpec.owner` / `BashExecutor.ownerOf` 的类型标注为 `OwnerToken | undefined`。`dsh-tool-bash` 消费方在边界处将 agent 的 `session.header.id`（一个 `SessionId`）cast 为 `OwnerToken`——这是两套词汇唯一交汇的地方。bash seam 从不导入 `dsh-session`。（理由见下一节。）

- **阻止 brand 侵蚀。** 将既有 brand 传播到缺口 2 列出的 `Map` 键类型和公开方法参数中：`Map<SessionId, Session>`、`get(id: SessionId)`、`Map<AgentId, Agent>`、`Map<CallId, …>`、ACP 的 `SessionRecord.sessionId: SessionId` 接口、协调器的 `Map<SessionId, …>`。这是 diff 中机械量最大的部分，也是让*既有* brand 在查找处真正发挥作用（而不仅仅标注在结构体字段上）的关键。

示意形状（工厂模式与已有的三个 brand 完全一致）：

```ts ignore-check
import type { Branded } from '@deepseek-ai/dsh-brand'

/** A background bash task handle (generated `bash-N` by the local executor). */
export type BashTaskId = Branded<'BashTaskId'>
export function BashTaskId(id: string): BashTaskId {
  return id as BashTaskId
}

/** A bash task's opaque isolation key — the consumer's owner identity, NOT the bash seam's. */
export type OwnerToken = Branded<'OwnerToken'>
export function OwnerToken(id: string): OwnerToken {
  return id as OwnerToken
}
```

## 曾考虑的替代方案

### 为什么不把 `owner` 类型标注为 `SessionId`？

执行器将 ownership 视为不透明的，不应依赖 session 模型。独立的 `OwnerToken` 保留了这一边界，同时防止裸 string 或 task id 被当作 owner 传入。`dsh-tool-bash` 拥有访问策略，由它执行来自 `SessionId` 的唯一转换。

## 不在范围内 / 可能的扩展

遵循"不是每个 string 都需要 brand"的策略，刻意保持窄范围。以下每项都是合理的未来 brand 候选，附带推迟理由而非承诺：

- **`ModelId`**（`GenerateOptions.model`，`LlmService` 适配器注册表的键）：一个真正的跨包查找键（config → agent → llm → adapter）；合理的下一个 brand，仅为控制本 RFC 的影响范围而暂不纳入。
- **`ToolName`**（`ToolRegistry` 的键）：由作者定义、人类可读，且很少与其他 id 混淆；最弱的候选，可能不值得加 brand。
- **`ErrorCode`**（`HarnessError.code`）：一个封闭词汇（`ABORTED`、`NO_ADAPTER`……），不是逐实例的 id；如果要做，string 字面量联合类型比 brand 更合适。
- **数值序号**：轮次号、步骤号和事件 `seq` 是 `number` 而非 `string`，`Branded<string>` 不适用；可以用并行的 `number & { readonly [BRAND]: B }` 变体来 brand 它们，但它们是位置序号、很少跨边界传递，收益较低。
- **带校验的构造**：brand 工厂是纯 cast，无运行时检查，且每个边界（ACP `sessionId`、提供方签发的 `call.id`、`dsh-llm-deepseek` 中的空字符串回退）今天都信任裸 string。一个在边界处对格式错误的输入抛异常的 `SessionId.parse()` / `isValid()` 配套工具确实是缺口，但它是*运行时行为*变更，有自己的设计问题（什么算"格式错误"？失败时怎么办？），应在独立 RFC 中处理，不应捆绑进这次纯类型变更。

## 验证

`BashTaskId` 和 `OwnerToken` 定义在 `dsh-bash` 中，贯穿执行器、本地实现和面向模型的工具，且未添加 `dsh-session` 依赖。集合、公开参数和导出签名对 `CallId`、`SessionId`、`AgentId` 或 `BashTaskId` 使用相应的 brand 而非裸 `string`；来自提供方、ACP 和模型的原始输入通过 brand 工厂进入，而非散落的 cast。

## 后果

- **两个接口面的机械性改动。** 传播 brand 涉及 bash seam（接口 + 实现 + 消费方）以及 ACP session-id 接口和持久化协调器。改动面广但严重度低：遗漏的位置是编译错误而非静默 bug。变更可观察地为纯类型变更——无快照或 e2e 行为差异。它与 [unify-the-agent-id-and-the-session-id](../../proposed/simplification/2026-06-20-unify-agent-and-session-id.md) 提案相邻（两者都触及 session-id / owner-token 边界）；如果该提案落地，`OwnerToken` 出于上述解耦理由仍与统一后的 id 保持独立。
- **Brand 不做校验。** Brand 是混淆防护，不是正确性证明：一个*错误的* session id 只要仍是合法的 string，就和以前一样能通过类型检查器。本 RFC 不关闭这个缺口（见"不在范围内"）——它只阻止这类*类别*错误：传入错误*种类*的 id。
- **"在哪里停下"仍是判断题。** 为 `BashTaskId` 加 brand 但不为 `ToolName` 加，为 `OwnerToken` 加但不为 `ModelId` 加，是对哪些 string"可能被混淆"的品味判断。合理的评审者可能想要更多或更少；`brand.ts` 中的策略是裁决依据，本 RFC 倾向于面向模型或用于访问控制的 id。
