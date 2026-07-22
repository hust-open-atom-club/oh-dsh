# RFC: 记录 fork 与混合 spawn+fork 快照场景

Status: implemented

[English](2026-06-22-fork-snapshot-scenarios.md) | 中文

## 问题

[seed-boundary RFC](2026-06-22-fork-child-replay-seed-boundary.md) 使 fork 子会话的回放路由正确运作：`dsh-llm-replay` 从子会话持久化的 `seedLength` 边界处或之后的事件推导出子会话的脚本，因此 fork 子会话继承的父会话前缀不会被当作子会话自身的模型调用来回放。但该 RFC 交付时**没有记录 fork 场景**——该切片仅由 `llm-replay` 的单元测试（一个合成的子会话 fixture（测试前置数据））和一个持久化往返测试覆盖。全 transcript（文本记录）快照层（即启动真实 `acp-agent` 并回放端到端嵌套 transcript 的那张网）只有 spawn 子会话（`subagent-spawn`、`subagent-multi`）。如果一个 fork 路由回归让单元测试保持绿色，它仍然会逃过专为捕获 transcript 回归而建的那一层。

表达 fork 场景所需的快照基础设施已经就位：两个进程内后端都在 `cordis.yml` / `cordis.snapshot.yml` 中以两个面向模型的工具接入（`subagent` → spawn、`subagent_fork` → fork），harness 会收集每个子会话的日志，回放按 `seedLength` 为键转发各子会话的 fixture。缺少的是一个*已记录的场景*来驱动 fork 子会话走完这条路径。

## 决策

针对真实 API 记录两个场景，均在默认门禁中以无密钥方式回放：

- **`subagent-fork`**：父会话完成一个轮次以建立一个事实，然后通过 `subagent_fork` 委派一个子任务。fork 子会话继承对话（其日志携带非零 `seedLength`），因此可以从父会话的上下文中作答。这是聚焦的回归守卫：子会话 fixture 的 `seedLength` 就是回放切片所依赖的边界，来自真实 fork 的记录而非手工合成。
- **`subagent-mixed`**：父会话完成一个轮次，然后在同一个 transcript 中分别通过 `subagent`（全新的 spawn 子会话，`seedLength` 为 0）和 `subagent_fork`（fork 子会话，`seedLength` 非零）各委派一次。这是 seed-boundary 和 per-session-replay 两份 RFC 都列为后续补充的混合 spawn+fork 场景：一个 transcript 同时覆盖两种传输方式和切片的两个分支（`seedLength` 0 = 无操作，`seedLength > 0` = 裁剪继承的前缀），两个子会话按 `createdAt` 排序为先 spawn 后 fork。

### 为什么需要一个已完成的第一轮次

fork 后端用父会话的**已完成轮次的平衡前缀**（[`completedTurnPrefix`](../../../../packages/subagent/subagent-fork)）来初始化子会话。如果父会话在第一轮次就 fork，则没有已完成的轮次可继承，seed 为空（等价于全新 spawn，`seedLength` 为 0），这不会覆盖切片逻辑。因此两个场景都使用双 prompt 输入：第一个 prompt 完成一个轮次（建立一个 codeword，子会话稍后被要求回忆它），第二个 prompt 委派 fork。子会话 transcript 中回忆出的 codeword 只是模型行为的附带产物；真正承载验证的产物是子会话 fixture 中记录的 `seedLength`，回放切片消费的正是它。

## 后果

- fork 路由切片现在由全 transcript 层守卫，而不仅仅是单元测试。移除 `slice(seedLength)`（回放整个子会话日志）会让**两个**新场景变红——fork 子会话收到的是父会话记录的 chunk 而非自己的——证明守卫确实生效（场景落地时已验证红→绿）。
- `subagent-mixed` 是第一个在同一个 transcript 中驱动两种*不同* subagent 后端的快照场景，同时覆盖了跨 spawn 和 fork 子会话的 per-session 回放键控。
- 进程外（ACP）subagent 回放形态不同（每个子会话是独立进程、有自己的回放），仍以 `TODO(acp-subagent-replay)` 跟踪——本文场景仅限进程内。
- 重新录制（`pnpm run test:snapshot:record`）会从真实 API 重新生成全部四个 fork/spawn fixture；两个新场景在无密钥时自动跳过，与所有已录制场景一致。

<!-- rfc-format: alternatives-not-recorded (pre-format RFC) -->
