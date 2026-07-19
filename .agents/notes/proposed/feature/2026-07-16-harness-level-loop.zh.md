# Agent Note: harness 层 goal-based loop

Status: proposed

[English](2026-07-16-harness-level-loop.md) | 中文

## 问题

`packages/core/agent-loop` 只跑 inner loop：一次 turn 内推理加工具循环，模型返回 `end_turn` 就结束。其 README 明确写「No built-in turn budget」——预算是它自己承认的 gap。跨轮次调度落在 harness 层：跑到测试全绿、按 rubric 反复改稿、把 PRD 拆成 bead 逐个推进、无人值守跑一整晚。这几类任务今天都没有一等公民的实现。

现有代码里有三种「能凑合跑」的替代，都不够用：

| 替代 | 问题 |
|---|---|
| `packages/workflow` 脚本表达 `while (!done)` | README 明写「No token-budget vocabulary」和「No journaling or resume」；父 turn 阻塞到脚本 settle。能跑几分钟的编排，跑不了几小时的长期任务 |
| 外部 shell `while :; do dsh-sdk …; done` | Ralph 风格的调度今天就能这么写。缺共享的 stop condition、budget、evaluator 词汇，每个使用者各自重发明；循环本身没有持久化对象可供事后诊断或恢复 |
| `packages/subagent` seam 的 `sendMessage`/`resume` | README 明写「Runtime steering and continuation are seam-only capabilities」。没有 model-facing consumer，模型只能起 fresh 子会话 |

典型使用场景有三类。**自动化修复**：面前一个失败的测试套件，希望一个进程持续修改代码、跑测试、根据失败信息再修改，直到全绿或触达预算上限。**按 rubric 迭代改稿**：一份文档、代码或翻译需要满足打分标准，循环反复调整、独立评估者打分、直到达标或耗尽轮数。**无人值守长跑**：例如通宵把一个仓库从一种技术栈移植到另一种，下班前启动第二天回来看结果，全程只有预算兜底。三类共同的形态：几分钟到几小时、evaluator 决定成败、预算是硬约束、跑完还需要能回看和恢复。

## 提案

**Loop 有四种触发形态**，按谁在什么时候启动一轮划分：

| 形态 | 谁触发 | 何时触发 | 现有对标 | 本 RFC |
|---|---|---|---|---|
| **turn-based** | 用户在会话里发一条消息 | 每一轮用户回复 | `packages/core/agent-loop` 现有一次 turn 内的推理与工具循环 | 不覆盖，已有实现 |
| **goal-based** | 用户或 agent 明确指定「跑到某条件为止」 | 一次启动，evaluator 判停 | Claude Code 的 `/goal`、Codex 的 `/goal`、Ralph 家族 | **本 RFC 覆盖** |
| **time-based** | scheduler | 按 cron 或时间间隔 | Claude Code 的 `/loop`（周期性）、`/schedule` | 延后到 `dsh-schedule` RFC |
| **proactive** | agent 自己 | agent 在推理中意识到需要开一个 loop 时 | Anthropic ClaudeDevs 4 类分类里的 proactive 档 | **本 RFC 自然包含**（agent 调 `loop` tool 就是 proactive） |

本 RFC 只**新增 capability seam `packages/loop/`** 处理 goal-based 一种。proactive 复用同一 `loop` tool，agent 主动调用即触发，无需额外机制。time-based 需要独立的 scheduler package，属于另一份 RFC 的事情；本 RFC 只在 cordis leaf 触发面预留跟未来 `dsh-schedule` 联动的钩子。

三个包：

- `@deepseek-ai/dsh-loop`：类型、`LoopDriver` service、`StopCondition` 判别联合、Phase 1 service 定义（`Evaluator` / `BudgetPolicy` / `RoundHandoff`）、事件 schema；`GoalReflector` 在 Phase 2 与首个调用方一起加入
- `@deepseek-ai/dsh-loop-driver`：默认 driver 实现
- `@deepseek-ai/dsh-loop-tool`：model-facing `loop` tool + CLI `dsh-sdk loop`

设计围绕四个具体问题展开，在每项能力出现调用方的 phase 中通过 service seam 或显式 driver policy 解决：

1. 长跑 loop 出问题后缺诊断和恢复手段。**loop 作为独立 session** 解决。
2. loop 结束时的 PASS 是否可信决定几小时工作是否作废。同一个 LLM 既生成又自评的架构本身就不可信。**Evaluator 与 Budget 做成 service seam** 解决。
3. 短任务和长任务需要的记忆策略相反，硬编一种模式会让另一类场景不可用。**RoundHandoff 做成 service seam** 解决。
4. 用户初始给的 goal 未必始终正确。agent 沿着错的目标蛮干会耗尽预算做错事。**Phase 1 用 goal concern event 与 policy 处理；GoalReflector service 随 Phase 2 的 `reflect` 路径一起加入**。

