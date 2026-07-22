# RFC: 相对文件系统路径按调用方的会话 cwd 解析

Status: implemented

[English](2026-07-02-fs-per-session-cwd.md) | 中文

## 问题

ACP（Agent Client Protocol）桥接层为每个会话提供独立的工作区：`session/new` 将编辑器的项目目录记录为 `SessionHeader.cwd`，`dsh-tool-bash` 将每次 bash 调用的 `workdir` 默认设为调用方 agent（智能体）的 `session.header.cwd`（见 [`packages/ui/acp`](../../../../packages/ui/acp) 中的 per-session cwd RFC 工作与 `dsh-tool-bash` 中的 `resolveWorkdir`）。因此会话 A 中的 bash 命令在 A 的项目目录执行，会话 B 中的在 B 的项目目录执行——一个服务器进程，N 个工作区。

文件系统解析使用的是插件加载时的 cwd，而 bash 使用的是会话的项目目录。因此，当编辑器项目目录与服务器启动目录不同时，相对路径的解析结果就会不一致；快照测试因为让这两个路径相同而掩盖了这个 bug。

## 决策

将调用方的会话 cwd 传入路径解析，与 `dsh-tool-bash` 对 `workdir` 的处理方式完全一致。**调用方**（即工具）提供 cwd；提供方不读取会话或 agent。

- `FileSystem.resolve` 扩展为 `resolve(path: string, opts?: { cwd?: string }): Promise<FsTarget>`。`opts.cwd` 是相对 `path` 解析时的基准目录；绝对 `path` 忽略它；省略 `opts.cwd` 则使用后端自身的默认值。采用 options 对象（而非位置参数 `cwd?`）为将来的解析提示留出空间，无需再次变更签名。
- `dsh-fs-local.resolve` 使用 `resolveLocalTarget(opts?.cwd ?? this.config.cwd, path)`。`config.cwd` 仍作为调用方未提供 cwd 时的默认值（非 ACP／无会话场景，以及 `process.cwd()` 本身就是工作区的单会话 stdio 演示）。
- `dsh-tool-fs` 的 `read`/`write`/`edit` 通过共享的 `sessionCwd(exec)` 辅助函数（`exec.agent?.session.header.cwd`，与 bash 的 `resolveWorkdir` 对应）获取会话 cwd，并传给 `resolve`。非 agent／无 header 的调用方得到 `undefined`，后端因此应用其默认值。

## 曾考虑的替代方案

### 为何由调用方（而非提供方）提供 cwd

提供方 seam 不得依赖 `dsh-agent`／`dsh-session`——它是一个文本存储后端，沙箱或远程实现同样满足该接口，而这些实现没有「agent 会话」的概念。工具已经接收了 `ToolExecution`（`exec`），其中携带 agent，因此工具是将 `exec → cwd` 投影并向提供方传递一个纯字符串的正确位置。这遵循「包（package）边界处显式优于隐式」的约定：基准目录作为显式参数传入，提供方据此行动，而非让提供方越界去读取它不应知晓的会话。这也与 `dsh-tool-bash` 一一对应，使两个面向模型的文件操作接口以相同方式解析路径。

默认值只存在于一个地方——提供方的 `config.cwd`。`sessionCwd` 在没有会话时返回 `undefined` 而非 `process.cwd()`，因此工具永远不会自行制造一个提供方本应自行选择的基准目录。

## 后果

- 在 ACP 演示中，fs 工具与 bash 现在对每个会话的工作区达成一致；编辑器可以打开任意项目目录，两类工具都在该目录下操作。
- `FsTarget` 的标识不变：`targetKey` 仍为解析后绝对路径的 realpath，因此 observed-state 键控与符号链接标识不受影响——正确的 per-session cwd 产生与 bash 目标相同的 key。
- 向后兼容：所有现有的 `resolve(path)` 调用（均在测试中）继续正常工作；新参数是可选的。
- 单会话 stdio 演示不受影响：它不提供会话 cwd（其 agent 的会话没有 `cwd`），因此解析回退到 `config.cwd = process.cwd()`，即工作区本身。
