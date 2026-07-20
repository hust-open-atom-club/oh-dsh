# Agent Note: 持久化 PTY 会话

Status: proposed

[English](2026-07-16-persistent-pty-sessions.md) | 中文

## 问题

harness 可以运行前台与后台命令、编辑文件和委派工作，但无法跨工具调用延续一次交互式终端对话。每次 `bash` 前台运行都会启动一个新 shell，因此 shell 内的 cwd、导出变量、虚拟环境激活状态、函数、job control 状态和交互式子进程都会随本次调用结束。

这个缺口排除了状态驻留在终端而不是文件中的工作流，例如单步调试 `gdb`、在 Python 或 Node REPL 中探索、驱动 `ed` 这类行式编辑器，或者中断前台命令后回到原 shell。通用的 [`ctx.tasks`](../../../../packages/tasks/README.md) 运行时可以保留后台操作句柄和输出，但不提供交互式 stdin 或终端语义。

现有 `bash`、`read`、`write` 和 `edit` 工具仍是有界、可审计操作的可靠默认选项。PTY 是对确实需要终端状态的工作的补充功能，不说明这些工具有缺陷，更不意味着要移除它们。

## 提案

新增可选的 `packages/pty/` 功能家族，向模型提供由 agent 拥有、持久化且面向行式交互的 PTY 会话。它遵循仓库的 [capability pattern](../../implemented/architecture/2026-06-13-capability-seams.md)，与现有命令和文件系统工具并存，并且不修改 `agent-loop`。

首次交付在 Linux 和 macOS 上支持交互式 shell 与行式 REPL。全屏终端应用、按键序列、BEL 触发的控制流、进程丢失后的会话恢复以及跨 agent 共享会话都明确推迟，直到基础生命周期得到验证。

### 包拓扑