四条 seam 之外还有一条贯穿全文的原则：**一个 loop 只处理一个原子目标**。大目标拆成若干小 loop 串联，不塞进一个 loop 让 evaluator 判定多件事。判定 granularity 是否合适的经验规则：如果 loop 跑完说不清它到底做完了什么，granularity 就太大，应当拆。Phase 2 补 `loop_split` model-facing tool 让 agent 收到过大 goal 时能自己拆。

术语约定：**inner loop** 指 `packages/core/agent-loop` 一次 turn 的推理与工具循环；**harness loop** 指本 RFC 引入的外层调度器，围绕 inner loop 反复迭代。本 RFC 不改 `agent-loop`，符合 AGENTS.md「Plugins, not loop changes」。

`StopCondition` 是 discriminated union，`assertNever` 收口：

```ts
interface EvaluatorReport { criteria: readonly { name: string; pass: boolean; evidence: readonly string[] }[] }

type StopCondition =
  | { kind: 'goal-met'; evidence: EvaluatorReport }
  | { kind: 'budget-cap'; scope: 'usd' | 'tokens' | 'rounds'; observed: number; maximum: number }
  | { kind: 'stuck'; pattern: 'repeat-action' | 'no-progress' | 'error-loop' }
  | { kind: 'approval-required'; reason: string }
  | { kind: 'user-cancel' }

export {}
```

### Loop 作为独立 session

长跑 loop 一旦出错，用户没有系统的诊断手段。跑几小时后失败，只能翻散落的日志文件。发现中间某一轮走偏想倒回去重跑，只能从头开始。agent 想参考自己过去 loop 的经验也没有可用的 API。

Driver 为每个 loop 开一个独立的 loop-session（新的 session id）。每轮的输入、inner-loop 结果、evaluator 报告、stop 决策都作为 session event 落盘，复用 `packages/session-persistence` 的 SQLite backend。得到三种诊断与 replay 能力。

- **从已记录轮次 replay 对话**：源 session 仍 live 时，发现第 78 轮偏航，可以 fork 第 77 轮的 event prefix，换 prompt 或 evaluator；已持久化 session 的 replay 还需要独立的受信任 load-and-seed 路径。两者都只会基于当前工作区 replay 对话状态，不会恢复第 77 轮的文件与外部副作用
- **事后诊断**：通过现有 `ctx.sessionQuery` 精确读取 service 检查 evaluator 从哪一轮开始一直挂在同条 criterion 上
- **元循环学习**：拟议中的 [SQLite FTS5 search](2026-07-10-sqlite-session-query-provider.md) 后续可以在新 loop 启动前找到相关历史 loop——「我以前 fix 过类似的 bug 吗？失败在哪一轮？」

Claude Code、Codex 的 `/goal` 是一次性对象：跑完就丢，agent 下次遇到同类问题从零开始。

**存储与恢复边界**。每轮几 KB events，100 轮 loop 约 100–500 KB；跑几千个 loop 会到 GB 级。`logDetail: 'summary' | 'full'` 配置缓解，默认 `full`，长跑用户可切 `summary`。中间态全持久化会把生成过的 key、密码一并落盘，跟普通 session 是同一类风险但量放大 10–100 倍，README 明确提示。通过 `ctx.sessionQuery` 的精确 live 与已持久化读取已经存在；FTS5 是可选的发现能力增强，不是 Phase 1 依赖。本 RFC 不承诺精确恢复执行世界：`SessionStore.fork()` 只接受 live session，而 session event 不会恢复文件、进程、环境或外部副作用。这需要单独的 Git/worktree/checkpoint 设计。

### 可插拔的 Evaluator 与 Budget

loop 的价值最终取决于结束时的 PASS 是否可信。如果 evaluator 会被 hack 或幻觉 PASS，前面几小时的工作全部作废。同一个 LLM 既生成又自评的架构本身就不可信：模型有条件说服自己 PASS。即便让独立 subagent 做 evaluator，只要 evaluator 还是 LLM，就仍然对同类内容有系统性偏好——独立 subagent 只是缓解不是根治。

