# RFC: 裁剪未实现的 subagent seam 词汇

Status: rejected — the deferred capability vocabulary (`outputSchema`/`structured`, `toolFilter`, `sendMessage`/`resume`) is intentionally reserved surface: the seam advertises the full intended contract ahead of its implementations by design, so providers and consumers grow into a stable shape rather than re-negotiating it per capability. The consumer-evidence analysis below stands as the record of what is currently unimplemented.

[English](2026-07-04-prune-unimplemented-subagent-vocabulary.md) | 中文

## 问题

[subagent seam](../../implemented/feature/2026-06-21-subagent-capability-seam.md) 交付了一套两层能力设计：启动时由服务检查的能力 flag，以及 `SubagentRun` 上的可选运行时方法。三个启动时特性和两个可选运行时方法的实现数与调用数均为零：

- **`outputSchema`/`structured` 与 `toolFilter`**（`SubagentCapabilities`、`SubagentStartRequest`、`SubagentResult`，位于 `packages/subagent/subagent/src/types.ts`）：每个真实提供方都声明 `outputSchema: false, toolFilter: false`（`packages/subagent/subagent-spawn/src/index.ts`、`packages/subagent/subagent-fork/src/index.ts`、`packages/subagent/subagent-acp/src/index.ts`）；唯一的生产环境 `ctx.subagents.start` 调用方（`packages/subagent/tool-subagent/src/index.ts`）构造 `{ prompt, parent, signal?, agentOptions? }`，结构上无法设置这两个字段；`structured` 仅由测试 mock（`packages/support/subagent-mock`）为其自身 spec 产出。服务的能力检查包含两行 assert，其唯一执行者是拒绝测试。
- **`SubagentRun.sendMessage` / `SubagentRun.resume`**（同一文件）：没有任何提供方实现——包括 mock 也没有；spawn spec 断言的正是它们的*缺失*。

`dsh-subagent` 依赖 `dsh-tools` 的唯一原因是 `outputSchema` 的 `SchemaSpec` 类型。三个后续 subagent 工作流（per-session 快照回放、fork seed 边界、ACP（Agent Client Protocol） 后端）都围绕这块接口面落地，却没有增长出哪怕一个消费方。

## 提案

从 seam 中移除 `outputSchema`/`structured`、`toolFilter`、`sendMessage` 与 `resume`；将 `SubagentCapabilities` 缩减为 `{ depthLimit }`；删除两行能力 assert、三个提供方上的 all-false flag、mock 的 structured 分支及其 `capabilities`/`structured` 配置项，以及为固定被移除接口面而存在的测试（两行拒绝测试、spawn 缺失测试、mock structured spec）。从 `packages/subagent/subagent/package.json` 中删除 `dsh-tools` 的 peer/dev 依赖。更新 [subagent.md](../../../core-data-structures/subagent.md) 中的粘贴内容与 type-equiv manifest（元数据清单），以及 `packages/subagent/subagent`、`packages/subagent/subagent-spawn`、`packages/subagent/subagent-fork` 和 `packages/support/subagent-mock` 的 README 相关行。实现 PR（Pull Request）按照 [implemented/AGENTS.md](../../implemented/AGENTS.md) 修订 seam RFC 的能力目录。

**保留** `depthLimit`/`maxDepth` 与能力检查。进程内后端已强制执行该限制，尽管当前发布的 tool 尚未设置它。递归是已知的 seam 风险，因此恰当的后续工作是提供一个 tool 默认值，而非删除正在工作的强制逻辑。

审视过但有意不动的相邻接口面：`SubagentService.getProvider()`/`list()` 仅有测试 harness 消费方，但 [prune-dead-seam-methods 实现说明](../../implemented/simplification/2026-06-20-prune-dead-seam-methods.md) 恰好记录了这种形态从 bash executor 中被移除后又被回退的经过——对于一个基于已跟踪 map 的单行访问器而言，测试 harness 就是消费方。`SubagentRunEndInfo.lastAssistantMessage` 是一个已记录的保留项（[subagent-observe-enrich RFC](../../implemented/feature/2026-06-30-subagent-observe-enrich.md) 的评审删除了 `agentType` 但有意保留了它，因为它是进程外子 agent（智能体）唯一的最终消息通道）；它当前未接通的桥接转发是一个待补的缺口或待记录的消费方，不是本 RFC 要裁剪的接口面。

这是[从持久化 seam 裁剪死方法](../../implemented/simplification/2026-06-20-prune-dead-seam-methods.md)在 seam 词汇层面的回响：每个实现都必须为无人声明的成员，甚至更弱，因为这里连一个实现都没有。

## 曾考虑的替代方案

### 为什么不保留？

两类能力的设计是 seam RFC 的核心亮点，日后重新添加 `outputSchema` 会涉及多个文件。但该设计以 `depthLimit` 作为活跃示例、以 RFC 作为记录仍然成立；而且 seam RFC 本身承认已交付的 `toolFilter` 形态是错误的（真正的强制需要在子 agent 上下文中实施 `tools/pre-execute` deny，而非 schema 过滤）——该 deny 原语已存在于拦截 seam 上，因此基于真实实现提供方重新添加时，将固定出一份比当前推测性契约更好的契约。

## 验收标准

- 被移除的拼写仅出现在本 RFC 和修订后的 seam RFC 中；`SubagentCapabilities` 为 `{ depthLimit: boolean }`；`dsh-tools` 依赖边已消除（`hygiene` 绿色）。
- 深度强制测试不变且绿色。

## 风险

subagent 生命周期事件在结束载荷上携带 `lastAssistantMessage`——该增强位于服务模块中，不在本 RFC 缩减的 seam 词汇范围内；observe-enrich RFC 记录了因缺少消费方而删除 `agentType` 兄弟字段的判断，本 RFC 延续了这一判断。CC hooks 桥接是这些生命周期事件的第一个外部消费方，它只读取事件载荷，不涉及本文移除的任何接口面；observe-enrich RFC 推迟的控制流重设计将实现 `resume` 列为自身的未来工作——恰好是本 RFC 模式所预期的重新添加触发点。
