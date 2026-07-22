# RFC: RFC 的统一受门禁约束的文件内格式

Status: implemented

[English](2026-07-05-uniform-rfc-format.md) | 中文

## 问题

RFC 的路径已经编码了生命周期和分类，但文件内容仍然混杂着不同的标题风格、状态格式、ADR 与 proposal 模板，以及已实现记录中残留的 proposal 时期的章节。作者随手复制找到的任何邻近文件，生命周期迁移时可以跳过必要的改写，因为没有门禁强制执行文件内契约。

## 决策

[README.md § The file format](../../README.md#the-file-format) 即文件内契约：头部块（`# RFC: <title>` 加上无日期、与所在文件夹一致的 `Status:` 枚举，唯一的正文内容是 rejection reason）；按生命周期区分的正文骨架（所有阶段都以 `Problem` 开头；`proposed/` 中为 `Proposal`/`Acceptance criteria`/`Risks`；`implemented/` 中为现在时态的 `Decision`/`Consequences` 且禁止 proposal 时期的标题；`rejected/` 中冻结 proposal 形态）；必须包含 `Alternatives considered` 章节；以及规范的章节词汇表，其间的自定义技术章节保持自由形式。`pnpm run verify-rfc-format`（[scripts/verify-rfc-format.ts](../../../../scripts/verify-rfc-format.ts)）作为 `doc-sync`（文档同步门禁）的一环强制执行每条机械化条款，因此生命周期迁移时跳过改写现在会让 CI 失败，而不是依赖评审者的记忆。

整个语料库在定义格式的同一个变更中完成了规范化，这是预发布阶段的立场：没有过渡期，不容忍双格式并存。唯一的祖父条款针对内容而非格式：替代方案是记录下来的，不是凭空编造的；因此如果一篇格式定义前的 RFC 的替代方案无法从记录中重建，它会携带 `rfc-format: alternatives-not-recorded` 这条精确注释，门禁仅对日期早于本 RFC 的文件接受该注释。

## 曾考虑的替代方案

- **完全刚性的模板**（每个生命周期一个固定章节序列，所有 RFC 重构以适配）：否决。大型设计 RFC 包含八到十五个自定义技术章节（包拓扑、协议格式契约、schema），这些是承重内容而非漂移；刚性序列会立即强制破坏性改写，并永远带来与模板的对抗。
- **仅规范化头部**（H1 和 Status，正文不动）：否决。债务标记指出的是*正文*的体裁分裂，让 `Context`/`Decision` 与 `Problem`/`Proposal` 无限期并存什么也解决不了。
- **不设 Status 行**（文件夹本身就是状态；格式定义前最新的三篇 RFC（以及其中一篇的中文对侧文件）省略了该行）：否决，保留自描述文件。省略 Status 行的动机是防止漂移，而将该行与文件夹做门禁校验即可消除漂移风险。
- **带日期的 Status**（`Status: implemented (accepted YYYY-MM-DD)`）：否决。接受日期属于叙述性历史，写作规则将其排除在文档之外；文件名承载首次提出日期，git 承载其余信息；门禁能检查日期格式，但永远无法检查其真实性。
- **裸 `# <title>` H1**：否决。`RFC: ` 前缀是语料库中的多数形式，且在文件脱离目录树被阅读时能自描述体裁；索引生成器会剥离前缀，因此索引行无论哪种写法都一样。
- **`## What we give up` 作为 implemented 的结尾章节**（README 自身对 RFC 记录内容的措辞）：否决。它只命名了代价，而诚实的后果章节同样记录这笔权衡换来了什么。
- **只有约定没有门禁**（写下契约，靠评审强制执行）：否决。slop checklist 已经通过约定禁止在 `implemented/` 中使用 spec 语气，而十九个文件展示了仅靠约定在此处能达到什么效果。
- **独立的 `FORMAT.md` 契约文件**：最初的落地位置；在生成索引迁出到 [INDEX.md](../../INDEX.md) 之后折入 README.md：表格移走后 README 重新有了空间，一个前门同时承载布局、分类和格式，优于将契约拆分到两个文件。

## 后果

每篇 RFC 现在需要略多一些结构，而必须包含 `Alternatives considered` 章节是刻意的摩擦：一个没有记录被否决方案的决策，会招致 RFC 本来就是为了防止的重新争论。格式定义前的 RFC 如果替代方案无法重建，则永久携带祖父条款注释，这是记录上的诚实缺口，而非编造的理由。`doc-sync` 增加一道门禁，将 RFC 在生命周期文件夹之间迁移现在是迁移时的实际工作（即迁移本就欠下的正文改写），而非无人追踪的延后清理。三十九个债务标记已全部消除，由它们等待的模板所解决。
