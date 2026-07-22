# RFC: 通过发现机制获取包清单，而非维护静态列表

Status: proposed

[English](2026-06-20-discover-package-inventory.md) | 中文

## 问题

包（package）与门禁清单在 TypeScript project references、包文档、CI 描述、Knip 覆盖项以及快照场景元数据中反复出现。大多数只是重述包布局、manifest 数据、聚合命令内容或 fixture（测试前置数据）文件。因此每新增一个包或场景都会产生本可避免的同步点。

[包层级结构](../../implemented/architecture/2026-06-20-package-hierarchy.md)已经手动消除了其中若干：`scripts/publint-all.ts` 现在从 `packages/<group>/<pkg>` 布局推导列表，两份 `tsconfig` 的 `paths` 映射也合并为一个 `@deepseek-ai/dsh-*` 通配符。剩下的是无法用 glob 消除的清单，主要是 `tsconfig.build.json` 的 project `references`——TypeScript 要求它是显式数组（没有通配符形式）。

当静态列表编码的是策略时，它们是合理的；当它们只是重复 `package.json`、workspace glob 或包层级结构中已有的 manifest 数据或布局事实时，就是不必要的摩擦。

## 提案

让剩余的包/门禁清单可被发现。一个唯一的权威来源——`packages/<group>/<pkg>` 层级结构加上包 manifest（元数据清单）——应当驱动 `tsconfig.build.json` 的 `references`、模块图以及任何全量包列表，并配合一个生成加校验步骤（沿用现有的 `gen-module-graph` / `gen-cordis-catalog` 模式：生成器写出产物，`hygiene`/`doc-sync`（文档同步门禁）中的 `--check` 模式在提交副本陈旧时报错）。模块图生成已经在读取包 manifest。`doc-sync` 应当成为定义并打印其子门禁的唯一命令，文档链接到该命令而非重述第二份列表。

层级结构不需要编码关于包的所有事实，但应当编码宽泛的维护策略：core/product 包、集成包、能力 seam 包与 support/test/example 包不应在脚本能区分它们之前先要求一份手工维护的例外列表。

有两类编目项根本不需要生成器：将 e2e 入口 glob 折入 knip 的默认配置段即可直接删除逐包的重复声明；`childSessions` 可从每个场景的 fixture 目录发现，使场景表只需声明策略（`recorded`、`hasModelTurn`、`comparesLog`）。而且即便是这些策略字段，今天也在追踪可从 fixture 推导的事实（`comparesLog` ⟺ 已提交的日志在头行之后还有条目；`recorded` ⟺ `hasModelTurn` 且没有 `replay.override.json` 兄弟文件），因此每个新场景类都在不断添加 fixture 目录本身已经能回答的开关。

## 验收标准

- `tsconfig.build.json` 的 project `references` 由层级结构生成（生成器输出它们；`--check` 门禁在提交副本陈旧时报错），而非手工维护。
- 新增一个包时，不需要为任何门禁编辑静态包列表。
- 文档描述真源，而非重复生成的清单。
- CI 调用聚合命令，由这些命令自行管理其子门禁列表。
- `knip.json` 仅在编码真实信息（额外入口文件、被忽略的依赖）时才携带逐包覆盖项，绝不重述默认配置段。
- 快照场景只声明策略，不声明可从其 fixture 目录发现的事实。

## 风险

发现脚本可能变得过于精巧。实现应当保持朴素：读取 manifest、按显式字段过滤、打印解析后的列表、出错时大声报错。收益在于消除手工清单的漂移，而非发明一套构建系统。

<!-- rfc-format: alternatives-not-recorded (pre-format RFC) -->