可信评估同时需要确定性的判断机制，以及与 threat model 匹配的隔离边界：shell exit code、静态分析或外部服务避免 LLM 自评；独立 worktree、只读 mount、容器或远程服务防止 worker 改写 evaluator 输入。具体检查和边界只有用户知道：不同项目 `pytest` 命令不同、公司有私有合规检查器、有些团队还要跑内部 lint。主库无论内置几种都覆盖不全。所以 evaluator 必须做成用户可以自己接入的 seam。

预算方面同理：产品级的花费护栏是黑盒，无法按团队策略调整（个人卡、团队分摊、按 PR 结算）。

`Evaluator` 和 `BudgetPolicy` 都作为 cordis service seam 暴露。`Goal` 必须携带一个明确档位的 `EvaluatorSpec`，driver 拒绝启动没有 evaluator 配对的 loop——含糊的目标（"把代码写好"）不能进入 loop 系统：

```ts
interface RubricItem { name: string; description: string }
interface EvaluatorContract { readonly name: string }

type CriteriaSpec =
  | { kind: 'single-metric'; name: string }
  | { kind: 'rubric'; criteria: RubricItem[] }
  | { kind: 'contract'; interface: EvaluatorContract }

type ExecutorSpec =
  | { kind: 'shell'; command: string }
  | { kind: 'llm-judge'; rubric: string; model: string }
  | { kind: 'provider'; name: string; config?: unknown }

type IsolationSpec = 'same-workspace' | 'separate-worktree' | 'container' | 'remote'

interface EvaluatorSpec {
  criteria: CriteriaSpec
  executor: ExecutorSpec
  isolation: IsolationSpec
}

export {}
```

**为什么使用显式维度，而不是让用户传自由函数？** spec 强制用户在启动时声明评估什么、由什么执行判断，以及什么隔离边界保护它。自由函数看起来灵活，实际让 evaluator 强度隐性下沉——用户以为在做确定性隔离检查，实际写的是同工作区 LLM 判断。长跑场景下代价是几小时白跑。

criteria shape、executor 与 isolation 是三个正交维度，不是可信度阶梯：rubric 可以由 shell、LLM 或外部服务检查，contract 也可以在同一工作区或容器中运行。`llm-judge` 仍是最弱的 executor，仅用于确实无硬信号的软目标（改稿、翻译质量）。文档明确标注「此 executor 不能挡定向对抗，长跑无人值守场景至少需要一个确定性 evaluator，并配合与 threat model 匹配的隔离边界」。

Driver 强制四条结构约束，不下放给 Evaluator 实现。隔离强度仍是已配置提供方的显式属性，不是 driver 能凭空制造的保证。

**防「同一个 agent 既生成又自评」**：

1. **LLM 评估使用 fresh subagent**：LLM evaluator 每轮开 fresh subagent（用 `dsh-subagent` 的 `spawn`），不继承主循环 context

**防 evaluator subagent 自身被 subverted**：

2. **限制模型可见工具集**：LLM evaluator 的 model-facing tool set 被 driver 剥离到只保留读类工具，写类工具禁用（复用 `SubagentProvider` 的 `toolFilter`）。这会减少意外修改，但不是进程隔离：除非已配置隔离边界拦截，否则 shell、代码运行时或其他 capability 仍能写入

**防 evaluator 报告本身欺骗 driver**：

3. **PASS 只能由 evaluator 报告翻转**：`goal-met` StopCondition 只能来自 evaluator，driver 或主 agent 都不能直接构造
4. **Default-FAIL**：driver 内部维护每个 criterion 的 pass 状态默认 `false`，只有 evaluator 报告里带非空 evidence 才允许翻 `true`；evaluator 无法通过返回 `{pass: true}` 而不给 evidence 让 driver 接受

四条一起保证 evaluator 结论在结构上由证据推动，而不是由自信推动。它们不能阻止主 agent 在共享工作区中修改 evaluator 输入。

**Phase 1 内置三个 backend**：

- `loop-evaluator-shell` 实现 `single-metric`：跑 shell 命令，`exit 0` = pass
- `loop-evaluator-rubric-judge` 实现 `llm-judge`：预写 rubric + LLM 打分，仅软目标
- `loop-budget-preflight`：每轮启动前估 `(promptTokens + overhead + estOutputTokens) / 1M × pricePerMTok`，超 `perRoundUsd` 拒绝启动。估算模型来自 MartinLoop `policy.ts:551-596`

