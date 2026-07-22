# RFC: 生成 RFC 索引表

Status: implemented

[English](2026-07-04-generate-rfc-index-tables.md) | 中文

## 问题

RFC 索引中按生命周期/按分类的表格所列信息完全可以推导：RFC 的路径编码了生命周期与分类，文件名编码了首次提出日期，H1 标题承载了标题文本。这些信息的手工维护副本也是仓库中冲突最频繁的文档热点：每一波提案都在同几行后追加新行，因此并发的 RFC 分支恰好在此处冲突，而其他地方完全一致；每次冲突都要手工合并那些文件系统本已知晓的行。[分类 RFC](2026-06-20-rfc-classification.md) 最初为了可策展性而保留手写索引，但 README 中真正需要策展的是行文，而行文从不冲突；冲突的只有机械表格。

## 决策

保留策展行文；生成列表。表格位于 [`docs/rfc/INDEX.md`](../../INDEX.md)，是一个**完全生成的文件**——策展行文留在 README.md 中，README.md 不包含任何索引行。[`scripts/rfc-index.ts`](../../../../scripts/rfc-index.ts) 是共享的真源：树遍历器（拥有封闭的生命周期/分类集合与结构规则，包括对可解析 H1 的要求）和渲染器（行来自 H1 标题并去掉 `RFC: ` 前缀，加上文件名日期，按日期再按文件名排序，以 `### {Class}` 分节、按规范分类顺序分组）。两个轻量消费方共享它：

- [`scripts/gen-rfc-index.ts`](../../../../scripts/gen-rfc-index.ts)（`pnpm run gen-rfc-index`）从目录树完整重写 INDEX.md。
- [`scripts/verify-rfc-classification.ts`](../../../../scripts/verify-rfc-classification.ts)（`doc-sync`（文档同步门禁）的一个成员）检查结构，断言已提交的 INDEX.md 与新鲜渲染结果逐字节一致（`gen-cordis-catalog`/`verify-cordis-catalog` 模式），并拒绝在策展 README 中出现索引格式的行。新鲜度检查涵盖了索引完整性检查：从磁盘生成的表格在定义上就是完整的、标题正确的。

添加、移动或删除一个 RFC 只需编辑 RFC 文件本身并运行生成器；分类 RFC 的「已否决替代方案」记录中带有替代关系的交叉链接。

## 曾考虑的替代方案

### 为什么不在 README.md 内使用标记分隔区域？

最初落地的形态是：生成器将表格拼接到 README.md 中 `gen-rfc-index` 标记注释之间、各 `## {Lifecycle}` 标题之下。在 README 同时吸收了文件内格式契约（[统一格式 RFC](2026-07-05-uniform-rfc-format.md)）之后，被整文件 INDEX.md 方案取代：一个门面 README 承载数百行生成内容会淹没其策展行文，而拼接机制（标记对、标题检查、区域外行检测）的存在仅仅是为了保护策展文本——专用的生成文件根本不包含这类文本。

### 为什么不采用纯校验器模式？

校验器能捕获错误，但每次提案编辑仍然要在手工维护的表格中触碰共享热点；对于纯机械的行，校验器失败比生成器更令人烦恼：作者已经命名并放置了文件，索引副本不增加任何信息。这与 [package-inventory 提案](../../proposed/process/2026-06-20-discover-package-inventory.md) 对 tsconfig references 和 knip stanzas 所做的手写列表与推导之间的判断一致——应用于这张确实会冲突的列表。

## 后果

- 生成文件是显式的：其横幅标注了生成器名称，文件内没有需要保护的策展区域，且生成器在目录树结构无效时拒绝运行。
- 格式错误或缺失的 H1 在生成器和门禁中都是硬错误——H1 现在是索引标题的承重来源。
- 并发的 RFC 分支通过重新运行生成器解决索引冲突，从不手工合并行。