| 包 | 角色 | ctx key |
|---|---|---|
| `dsh-pty` | `PtyService`、branded `PtySessionId`、后端注册表、按 owner 隔离的会话契约和结果类型 | `ctx.pty` |
| `dsh-pty-local` | 基于 [`node-pty`](https://github.com/microsoft/node-pty) 的本地后端、平台进程检查、有界终端缓冲、沙箱解析和进程树监管 | 在 `ctx.pty` 上注册后端 |
| `dsh-tool-pty` | 6 个面向模型的工具、后台发送的 task 运行时集成、使用指引和 ACP render intent | 注册到 `ctx.tools` |

idle 检测属于后端行为，不是第二条公共 seam。远程或容器后端可能拥有完全不同于本地 `/proc` 检查的权威就绪信号；因此每个 `PtyBackend` 都返回统一的发送结果，同时在内部拥有自己的检测机制。

### agent 所有权与身份

`PtyService` 在进程内保存活会话，但每个会话都由工具执行上下文传入的确切 `Agent` 拥有。服务铸造不透明的 `PtySessionId`；模型可选填的 `name` 只是显示元数据，仅在该 owner 内唯一。所有操作都以 `sessionId` 为目标，`list`/`read`/`signal`/`kill` 会拒绝 owner 之外的调用方。

初始设计不提供插件加载期 auto-start 会话。`pty_spawn` 只在 agent 工具调用期间创建会话，此时所有权和所属的事件溯源会话都已确定。若部署后续需要声明式启动，必须通过尚未发布的 agent setup 组合，而不能创建全局共享终端。

agent scope dispose 时先关闭注册，再等待全部所属 PTY 静默退出。后端或工具插件 reload 不会遗留会话：所有权持续存放在 `PtyService` 中，直到 agent 结束，与 [`ctx.tasks`](../../../../packages/tasks/tasks/README.md) 的服务持有记录模式一致。

### 安全与进程边界

注册的 `shell` 后端只约束终端如何启动，不约束启动后输入的命令。因此 `dsh-pty-local` 在 spawn 前应用两层保护：

- 它使用与 `bash-local` 相同的凭证形态名称策略构建清洗后的子进程环境，移除环境中的 `*KEY*`、`*SECRET*`、`*TOKEN*` 和 harness 管理的变量，除非显式的可信映射提供这些值。
- 它的 `sandbox` 配置为 `required | optional | disabled`，默认 `required`。`required` 在缺少 `ctx.sandbox` 时于插件加载期失败；`optional` 在提供方存在时使用；`disabled` 是显式选择无约束模式。所选提供方只包装一次会话 argv，并在 PTY 的整个生命周期中充当进程边界。

沙箱限制本地进程副作用，但不会让任意 shell 输入自动安全：网络调用和其他外部副作用仍由部署策略治理。工具描述会说明 PTY 会话比一次性工具更难审计，只应在确实需要持久状态或交互式 stdin 时使用。

实现只使用 `node-pty` 的公共功能：子进程 PID、`data` 与 `exit` 通知、`write`、`resize` 和 `kill`。它不假设能访问原生 master fd，也不从 TypeScript 调用 `waitpid`。平台进程检查器在 Linux 上通过 `/proc`、在 macOS 上通过 `ps` 推导进程组和会话成员关系。

### 6 个面向模型的工具

| 工具 | 用途 | 结果 |
|---|---|---|
| `pty_spawn` | 从已注册的后端类型创建按 owner 隔离的会话 | `{ sessionId, name, type, motd }` |
| `pty_send` | 发送文本、可选提交 Enter，并等待就绪或注册一个后台任务 | 有界 viewport、等待状态和会话状态；后台模式还返回 `taskId` |
| `pty_read` | 从保留的 scrollback 读取一个有界页 | `{ text, totalLines, lineBegin, lineEnd, truncated }` |
| `pty_signal` | 向当前前台进程组发送一种允许的信号 | `{ delivered, targetPgid }` |
| `pty_kill` | 关闭一个会话并等待进程树静默退出 | `{ killed }` |
| `pty_list` | 列出调用方的活会话 | 按 owner 隔离的会话摘要 |

`pty_send({ sessionId, text, submit?, background? })` 将 `text` 视为 UTF-8 字节，并由工具实现在解析阶段把 `submit` 默认成 `true`。`submit` 为 true 时先写入文本，再写入平台 Enter 序列；为 false 时只写文本，使控制字符和 REPL 片段无需隐藏的内容启发式即可发送。

前台发送返回有界的渲染增量和两个独立事实：`waitReason`（`stdin_read | inferred_idle | timeout | session_exit`）与 `sessionStatus`（`running`，或携带退出码或信号的 `exited`）。`session_exit` 指 PTY 顶层 shell 进程退出，不指由 shell 消费状态的任意前台命令。timeout 从不意味着进程已经退出。

当 `background: true` 时，`dsh-tool-pty` 在 `ctx.tasks` 上注册进行中的发送，并立即返回 `taskId`。`task_output(wait: true)` 负责等待、读取增量输出并记录最终结果；`task_kill` 将取消转发为 `SIGINT`，只有 PTY 后端拥有的 teardown 路径可以升级信号。若 task 对外接口不存在，后台模式必须在写入输入前失败。设计不新增 PTY 专用的 `sleep` 工具或通用唤醒 seam。

`pty_read` 从最新保留行向后分页。后端同时对保留的 scrollback 和完整返回值执行行数与 UTF-8 字节上限，因此单个超长行无法绕过限制。`truncated` 用于区分保留数据丢失与普通 viewport 增量。

`pty_signal` 接受闭合集 `SIGINT | SIGTERM | SIGKILL | SIGTSTP | SIGHUP`。后端在执行时解析终端前台进程组。当目标组是顶层 shell 时拒绝 `SIGKILL`，并指引调用方使用 `pty_kill`；进程组解析失败时操作直接失败，而不是向猜测的 PID 发送信号。

### 本地就绪检测

本地后端执行 3 个有界层级。所有时间参数都是经校验的配置字段：`pollIntervalMs`、`exactProbeAfterMs`、`idleSilenceMs` 和 `timeoutMs`。

在 Linux 上，检查器从 `/proc/<shellPid>/stat` 读取 shell 的终端前台 PGID，枚举该进程组中的每个进程与线程，并检查它们当前的 syscall。Tier 1 只有观察到 stdin 等待才返回正结果：直接 `read(0)`、获准读取且含 fd 0 的 `select`/`pselect6` 或 `poll`/`ppoll` 参数，或者含 fd 0 的 epoll interest list。无法读取的进程内存和未识别的 syscall 都是 miss，绝不作为正向猜测。架构表只包含对应 Linux UAPI 定义的 syscall number；不支持的架构跳过 Tier 1。

macOS 没有精确 syscall 层。任何前台进程组输出静默都会返回 `inferred_idle`，包括 Python 和 `gdb`；从 `ps` 推导的终端 PGID 只用于发送信号，不作为「只有 shell 才能 idle」的证明。纯进程检查逻辑可注入并在 Linux 上完成 unit 覆盖率，同时由 macOS CI job 驱动真实 PTY 和进程表路径。

Tier 2 在持续 `idleSilenceMs` 没有输出后返回 `inferred_idle`，因此 sleep 或网络阻塞的命令可能看似 ready。Tier 3 在 `timeoutMs` 后返回 `timeout`，避免前台工具调用无限占住 agent。结果保留这些区别；调用方可以通过 `ctx.tasks` 等待、向前台组发信号，或从另一个会话排查。

`node-pty` data 通知进入同一个流式 decoder 和终端 parser。parser 的 carry 状态处理跨 chunk 的 UTF-8 与终端查询序列。首次交付只规范化行式输出并检测 alternate-screen 进入，不承诺正确操作全屏应用。

### 模型可见输出与持久性

现有持久化 `tool/call` 与 `tool/result` 事件是模型发送文本和返回给模型的渲染输出的真源。`pty_spawn` 通过已记录的工具结果返回 MOTD；前台 `send`/`read`/`list`/`signal`/`kill` 结果走同一路径记录。PTY 包不会把原始字节流重复写入自定义会话事件。

后台发送复用现有后台任务完成通知和 `task_output` 结果路径，因此进入后续模型请求的任何输出同样持久化。原始终端字节只作为有界的进程内状态存在，既不持久化也不可恢复。未来的 opt-in transcript sink 必须拥有独立的保留、凭证和隐私契约。

### 进程树 teardown

顶层 `node-pty` 子进程视为 POSIX 会话 leader，但所属资源是完整的 OS 进程会话，而不是一个 PID。关闭时，后端先停止 callback，再向仍匹配的会话成员发送 `SIGTERM`、关闭 PTY、等待 `node-pty` exit 与进程检查器确认静默，然后在可配置的 `disposeGraceMs` 后向已验证的存活者发送 `SIGKILL`。成员快照包含进程启动身份，避免 PID 复用把升级信号发给无关进程。

teardown 独立报告根进程退出与存活进程清理。它不会只因 shell 退出就声称成功；dispose 只有在已捕获的会话成员全部消失后才完成，否则返回结构化清理失败并列出存活者。

### 组合与推行

示例组合保持 opt-in，并采用安全默认值：

```yaml
plugins:
  '@deepseek-ai/dsh-sandbox-local':
  '@deepseek-ai/dsh-pty':
  '@deepseek-ai/dsh-pty-local':
    config:
      sandbox: required
      scrollbackLines: 10000
      scrollbackMaxBytes: 4194304
      maxReadBytes: 262144
      pollIntervalMs: 50
      exactProbeAfterMs: 150
      idleSilenceMs: 3000
      timeoutMs: 30000
      disposeGraceMs: 3000
  '@deepseek-ai/dsh-tool-pty':
```

包会提供简洁的工具指引，说明持久状态、owner 隔离、不确定的 idle 结果、清理，以及无需交互时优先使用现有一次性工具。它不增加全局 system prompt 推荐，也不在已发布的默认配置中挂载 PTY。

### 推迟的工作

- 全屏 TUI 支持、命名按键序列、BEL 中断、终端 resize 工具和 alternate-screen 快照需要另行验证面向模型的契约。
- 声明式 per-agent 启动需要 agent-setup 组合点；仍然禁止插件加载期全局会话。
- harness 进程丢失后的会话恢复需要进程外 owner 和版本化协议。
- 网络出口策略与外部副作用回滚超出 PTY 范围，继续作为独立安全工作。
- Windows/ConPTY 支持需要具备 Windows 原生进程所有权与信号语义的后端。

## 备选方案

**用 PTY 替换 `bash`、文件系统工具或 task 工具。**拒绝。一次性工具拥有更强的校验、审批、沙箱、输出上限和回放契约。PTY 只服务交互式状态。

**给 `bash` 增加持久模式。**拒绝。按就绪而不是进程退出返回、跨调用保留进程树、暴露交互式 stdin 会形成不同的所有权和失败契约。

**要求从 `node-pty` 获取原生 master fd。**拒绝。它的公共 API 不暴露 master fd。本地后端改为从受支持的 OS 进程元数据推导前台组和 session 成员，并把不可读元数据视为 detector miss。

**发布可替换注册表 `PtyIdleDetector`。**拒绝。只有本地后端需要这些平台 probe，远程后端可能通过自己的协议接收就绪状态。替换后端已经提供所需扩展点。

**新增 PTY 专用 `sleep` 工具。**拒绝。`ctx.tasks` 已经拥有有界等待、取消、完成通知和面向模型的收集。第二套通用唤醒机制会跨越 agent loop（智能体循环）边界并重复该契约。

**在首次交付包含 TUI sequence 与 BEL 处理。**拒绝。源 prototype 将这些路径视为 timing-sensitive，且仍记录未解决的 alternate-screen 和交互失败。行式 PTY 已能证明核心价值，无需把未经验证的行为放进基础层。

**立即采用进程外 daemon。**初始的进程内功能不采用，因为当前持久 front door 已能维持 Cordis context。跨进程恢复或多客户端 attach 会让 daemon 变得合理，但两者都已推迟。

## 验收标准

- `packages/pty/{pty,pty-local,tool-pty}` 分别作为接口、本地实现和模型消费方构建；后端注册可干净 dispose。
- 每个活 PTY 都有一个由服务铸造的 `PtySessionId`、一个确切的 `Agent` owner、按 owner 隔离的操作，并在 agent dispose 时等待清理；并发 agent 可以复用显示名称而不共享状态。
- `dsh-pty-local` 只使用 `node-pty` 公共 API，不包含 master-fd 或 TypeScript `waitpid` 假设。
- 环境测试证明凭证形态的环境变量不存在。缺少提供方时 `sandbox: required` 在加载期失败，REAL-composition 测试证明提供方包装长活会话进程。
- Linux fixture（测试前置数据）覆盖 shell 管道、读取 stdin 的非 leader 进程、读取 stdin 的非主线程、不可读进程内存、受支持的 UAPI syscall 表、不支持的架构和误报拒绝。macOS 进程检查逻辑在 Linux 上达到 100% 覆盖率，macOS CI 驱动真实 bash 与 Python REPL。
- 前台测试覆盖 `stdin_read`、`inferred_idle`、`timeout` 和顶层会话退出，不把前台命令退出当作可直接观察事件。
- 后台发送注册 `ctx.tasks` work、在就绪前返回、通过 `task_output` 流式提供有界输出、遵守 task cancellation，并在 task 对外接口缺失时于写入前失败。
- scrollback 与每个面向模型的结果都对最终 UTF-8 字节执行上限，包括单个超长行和多字节边界情况。
- `pty_signal` 解析活跃前台组，拒绝查询失败和指向 shell 的 `SIGKILL`，且绝不回退到猜测的 PID。
- dispose 测试启动前台与后台子进程，包括忽略信号的子进程，然后证明等待 agent dispose 后每个捕获的进程身份立即消失。
- 测试专用 `cordis.yml` 在 Linux 与 macOS 上通过 Loader 启动，挂载真实本地后端与沙箱，并通过真实工具注册表驱动 spawn/send/read/signal/kill/list。ACP 与 headless 快照固定 6 个 schema、有界结果、错误和 render intent。
- TUI、sequence、BEL、auto-start、Windows 和 crash-restoration 行为不出现在公共 schema 中，并记录为推迟事项，而不是由 fixture 模拟。
- 包 README 与 JSDoc 记录配置、所有权、失败、取消、上限、沙箱、模型可见影响和限制；实现同时更新 `docs/architecture.md` 与生成目录。
- 根 `AGENTS.md` 中的仓库 CI 等价序列通过，包括 `test:coverage`、快照、文档、构建、hygiene 和 built-entry smoke。

## 风险

**Linux Tier 1 之外的 idle 都是启发式结果。**输出静默无法区分 prompt、sleep 和网络 I/O。类型化结果保留不确定性，有界 timeout、task 等待与信号让模型仍能掌握控制权。

**持久状态可能偏离模型认知。**模型可能忘记 cwd 或活跃 REPL。会话摘要和保留输出有助恢复，但任何 prompt 都无法让状态持久化变成确定行为。

**Shell 可以造成外部副作用。**会话沙箱和环境清洗降低本地暴露，但无法撤销 push、API 调用或消息发送。无法容忍这些副作用的部署必须省略 PTY 或增加网络策略。

**进程丢失会销毁终端状态。**进程内会话无法跨 harness crash 或 restart 存活，原始 scrollback 也不持久化。重要工作必须提交到文件或其他持久系统。

**`node-pty` 是原生依赖。**安装、支持的 Node 版本、prebuild 可用性和平台行为都需要在每个支持 OS 上运行 built-artifact smoke。
