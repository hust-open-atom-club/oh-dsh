# Agent Note: 默认的本地指令覆盖层

Status: implemented

[English](2026-07-21-local-instruction-overlay.md) | 中文

## 问题

个人的、被 git 忽略的指导文件（`AGENTS.local.md` / `CLAUDE.local.md`）是 Claude Code 的一项约定，用于存放刻意不提交、每位开发者各自的覆盖内容。[workspace-context 插件](2026-06-24-workspace-context.md)每个目录只加载一个候选，因此只有把某个 `.local.` 名字加进 `instructionFileCandidates` 才能读到它；而由于一个目录只有一个胜出者，这样做只会让它*遮蔽*已提交的基础文件，而不是补充它。这与这些名字所暗示的「基础文件加个人覆盖层」的叠加模型正好相反，而且它默认是关闭的。

## 决策

插件为每个项目目录额外加载第二个独立的候选列表。`localInstructionFileCandidates` 默认为 `['AGENTS.local.md', 'CLAUDE.local.md']`，并与 `instructionFileCandidates` 采用相同的同目录校验来解析。在从项目根到会话 cwd 的每个项目目录中，插件先加载第一个存在的基础候选，然后叠加加载第一个存在的本地候选；本地文件排在基础文件之后，因此在字节预算之内其内容优先级更高。将 `localInstructionFileCandidates` 置空即可关闭该覆盖层。

该默认值定义在插件的 `Config` schema 中，而非某个产品的 `cordis.yml` 里，因此每个嵌入方（TUI、ACP、headless）读取 `.local.` 文件的行为一致，部署方也可以在一处覆盖或关闭该行为。这与插件自身持有的 `instructionFileCandidates` 默认值保持对称。

固定的用户全局文件 `$DSH_HOME/AGENTS.md` 没有本地覆盖层，始终只有基础文件。

## 分层的 scope 键

现在每个目录最多产生两个逻辑 scope，它们共享同一路径，但在基线冻结、待定窗口、版本缓存和协调过程中都必须彼此独立。`render.ts` 把层级编码进 scope 键：基础层级保留原始的目录 scope（`.`、`pkg`、`user-global`），本地层级则追加一个真实路径中不可能出现的 NUL 哨兵（`\u0000local`）。`scopeKey`/`decodeScopeKey` 负责这套编码。`DiscoveredInstructionFile` 携带必填的 `tier`，`LoadedInstructionFile` 携带可选的 `tier`（缺省即表示基础层级）；发现过程为每个文件打上标记，`baselineInstructionState` 由目录加层级推导出分层的键，`reconcileInstructionContext` 在本地列表非空时为每个项目目录枚举两个层级，`probeScopeInstruction` 则解码该键以选取基础或本地候选列表。面向模型的提示词从文件的展示路径推导出供人阅读的目录标签，因此哨兵永远不会到达模型；而既有的按绝对路径去重仍会把解析到同一文件的基础列表与本地列表合并为一个。

## 备选方案

**更高优先级的先到先得（加载 `.local.` 而非基础文件）。** 否决：一个会替换已提交文件的个人覆盖层，会在覆盖层存在时丢弃共享的项目指导，这与 Claude Code 的叠加模型正好相反。

**通过 `instructionFileCandidates` 保持按需开启。** 否决：一个目录只有一个胜出者，因此加进该列表的 `.local.` 名字会遮蔽基础文件，而非补充它。packages 指引要求把按需开启项排除在出厂默认之外，但此处强有力的现有实践、以及用户对 `.local.` 文件总会被读取的预期，压过了这一考量。

**在产品 `cordis.yml` 层面设默认，而非在插件 schema 中。** 否决：这样只会为记得开启的那个前门启用 `.local.`，从而在 TUI/ACP/headless 之间割裂行为，并重复一个本应与既有候选默认值放在一起的取值。

**两个层级复用原始目录作为 scope 键。** 否决：同一目录下的基础文件与本地文件会在每个以 scope 为键的映射中冲突，于是对其中一个的改动会抑制或覆盖另一个。带哨兵后缀的键让两个层级保持独立，且无需扩展持久化的元数据结构。

**将覆盖层扩展到用户全局 scope。** 暂缓：`$DSH_HOME` 是单个固定的 `AGENTS.md`，没有可供补充的已提交基础文件，因此在出现具体需求前始终只有基础文件。

## 影响

`.local.` 指导在所有产品中默认被读取，无需按部署单独配置，与邻近工具保持一致。每个项目目录可以贡献两个持久 scope 而非一个，因此动态发现、编辑和移除会分别独立地协调基础层级与本地层级。scope 键的形态发生了变化以携带层级；`dsh-session` 对旧会话不作兼容承诺，因此这是一次无成本的改动。用户全局 scope 仍然只有基础文件，这一点作为 Known Limitation 记录在包 README 中。