`PricingProvider` 服务注入 pricing 表，test seam 可覆盖，不硬编到 driver 里（AGENTS.md「No hardcoded tunables in plugins」）。解析后的 budget 携带 `maxRounds`、可选 `maxTokens` 与 `maxUsd`，以及可选 `perRoundUsd`。driver 在启动工作前检查单轮准入，随后在每次请求后累计 worker、evaluator、compaction 和 reflector 用量。token 或 USD 上限可能被一个在途请求超出，因为 usage 在完成后才到达；`budget-cap` 结果同时报告 `observed` 与 `maximum`。`rubric` 与 `contract` criteria shape 在 Phase 2 补内置 executor，Phase 1 暴露这些 shape 让第三方插件先接。

**局限**：`same-workspace` 加只读 model-facing tool set 不是硬隔离。当前 `packages/fs` policy 实施 read-before-edit 与版本保护，不是路径拒写；bash 或代码运行时可以绕过 filesystem tool。挡定向对抗需要覆盖所有写入通道的边界，例如只读 mount、隔离 worktree、容器或远程 evaluator。两容器方案（evaluator 定义文件对主 agent 完全不可访问，Anthropic patch.py 走的就是这条路）仍在 Phase 3。见 风险。

### 可插拔的 RoundHandoff

每轮之间如何传递 context 是一个两难。完整保留之前对话（continue）连续性好，但对话会持续增长最终撞上 context 上限，且上一轮的错误信息会污染后续每一轮。每轮从零开始（fresh）避免污染，但每次需要重新理解上下文。跑 3 轮改稿与跑 80 轮 overnight 修 bug 需要的策略是相反的。Claude Code、Codex 都硬编一种模式，用户没法按任务类型切换。

做成 service seam：

```ts
interface ContinuationRun {
  readonly id: string
  resume?(prompt: string): Promise<ContinuationRun>
}

interface PreviousRound {
  result: unknown
  evaluator: { criteria: readonly { name: string; pass: boolean; evidence: readonly string[] }[] }
  tokenUsage: number
  summary: string
  sessionId: string
  run?: ContinuationRun
}

interface RoundContext { loopId: string; round: number; previous: PreviousRound }

type NextRoundSpec =
  | { mode: 'fresh'; prompt: string }
  | { mode: 'continue'; run: ContinuationRun; prompt: string }

interface RoundHandoff {
  buildNextRound(prev: RoundContext, signal: AbortSignal): Promise<NextRoundSpec>
}

export {}
```

Phase 1 交付 fresh backend；Phase 2 在 provider continuation 存在后增加两个 continuation backend：

| Backend | Phase | 场景 | 机制 |
|---|---|---|---|
| `handoff-fresh-with-summary`（默认） | Phase 1 | 长跑、无人值守 | 每轮开 fresh subagent，只注入一段 progress 摘要作 system prompt 附加段 |
| `handoff-continue-with-compaction`（推荐中间档） | Phase 2 | 5–20 轮的中等长度 | 整段对话保留到 token 阈值，超了复用 [`packages/compact`](../../../../packages/compact/README.md) 压缩，摘要 + 最近 K 轮作起点 |
| `handoff-continue-raw`（专业档） | Phase 2 | ≤5 轮短任务、测试 | 纯连续对话不裁剪 |

**为什么默认 fresh？** 所有实际跑成的长跑 loop（repomirror、Kimi ralph-loop、autoresearch）用的都是 fresh。把重要 loop 状态放在 context window 外由 driver 管理是长跑的正确姿势。`handoff-continue-raw` 违反这条经验，README 明写长跑不适用。

**为什么中间档只有我们能做？** `handoff-continue-with-compaction` 依赖 compaction seam——竞品都没有，只有本仓库 `packages/compact` 提供了这个基础设施。

**为什么做成 seam 而不是三选一 flag？** 用户可以写 20 行插件表达「前 5 轮 continue、之后 fresh」这类混合策略，或表达「context 到 50% 自动 compact 一次」，不用等主库支持。

**局限**：`continue-with-compaction` 依赖 `packages/compact` 的压缩质量，压缩本身可能把幻觉信息写进摘要传下去；README 建议长跑首选 fresh。三个 backend 的边界会让新用户不知道选哪个；`dsh-sdk loop` CLI 默认用 fresh，用户在遇到具体问题前不需要理解这些差别。

### 可插拔的 GoalReflector

用户在启动 loop 时给的目标不一定准确。可能基于错误假设（让 agent 用某个已经废弃的 API 实现功能），可能不够清晰（agent 在做的过程中才发现需要澄清），也可能被后来的信息证伪。现在的循环执行框架把 goal 当作启动时冻结的合约，agent 只能沿着原路蛮干，结果是在错的方向上耗尽预算。

Phase 2 把它做成 service seam，与 `Evaluator` 职责分离：evaluator 问「是否达成目标」，reflector 问「目标是否还是那个目标」。Phase 1 只携带 concern event，以及 `stop` 与 `notify-continue` driver policy，不注册没有调用方的 `GoalReflector` service。

