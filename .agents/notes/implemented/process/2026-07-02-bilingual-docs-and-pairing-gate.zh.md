# Agent Note：通过配对兄弟文件与配对门禁实现双语文档

Status: implemented

[English](2026-07-02-bilingual-docs-and-pairing-gate.md) | 中文

## 问题

本仓库的 README 与 docs 目录树会被公司内外的人和 agent（智能体）以中英两种语言阅读。在没有机制的情况下纯靠手工维护第二语言，正是译文腐烂的根源：一侧持续演进，另一侧默默失实，而没有门禁会注意到。对于这类不变式，本仓库一贯的做法是将其编码为机械检查（见[质量门禁](2026-06-11-quality-gates.md)与 [doc-sync 强制](2026-06-11-doc-sync-enforcement.md)），因此双语政策随附一道门禁一起交付。

## 决策

- **配对兄弟文件，两种语言同权。** 一对文档由三个兄弟文件组成：英文 `foo.md`、中文 `foo.zh.md`，以及一份一致性记录 `foo.i18n.yaml`。没有哪种语言是正典：一篇文档可以先用中文撰写和评审、之后再译成英文，反之亦可；约束配对的是：两侧必须表达相同的内容，且配对整体合并（两种语言加记录，绝不单独落一侧）。政策见 [docs/i18n/README.md](../../../../docs/i18n/README.md)；翻译规则见 [docs/i18n/translation-rules.md](../../../../docs/i18n/translation-rules.md)；术语真源见 [docs/i18n/terminology.md](../../../../docs/i18n/terminology.md)。
- **伴随记录保存两侧 blob hash，使一致性可检查。** `foo.i18n.yaml` 保存两侧文件在上一次确认一致时各自的完整 git blob hash。此后修改了任一侧而未重新确认配对，都能被机械检测出来（纯内容比较，无需查询历史），而且同一个 PR（Pull Request）内改动的文件也能计算出 hash，commit hash 式的记录做不到这一点。重新记录（`verify-translation-pairing --write`）会产生一份可评审的 yaml diff：确认一致在 PR 中是一个显式、可见的动作。
- **`verify-translation-pairing` 加入 `doc-sync`。** 门禁（[scripts/verify-translation-pairing.ts](../../../../scripts/verify-translation-pairing.ts)）强制执行以下规则：required 的配对必须存在；任何已存在的配对必须完整（三个文件齐全）且一致（两个 hash 匹配、切换行双向互链、结构签名一致）；被排除的文件（生成物或本身即双语的）不得配对；凡文件名以日期开头且日期不早于 manifest（元数据清单）中 `requiredSince` 分界日期的文档，也必须有完整配对。[scripts/translation-pairing.manifest.json](../../../../scripts/translation-pairing.manifest.json) 中的 `required` 清单只进不退：每个合并的翻译批次将自己的文件加入其中，覆盖面只增不减。
- **翻译是 agent 的工作，由人评审。** 仓库内置的工作流是 [.agents/skills/dsh-translate-docs](../../../skills/dsh-translate-docs/SKILL.md)，与 [dsh-code-review](../../../skills/dsh-code-review/SKILL.md) 模式相同：skill（技能）承载工作流，并将文档作为真源。

## 曾考虑的替代方案

- **英文为正典源、指纹放在译文内**：本 Agent Note 最初提出的设计：`.zh.md` 文件携带一条 HTML 注释记录英文源的 blob hash，翻译只沿 EN → ZH 单向流动。评审中修订：团队需要中文先行的撰写方式（先写、先审中文 Agent Note，再译英文），两种语言同权，而单向正典模型无法表达这一点。覆盖**两侧**的伴随记录取代了文件内的单向指纹；blob hash 的机制本身保持不变。
- **语言目录（`docs/en/` + `docs/zh/`，Kubernetes/ECharts 模式）**：否决。本仓库没有将 locale 映射到路由的文档站框架；如果移动所有英文文件，所有既有交叉引用都要随之修改；且 `verify-md-links`/`verify-doc-refs` 将需要路径映射逻辑，而非原样工作。
- **独立翻译仓库（PingCAP `docs`/`docs-cn` 模式）**：否决。适合有独立发布节奏的文档产品，对 monorepo 自身的文档而言过重；还会把译文置于本仓库门禁触及不到的地方。
- **中英混排单文件（一个文件、两种语言）**：否决。每个 diff 都翻倍，破坏一段一行约定的 diff 易读性，且局部不一致不可见。
- **Commit hash 式记录（MDN `l10n.sourceCommit` 模式）**：否决，改用 blob hash。同一个 PR 内的改动还没有 commit hash，MDN 模式无法表达「与本 PR 引入的状态一致」，且校验它需要 git 历史而非文件内容。
- **比较配对两侧的 git 时间戳（无记录）**：否决。纯格式化的改动会误报，一次无关改动之后提交的对侧文件会漏报；只有内容同一性这个信号才与门禁的承诺名实相符。

## 业界先例

带语言后缀的配对兄弟文件是中国大厂的主流约定（ant-design 的 `index.zh-CN.md`/`index.en-US.md`；arco-design 的 `README.zh-CN.md` 加顶部切换行；Apache ShardingSphere 的 387 对 `.cn.md`/`.en.md`），但这些仓库都没有在 CI 中**强制**配对或一致性检查；约定纯靠评审维系。一致性自动化存在于中国以外：MDN 的 `l10n.sourceCommit` front-matter 指纹、Vue 的 Ryu-Cho action（监视上游 commit，为陈旧译文自动开 issue/PR）、Kubernetes 的本地化漂移脚本、微软 Azure co-op-translator（CI 中由源 hash 驱动的 LLM 重译）。本设计将两者结合：中文生态的文件布局，加上 hash 配对门禁，再加一个仓库内置的 agent skill 替代 bot 服务。

## 后果

- 修改已配对文档的任一侧，同一个 PR 就有义务更新对侧并重新记录配对。门禁将 doc-sync 规则双语化，不变式由 CI（而非评审者的记忆）承载。
- 每个配对给目录树多添一个文件。记录由机器写入（`--write`），代价是目录噪音而非维护负担；换来的是「谁在何时确认过这对文档一致」可以从 yaml 的 git blame 直接回答。
- 两侧说法冲突时，没有机械规则裁决谁赢，由 PR 评审裁决。这是同权的代价，且是有意接受的：另一个选项（正典语言）会禁止中文先行撰写。
- 生成文档（`cordis-catalog/`、`tool-catalog/`、`module-graph.md`）暂被排除；计划中的后续工作是让生成器在输出英文的同时输出中文，届时将这些文件移出排除清单。
- 推进天然是渐进的：`required` 之外的文档是可见的 backlog（待翻清单，`--list`），而非红色的 CI；因此配对按可评审的批次落地，无需一个巨型 PR。凡文件名以日期开头且日期不早于 manifest 中 `requiredSince` 分界日期的文档，都必须配齐双语文件，因此新建的日期命名 Agent Note 不会增加这份 backlog。
- 记录的 hash 兼作更新工具（`git cat-file -p <hash>` 能还原任一侧上次确认的文本，用于基于 diff 的最小更新），因此这套机制从不强迫整篇重译。
