# RFC: 统一 agent id 与 session id

Status: proposed

[English](2026-06-20-unify-agent-and-session-id.md) | 中文

## 问题

agent 工厂为每个活跃的 agent/session 对维护两个 id：`agentId`（`AgentRegistry` 的路由句柄）和 `sessionId`（事件溯源与持久化日志的标识）。`CreateAgentOptions` 接收两者；`ResumeAgentOptions` 接收 `agentId` 加 `resumeSessionId`；进程内 subagent 各自铸造两个独立的 UUID，尽管血缘关系另行记录。

ACP（Agent Client Protocol）已经对这两个标识使用同一个值。它们在配置创建的 agent（智能体）、恢复的会话和进程内子 agent 中才出现分歧，但没有任何生产路径会把一个活跃 agent 重新关联到多个会话，或让一个会话经过多个 agent id。Stdio 保留 `labelBySession` 仅仅是为了从会话事件中恢复 agent 标签，而钩子同时暴露两个值让使用者自行调和。

[agent-scope 运行时](../../implemented/architecture/2026-07-12-agent-scope-runtime-design.md)没有与标识相关的保留状态：创建和恢复使用同一个 `AgentCreationTransaction`，两个注册表条目都使用相同的 final-entry 碰撞规则。分离的 id 并不会使活跃性、回滚或静默机制产生重复。统一后删除一个调用方提供的 id、每个进程内子 agent 的一个 UUID 以及剩余的转换路径，而不改变事务生命周期；同时使活跃 agent 注册表强制执行后台任务所有权所使用的会话标识。

`Session` 另外同时暴露 `Session.id` 和 `Session.header.id`，尽管构造时要求二者必须一致。持久化边界必须校验这个重复值，消费方必须在同一事实的两个归属位置之间做选择。

## 提案

对 agent 注册表条目和 `session.header.id` 使用同一个 id。`CreateAgentOptions` 为两个最终条目接收一个标识；恢复操作以被恢复的 session id 注册 agent；subagent 创建铸造一个合并后的 id；`Session` 只保留一个标识归属位置。保留当前的事务、final-entry 碰撞检查、exact-entry 摘除、回滚与静默机制；仅移除唯一职责是在两个 id 之间做转换的 map 和字段。

配置驱动的路径必须先确定其恢复还是创建的策略。当前它使用一个稳定的 agent 标签加一个带 UUID 后缀的新 session id，以避免在下次运行时与已有的持久化日志碰撞。统一后，它必须明确选择：恢复一个固定 id、铸造一个新的合并 id，还是将该策略暴露出来；实现不得默默做出选择。

`agent/created` 和 `agent/disposed` 不在本提案范围内。它们是发布生命周期事件而非标识别名；移除它们需要单独的生产方-消费方审计与决策。

## 曾考虑的替代方案

**保留分离的路由标识与日志标识。** 一个稳定的配置 agent 标签配合一个新的对话，是这种区分的真实用途。如果确实需要该显示或路由标识，请否决本提案，转而显式强制 session id 唯一性，而不是把转换隐藏在另一个 map 中。

## 验收标准

- agent 创建/恢复与 subagent 创建只携带一个标识；`Session` 将其存储在一个位置。
- 创建事务在不依赖标识相关生命周期状态的前提下，保留 final-entry 碰撞、exact-entry 摘除、回滚与静默保证。
- ACP、stdio、钩子、bash 所有权、持久化与血缘关系无需进行 agent/session id 转换。
- 配置驱动的恢复还是创建策略是显式的，并在持久化重启场景下得到覆盖。
- `agent/created` 和 `agent/disposed` 仅在单独的生产方-消费方审计之后才变更。
- 类型检查、覆盖率、快照、doc-sync、module-graph 校验、构建与 hygiene 全部通过。

## 风险

统一后将无法再拥有一个跨多个会话日志的稳定 actor 标识，包括未来可能出现的、在保留 actor 的同时切换会话的 handoff 或 fork 场景。重新引入该设计将需要一个新的显式 actor 标识。统一还使一个持久化的、可能由客户端选定的 session id 成为注册表句柄，并改变每个创建/恢复的调用点与 fixture（测试前置数据）。

配置重启策略是阻塞性的设计决策：固定的合并 id 可能与已有日志碰撞，而每次运行生成新 id 则放弃了稳定的配置标签。如果确实需要独立的 actor 标识或稳定标签/新会话的配对，请否决本提案，保留分离的 id 并加上显式的唯一性守卫。
