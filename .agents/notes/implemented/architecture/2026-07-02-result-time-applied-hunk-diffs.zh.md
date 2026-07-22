# RFC: 结果时刻的 applied-hunk diff 用于文件变更

Status: implemented

[English](2026-07-02-result-time-applied-hunk-diffs.md) | 中文

## 问题

[tagged render-intent union](2026-07-02-tool-render-intent-union.md) 为 `dsh-tool-fs` 的 write/edit 在调用时刻提供了 `card:'diff'`，纯粹从工具参数推导：write ⇒ `{oldText:null, newText:content}`（整个新文件），edit ⇒ `{oldText:old_string, newText:new_string}`（裸替换片段）。编辑器将其渲染为行内 diff，但这是一个**无上下文**的 diff：裸的 `old_string`→`new_string` 没有周围行，而一次触及五个分散位置的 `replace_all` 仍然渲染为一对片段。

在对接 `claude-agent-acp` 自身的 ACP（Agent Client Protocol） bridge 时可以看到完整编辑器 diff 的样子：变更应用后，它发出第二个 `tool_call_update`，其 diff 是**带 ±3 行上下文的 applied hunk**（`replace_all` 的每个变更位置各一个 hunk），由工具的 `structuredPatch` 重建。这个结果时刻的 hunk 正是让 Zed 在文件中*原位*显示变更（而非浮动片段）的关键。我们的工具止步于调用时刻的片段；完成后的结果只携带纯文本 "updated successfully"，没有 diff。

障碍在于一个 seam 边界：`presentResult(args, result)` 是 **`args` + 面向模型的 `result`（`{content, isError}`）的纯函数**——它在实时流式输出和会话日志回放中都会运行，因此必须具备回放确定性且不能做 I/O。它看不到文件的前后内容，而 `FsEditOutcome`/`FsWriteOutcome` 只携带替换计数和版本号，没有文本。因此无法计算——甚至无法携带——applied hunk 给 presenter。

## 决策

添加一个**持久化的、工具私有的展示通道**，使工具的 `execute` 能附加一个结果时刻的渲染载荷并在回放中存活，并用它来携带 applied-hunk diff。

### 1. 工具结果上的 `meta` 通道（core）

`ToolDefinition.execute` 现在可以返回其面向模型的 `ContentBlock[]`（不变，常见情况）或 `{ content: ContentBlock[]; meta?: unknown }`：

```ts ignore-check
type ToolExecuteReturn = ContentBlock[] | { content: ContentBlock[]; meta?: unknown }
```

`meta` 是工具自有的 `unknown`，core 持久化但不解释。`Session.append` 拒绝非 JSON 值，回放时将存储的载荷回传给 `presentResult`；因此展示无需 I/O 或重新计算即可复现。运行时校验避免了向 tools core 添加共享的 serializable-value 依赖。

这是通用形态（"工具附加持久化的结果展示"），而非 fs 特有的——任何工具都可以使用。

### 2. 工具计算 hunk；后端返回 before/after（fs）

按照 [capability-seam 拆分](2026-06-13-capability-seams.md)，存储后端只返回**存储事实**，面向模型的工具拥有**展示**：

- `dsh-fs` 将 `FsEditOutcome` 扩展为包含 `{ before: string; after: string }`，将 `FsWriteOutcome` 扩展为包含 `{ before: string | null; after: string }`（`before: null` 表示创建，或已存在但不可 diff 的二进制/非 UTF-8 文件）。本地后端在写入时已持有两份文本；它以原始 LF 规范化文本返回，**不让任何 diff/UI 概念进入 seam**。
- `dsh-tool-fs` 将上下文 hunk 存入 `meta: { diffs: FileDiff[] }`。成功的变更始终以 diff 卡片完成，因为 ACP 结果内容会替换待定卡片：创建或无变化的覆写回退到由参数推导的整文件 diff，而编辑使用 applied hunk。失败的变更不携带 diff 元数据，正常渲染其错误信息。

### 3. Bridge 渲染 `diff` 结果卡片

`ToolResultView` 新增 `DiffResultView { card:'diff'; title?; diffs: FileDiff[] }`；bridge 结果侧的 `switch (view.card)` 增加 `diff` 分支，发出 `{type:'diff'}` 的 `ToolCallContent` 块（与调用侧分支对称）。ACP 的 `tool_call_update.content` 在编辑器中替换调用时的内容，因此结果 diff **取代**调用时刻的片段（并防止面向模型的结果文本覆盖它）——两次更新序列（先调用片段，再结果 diff）与 `claude-agent-acp` 完全一致。

## 曾考虑的替代方案

**手写或 vendor diff 算法。** 上下文 hunk 有已知的边界情况，因此 `dsh-tool-fs` 使用带类型的 [`diff`](https://www.npmjs.com/package/diff) 包，并在一个模块中规范化 `structuredPatch` 输出。仓库的 vendor 策略适用于框架源码，而非每个叶子工具库。

## 后果

`tool/result` 事件现在可以携带工具私有的 `meta` 载荷——属于磁盘格式词汇的一部分，由 `Session.append` 在运行时限制为 JSON——任何工具都可以附加持久化的结果展示而无需再改 core。diff 卡片在会话重载和快照回放时免费复现：它从日志中读回，从不重新计算。代价：覆写操作在内存中同时持有旧文本和新文本以计算仅用于 UI 的 hunk（`TODO(overwrite-diff-bound)`），且 `dsh-tool-fs` 引入了一个小型、知名的运行时依赖。

## 非目标

- **实时增量 diff 流式输出。** hunk 在变更完成后一次性计算；没有逐键 diff。
- **对二进制/非 UTF-8 覆写做 diff。** 此类文件的 `before` 为 `null`（没有文本 diff 基础）；写入仍然成功，结果渲染整文件 diff（`oldText: null`）而非上下文 hunk。
- **重命名/移动 diff。** 仅限单个已解析路径的内容 diff。
- **限制覆写 diff 基础的大小。** 覆写操作将整个旧文件读入内存以计算上下文 hunk（加上已持有的新内容），因此非常大的文本覆写会为仅 UI 用途的 diff 分配两份文本。未来的改进可以设定预读上限，超过阈值时回退到整文件/无上下文 diff；在读取位置以 `TODO(overwrite-diff-bound)` 跟踪。

## 相关

- 补全了 [Tagged render-intent union](2026-07-02-tool-render-intent-union.md) 中作为非目标列出的最后一项表示差异——该 RFC 的「非目标」一节已更新，记录 applied-hunk diff 在此处交付。
- 基于[文件系统 capability seam](2026-06-17-filesystem-capability-seam.md)（before/after 是后端返回的存储事实）和[事件溯源会话](2026-06-11-event-sourced-sessions.md)（`meta` 载荷持久化在 `tool/result` 事件上，因此回放可复现卡片）。
- `meta` 通道有意设计为通用的：未来的工具（结构化搜索、数据表结果）可以附加自己的持久化结果展示而无需再改 core。
