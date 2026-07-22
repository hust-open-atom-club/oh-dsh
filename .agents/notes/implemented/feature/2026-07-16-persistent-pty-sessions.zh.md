# Agent Note: 持久化 PTY 会话

Status: implemented

[English](2026-07-16-persistent-pty-sessions.md) | 中文

## 问题

harness 可以运行前台与后台命令、编辑文件和委派工作，但无法跨工具调用延续一次交互式终端对话。每次 `bash` 前台运行都会启动一个新 shell，因此 shell 内的 cwd、导出变量、虚拟环境激活状态、函数、job control 状态和交互式子进程都会随本次调用结束。

这个缺口排除了状态驻留在终端而不是文件中的工作流，例如单步调试 `gdb`、在 Python 或 Node REPL 中探索、驱动 `ed` 这类行式编辑器，或者中断前台命令后回到原 shell。通用的 [`ctx.tasks`](../../../../packages/tasks/README.md) 运行时可以保留后台操作句柄和输出，但不提供交互式 stdin 或终端语义。

现有 `bash`、`read`、`write` 和 `edit` 工具仍是有界、可审计操作的可靠默认选项。PTY 是对确实需要终端状态的工作的补充功能，不说明这些工具有缺陷，更不意味着要移除它们。

## 决策

可选的 `packages/pty/` 功能家族提供由 agent 拥有、持久化且面向行式交互的 PTY 会话。它遵循仓库的 [capability pattern](../../implemented/architecture/2026-06-13-capability-seams.md)，与现有命令和文件系统工具并存，并且不修改 `agent-loop`。

当前实现在 Linux 和 macOS 上支持交互式 shell 与行式 REPL。全屏终端应用、按键序列、BEL 触发的控制流、进程丢失后的会话恢复以及跨 agent 共享会话都明确推迟。

### 包拓扑

