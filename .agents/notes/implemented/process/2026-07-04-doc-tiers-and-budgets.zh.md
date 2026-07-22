# RFC: 文档分层、预算与上限门禁

Status: implemented

[English](2026-07-04-doc-tiers-and-budgets.md) | 中文

## 问题

尽管已有写作指导，常设文档仍然积累了重复的规则、重述的事故、重复的包（package）映射和陈旧的 RFC 摘要。仅靠评审无法阻止这种膨胀，因此仓库需要在文档分类体系之外增加一道机械化的预算约束。

## 决策

- **分层分类体系，每条事实只有一个归属地。** [docs/AGENTS.md](../../../AGENTS.md) 是文档标准：它为每个 Markdown 层级指定唯一职责（常设指令、系统地图、类型目录、决策记录、事故叙事、实操手册、逐包契约、生成目录、工作流），禁止在归属层级之外重述事实（应以链接代替），并附带一份在撰写或评审任何文档时使用的冗余检查清单。
- **窄范围、硬约束的预算门禁。** [scripts/verify-doc-budgets.ts](../../../../scripts/verify-doc-budgets.ts) 加入 `doc-sync`（文档同步门禁）：[scripts/doc-budgets.manifest.json](../../../../scripts/doc-budgets.manifest.json) 中列出的每篇文档都必须低于其字数上限（`wc -w` 语义，整个文件），且受预算约束的文件如果缺失也会导致门禁失败，防止重命名后预算被静默遗留。范围刻意限定为容易膨胀的常设文档：根目录和子树的 `AGENTS.md`、`architecture.md`、`packages/README.md`，以及它们将内容分流到的常设策略文档（`docs/testing.md`、`docs/defensive-patterns.md`）。参考文档、RFC 和 package README 不设预算：当每一行都是事实时，长度是合理的，由评审加冗余检查清单来管控。
- **上限是只进不退的执行红线。** 上限设定为文档当前字数的至少 105%（留出工作余量，使日常措辞调整能通过，而真正的膨胀仍会触发门禁），并随着文档被精简到目标预算而同步下调、保持该余量（根 `AGENTS.md` ≤ 1,500 词；`architecture.md` ≤ 1,800；子树 `AGENTS.md` ≤ 600；`packages/README.md` ≤ 600）。推进机制与[翻译配对的 `required` 清单](2026-07-02-bilingual-docs-and-pairing-gate.md)相同。门禁变红时，修复方式是按分类体系迁移或压缩内容；只有在 PR（Pull Request）描述中给出明确理由时才允许提高上限，manifest（元数据清单）的 diff 本身即为可评审的动作。
- **轻量工作流 skill（技能），契约在文档中。** [.agents/skills/dsh-doc-standards](../../../../.agents/skills/dsh-doc-standards/SKILL.md) 承载放置/审计/红灯修复工作流，并将文档标准作为真源，与 [dsh-translate-docs](../../../../.agents/skills/dsh-translate-docs/SKILL.md) 对 i18n 契约的分工方式一致。

## 曾考虑的替代方案

- **仅靠 skill 和评审纪律，不设门禁**：否决。上述膨胀正是在现行规则和评审注意力已经存在的情况下发生的；一条没有机械后盾的行文规则在此处已被证明无法维持，而本仓库自身的[质量门禁立场](2026-06-11-quality-gates.md)认为值得保持的不变式就值得编码。
- **对所有文档层级全面设限**：否决。一刀切的上限恰好惩罚了那些正当的长文档（如特性矩阵或类型目录，每一行都是事实，例如 `packages/ui/acp/acp-feature-support.md`），并产生逐文件的例外变更，训练贡献者机械地批准提限。
- **将标准放在 skill 内部**：否决。契约归文档，工作流归 skill；如果标准被塞进 SKILL.md，那些不调用该 skill 而直接编辑文档的 agent（智能体）就看不到它，而 `docs/AGENTS.md` 已经作为子树指令被任何在 `docs/` 下工作的人加载。

## 后果

- 向受预算约束的文档添加内容现在需要置换：将新增内容迁移到其分类体系归属地并留下指针，或压缩现有行文来腾出空间。只增不减会导致 CI 失败。
- 精简到目标预算的重写以堆叠的后续 PR 落地，每次合并时同步下调 manifest 中的上限；在各自落地之前，文档冻结的上限仅阻止进一步膨胀。
- 字数是一个粗糙的代理指标，这是有意接受的：它无法判断质量，但它在内容被添加的那一刻强制触发迁移决策，而那正是作者拥有足够上下文来正确放置内容的时刻。