```ts
interface RoundContext { loopId: string; round: number }
interface GoalConcern { concern: string; severity: 'low' | 'medium' | 'high' }

interface GoalReflector {
  reflect(ctx: RoundContext, concerns: GoalConcern[]): Promise<GoalReflection>
}

type GoalReflection =
  | { kind: 'continue' }                              // goal 仍有效
  | { kind: 'revise'; newGoal: string; why: string }  // 建议修正 goal
  | { kind: 'stop-for-human'; reason: string }        // 需要人拍板

export {}
```

**concern 有三种触发来源**。Phase 1 实现前两种；`GoalReflector` service 与周期性来源一起在 Phase 2 加入：

- **agent 主动**：通过 model-facing tool `loop_flag_concern({ concern, severity })`。agent 在调研中意识到「用户假设的那个库已经废弃」时可以直接 raise
- **driver 启发式**：预算过 50% 且零 criterion pass 时，driver 自动 raise `no-progress-toward-goal` concern
- **周期性 reflector subagent**（Phase 2）：每 N 轮独立跑一个只读 subagent 复审 goal 有效性，与 evaluator 独立性遵循同一思路

**响应策略通过 `onGoalConcern` 配置项**。这四种配置对应不同的 loop 使用哲学，用户按团队协作方式选，driver 不预设立场：

- `'stop'`（Phase 1 默认）：任何 concern 都触发 `StopCondition: approval-required`，人拍板。loop 在遇到任何不确定性时都不应自己往下走，适合谨慎风格团队与影响面较大的 loop 场景
- `'notify-continue'`（Phase 1）：记录普通 `loop/goal-concern` session event 后继续跑，人在结束时集中审阅。ACP 没有通用高优先级 marker，因此专用 concern 渲染与 ACP command 基础设施一起后置。loop 内部不打扰，适合无人值守长跑
- `'reflect'`（Phase 2）：调 `GoalReflector` 决定 continue、revise 还是 stop。委派一个独立 agent 代替人做初步判断，适合中等自主度的团队
- 不注册 `GoalReflector` 且 `onGoalConcern` 未设 = 最放手档，loop 只在传统 stop condition 触发时停

**为什么默认选 `stop`？** 无人值守场景下宁可多停一次也不要在错方向上跑几小时。用户明确要无人值守可切 `notify-continue`。

concern 本身就是普通 session event，跟前文的持久化 session 能力天然协同：后续 replay 可以从 concern 出现的轮次为新对话提供 seed，并替换 goal。这不会把工作区回滚到该轮。

**滥用与丢失防护**。agent 可能每轮都 raise concern；缓解是 `severity` 字段和 driver 侧的最小 rate limit（同一 concern 30 秒内去重）。这种滥用的代价是 agent 卡住自己无法推进，动机不强。goal 被 revise 后原始 goal 会丢失；每次 revise 落 `loop/goal-revised` session event 带 rationale，后续 replay 可选任意历史 goal 版本，但不承诺恢复工作区。

### 用户面

四个触发面共享同一个 driver：

- **agent 侧 tool**：`loop({ goal, evaluator, maxRounds, maxUsd, onGoalConcern })` 通过 `ctx.tasks` 注册 `kind: 'loop'`，立即返回 task id，并在后台运行 harness loop。`task_output`、`task_list` 和 `task_kill` 负责收集与取消。正在跑的 loop 内部 agent 可用 `loop_flag_concern({ concern, severity })` 主动发起 concern。ACP 渲染意图为 `generic`。agent 自主发起就是 proactive 触发，无需额外机制
- **CLI**：`dsh-sdk loop <prompt> --stop <shell-cmd> --max-rounds N --max-usd X --handoff fresh`。人类主导启动，最典型的 Ralph 风格用法
- **cordis leaf**：`cordis.yml` 里以 leaf 形式声明常驻循环，配合未来的 `dsh-schedule` RFC 可做周期性触发
- **ACP slash command**：`/loop <goal>`（还有 `/loop-flag-concern`）在编辑器/客户端的当前会话里直接启动。语义等价于人类在 CLI 里敲 `dsh-sdk loop`，但发生在正在进行的 ACP session 上下文中，允许 loop 结果直接注入会话

