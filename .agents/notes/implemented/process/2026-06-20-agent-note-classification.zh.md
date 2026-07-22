# RFC: 通过路径编码的子目录对 RFC 进行分类

Status: implemented

[English](2026-06-20-rfc-classification.md) | 中文

## 问题

`docs/rfc/` 过去仅按**生命周期**分组 RFC：`proposed/`／`implemented/`／`rejected/`。没有任何机制记录每个 RFC 属于哪一*类*决策。索引在每个生命周期下只是一个扁平列表，无法按需筛选「所有简化类」或「所有测试策略类」决策。一批简化类 RFC 在同一天落地后，这个缺口变得具体：浏览 `proposed/` 的读者无法在不逐一打开文件的情况下区分新能力、移除和工具策略变更。

本仓库一贯的倾向是[机械质量门禁优于行文规范](2026-06-11-quality-gates.md)：不被机器检查的约定终将腐烂。因此这里的分类方案必须可强制执行，而非靠自觉的文件头。

## 决策

增加第二个维度——RFC 的**类别**——并将其编码在路径中：`{lifecycle}/{class}/yyyy-mm-dd-topic.md`。文件夹本身*就是*标签。文件的位置声明其类别，封闭集合是「这些文件夹且仅限这些」，而既有的 [verify-md-links](2026-06-18-markdown-cross-link-lint.md) 门禁已经保护了移动文件所需的路径重写。

### 六个类别的封闭集合

| 类别 | 涵盖范围 |
|---|---|
| `feature` | 面向用户或模型的新能力。 |
| `bug-fix` | 修正缺陷或填补事后复盘暴露的空白。 |
| `simplification` | 移除代码、行为或对外表面积，不引入新能力。 |
| `architecture` | 关于**交付源码**的结构性决策——包（package）之间的关系、运行时词汇。 |
| `process` | **围绕**代码的工具、策略或工作流，而非运行时行为。 |
| `testing` | 测试基础设施与策略。 |

`architecture` 与 `process` 的分界线：**architecture** 关乎我们交付的源码；**process** 关乎围绕源码的工具与工作流。本 RFC 本身是一个 `process` 决策——它改变的是仓库的组织方式和门禁，而非 harness 的运行时行为——因此它位于 `implemented/process/` 下。

### 两道门禁

两者都是 `doc-sync`（文档同步门禁）的成员，风格与 `verify-md-wrap` 一致（tsx ESM，只校验不生成，首个违规即以非零退出码退出）：

- **`scripts/verify-rfc-classification.ts`**——封闭集合与索引新鲜度。它断言生命周期文件夹下的每个文件都位于规范集合中的某个类别文件夹内（生命周期根目录下的散落 `.md` 或未知类别文件夹均判定失败），并断言生成的 [INDEX.md](../../INDEX.md) 与从目录树重新渲染的结果逐字节一致（见[生成 RFC 索引表](2026-07-04-generate-rfc-index-tables.md)）。规范类别集合以 `const` 形式定义在 `scripts/rfc-index.ts` 中——这是与生成器共享的机器真源——而 [README](../../README.md) 以行文形式记录它；类别*描述*保持手写，索引由机器生成。
- **`scripts/verify-doc-refs.ts`**——源码注释中的文档引用。RFC 路径不仅被 Markdown 引用，也被 TypeScript 文档注释引用（以仓库根为起点的路径，如 `docs/rfc/implemented/testing/2026-06-19-acp-snapshot-tests.md`）。`verify-md-links` 从未扫描过这些引用，因此重组可能使它们静默失效。此门禁扫描 `packages/**` 和 `examples/**` 下仓库自有的 `.ts` 文件（排除构建产物 `lib/` 和 `vendor/`），查找 `docs/….md` 形式的 token，将每个以仓库根为起点的路径解析并断言其存在。它要求 `.md` 扩展名，因此无扩展名的行文引用（`docs/postmortem/0001`、`docs/architecture.md § Extending The Harness`）不受影响。

## 曾考虑的替代方案

- **在每个文件中添加 `Classification:` 行文行**（紧邻 `Status:`），由门禁解析。可行，但它将路径已能承载的事实重复到文件中，且行内容可能与所在文件夹不一致。路径编码使标签与其存储合二为一，没有需要保持同步的东西。
- **设立 `refactor` 类别。** 与 `simplification` 几乎完全重叠；唯一有人试图用来区分的标准是「可观察行为是否改变？」，而 `simplification` 已经编码了这一点（它不改变）。一个类别即可，无需两个。
- **从文件系统自动生成索引。** 此处最初否决，以保持索引手写；后被[生成 RFC 索引表](2026-07-04-generate-rfc-index-tables.md)取代——当堆叠的提案潮使手写表格成为仓库中冲突最频繁的文档区域后，列表改为完全生成的 [INDEX.md](../../INDEX.md)，而 README 行文保持人工维护。

## 后果

- 每个 RFC 现在都位于一个类别文件夹下，索引在每个生命周期内按类别分组。读者只需扫一个标题即可看到所有简化类或所有测试类决策。
- `doc-sync` 链中多了两个快速 tsx 脚本；无新依赖（mdast/GFM 栈已因 `verify-md-wrap`/`verify-md-links` 而存在）。
- 新增类别是一个刻意的动作：修改 `scripts/rfc-index.ts` 中的 `const` 和 [Classification 章节](../../README.md#classification)，而非仅仅 `mkdir` 一个文件夹。门禁拒绝未知文件夹，因此临时类别无法悄悄混入。
- 源码注释中的文档引用现在也受门禁保护——一个被移动或重命名的文档如果被 `.ts` 注释引用，pre-push 钩子就会失败，堵住了 `verify-md-links` 在结构上无法看到的一类漂移。
