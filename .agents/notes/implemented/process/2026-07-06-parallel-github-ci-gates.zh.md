# RFC: 并行 GitHub CI 门禁

Status: implemented

[English](2026-07-06-parallel-github-ci-gates.md) | 中文

## 问题

keyless GitHub CI 门禁大多相互正交：类型检查、lint、文档新鲜度、覆盖率、快照回放、构建、包发布卫生检查、demo 冒烟测试与 built-bin 冒烟测试各自因不同原因失败，彼此不需要对方的运行时状态。将它们串成一条有序命令链，工作流的挂钟时间等于所有门禁之和；而把每个叶子门禁拆成独立的 GitHub job，则会重复 checkout、Node 设置、pnpm restore 和 install 工作，直到编排开销本身成为瓶颈。

难点在于产物边界。`publint`、`verify-node-next-types` 和 built-bin 冒烟测试需要构建出的 `lib/` 输出，而大多数门禁只需要源码和依赖。盲目扇出要么让这些产物消费方在 `pnpm run build` 输出声明文件和 bundle 之前就开始竞跑，要么在每个依赖产物的 job 中重复构建。

## 决策

[CI](../../../../.github/workflows/ci.yml) 将 keyless 检查分组为若干宽粒度的主运行时 lane，外加一个兼容性矩阵。工作流文件拥有当前 lane 和运行时清单的定义权。

每个 lane 委托给 [scripts/run-gates.ts](../../../../scripts/run-gates.ts)，该脚本以有界并发调度独立门禁，并为每个门禁打印一个可归因的结果块。产物消费方依赖其所在 lane 内的一次 build，而兼容性 job 将类型检查与一次真实的未构建 worker 启动结合，以覆盖运行时特定的 loader 行为。

生成的 `.sessions/` 日志和 `.doc-typecheck-*` 临时目录被 lint 忽略。聚合的本地 CI 模式仍在 lint 之后运行 demo 冒烟测试，而拆分后的 GitHub static lane 可以直接运行 demo 冒烟测试，因为 lint 已隔离在自己的 lane 中。

构建输出在 Node 24 的产物 lane 中只生成一次。产物消费方（`publint`、`verify-node-next-types` 和 built-bin 冒烟测试）声明对 `build` 的依赖，因此没有 upload/download 交接，消费方也不可能在声明文件或 bundle 就绪之前抢跑。CI 覆盖率报告仅输出文本，本地覆盖率则保留 HTML 报告。

两个工作流都缓存 pnpm store。真实 API 工作流使用共享的有界 Vitest 文件池，而非为每组测试单独开一个 job。

## 曾考虑的替代方案

- **在 Node 矩阵中保留完整串行链**：最容易推理，但会重复执行不产生 Node 版本特定信号的仓库级门禁，且让每个 PR 等待所有门禁的总和。
- **每个门禁作为独立 GitHub job 运行**：最大化 GitHub 可见的扇出，但产生过多 check，且对运行时间短于 runner 准备时间的门禁而言，重复的 setup/install 开销得不偿失。
- **将构建产物上传给依赖产物的 job**：在多 job 间保持正确性，但增加了 artifact upload/download 时间，且当产物消费方可以在主 job 内通过本地依赖排序运行时，工作流仍然过宽。
- **并发运行 `typecheck` 与 `build`**：向调度器暴露更多工作，但两个命令都调用 `tsc -b`；在它们之间共享增量构建状态是一场不必要的竞争，换来的挂钟收益很小。
- **使用无界的真实 API e2e 并行度**：否决。该套件包含大量真实模型/工具场景；worker 池需要一个显式的 `DSH_E2E_MAX_WORKERS` 上限，使 CI 和本地运行都能扇出，同时不会把配额或资源问题隐藏在不稳定的限流失败背后。

## 后果

PR 反馈以少量 GitHub check 的形式呈现，每个宽粒度 job 内部包含结构化的逐门禁日志块。这将 runner 设置开销控制在有限范围内，并保持 Actions UI 紧凑，代价是失去了每个叶子门禁独立的状态标记。

宽 lane 拆分比单一主 job 更频繁地重复 checkout、setup 和 install。这一设置开销是有意为之的：在 GitHub 托管 runner 上，将 lint、覆盖率和快照回放放在同一个进程池中运行会严重超额占用 CPU，以至于单 job 的关键路径比重复设置还要长。

这种拆分引入了一项维护义务：当 `package.json` 新增或移除一个应纳入 CI 的门禁时，[scripts/run-gates.ts](../../../../scripts/run-gates.ts) 需要添加或删除对应的叶子。这一义务是有意为之的，因为该 runner 是同一套门禁词汇的并行执行计划，而非独立的质量策略。

兼容性信号比主 Node 24 信号更窄。它证明源码图在每个声明支持的运行时上都能通过类型检查，且真实的未构建 workflow-worker 启动路径能够执行，而不必重复文档、覆盖率、发布、快照回放以及那些不因 Node 版本而异的无关冒烟测试。
