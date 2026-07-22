# RFC: 共享应用 bin 的启动胶水代码，而非维护两份副本

Status: implemented

[English](2026-07-04-share-app-bin-boot-glue.md) | 中文

## 问题

stdio 和 ACP 两个 bin 各自重复了环境加载、fail-loud 处理、入口校验与启动逻辑，包括微妙的 Loader 失败行为。两份副本已经发生漂移，且位于自执行文件中、被排除在单元测试覆盖率之外，导致其导出的辅助函数无法被复用。

## 决策

辅助函数只存在一处：[`@deepseek-ai/dsh-app-boot`](../../../../packages/ui/app-boot)（`packages/ui/app-boot`，归入 `ui` 分组，因为 bin 是已发布产物，其运行时依赖本身也必须是已发布的包，而非 `support/`）。包含：`resolveConfigPath`（快照感知，两个 bin 共用的唯一路径解析器）、`loadEnv`、`installFailLoud`、`assertEntriesLoaded` 与 `boot`，每个函数都通过 bin 的诊断前缀参数化，并在其副作用 seam（warn sink、process slice）处支持注入，使单元测试套件能覆盖每个分支——包括 `boot()` 在进程内驱动真实 Loader、使用相对路径 specifier 配置的场景，既覆盖已稳定树的正常路径，也覆盖无 fiber 入口的拒绝路径。该包启用逐文件 100% 覆盖率门禁；Loader 失败的相关知识只有一个归属地。

每个 `bin.ts` 是一个精简的自执行组合，基于共享辅助函数加上各自特有的应用生命周期（ACP bin：replay 模式下跳过 env 加载与 stdin-EOF dispose；stdio bin：无额外逻辑）。bin 文件仍被排除在覆盖率之外且不导出任何内容；已发布产物的守卫不变——built-bin 冒烟测试仍在 node_modules 形状的临时目录中以原生 node 运行每个 bin（现在也符号链接了 `ui/app-boot`），并仍断言缺少配置时的非零退出码，遵循「真实入口路径即已发布产物」的防御模式。[extract-example-app-packages RFC](../architecture/2026-06-20-extract-example-app-packages.md) 中关于 bin 归属的事实已相应修订。

## 曾考虑的替代方案

### 为何不保留重复？

bin 被定位为独立拥有的已发布产物，而新增一个包（package）带来的固定开销（manifest（元数据清单）、README、tsconfig reference、publint 表面积）与去重的代码行数相当。但创建 bin 的那份 RFC 从未权衡过应用间共享的可能——它将三份示例 `start.ts` 副本合并进 bin 后便止步了；漂移是已观察到的事实；而覆盖率缺口的论据独立于去重论据：这是仓库中唯一免于逐文件 100% 门禁的非平凡运行时逻辑。记录在案的备选方案（仅将纯逻辑提取为各应用自己的模块）虽能终结豁免，但会保留两个知识归属地。

## 后果

- 启动胶水代码的变更（新增守卫、修复路径解析）只需落地一次，两个已发布 bin 自动继承；bin 之间不会再次漂移。
- `dsh-app-boot` 保持轻量依赖（cordis + loader/include 对）——它是启动机制，不是应用表面积。
- bin 自身的文件几乎是平凡的组合；所有含分支的逻辑都在覆盖率门禁之下。