ACP slash command 的依赖：`packages/ui/acp` 的 `available_commands_update` 面目前是 unbuilt 状态（[acp-feature-support.md](../../../../packages/ui/acp/acp-feature-support.md)）。等 harness 的 slash command 基础设施落地，`/loop` 与 `/loop-flag-concern` 只需在该基础设施里注册；driver 与 tool 接口不变。本 RFC 保留名字并给出参数 shape，但不承诺基础设施本身——那属于独立的 ACP 补齐 RFC。

默认 system prompt 里有两条行为指令，随所有内置 `loop` tool 一起分发：

1. 不允许写 `TODO`、`FAKE`、`PLACEHOLDER` 占位符让 evaluator 表面通过
2. 不允许写空的 `try/except` 或 `catch(_)` 让 evaluator 忽略错误

这两条无法在 seam 层强制，只是 prompt 层 guidance，不能描述成硬约束。用户可以自定义 system prompt；需要强制这些规则的 evaluator 必须显式检查。

### 与仓库现有代码的关系

直接复用无需修改：

- `packages/subagent` 的 `spawn` provider、`toolFilter`、`persona`——loop 每轮起 subagent；LLM evaluator 获得受限的 model-facing tool set，不获得进程隔离保证
- `packages/tasks`——model-facing loop 是 `loop` task producer，复用 owner isolation、`task_output`/`task_list`/`task_kill`、完成通知、取消和 awaited cleanup
- `packages/session-persistence` 的 SQLite backend——loop-session 落盘
- `packages/session-query`——精确读取 live 与已持久化 session，用于事后诊断
- `packages/compact`——`handoff-continue-with-compaction` 的实现基础
- `packages/todo`——单会话 continue 模式下作为可选 progress 表达
- 若 [ToolExecution.reportProgress](2026-07-13-stream-workflow-progress-through-tool-calls.md) 先落地，loop tool 可用它逐轮 UI 更新

不动：`packages/core/agent-loop`（inner loop 语义保持）；`packages/workflow`（DAG 编排 vs. 迭代同 goal 是 orthogonal 关系，两个 README 在「Related」段互链说明边界）。

依赖尚未落地的一处：

- ACP slash command 基础设施（`available_commands_update` 面）——见 用户面。基础设施落地前，slash command 触发面缺席，其它三个触发面照常工作

拟议中的 [SQLite FTS5 search](2026-07-10-sqlite-session-query-provider.md) 是现有 exact-read query service 之上的可选 Phase 2 发现能力增强，不是 Phase 1 event 访问的依赖。

Continuation 工作可以延后到 Phase 2：`SubagentRun.sendMessage` 与 `resume` 方法作为可选 seam capability 存在，但当前 `subagent-spawn` provider 明确不暴露这两个方法。因此，两个 `handoff-continue-*` backend 需要 provider 实现、capability check、ownership 测试和 consumer surface，不只是给 `packages/subagent-tool` 增加参数。Phase 1 只交付 `handoff-fresh-with-summary`，不改 subagent continuation。

### 分阶段

**Phase 1**（本 RFC 承诺范围）：三包 seam；`StopCondition`；criteria／executor／isolation 三个正交维度的 `EvaluatorSpec`，其中 shell 与 LLM-judge execution 有内置实现，rubric／contract criteria shape 开放待接；Default-FAIL 强制；evaluator 与累计 budget backend；`handoff-fresh-with-summary`；`ctx.tasks` 集成；`loop_flag_concern` tool；no-progress 启发式；`onGoalConcern: 'stop' | 'notify-continue'` 二档；CLI；tool；默认 system prompt guidance。**不含**：SQLite FTS5 search 面、ACP slash command 触发面（依赖 `available_commands_update` 基础设施）、subagent continuation provider/tool 工作、`GoalReflector` service、stuck 检测器、Reflector subagent、`loop_split` tool，以及每种 rubric／contract 组合的内置 executor。

**Phase 2**：SQLite FTS5 search 面；stuck 检测器（复现 OpenHands 5 种模式）；subagent continuation provider 实现、capability check 与 consumer surface（解锁两个 continue handoff）；`GoalReflector` service 与 Reflector subagent；`onGoalConcern: 'reflect'` 档；`loop_split` model-facing tool；更多 rubric／contract 组合的内置 executor。

**Phase 3**：agent fleet（同 goal 派 N 个并行 loop 取最优）；与 `dsh-schedule` 集成；两容器 evaluator 隔离（evaluator 定义文件对主 agent 完全不可访问，防 reward 反向优化）。

## 备选方案

**扩 `packages/core/agent-loop`**：给 inner loop 加「iterate on end_turn until goal」开关。拒绝——AGENTS.md「新行为走文档化扩展 seam；改 agent-loop 需要更新 docs/architecture.md」。harness loop 需要跨 session、跨 agent 的状态，塞进 inner loop 会把 session 语义拧成两层混合。

