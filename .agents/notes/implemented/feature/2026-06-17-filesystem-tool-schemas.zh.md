# RFC: 文件系统工具 schema——面向模型的读/写/编辑接口形状

Status: implemented

[English](2026-06-17-filesystem-tool-schemas.md) | 中文

## 问题

[文件系统能力 seam RFC](../architecture/2026-06-17-filesystem-capability-seam.md) 定义了文件系统能力 seam（`ctx.fs`）、包（package）拆分（`dsh-fs`、`dsh-fs-local`、`dsh-tool-fs`，加上 `dsh-fs-policy` 策略插件），以及针对 read-before-write/edit 检查的 observed-file/stale-version 策略——[split-fs-seam](../simplification/2026-06-26-fsspec-style-fs-seam.md) 和 [event-gate](../architecture/2026-06-26-file-context-as-event-gate.md) RFC 后来将其从 `ctx.fs` 移至 `dsh-fs-policy` 插件的 `fs/*` 事件门上。首次文件系统工具交付剩余的决策是面向模型的 schema 接口：模型在 `read`、`write` 和 `edit` 中看到哪些参数。

该 schema 应足够小，以便在 `dsh-tool-fs` 的首次实现中完成，但又足够稳定，使未来的本地/远程/沙箱文件系统后端不需要改动面向模型的接口。同时应避免从参考系统中照搬所有选项。Claude Code 和 OpenCode 暴露了类似的核心文件工具，但在命名风格和额外 flag 上有所不同；本 RFC 为原型选择最小的共有接口。

## 决策

`@deepseek-ai/dsh-tool-fs` 在首个文件系统工具套件中暴露以下三个面向模型的工具：

| Tool | Our schema | Claude Code | OpenCode | Notes | Part of prototype |
|---|---|---|---|---|---|
| `read` | `read(file_path, offset?, limit?)` | `Read(file_path, offset?, limit?, pages?)` | `read(filePath, offset?, limit?)` | Files only; 1-indexed `offset`; no image/PDF/multimodal support in the first pass. | YES |
| `write` | `write(file_path, content)` | `Write(file_path, content)` | `write(content, filePath)` | Creates or overwrites UTF-8 text. Under the default fs-policy, updates to existing files require a prior observation; new-file creates do not. | YES |
| `edit` | `edit(file_path, old_string, new_string, replace_all?)` | `Edit(file_path, old_string, new_string, replace_all?)` | `edit(filePath, oldString, newString, replaceAll?)` | Literal string replacement; unique match required by default; under the default fs-policy requires a prior observation (any windowed read counts). | YES |

schema 使用 snake_case 字段名（`file_path`、`old_string`、`new_string`、`replace_all`），与 Claude Code 及现有 DeepSeek Harness 工具 schema 示例保持一致。消费方包将这些面向模型的名称转换为 `ctx.fs` 调用和 `fs/*` 事件分发。

## 工具 schema

### `read`

`read` 检视一个 UTF-8 文本文件并返回带行号的内容。

参数：

- `file_path: string`——必填。要读取的路径，由 `ctx.fs` 解析。
- `offset?: number`——可选。返回的第一行，从 1 开始。默认为第一行。
- `limit?: number`——可选。返回的最大行数。默认值与上限是 `dsh-tool-fs` / `ctx.fs` 的实现细节。

首次实现不涉及的内容：

- 无 PDF `pages` 参数。
- 无图片或多模态文件读取。
- 不通过 `read` 列出目录；如有需要，目录列表将作为单独的后续工具。

### `write`

`write` 创建或完整替换一个 UTF-8 文本文件。

参数：

- `file_path: string`——必填。要写入的路径，由 `ctx.fs` 解析。
- `content: string`——必填。要写入的完整 UTF-8 文本内容。

在默认 fs-policy 下，使用 `write` 更新已有文件需要同一执行上下文先前对该文件有过一次观测（read/write/edit）；`dsh-fs-policy` 插件将观测到的版本作为 `fs/write-intent` 上的 stale guard 提供。创建新文件不需要先前观测。如果策略插件不存在，`write` 是无条件的裸提供方 create-or-overwrite。

schema 不将 `expected_hash`、`expected_version` 或 `create_only` 作为面向模型的参数暴露。陈旧版本检查由后端产生的版本和策略插件的观测状态驱动，而非要求模型通过 schema 复制版本令牌。

### `edit`

