# RFC: Markdown 交叉链接有效性检查

Status: implemented

[English](2026-06-18-markdown-cross-link-lint.md) | 中文

## 问题

本仓库的文档通过相对路径互相链接：`[topic](../implemented/2026-…-….md)`、`[the cookbook](adding-a-tool.md)`、`[architecture.md](../../architecture.md)`。此前没有任何机制验证这些目标是否存在。重命名或移动文件会静默破坏所有指向它的链接，且在读者点击之前不可见。[Doc-sync 强制](2026-06-11-doc-sync-enforcement.md)已经将两类文档漂移机械化（无法编译的代码块、陈旧的事件分类表），[verify-md-wrap](2026-06-11-doc-sync-enforcement.md) 覆盖了第三类（硬换行的段落），但死链是第四类同样可机械检查、却仍靠肉眼验证的问题。

触发本门禁的直接案例是引入它的那次 RFC 目录重组：将 `docs/adr/` + `docs/rfc/` 统一为一个 `docs/rfc/`，下设 `proposed/`/`implemented/`/`rejected/` 子目录，手动改写了约四十条文档间链接。任何一个手误路径都会让一条死链随代码入库，而没有任何东西能拦住它。

## 决策

新增第四道 `doc-sync` 门禁 `verify-md-links`（`scripts/verify-md-links.ts`），风格与 `verify-md-wrap` 一致（tsx ESM、基于 AST、只验证不生成）：

- 使用 `mdast-util-from-markdown` + GFM 解析每个范围内的 Markdown 文件，遍历所有 `link`、`image` 和 `definition` 节点。
- 仅当目标是**相对路径**时才检查。跳过带协议的 URL（`https:`、`mailto:` 等）、协议相对路径（`//host`）、根绝对路径（`/path`，在检出目录中没有稳定基准）以及纯页内锚点（`#section`）。剥除 `#fragment`/`?query`，相对于链接所在文件的目录解析路径，并断言目标在磁盘上存在。
- 只报告、不改写；发现第一条死链即以非零状态退出。

范围与其他门禁一致，另外加上 AGENTS.md 对和 `.agents/skills/` 下仓库自有的 agent skill Markdown（这些 skill 文件交叉链接到 docs 目录，因此本次重组也改写了其中的链接）：`README.md`、`docs/**/*.md`、`packages/*/README.md`、`AGENTS.md`、`packages/AGENTS.md`、`.agents/skills/**/*.md`，按真实路径去重（`CLAUDE.md` 符号链接解析到 AGENTS.md 文件）。它接入 lefthook pre-push 钩子和 CI 都会运行的 `doc-sync` 脚本，因此死链在推送前就会在本地失败——与[机械化质量门禁](2026-06-11-quality-gates.md)一致。

本门禁检查的是*文件存在性*，而非锚点有效性：指向一个真实文件但带有 `#wrong-heading` 片段的链接仍会通过（文件可解析；片段被剥除）。

## 曾考虑的替代方案

**锚点级有效性检查**：更重且价值更低；实际造成问题的是文件级死链。这一范围裁剪是有意为之：作者在链接到某个锚点时自行验证 `#fragment`。

## 后果

- 重命名或移动文件导致交叉链接悬空时，现在会在 pre-push 钩子和 CI 中失败，而不是等读者点击死链才发现。这使得引入本门禁的 RFC 重组具备自验证能力：改写四十条链接的同一个 PR 也添加了证明无一悬空的检查。
- `doc-sync` 链中多了一个快速 tsx 脚本；无新增依赖（mdast/GFM 技术栈已作为 `verify-md-wrap` 的 devDependencies 存在）。
- 本门禁强制的约定——通过可机械检查的相对链接引用文档，而非裸文本或编号——记录在 [docs/AGENTS.md](../../../AGENTS.md) 中，让作者知晓门禁的存在与原因。