**只做一个 slash command `/loop`（Claude Code 复刻）**：实现最简。拒绝——slash-command 层不解决 harness/inner 边界；四条设计要点（可查询 session、分档 evaluator、可插拔 handoff、可插拔 goal reflector）在 slash-command 层没有承载点，本 RFC 承诺的能力全部丢失。

**全权外包给 `packages/workflow`**：把 loop 表达成带回边的 workflow 节点。拒绝——workflow 缺 iteration、StopCondition、Evaluator 的一等公民语义。硬用会把 evaluator 冒充成一个 phase，违反 evaluator 独立于 producer 的架构隔离要求；预算护栏在 workflow 是 phase-level 而非 round-level，粒度对不上。

**A（fresh）vs. B（continue）硬编二选一**：Ralph 派和 LoopTroop 派各自都有强场景。拒绝——可插拔的 RoundHandoff 提出 seam + 三档内置 backend 涵盖两派并允许 hybrid。

**不做 evaluator seam，内置几种够用**：更轻。拒绝——可插拔的 Evaluator 与 Budget 的核心价值是团队或私有 evaluator 可扩展。写死后长跑无人值守场景的用户只能改主库。

**接受不带显式 `EvaluatorSpec` 的自由函数**：允许用户传任意 `(result) => boolean`。拒绝——criteria／executor／isolation 维度强制用户在启动时声明评估什么、由什么执行判断、由什么边界保护，防止不知不觉滑到更弱的配置。自由函数看起来灵活，实际让 evaluator 强度隐性下沉，长跑场景代价大。

**引入独立记忆引擎（Beads / dex-style）**：外部化状态的成熟做法。拒绝——`packages/session-persistence` 加现有 exact-read `ctx.sessionQuery` 已经覆盖 Phase 1 诊断，SQLite FTS5 后续可以补 search；新引擎收益远小于维护成本。

**goal reflection 塞进 Evaluator seam**（让 evaluator 返回「criteria 不可能满足」）：拒绝——混淆「是否成功」和「目标是否正确」两个正交问题。`Evaluator` 应保持独立、只读、简单。

**goal-concern 永远只做 event 不做 seam**：更轻。Phase 1 确实使用 event 加 `stop`／`notify` policy；作为最终设计仍拒绝，因为 Phase 2 的 `reflect` 路径需要可替换响应策略。seam 与首个调用方一起落地，不提前出现。

**Phase 1 就上完整 Reflector subagent**：更全。拒绝——`loop_flag_concern` tool + no-progress 启发式 + 二档 policy 覆盖 80% 场景；每轮跑独立 subagent 成本高，Phase 2 按需引入更合理。

**不做 `loop_split`，用户自己拆**：Phase 1 已经如此。Phase 2 加是因为长跑场景发现 agent 收到过大 goal 会直接跑而不是自己拆，需要显式工具引导。

## 验收标准