`edit` 通过替换字面文本来更新已有的 UTF-8 文本文件。

参数：

- `file_path: string`——必填。要编辑的路径，由 `ctx.fs` 解析。
- `old_string: string`——必填。要替换的字面文本。首次实现中空字符串无效。
- `new_string: string`——必填。字面替换文本；空字符串表示删除匹配内容。
- `replace_all?: boolean`——可选。默认为 false。为 false 时，`old_string` 必须恰好匹配一处。

`edit` 要求同一执行上下文先前对该文件有过一次观测（任何窗口化的 read 都算——授权基于版本新鲜度，而非全文查看要求），或该上下文先前对该文件做过 write/edit。`dsh-fs-policy` 策略插件推导所有者并将记录的版本作为 stale guard 提供；提供方的 mutation lock 负责执行。

首次实现拒绝 Codex 风格的 patch 语法和多模式 edit API。它使用一种严格的字面替换模式，使面向模型的契约保持简单，并让后端掌控精确匹配、重复匹配、行尾和陈旧版本的语义。

## 结果形状

首次实现通过现有的 `ToolDefinition.execute()` 契约返回 `ContentBlock[]`。`ctx.fs` 返回结构化的文件系统结果并负责文件状态的记录/刷新；`tool-fs` 将这些结果格式化为模型投影。

默认原生投影：

| Tool | Structured `ctx.fs` outcome consumed by `tool-fs` | Default model projection |
|---|---|---|
| `read` | returned lines, returned line count, total line count, target display path, file version, partial-view flag | line-numbered text plus pagination footer |
| `write` | create/update operation, target display path, new file version | concise create/update success text |
| `edit` | replacement count, replace-all flag, target display path, new file version | concise edit success text |

结构化结果不会重复模型参数（如 `file_path`、`old_string` 或 `content`），除非后端已将其解析为新信息（如 `displayPath`、`targetKey` 或新版本）。面向 token 的截断属于模型投影的职责，而非后端规范结果的一部分。

## 延后事项

以下内容被明确排除在首次文件系统 schema 实现之外：

- 面向模型的 `expected_hash`、`expected_version` 或 `create_only` 参数。
- 目录列表、glob、grep 和搜索工具。
- 二进制安全的读/写操作。
- PDF/图片/多模态 `read`。
- 文件系统工具的 Code Mode 投影值。
- 规范的 edit diff 格式。

## 测试

schema 测试固定每个工具的必填/可选参数集、空 `old_string` 拒绝、`replace_all` 默认值、snake_case 字段名、描述文字中对观测策略的说明，以及根插件套件注册；集成测试通过 `ctx.tools.execute()` 对真实的 `dsh-fs-local` 提供方执行全部三个工具，并验证模型参数被正确转换为预期的 `ctx.fs` 调用和 `fs/*` 分发。

## 曾考虑的替代方案

- **Codex 风格的 patch 语法或多模式 edit API**：否决。一种严格的字面替换模式使面向模型的契约保持简单，并让后端掌控精确匹配、重复匹配、行尾和陈旧版本的语义。
- **camelCase 参数名（OpenCode 风格）**：snake_case 与 Claude Code 及现有 harness 工具 schema 示例一致，且命名一旦发布即成为公开接口。
- **面向模型的 `expected_hash` / `expected_version` / `create_only` 参数**：否决。陈旧检查由后端产生的版本和策略插件的观测状态驱动，从不依赖模型复制的脆弱令牌。

## 后果

**首版 schema 有意小于 Claude Code 的。** 去掉 PDF pages、多模态 read、丰富的 grep/list flag 和 expected hash 字段使实现保持聚焦，但用户可能很快就会提出这些需求。它们将以独立 RFC 或聚焦的后续工作形式到来，而非对初始 schema 的重载。

**v1 中没有显式的面向模型的 stale guard。** schema 不要求模型提供 expected hash/version。这是有意为之：陈旧检查来自后端产生的版本和 `dsh-fs-policy` 插件的观测状态，而非模型复制的脆弱令牌。文件系统安全失败通过 `dsh-fs` 拥有的结构化 `FsError` 代码浮现，而非模型提供的版本字段。

**命名成为公开接口。** 一旦发布，将 `file_path` 改为 `filePath` 或 `old_string` 改为 `oldString` 会搅动提示词、示例和下游客户端。本 RFC 预先选择 snake_case，并将其视为稳定的面向模型的契约。
