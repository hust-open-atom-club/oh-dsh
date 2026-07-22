# RFC: 将 ACP 快照套件提取为支持包

Status: implemented

[English](2026-07-08-shared-acp-snapshot-package.md) | 中文

## 问题

ACP 快照层（[快照 RFC](2026-06-19-acp-snapshot-tests.md)）由位于某个示例测试目录中的三个模块构成：`snapshot-harness.ts`（启动真实 bin 子进程，通过 ACP JSON-RPC 驱动它，收集持久化日志）、`snapshot-normalize.ts`（纯粹的 golden 规范化器），以及 `acp.snapshot.ts` 中约 150 行的场景主体加 fixture（测试前置数据）守卫（record/replay 模式、stdout-golden 与日志比对、pinned-header 一致性守卫、orphan/required-file/single-pin 元测试）。

第二个 ACP 示例只能复制 record、规范化和收集逻辑，而这些逻辑必须保持一致。`examples/` 下的代码也不在包（package）覆盖率门禁范围内，且原始 harness 只能取消权限请求。共享包使这些机制纳入度量，并允许场景脚本化地提供审批答案。

## 决策

这些机制位于 [`packages/support/acp-snapshot`](../../../../packages/support/acp-snapshot/README.md)（`@deepseek-ai/dsh-acp-snapshot`）；示例的 `*.snapshot.ts` 只包含场景表、agent 路径和一次工厂调用，依赖自己的 `snapshots/` fixture 与 `cordis.snapshot.yml` overlay（[单源 replay 配置](2026-07-04-single-source-acp-replay-config.md)）。读取 `DSH_SNAPSHOT` 留在边缘层——库接收的是已解析的 `mode`。

**`src/harness.ts`** 提供 `runScenario` 及其脚本/结果类型，以 agent 的 bin 和配置路径为参数。权限答案构成一个 FIFO 队列，以稳定的 option kind（而非随机的 option id）为键。缺少答案时取消该请求；不可用的 kind 取消 agent 请求并使场景失败。

**`src/normalize.ts`** 是纯规范化器，按策略不含钩子：当未来某个事件携带新的易变字段（例如审批耗时），共享规范化器在同一个变更中学会它，保持「规范化」的含义只有一个归属，而非各套件各自扩展清洗逻辑。

**`src/suite.ts`** 提供 `Scenario` 类型与 `defineAcpSnapshotSuite(options)`，注册逐场景比对、record/refresh 的 fixture 回写、header pin 及其实时一致性守卫，以及 fixture 守卫块（无 orphan 场景目录、必需文件齐全、每个 class 恰好一个 pin、每个 JSONL 是 `scrubSystemPrompts` 的不动点、非 pinning fixture 也是 `scrubRequestHeaders` 的不动点）。pinned-header 契约（[pinned-header RFC](2026-07-06-pin-request-header-content-in-one-scenario.md)）按套件划分：每个 header class 恰好标记一个 `pinsHeader` 场景，其 `system-prompt.golden.md` 与 JSONL 工具列表将组合后的 header 拆分为可评审的产物；一致性守卫将二者与该 class 中每个实时 header 进行比对。纯辅助函数（`childFixturePaths`、`fixtureContext`、`normalizedHeaders`、`normalizedSystemPrompts`、`formatSystemPromptSnapshot`、`headerDeltaCount`）从模块导出，以便直接进行单元覆盖。

## 曾考虑的替代方案

- **将模块复制到每个示例中**：正是本 RFC 要防止的 fork。record/守卫逻辑恰恰是必须在各套件间保持逐字节一致的代码，而示例不在覆盖率门禁范围内，因此每份副本也无法被度量。
- **在 `examples/` 下建共享模块目录**：代码仍在覆盖率门禁之外，且需要跨示例边界的相对导入，违反包名导入约定；`examples/` 的叶子节点按设计应保持轻薄。
- **`dsh-acp-demo` 的 `/testing` 子路径导出**：将测试基础设施耦合到产品包的对外服务接口与依赖集中；`packages/support/` 的存在正是为了真实但兼容性承诺较低的开发/测试包，`dsh-llm-replay` 是先例，本包与之配套。
- **导出原始测试体函数而非套件工厂**：每个示例将重新拥有 `describe`/`it` 骨架（每套件约 80 行注册样板），却无灵活性收益；工厂使消费方只需一张场景表加一次调用，而导出的纯辅助函数在工厂设计内保留了可单元测试性。
- **可注入的 ACP `Client` 工厂，而非声明式 `permissionAnswers`**：灵活性最大，但将 SDK 客户端构造泄露给每个消费方，并在正被统一的层面重新引入逐示例漂移；声明式队列使 `input.json` 成为唯一的脚本化界面，且可被 golden 规范化。
- **泛化到 ACP 之外（传输无关的快照 harness）**：不存在第二种传输方式；harness 端到端都是 ACP 形态（SDK 客户端、JSON-RPC 帧、`session/update` 等待器），推测性的抽象将是一个超前于任何消费方的 seam 拆分。

## 测试

提取保留了所有既有 ACP golden 字节。包的 `src/` 通过脚本化的 ACP 子进程达到逐文件 100% 覆盖率：harness 测试覆盖每个步骤操作、两条预期错误分支、权限选择/回退/不可能选项、环境变量转发、workspace 种子注入、收集排序/噪声/回退；suite 测试对已提交的合成 fixture 执行 replay，并对临时副本执行 record，同时覆盖纯辅助函数。两个结构上不可达的守卫保留了有理由的覆盖率排除。fake agent 将 `session/new` 的 cwd 替换到日志中，包括 Darwin 的 `/var` realpath 行为，与真实 bin 一致。

## 后果

新示例只需一张场景表加 fixture 即可获得完整快照层——sandbox 分支从 master 合入后添加自己的套件（自己的 pin 场景、自己的 overlay、通过 `test:snapshot:record` 生成 fixture、通过 `permissionAnswers` 提供审批答案）。代价：`suite.ts` 导入 vitest，因此该包只能在 vitest 运行中导入——这是其他包没有的形态，已在其 README 中声明；每个套件 pin 自己约 8 KB 的 header fixture（真正不同的组合值得拥有自己的 pin；相同的组合会被该套件的一致性守卫捕获）；e2e launcher 的重复仍然存在（`TODO(acp-test-harness)`）——当该迁移落地时，harness 即为提取目标。
