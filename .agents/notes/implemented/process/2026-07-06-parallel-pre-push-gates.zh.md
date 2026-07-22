# Agent Note: 并行 pre-push 门禁

Status: implemented

[English](2026-07-06-parallel-pre-push-gates.md) | 中文

本记录中的本地 hook 部分已由[快速本地 Git hook](2026-07-22-fast-local-git-hooks.md) 取代。有界门禁调度器和包级 `publint` 并行机制仍用于 CI、`doc-sync` 和显式本地命令。

## 问题

文档同步等聚合 job 隐藏了很长的串行链，其成员只读且相互独立。在工作流 YAML 中重复这些叶子清单，会使未来脚本变更有多个位置可以发生漂移；而串行运行包发布检查，会使一道门禁的耗时与包数量成正比。

## 决策

[scripts/run-gates.ts](../../../../scripts/run-gates.ts) 拥有 CI、`doc-sync` 和选择启用的 `check:all` 命令所使用的有界调度器。它将具名模式展开为叶子门禁，遵守产物依赖，缓冲可归因的输出，并在调用方需要不同 worker 上限时接受 `DSH_GATE_CONCURRENCY`。

[scripts/publint-all.ts](../../../../scripts/publint-all.ts) 从 `packages/<group>/<pkg>` 发现包，并以根据 `availableParallelism()` 确定大小的 worker 池运行 `publint`。`DSH_PUBLINT_CONCURRENCY` 可以针对资源配置不同的本地机器和 CI runner 限制或提高 worker 数量。结果按包缓冲，并按确定性的包顺序打印，因此并行执行不会打乱各包的日志块。

各门禁的包脚本仍是临时本地运行所用的词汇。`hygiene` 继续作为聚合 `&&` 链，而 `doc-sync` 在调度器中拥有其成员列表（[通过门禁调度器运行 doc-sync](2026-07-21-doc-sync-through-gate-scheduler.md)）。

## 曾考虑的替代方案

- **保持聚合 job 串行**：执行更简单，但墙钟时间等于各独立检查之和，并重复启动命令包装器。
- **每个叶子门禁声明一个 CI job**：暴露最大工作流并行度，但会重复 checkout、设置和安装开销，并在 YAML 中复制调度器清单。
- **在 shell 脚本内后台运行子命令**：可以并行处理，但会失去各门禁计时、确定性的失败分组和直接的信号处理。
- **每个包声明一个 `publint` job**：暴露最大包级并行度，但会创建手工维护的包清单，包发生变化时就会漂移。
- **以无界并发运行 `publint`**：只有通过拿进程数、内存压力、包 tarball 创建和可读日志冒险，才能最大限度缩短小型仓库的耗时。

## 后果

由调度器支持的命令耗时取最慢依赖链，而非各独立门禁之和，并会报告主导耗时的门禁。代价是维护一个具有显式模式清单的定制调度器。

`publint-all.ts` 采用异步执行并缓冲命令输出，而不是实时继承 stdio。换来的是具有稳定输出顺序的包级并行，以及用于资源调节的单一环境变量。
