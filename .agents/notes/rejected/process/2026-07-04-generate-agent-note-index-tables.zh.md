# Agent Note: 生成 Agent Note 索引表

Status: rejected — a centralized generated list is merge-prone and adds little discovery value

[English](2026-07-04-generate-agent-note-index-tables.md) | 中文

## 问题

按生命周期和分类划分的表格只会列出完全可推导的事实：Agent Note（agent 决策记录）的路径编码其生命周期和分类，文件名编码首次提出日期，H1 承载标题。手工维护这些事实的副本还会成为高冲突文档热点，因为并发的 Agent Note 分支会向相同的几行追加条目。[分类 Agent Note](../../implemented/process/2026-06-20-agent-note-classification.md) 将目录树本身定为权威来源。

## 提案

保留策展文本，并将列表生成为完全生成的 `.agents/notes/INDEX.md`。共享的 `scripts/agent-note-index.ts` 模块将同时负责目录树遍历器和渲染器。两个轻量消费方会共用它：

- `scripts/gen-agent-note-index.ts`（`pnpm run gen-agent-note-index`）将根据目录树完整重写 INDEX.md。
- `scripts/verify-agent-note-classification.ts` 将检查结构，并断言已提交的 INDEX.md 与新鲜渲染结果逐字节一致。

添加、移动或删除 Agent Note 时，只需编辑 Agent Note 文件并运行生成器。

## 曾考虑的替代方案

### 为什么不在 README.md 中使用标记分隔区域？

README.md 中由标记分隔的表格会混合生成内容与策展文本，因而需要拼接机制并保护周围的契约。专用生成文件至少能将这些关注点分开。

### 为什么不采用纯校验器模式？

它能捕获错误，但每次提案编辑仍然要在手工维护的表格中触碰共享热点。作者已经命名并放置了文件，因此索引副本不增加任何信息。这与[包清单提案](../../proposed/process/2026-06-20-discover-package-inventory.md)对 tsconfig 引用和 knip 配置段所做的手写列表与推导之间的判断相同。

## 后果

- 生成文件将是显式的，且不包含任何策展区域。
- H1 格式错误或缺失将是硬错误，因为 H1 为每一行提供标题。
- 即使可以通过重新运行生成器解决冲突，并发分支仍会修改同一个已提交产物。

## 相关

已落地的[不建立索引决策](../../implemented/process/2026-07-19-remove-generated-agent-note-index.md)保留目录树和仓库搜索作为发现机制。
