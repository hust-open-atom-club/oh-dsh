# RFC: 提取通用的长时间运行工具运行时

Status: proposed

[English](2026-06-20-generic-long-running-tool-runtime.md) | 中文

## 问题

bash 能力 seam 同时支持前台命令和长时间运行的后台任务。后台支持体量不小：抽象执行器暴露 `start`、`get`、`ownerOf`、`list`、`readOutput`、`kill` 和 `onTaskDone`；本地执行器负责跟踪任务、增量读取、owner token、进程清理和完成监听；模型侧看到三个工具（`bash`、`bash_output`、`bash_kill`）；工具插件将完成通知注入回所属 agent（智能体）的会话。本地执行器用 owner token 隔离任务访问，因为可预测的全局 task id 会带来跨会话的读取/终止风险。

[工具实操手册](../../../cookbook/adding-a-tool.md)已经指出了真正的设计异味：后台 bash 本质上是寄居在单个工具内部的通用长时间运行工具基础设施。如果未来的工具也需要后台执行、轮询、终止、所有权和完成通知，这些语义不应藏在 `dsh-bash` 里。

## 提案

将长时间运行任务的语义从 bash 上移到一个与工具无关的运行时中。bash 仍然能运行后台命令，但不再拥有 task id、ownership token、轮询、取消、完成通知以及模型侧「读取/终止此任务」命令等通用概念。

该运行时应拥有：

- 稳定的 task id 和 owner token，按调用方的会话/agent 做键。
- 注册一个长时间运行任务，附带增量输出的生产者和一个完成 promise。
- 通用的 read/cancel/list 操作，对所有工具使用相同的跨会话授权规则。
- 向所属会话注入完成通知。
- 针对 pending/running/completed 任务状态的展示钩子，bash 只提供命令特有的标签和输出格式化。

`dsh-bash` 保留 bash 特有的执行契约：将请求解析为命令规格、运行前台命令，或启动进程并将其流/进程句柄交给通用运行时。`dsh-tool-bash` 保留模型侧的命令工具，但后续操作变为通用的长时间运行工具操作，或者 bash 向其注册的共享工具，而不是专属的 `bash_output`/`bash_kill` 管道。

## 当前 seam 消费情况

当前消费方划分清晰：`dsh-tool-bash` 使用完整的前台/后台 seam，而钩子桥接层只使用前台的 `resolve` 和 `run`（带受信的 `stdin` 和 `env`）。`get` 和 `list` 仅在测试中使用；`BashTask.done` 仅在实现内部用于 dispose（资源释放），生产环境的完成通知使用 `onTaskDone`。提取出的运行时应暴露一个公开的完成机制，保留钩子所需的简单前台路径，并决定后台的 `timeoutMs` 是否属于 `start`。如果它拥有进程 spawn 的职责，还应集中处理目前重复的凭证清洗逻辑。

## 验收标准

- bash 特有的包（package）不再定义通用的任务注册表、owner-token 授权、轮询、取消或完成通知机制。
- 一个共享的长时间运行任务服务或工具层拥有这些语义，并被文档化为未来任何具备后台能力的工具的接入路径。
- bash 后台行为仍可通过共享层使用，测试证明跨会话隔离依然成立。
- ACP 和快照 fixture（测试前置数据）通过共享任务词汇渲染后台 bash，而非通过 bash 专属的生命周期语义。
- [工具实操手册](../../../cookbook/adding-a-tool.md)将长时间运行工具指向共享运行时，而不是让每个工具自行发明任务协议。

## 风险

bash 包失去了对一个已经可用的后台任务实现的本地所有权，实现 PR（Pull Request）可能暂时搅动模型侧的工具名称或 transcript（文本记录）展示。如果最终结果是留下一份后台任务契约，而不是让每个未来的长时间运行工具克隆 bash 的私有协议，这种搅动是值得的。

<!-- rfc-format: alternatives-not-recorded (pre-format RFC) -->