| 包 | 角色 | ctx key |
|---|---|---|
| `dsh-pty` | `PtyService`、branded `PtySessionId`、后端注册表、按 owner 隔离的会话契约和结果类型 | `ctx.pty` |
| `dsh-pty-local` | 基于 [`node-pty`](https://github.com/microsoft/node-pty) 的本地后端、平台进程检查、有界终端缓冲、沙箱解析和进程树监管 | 在 `ctx.pty` 上注册后端 |
| `dsh-tool-pty` | 6 个面向模型的工具、后台发送的 task 运行时集成、使用指引和 ACP render intent | 注册到 `ctx.tools` |

idle 检测属于后端行为，不是第二条公共 seam。远程或容器后端可能拥有完全不同于本地 `/proc` 检查的权威就绪信号；因此每个 `PtyBackend` 都返回统一的发送结果，同时在内部拥有自己的检测机制。

### agent 所有权与身份

`PtyService` 在进程内保存活会话，但每个会话都由工具执行上下文传入的确切 `Agent` 拥有。服务铸造不透明的 `PtySessionId`；模型可选填的 `name` 只是显示元数据，仅在该 owner 内唯一。所有操作都以 `sessionId` 为目标，`list`/`read`/`signal`/`kill` 会拒绝 owner 之外的调用方。

实现不提供插件加载期 auto-start 会话。`terminal_open` 只在 agent 工具调用期间创建会话，此时所有权和所属的事件溯源会话都已确定。未来的声明式启动功能必须通过尚未发布的 agent setup 组合，而不能创建全局共享终端。

agent scope dispose 时先关闭注册，再等待全部所属 PTY 静默退出。未发布的后端 setup 同样是受追踪的生命周期操作：owner 或服务 dispose 会中止服务自有的 signal，等待后端结算与回滚完成后才返回。即使后端 reject，或返回的会话在回滚 close 时失败，调用方取消仍会原样保留其 `AbortSignal.reason`；该清理失败不会替换调用方原因，而会继续受追踪，留待后续 owner 或服务 dispose 处理。由 lifecycle dispose 触发的回滚 close 失败会使 spawn 与该 lifecycle dispose 都 reject，而 `PtyBackendCleanupError` 让后端在不替换调用方取消的前提下，为该 lifecycle dispose 保留自身的启动清理失败。若调用方取消先于 dispose 完成结算，该清理失败会继续作为受追踪的 owner activity 保留，直到后续 owner 或服务 dispose 消费并报告它，因此沙箱模式策略不会把清理失败误判为静默。后端或工具插件 reload 不会遗留会话：所有权持续存放在 `PtyService` 中，直到 agent 结束，与 [`ctx.tasks`](../../../../packages/tasks/tasks/README.md) 的服务持有记录模式一致。服务会先同步把会话预留给一次活跃发送，再返回该操作；后台发送同样会在 task id 对外可见前完成预留。第二次发送会以 `SEND_ACTIVE` 失败，因此输出与取消无法跨越操作所有权。

### 安全与进程边界

注册的 `shell` 后端只约束终端如何启动，不约束启动后输入的命令。因此 `dsh-pty-local` 在 spawn 前应用两层保护：

- 它使用与 `bash-local` 相同的凭证形态名称策略构建清洗后的子进程环境，移除环境中的 `*KEY*`、`*SECRET*`、`*TOKEN*` 和 harness 管理的变量，除非显式的可信映射提供这些值。
- 它要求 `ctx.sandbox` 和共享的 `ctx.sandboxPolicy`。后端在 spawn 时，以部署默认值为底折叠 owner 的有效 session mode，并只包装一次 shell argv；该 mode 与 workspace root 在 PTY 的整个生命周期中充当进程边界。只要 owner 有任何已打开的 PTY 或尚未发布的 spawn，任何会改变生效 `sandbox/mode` 的写入都会在提交前被拒绝，并提示先等待创建操作结算，再关闭这些会话；不会改变生效模式的写入仍然有效。这项进行中的预留从后端 setup 持续到发布完成，因此不存在降级后又出现权限更宽的终端这一竞态。`danger-full-access` 是现有的显式无约束选择，不另设 PTY 私有 bypass。

沙箱限制本地进程副作用，但不会让任意 shell 输入自动安全：网络调用和其他外部副作用仍由部署策略治理。工具描述会说明 PTY 会话比一次性工具更难审计，只应在确实需要持久状态或交互式 stdin 时使用。

实现只使用 `node-pty` 的公共功能：子进程 PID、`data` 与 `exit` 通知、`write`、`resize` 和 `kill`。它不假设能访问原生 master fd，也不从 TypeScript 调用 `waitpid`。平台进程检查器在 Linux 上通过 `/proc`、在 macOS 上通过 `ps` 推导前台进程组和父子进程身份。

### 6 个面向模型的工具

| 工具 | 用途 | 结果 |
|---|---|---|
| `terminal_open` | 从已注册的后端类型创建按 owner 隔离的会话 | `{ sessionId, name, type, motd }` |
| `terminal_send` | 发送文本、可选提交 Enter，并等待就绪或注册一个后台任务 | 有界 viewport、等待状态和会话状态；后台模式还返回 `taskId` |
| `terminal_read` | 从保留的 scrollback 读取一个有界页 | `{ text, totalLines, lineBegin, lineEnd, truncated }` |
| `terminal_signal` | 向当前前台进程组发送一种允许的信号 | `{ delivered, targetPgid }` |
| `terminal_close` | 关闭一个会话并等待进程树静默退出 | `{ killed }` |
| `terminal_list` | 列出调用方的活会话 | 按 owner 隔离的会话摘要 |

ACP 渲染契约精确且不携带位置信息。`terminal_send` 只为前台发送使用 terminal 调用卡片和结果卡片；后台形式使用通用 `execute` 卡片。`terminal_open`、`terminal_read`、`terminal_signal`、`terminal_close` 和 `terminal_list` 分别使用通用 `execute`、`read`、`execute`、`delete` 和 `read` 卡片。所有 PTY 工具都不发出 `locations`。

`terminal_send({ sessionId, text, submit?, run_in_background? })` 将 `text` 视为 UTF-8 字节，并由工具实现在解析阶段把 `submit` 默认成 `true`。`submit` 为 true 时先写入文本，再写入平台 Enter 序列；为 false 时只写文本，使控制字符和 REPL 片段无需隐藏的内容启发式即可发送。`enableRunInBackground` 默认为 true；设为 false 时，schema 中会移除 `run_in_background`，调用方即使强行把这个未声明参数传入执行流程，也会被拒绝。

前台发送返回有界的渲染增量和两个独立事实：`waitReason`（`stdin_read | inferred_idle | timeout | session_exit`）与 `sessionStatus`（`running`，或携带退出码或信号的 `exited`）。`session_exit` 指 PTY 顶层 shell 进程退出，不指由 shell 消费状态的任意前台命令。timeout 从不意味着进程已经退出。`dsh-tool-pty.maxResultBytes` 默认为 262144；低于 64 的值会被拒绝，以确保创建确认保留 registry 签发的 id；每个单文本 UTF-8 结果在加入规范化的工具或流水线错误、等待、会话、分页、截断、通用 task 状态包装、策略拒绝或短路以及 post-execute 替换或阻断后，仍受该值限制；终端定义自有的末端 `finalizeContent` callback 会原样保留策略刻意返回的结构化多 block 内容。渲染器会为后缀预留空间并保持代码点边界，而不会把后端载荷上限当作面向模型结果的最终上限。

当 `run_in_background: true` 时，`dsh-tool-pty` 在 `ctx.tasks` 上注册进行中的发送，并立即返回 `taskId`。生产方把 `maxResultBytes` 写入 task 快照，使 `task_output`、kill 返回的终态状态和完成通知在加上通用元数据后，仍对完整结果执行同一上限。`task_output(wait: true)` 负责等待、读取增量输出并记录最终结果；`task_kill` 会解析当前前台 PGID 并发送真正的 `SIGINT`，即使应用已禁用终端 `ISIG` 也同样如此，且后续升级仍只通过 PTY 后端拥有的 teardown 路径进行。若 task 对外接口不存在，后台模式必须在写入输入前失败。设计不新增 PTY 专用的 `sleep` 工具或通用唤醒 seam。

`terminal_read` 从最新保留行向后分页。后端同时对保留的 scrollback 和返回页载荷执行行数与 UTF-8 字节上限，因此单个超长行无法绕过后端上限；工具随后再限制包含分页与截断元数据的完整渲染页。`truncated` 用于区分保留数据丢失与普通 viewport 增量。

`terminal_signal` 接受闭合集 `SIGINT | SIGTERM | SIGKILL | SIGTSTP | SIGHUP`。后端在执行时解析终端前台进程组。当目标组是顶层 shell 时拒绝 `SIGKILL`，并指引调用方使用 `terminal_close`；进程组解析失败时操作直接失败，而不是向猜测的 PID 发送信号。

### 本地就绪检测

本地后端先识别受控 bash 启动时发出的私有 OSC prompt marker，并且只有在该 marker 后出现可打印的 prompt 文本时才据此声明 prompt 就绪；除此之外，它还运行 3 个有界 fallback 层级。在 data callback 之间保留这项状态，可以适配 macOS 分开交付 OSC marker 与 `PS1` 的情况；单独的 marker 不会发布空 MOTD。marker 在输出到达模型前被移除，使两个平台上的普通 shell 命令都无需固定等待静默阈值。尚未发布的 startup 不会把零输出静默视为就绪；timeout 会拒绝 spawn。若调用方取消在 startup 期间胜出，后端会关闭私有会话并原样抛出 `AbortSignal.reason`；尚不可观察的前台 PGID 不会再用查找错误覆盖取消原因。所有时间参数都是经校验的配置字段：`pollIntervalMs`、`exactProbeAfterMs`、`idleSilenceMs` 和 `timeoutMs`。

在 Linux 上，检查器从 `/proc/<shellPid>/stat` 读取 shell 的终端前台 PGID，枚举该进程组中的每个进程与线程，并检查它们当前的 syscall。Tier 1 只有观察到 stdin 等待才返回正结果：直接 `read(0)`、获准读取且含 fd 0 的 `select`/`pselect6` 或 `poll`/`ppoll` 参数，或者含 fd 0 的 epoll interest list。无法读取的进程内存和未识别的 syscall 都是 miss，绝不作为正向猜测。架构表只包含对应 Linux UAPI 定义的 syscall number；不支持的架构跳过 Tier 1。

macOS 没有精确 syscall 层。任何前台进程组输出静默都会返回 `inferred_idle`，包括 Python 和 `gdb`；从 `ps` 推导的终端 PGID 只用于发送信号，不作为「只有 shell 才能 idle」的证明。纯进程检查逻辑可注入并在 Linux 上完成 unit 覆盖率，同时由 macOS CI job 驱动真实 PTY 和进程表路径。

Tier 2 在持续 `idleSilenceMs` 没有输出后返回 `inferred_idle`，因此 sleep 或网络阻塞的命令可能看似 ready。Tier 3 在 `timeoutMs` 后返回 `timeout`，避免前台工具调用无限占住 agent。结果保留这些区别；调用方可以通过 `ctx.tasks` 等待、向前台组发信号，或从另一个会话排查。

`node-pty` data 通知进入同一个终端 parser。parser 的 carry state 会处理跨 callback 的控制序列和位于 callback 末尾的回车；因此，即使 CRLF 被拆开，也只会生成一个换行，而不会产生改变分页的空行。实现会规范化行式输出，但不承诺正确操作全屏应用。

### 模型可见输出与持久性

现有持久化 `tool/call` 与 `tool/result` 事件是模型发送文本和返回给模型的渲染输出的真源。`terminal_open` 通过已记录的工具结果返回 MOTD；前台 `send`/`read`/`list`/`signal`/`close` 结果走同一路径记录。PTY 包不会把原始字节流重复写入自定义会话事件。

后台发送复用现有后台任务完成通知和 `task_output` 结果路径，因此进入后续模型请求的任何输出同样持久化。原始终端字节只作为有界的进程内状态存在，既不持久化也不可恢复。未来的 opt-in transcript sink 必须拥有独立的保留、凭证和隐私契约。

### 进程树 teardown

顶层 `node-pty` 子进程是所有权锚点。关闭时，后端先停止 callback，再按父 PID 以子进程优先顺序捕获其传递子进程、发送 `SIGTERM` 并等待，然后重新扫描关停期间 fork 出的子进程，向剩余子孙进程树发送 `SIGKILL`，并在 shell 仍存活时验证每个非僵尸子孙进程都已离开进程表。身份匹配的 Linux 僵尸进程已无可执行工作，因此视为静止；shell 关闭时会回收它或将其重新挂接给负责回收的父进程。完成这些步骤后，后端才用 shell 自身的 TERM、宽限等待、KILL 序列停止 shell。每个捕获的 PID 都包含进程启动身份，避免 PID 复用把升级信号发给无关进程。

teardown 独立报告根进程退出与存活进程清理。它不会只因 shell 退出就声称成功；dispose 只有在已捕获的进程树中不再存在非静止成员后才完成，否则返回清理失败并列出存活者。失败的 close 不会永久缓存：注册表与本地会话各自仅在关闭围栏仍指向该次失败尝试时才将其清除，因此外部存活进程状态改变后，后续的显式 close 或生命周期 close 会重试，且不会干扰较新的并发尝试。即使某个 close 失败，服务 dispose 仍会清空其后端、预留与 owner detacher 注册表。所有权绝不会扩大到根 PID 所属 POSIX 会话的全部成员。

### 组合与推行

示例组合保持 opt-in，并采用安全默认值：

```yaml
plugins:
  '@deepseek-ai/dsh-sandbox-local':
  '@deepseek-ai/dsh-sandbox-policy':
    config:
      mode: workspace-write
      workspaceRoot: .
  '@deepseek-ai/dsh-pty':
  '@deepseek-ai/dsh-pty-local':
    config:
      scrollbackLines: 10000
      scrollbackMaxBytes: 4194304
      maxReadBytes: 262144
      pollIntervalMs: 50
      exactProbeAfterMs: 150
      idleSilenceMs: 3000
      timeoutMs: 30000
      disposeGraceMs: 3000
  '@deepseek-ai/dsh-tool-pty':
    config:
      enableRunInBackground: true
      maxResultBytes: 262144
```

包提供简洁的工具指引，说明持久状态、owner 隔离、不确定的 idle 结果、清理，以及无需交互时优先使用现有一次性工具。已发布的基础示例不挂载 PTY：PTY 仅通过专用组合 opt-in，ACP 与 headless 快照 overlay 覆盖该组合。`dsh-tool-pty` 实例一旦启用，6 个工具和 `run_in_background` 就会默认启用；部署可通过配置仅禁用后台参数。

### 推迟的工作

- 全屏 TUI 支持、命名按键序列、BEL 中断、终端 resize 工具和 alternate-screen 快照需要另行验证面向模型的契约。
- 声明式 per-agent 启动需要 agent-setup 组合点；仍然禁止插件加载期全局会话。
- harness 进程丢失后的会话恢复需要进程外 owner 和版本化协议。
- 网络出口策略与外部副作用回滚超出 PTY 范围，继续作为独立安全工作。
- Windows/ConPTY 支持需要具备 Windows 原生进程所有权与信号语义的后端。

## 备选方案

**用 PTY 替换 `bash`、文件系统工具或 task 工具。**拒绝。一次性工具拥有更强的校验、审批、沙箱、输出上限和回放契约。PTY 只服务交互式状态。

**给 `bash` 增加持久模式。**拒绝。按就绪而不是进程退出返回、跨调用保留进程树、暴露交互式 stdin 会形成不同的所有权和失败契约。

**要求从 `node-pty` 获取原生 master fd。**拒绝。它的公共 API 不暴露 master fd。本地后端改为从受支持的 OS 进程元数据推导前台组与子孙进程，并把不可读元数据视为 detector miss。

**向根 PID 所属 POSIX 会话的全部成员发送信号。**拒绝。`node-pty` 可能暴露属于启动器会话的 helper PID，因此按 SID 清理可能向无关的 harness 或桌面进程发送信号。带 PID 启动身份校验的子孙进程树范围更窄，其安全边界由结构保证。

**发布可替换注册表 `PtyIdleDetector`。**拒绝。只有本地后端需要这些平台 probe，远程后端可能通过自己的协议接收就绪状态。替换后端已经提供所需扩展点。

**新增 PTY 专用 `sleep` 工具。**拒绝。`ctx.tasks` 已经拥有有界等待、取消、完成通知和面向模型的收集。第二套通用唤醒机制会跨越 agent loop（智能体循环）边界并重复该契约。

**包含 TUI sequence 与 BEL 处理。**拒绝。源 prototype 将这些路径视为 timing-sensitive，且仍记录未解决的 alternate-screen 和交互失败。行式 PTY 已能证明核心价值，无需把未经验证的行为放进基础层。

**立即采用进程外 daemon。**初始的进程内功能不采用，因为当前持久 front door 已能维持 Cordis context。跨进程恢复或多客户端 attach 会让 daemon 变得合理，但两者都已推迟。

## 验证

- 每文件覆盖率固定 owner 隔离、并发预留、未发布 spawn 的取消与等待式 teardown、沙箱模式变更拒绝、可重试的生命周期清理、就绪层级、sanitizer carry state、完整 UTF-8 结果上限、task 集成、schema 和精确 render intent。
- Linux 进程 fixture 覆盖非 leader 与非主线程的 stdin 等待、僵尸进程静止性、不可读进程状态、受支持的 syscall 表、不支持的架构和误报拒绝；同一单元测试套件通过注入覆盖 macOS 检查器逻辑。
- 真实 `node-pty` 测试在受支持宿主上覆盖 shell 状态、共享沙箱策略、环境清洗、raw mode 下的前台 `SIGINT`、忽略 `SIGTERM` 的子进程，以及 dispose 返回后立即静默。
- Loader 驱动的 `cordis.yml` 测试挂载真实三包组合；ACP 与 headless 快照通过 opt-in overlay 固定 6 个 schema、有界结果、错误渲染和 terminal/generic card。
- 包契约、架构图、核心数据结构、生成目录和 website API 描述同一个已发布接口。
- 仓库 CI 等价序列负责类型、lint、覆盖率、快照、文档、构建、hygiene、demo 和 built-entry 验证。

## 后果

**无需削弱一次性工具即可获得持久终端状态。**Shell 与 REPL 状态可以跨工具调用保留，而 `bash`、`read`、`write` 和 `edit` 继续拥有更窄的校验、审批与回放契约。

**Linux Tier 1 之外的 idle 都是启发式结果。**输出静默无法区分 prompt、sleep 和网络 I/O。类型化结果保留不确定性，有界 timeout、task 等待与信号让模型仍能掌握控制权。

**持久状态可能偏离模型认知。**模型可能忘记 cwd 或活跃 REPL。会话摘要和保留输出有助恢复，但任何 prompt 都无法让状态持久化变成确定行为。

**daemonized 子进程可能离开捕获树。**在 teardown 前 reparent 的进程无法再从 `node-pty` 根进程发现。实现接受这个清理缺口，不冒险按 SID 向无关进程发送信号。

**Shell 可以造成外部副作用。**会话沙箱和环境清洗降低本地暴露，但无法撤销 push、API 调用或消息发送。无法容忍这些副作用的部署必须省略 PTY 或增加网络策略。

**进程丢失会销毁终端状态。**进程内会话无法跨 harness crash 或 restart 存活，原始 scrollback 也不持久化。重要工作必须提交到文件或其他持久系统。

**`node-pty` 是原生依赖。**安装、支持的 Node 版本、prebuild 可用性和平台行为都需要在每个支持 OS 上运行 built-artifact smoke。