- `packages/loop/{loop,loop-driver,loop-tool}` 三包按 capability seam 建成；`dsh-loop` 只导 types 与 registry
- `StopCondition` 判别覆盖所有分支（单元），`assertNever` 编译期收口
- Phase 1 的 `Evaluator`、`BudgetPolicy`、`RoundHandoff` 三条 service 都能被外部插件替换（fixture：注入 mock 实现，driver 正确调用）；Phase 2 `reflect` consumer 出现前不注册 `GoalReflector` service
- `EvaluatorSpec` 的 criteria／executor／isolation 维度在编译期收敛；driver 拒绝启动没有 evaluator 配对的 loop（fixture：`loop({ goal, evaluator: undefined })` 立即返回配置错误）
- Default-FAIL fixture：evaluator 报告返回 `{criterion, pass: true, evidence: []}` 时 driver 拒绝该 criterion 翻转、记 `evaluator/invalid-report` session event
- `RoundHandoff` 接收上一轮 result、evaluator report、token usage、summary、session id、可选 run handle 和 cancellation signal；Phase 1 的 `fresh-with-summary` 有单元覆盖与一个 pass-path e2e，continuation backend 测试等待 Phase 2 provider 支持
- `dsh-sdk loop` CLI e2e：给定 goal + 3 轮上限 + 一个 shell evaluator，通过与耗尽两条路径都返回结构化 stop cause 并 exit code 语义化
- Evaluator scope fixture：主 agent 有 fs.write，LLM evaluator 的 model-facing tool set 没有；结果与文档仍把 `same-workspace` 标记为未隔离，不暴露 `protectedPaths` 保证
- Budget fixture 覆盖 `perRoundUsd` 准入，以及跨 worker 与 evaluator usage 累计的 `maxRounds`、`maxTokens`、`maxUsd`；在途超限 emit 带 `observed` 与 `maximum` 的 `budget-cap`
- Goal concern fixture：`loop_flag_concern` 可从主 agent 调用并产出普通 `loop/goal-concern` session event；`onGoalConcern: 'stop'` 下 emit `approval-required` StopCondition；`'notify-continue'` 下继续跑且不携带不存在的 ACP priority metadata；no-progress 启发式在预算超 50% 且零 pass 时自动触发一次（rate-limit 去重）
- 默认 system prompt guidance（无 TODO/FAKE/PLACEHOLDER、无空 catch）随内置 `loop` tool 一起分发，snapshot 覆盖 prompt 内容但不把它当作强制机制
- 每轮的 prompt、inner-loop 结果、evaluator report、stop 决策都以 session event 出现，并可通过现有 exact-read `ctx.sessionQuery` 读取；FTS5 search 留在 Phase 2
- model-facing loop 启动后立即返回 `loop` task id；`task_output`、`task_list`、`task_kill`、父 agent dispose、取消、producer reload 和 service dispose 覆盖 owner isolation 与 awaited quiescence
- `packages/loop/README.md` 和 `packages/workflow/README.md` 的「Related」段互链清楚「何时用 workflow、何时用 loop」的边界
- 单元 100% / snapshot / e2e / doc-sync / verify-module-graph / build / hygiene 全绿；新增 tool 的 ACP 渲染意图（`generic`）有 snapshot

## 风险

**对话 replay 不是工作区恢复**。精确 session 读取已经存在，FTS5 改善历史发现能力，不决定正确性。基于当前工作区 replay 某一轮 prefix 可以诊断或改变运行方向，但复现该轮执行世界需要 Git/worktree/checkpoint 支持，以及针对外部副作用的显式 policy。

**`packages/workflow` 与 loop 的边界是持续答疑热点**。「多轮是 loop 还是 workflow」两个 README 必须写清楚：workflow 是「步骤已知、agent 未定、并串行编排」；loop 是「agent 已定、轮数未定、evaluator 判停」。文档不清晰会让用户混用错档。

**evaluator 反向优化（reward hacking）**。足够长的 loop 里 agent 有条件识别 evaluator 的模式并针对性优化，例如发现「只要测试文件里出现 `assert True` 就 PASS」从而绕过实质完成。Phase 1 的 `same-workspace` 模式不能阻止 agent 通过 bash、代码运行时或其他写入通道修改测试或 evaluator 配置；当前 `packages/fs` policy 不是路径隔离边界。需要对抗强度的用户必须选择隔离 worktree、只读 mount、容器或远程 evaluator。Phase 3 的两容器方案让 evaluator 整个运行时（二进制、rubric、依赖库）对主 agent 完全不可访问，Anthropic patch.py 走的就是这条路。

**占位符伪造与过度防御码**。agent 有时会写 `# TODO: implement` 让测试勉强通过，或写大量 `try/except: pass` 让 evaluator 表面 PASS。这些不属于 evaluator 层的问题，而是 agent 生成阶段的 prompt 与训练问题。用户面 段的两条默认 system prompt 指令只是 guidance；用户在自定义 evaluator 中加入「静态检查禁止 TODO 与空 catch」才能获得可强制覆盖。这类问题不是 seam 层能根治的。

**预算估算漂移与在途超限**。pricing 可能变化，累计 token／USD usage 只能在每次 worker、evaluator、compaction 或 reflector 请求报告 usage 后精确。preflight 保护单轮；累计上限会停止下一个请求，但可能被一个在途请求超出。README 同时报告 observed 与 maximum，并说明 provider 账单才是权威。

**后台 task 只存在于当前进程**。`ctx.tasks` 为 model-facing loop 提供 owner isolation、通用收集／取消、完成通知和 awaited cleanup。父 agent 或 service dispose 会取消并等待 loop；进程 crash 无法执行 cleanup，持久重启不在 Phase 1 范围内。

**长跑 loop 日志膨胀**。跑 100 轮 loop 单 session 上 MB 级。`logDetail: 'summary'` 兜底但 Phase 1 默认 `full`，Phase 2 再补 summary 语义。

**pre-release 允许直接演进**。`SESSION_FORMAT_VERSION=0`，`LoopRoundEvent` schema 可随时改；后端拒收旧格式而非兼容，与 AGENTS.md 顶部 pre-release stance 一致。
