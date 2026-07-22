# RFC: Hook 快照矩阵——覆盖两种 bridge 的端到端 golden 测试

Status: implemented

[English](2026-07-04-hook-snapshot-matrix.md) | 中文

## 问题

hook bridge——[`dsh-hooks-claude`](../../../../packages/hooks/hooks-claude)（7 个 Claude Code hook 点）和 [`dsh-hooks-codex`](../../../../packages/hooks/hooks-codex)（5 个 Codex 点）——将外部 hook 命令映射到 harness 的拦截 seam 上。它们拥有深度的单元测试和 coverage-spec 覆盖率（每个决策分支、每种 payload 方言，均对 mock 的 seam 驱动），外加一个需要密钥的 e2e 测试（`hooks.e2e.ts`，一次真实的 `PreToolUse` 拦截）。但完整 transcript（文本记录）快照层：那张真正启动 `acp-agent` 子进程、无密钥回放录制会话、并将规范化的 ACP stdout 与重新持久化的日志与已提交 golden 做 diff 的网，只覆盖了一个 hook：Claude 的 `UserPromptSubmit` 拦截（`hook-cc-promptsubmit-block`）。

这正是 mock 单元测试在结构上无法替代的层级：它验证的是真实 bridge 将真实 hook 进程的结果翻译到真实 seam 决策，再到真实 agent loop（智能体循环）的反应，渲染结果与编辑器看到的完全一致。一个 bridge 翻译或 loop 结构的回归，即使让所有单元测试保持绿色，也会在除那一个 hook 点之外的所有点上逃逸；而对于 Codex bridge，ACP 示例甚至没有加载它，因此没有任何 Codex hook 能端到端触发。

## 决策

实现由两个耦合部分组成：

### 1. ACP 示例同时加载两种 hook bridge

`examples/acp-agent/cordis.yml` 和 `cordis.snapshot.yml` 现在同时加载 `dsh-hooks-codex` 与 `dsh-hooks-claude`，各自指向自己的配置文件（Claude 用 `./hooks.json`，Codex 用 `./codex-hooks.json`——两种方言无法共用一个文件）。这是一个真正的产品接口变更，而非仅用于测试的接线：交付的 ACP 服务器（以及 `demo:acp` 入口）现在同时携带两种 bridge。

这是安全的，因为配置文件不存在时 bridge 是**静默无操作**的：`apply()` 捕获读取失败、通过 `ctx.logger` 记录日志、不注册任何东西——零监听器、零会话事件。`acp-agent` 应用不附带 stdout logger，因此警告不会到达 ACP JSON-RPC 通道。只需要 Claude hook 的场景（或真实项目）只提供 `hooks.json`；Codex bridge 找不到 `codex-hooks.json` 便自动消失。这已通过实验验证：在两种 bridge 同时加载的情况下，所有既有快照（均不附带 `codex-hooks.json`）逐字节一致。

同时加载是让快照层能够在产品交付的同一个真实应用上验证每种方言的最低要求。录制（启动 `cordis.yml`）天然加载两者，回放以同样方式继承：`cordis.snapshot.yml` 是 `cordis.yml` 的 include-overlay，只替换 llm 入口（见[单一来源 acp-agent 回放配置](2026-07-04-single-source-acp-replay-config.md)），因此添加到运行时树的 bridge 无需第二次编辑即出现在回放树中。

### 2. 每个 hook 点 × 其主要结果各一个快照场景，覆盖两种方言

`examples/acp-agent/tests/snapshots/` 下共 13 个场景，命名为 `hook-<dialect>-<point>-<outcome>`：

- **手工编写、无模型轮次**（无密钥、无 sidecar——派生的回放脚本为空；比对的是携带 `hook/*` 事件的 `rejected` 轮次）：`hook-cc-promptsubmit-block`、`hook-codex-promptsubmit-block`。
- **对真实 API 录制、录制期间 hook 活跃**（模型对决策的反应是捕获的 transcript 的一部分，此后无密钥回放）：`hook-{cc,codex}-promptsubmit-context`（allow + additionalContext 折叠）、`hook-cc-pretool-deny` / `hook-codex-pretool-block`（deny → `isError` 工具结果）、`hook-cc-pretool-ask`（ask → 降级为 deny 并附带 approval-required 原因）、`hook-{cc,codex}-posttool-block`（block 并附带反馈）、`hook-{cc,codex}-posttool-context`（accept + additionalContext）、`hook-{cc,codex}-stop-continue`（阻塞性 Stop hook 通过 steering（中途引导）强制多走一步）。

每个 hook 命令只输出固定字面量字符串（无时间戳/pid/`$RANDOM`/cwd 回显）；快照规范化器擦除 `hook/result` 携带的唯一不稳定字段（`durationMs`）。`Stop` 场景通过标记文件（`.stop_fired`）自限，使 force-continue 不会循环——`stop_hook_active` 循环守卫仍是 bridge 的一个 `TODO`，因此无条件的 Stop hook 会在每一步都 force-continue。

### 三个 hook 点被有意排除在快照之外

在构建矩阵过程中发现，记录于此是因为这些遗漏是决策而非疏忽：

- **`SessionStart` 与 `SubagentStart`** 通过一个分离的、尽力而为的 `void runPoint(...).then(agent.inject())` 注入上下文，没有轮次绑定。由此产生的 `context/message` 与它所先于的工作（首次模型请求/子 agent 的首轮）存在竞争，落在日志中的位置不确定。录制的 golden 甚至无法在自身回放中复现——10 次回放稳定性检查对两者均 10/10 失败。它们留在 bridge 的单元覆盖率中，单元测试直接驱动 seam 而无时序竞争。（如果注入将来变为轮次绑定且确定性的——`TODO(session-start-gating)` 所指的方向——它们就可以纳入快照。）
- **`SubagentStop`** 是纯观察性的：其 `subagent/end` 处理器不传递轮次（因此无 `hook/*` 日志事件）、不做注入。它对 transcript 不写入任何内容，因此 golden 与无 hook 运行逐字节一致，永远无法被证明失败——一道永远不会触发的守卫。它留在单元覆盖率中（`bridge.spec.ts` 已断言了纯观察调用）。

因此，该矩阵覆盖了所有具有确定性、可观测 transcript 足迹的 hook 点，涵盖两种方言。

## 后果

- 每个具有可观测 transcript 的 bridge seam 映射现在都在完整 transcript 层级、在真实应用中、对两种方言受到守护——包括此前完全没有端到端覆盖率的 Codex bridge。录制的 golden 捕获了模型对 deny/block/force-continue 轮次的真实反应，这是手工编写的 transcript 只能猜测的。
- block 场景无需密钥（无模型轮次）；其余场景从录制的 fixture（测试前置数据）无密钥回放。`pnpm run test:snapshot:record` 从真实 API 重新生成录制的 fixture，无密钥时自动跳过，与所有录制场景一致。
- prove-red 纪律成立：篡改 hook 配置的输出（例如修改 deny 原因）会使其场景在回放时变红——hook 进程在回放期间真实运行（只有模型被回放），因此 golden 守护的是实际的 hook→seam→loop 路径，而非它的 mock。
- `acp-agent` 演示现在加载了一个通常会无操作的 Codex bridge（典型项目中没有 `codex-hooks.json`），这正是预期的柔性失败行为，而非代价。

<!-- rfc-format: alternatives-not-recorded (pre-format RFC) -->
