# RFC: 并行 pre-push 门禁

Status: implemented

[English](2026-07-06-parallel-pre-push-gates.md) | 中文

## 问题

pre-push 钩子是分支离开本地机器前的最后一道检查点，因此它的挂钟时间直接影响贡献者是否愿意保持启用并信任其信号。Lefthook 已经能并行运行顶层 job，但 `pnpm run hygiene` 和 `pnpm run doc-sync` 等聚合 job 在单个 job 内部隐藏了长串的顺序执行链。钩子因此可能在配置上看似并行，实际仍在等待那些成员彼此独立却串行执行的子命令。

将这些成员直接展平到 `lefthook.yml` 只能解决本地钩子的问题。CI 面临同样的调度问题，而在 YAML 中复制一长串叶子列表会让未来的脚本改动有两处可能漂移。

`publint` 在更低一层也有同样的形态。每个包（package）独立地根据自身 manifest（元数据清单）和构建产物做 lint，但 runner 按顺序遍历所有包。在本仓库中，这意味着一个包发布门禁的耗时与包的数量成正比，尽管各检查之间并不共享可变状态。

## 决策

[lefthook.yml](../../../../lefthook.yml) 保留一个名为 `full check` 的 pre-push job，运行 `pnpm run check:pre-push`。该 package 脚本委托给 [scripts/run-gates.ts](../../../../scripts/run-gates.ts)，即 CI 使用的同一个有界调度器。

`pre-push` 模式展开为以下叶子门禁：单元测试套件、快照测试套件、构建、`hygiene` 成员、`doc-sync` 成员，以及 module-graph 新鲜度。叶子列表保持与 package 脚本相同的门禁词汇，包括 RFC 分类和 RFC 格式，同时 runner 并发调度独立检查，并为每个门禁打印一个计时/输出块。

构建门禁使钩子在干净的 worktree 上也能自足运行。`publint` 和 `verify-node-next-types` 等待构建产物就绪，而仅依赖源码的门禁继续并行执行。

[scripts/publint-all.ts](../../../../scripts/publint-all.ts) 从 `packages/<group>/<pkg>` 发现包列表，并使用大小取自 `availableParallelism()` 的 worker 池运行 `publint`。`DSH_PUBLINT_CONCURRENCY` 可为资源配置不同的本地机器和 CI runner 设定或提高 worker 数量上限。结果按包缓冲，并以确定性的包顺序打印，因此并行执行不会打乱各包的日志块。

聚合 package 脚本仍然是临时本地运行的真源。调度器是对其成员门禁的并行执行计划，而非替代词汇。

## 曾考虑的替代方案

- **在钩子中保留聚合的 `hygiene` 和 `doc-sync` job**：配置更简单，但 pre-push 的大部分挂钟时间仍然消耗在 lefthook 看不到也无法调度的串行命令链内部。
- **为每个叶子门禁声明一个 lefthook job**：通过 lefthook 原生 job 模型暴露并行性，但会让钩子文件承载一长串成员列表，CI 无法复用。
- **要求开发者在推送前手动构建**：可以省去一个钩子门禁，但会导致 `publint` 在干净 worktree 上失败，并把最后的本地检查点从可运行的检查降级为一种约定。
- **在 shell 脚本中使用后台子命令**：能并行化工作，但会丢失 lefthook 的 job 名称、逐 job 计时和失败分组，且信号处理更难推理。
- **为每个包声明一个 publint lefthook job**：暴露最大并行度，但会让钩子变成一份手动维护的包清单，恰好在新增包时漂移。
- **以无界并发运行 publint**：仅在小型机器上以赌注方式最小化耗时，代价是进程数、内存压力、包 tarball 创建和日志可读性的风险。

## 后果

钩子的关键路径变为最慢的单个真实门禁，而非隐藏门禁链的总和。Lefthook 报告一个 `full check` job，runner 在该 job 内部报告逐门禁计时，因此本地检查点偏慢时仍能指向主导耗时的那个门禁。

钩子文件保持简短，重复的成员列表集中在 [scripts/run-gates.ts](../../../../scripts/run-gates.ts) 中，CI 和 pre-push 可以共享。代价是引入一个自定义调度器脚本（而非纯 lefthook 配置），外加本地 pre-push 路径中的一次构建。

`publint-all.ts` 变为异步代码，缓冲命令输出而非实时继承 stdio。收益是包级别的并行性、稳定的输出顺序，以及一个用于资源调优的环境变量。
