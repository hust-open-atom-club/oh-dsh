# RFC: Claude Code 与 Codex subagent 后端（向外部编码 agent 的进程外委派）

Status: proposed

[English](2026-07-07-claude-code-and-codex-subagent-backends.md) | 中文

## 问题

为 Claude Code 和 Codex 添加隔离的 subagent 提供方。既有的[命名提供方 seam](../../implemented/feature/2026-06-21-subagent-capability-seam.md) 和 [ACP 后端](../../implemented/feature/2026-06-22-acp-subagent-backend.md)已确立了进程边界的形状。harness 的一个轮次应能将一个自包含任务委派给上述任一产品，并接收其最终答案，同时不暴露父进程的密钥，也不继承来自 `~/.claude` 或 `~/.codex` 的宿主配置。

## 提案

两个兄弟提供方包（ACP 后端的结构变体），加一次提取：

- `@deepseek-ai/dsh-subagent-claude-code`：通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` 驱动一个 Claude Code 子进程（SDK 在父进程中运行，并将其内置的 `claude` CLI 作为子进程 spawn）。提供方名称为 `claude-code`：子进程是 Claude Code 这个*产品*，而非 Anthropic 模型适配器——"claude" 保留给未来的 `dsh-llm` 适配器。
- `@deepseek-ai/dsh-subagent-codex`：spawn `codex app-server`，通过其 JSON-RPC-over-stdio 协议驱动一个 thread/turn，使用包内一个手写的换行 JSON 客户端（约 200–300 行）。
- `@deepseek-ai/dsh-subagent-process`：纯库（沿用 `subagent-inprocess` 的先例），提取 `dsh-subagent-acp` 已有且两个新后端都需要的内容：凭证环境清洗（`SENSITIVE_ENV_PATTERN`/`buildChildEnv`）、EOF → SIGTERM → SIGKILL 的 dispose 阶梯，以及新的隔离配置目录辅助函数（`mkdtemp` 创建、尽力删除）。ACP 后端迁移到该库上；`bash-local` 的兄弟副本保持不动以限制变更范围。

两个提供方遵循 ACP 后端契约：每次 `start` 创建一个全新子进程、一次 prompt 往返、不继承父上下文也不声明可选能力、忽略 `request.parent` 和 `request.agentOptions`、使用随机的品牌化 agent id。`result` 从不 reject；子进程失败映射为 stop reason，原始错误送入 logger。每个提供方以不同的工具名挂载 `dsh-tool-subagent`。工具结果是唯一新增的模型可见产物，因此无需新的会话事件；工作区变更仍是 transcript（文本记录）回放之外的环境副作用。

## 已验证的接口事实（固定版本）

两个集成面在本提案之前均已针对固定版本进行了验证——阅读类型与打包源码、运行无需密钥的 spike——而非仅依赖厂商文档。固定版本是验证基线，不是运行时契约：后端不执行运行时版本探测（无 `codex --version` 门禁、无 SDK 版本嗅探）。兼容性在开发时强制执行——每次依赖升级都会针对真实加载路径重跑无密钥套件——在运行时则通过大声失败来保障：协议层面的意外通过 `onError` 结算为 `error`，绝不静默异常。

**`@anthropic-ai/claude-agent-sdk` 0.3.202。** `options.env` 会替换子进程环境（不与 `process.env` 合并），恰好满足清洗需求。`settingSources` 默认加载所有文件系统设置——隔离要求显式传入 `[]`。结果子类型为 `success` | `error_during_execution` | `error_max_turns` | `error_max_budget_usd` | `error_max_structured_output_retries`。中止时 SDK 自行升级 CLI 子进程：立即关闭 stdin，约 2 秒后若子进程未退出则发送 SIGTERM（已观察到；无残留进程）——无需自定义 kill 回退。`outputFormat: {type: 'json_schema'}` 和 `agents` 选项已存在，为 seam 的 `outputSchema` 能力和命名 subagent 类型提供了未来着陆点；两者均不在本 RFC 范围内。

**codex CLI 0.142.5，`codex app-server`（v2 词汇）。** LF 分隔的 JSON，JSON-RPC 2.0 形状但省略 `"jsonrpc"` 头。

- 生命周期：`initialize{clientInfo}` + `initialized` → `thread/start`（接受 `cwd`、`model`、`sandbox`、`approvalPolicy`、`ephemeral`；未认证即可成功）→ `turn/start{threadId, input:[{type:'text',text}]}` 立即返回一个 `inProgress` 的 turn；终止信号是携带 `Turn{status: completed|interrupted|failed|inProgress, error}` 的 `turn/completed` 通知。
- 审批是服务端发起的请求——`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval`、`item/tool/requestUserInput`、`mcpServer/elicitation/request`——以 `accept`/`decline` 系列决策应答。
- 认证：`account/login/start{type:'apiKey', apiKey}` 是一等 RPC，`account/read` 报告 `requiresOpenaiAuth`——且未认证的 `turn/start` 不会快速失败（它会挂在重试中），因此后端必须预检认证状态，并在失败时大声结算为 `error`，而非等待 turn。
- 隔离：`CODEX_HOME` 重定向被尊重（`initialize` 响应会回显它，测试可据此断言隔离），`ephemeral: true` 的 thread 不留任何会话文件。

## 隔离与凭证

认证方式仅限 API key。每次运行使用一个全新的配置目录（Claude Code 用 `CLAUDE_CONFIG_DIR` 配合 `settingSources: []`，Codex 用 `CODEX_HOME`），dispose 时尽力删除；配置也可以选择一个持久目录。共享的子进程环境辅助函数转发 `PATH`、`HOME`、`TMPDIR`、locale 和代理设置等普通值，移除凭证形态的名称，并叠加显式的 `config.env`。Claude Code 通过该叠加接收 API key，而 Codex 通过 `account/login/start` 接收，而非手写认证文件。

## 权限与审批策略

每个后端暴露其引擎原生的策略词汇。Claude Code 默认 `permissionMode: default` 配合 `permission: reject`；Codex 默认 `sandboxMode: read-only`、`approvalPolicy: never`，以及相同的拒绝回退。示例可选择启用 `acceptEdits` 或 `workspace-write`。已知的审批、用户输入和 elicitation 请求接收配置的应答；未知方法接收 method-not-found，未知通知被消费。没有 prompt 到达人类，子进程也不会因等待不可用的输入而无限挂起。

## StopReason 映射

Claude Code：`success` → `completed`；`error_max_turns`、`error_during_execution`、`error_max_budget_usd`、`error_max_structured_output_retries` → `error`（与 ACP 对 `max_turn_requests` 的处理对齐：未完成的任务不是成功）；生成器中止 → `aborted`；未知值 → `error`。Codex：`Turn.status` 为 `completed` → `completed`；`interrupted` → `aborted`；`failed` 且 `codexErrorInfo: 'contextWindowExceeded'` → `max-tokens`，其他 `failed` → `error`；传输/spawn/认证预检失败 → `error`（若已请求取消则为 `aborted`）。两者中，`cancel()` 采用 ACP 形状：标志位 + abort/interrupt + 一个 cancel-settled 竞争分支，使不合作的子进程无法阻塞结果。

活性姿态，明确声明：teardown 时序是配置项，turn 时长不是。两个后端将 dispose 阶梯的宽限期作为带默认值的已验证配置字段（ACP 后端的 `disposeEofGraceMs`/`disposeGraceMs` 形状，由提取库承载），但刻意不设 turn 时长或启动超时——与 ACP 一致：turn 期间的活性由调用方通过 `cancel()`/abort signal 掌控，subagent turn 合理地可达数分钟，而 Codex 认证预检消除了唯一已验证的必然挂起场景；需要墙钟上限的部署从父侧取消即可。

## 测试

每个适用层级都要求覆盖：

- **无密钥单元/集成测试：** 通过真实 SDK 驱动一个假 Claude CLI，通过真实协议客户端驱动一个脚本化的 Codex app-server。在逐文件 100% 覆盖率下，验证往返、每种 stop 映射、两条取消路径及预中止、权限策略、未知消息、spawn 失败、reload 清理、导出形状、清洗后的环境、临时目录删除，以及 Codex 认证预检失败。
- **有密钥 e2e 测试：** 每个真实引擎在 `acceptEdits` 或 `workspace-write` 下执行文件操作；跳过时命名缺失的二进制或密钥，并断言无残留子进程。
- **快照测试：** 标记为 `TODO(claude-code-subagent-replay)` 和 `TODO(codex-subagent-replay)` 推迟，等待 [subagent 回放 RFC](../../implemented/testing/2026-06-22-subagent-snapshot-replay.md) 描述的进程特定回放形状。

## 曾考虑的替代方案

### 为什么不用官方 `@openai/codex-sdk` 而手写客户端？

dispose 阶梯和环境清洗要求拥有子进程（spawn 参数、env、信号、exit 等待）；SDK 隐藏了进程。协议格式极其简单（LF JSON），形状可按固定版本生成（`codex app-server generate-json-schema`），仓库先例（`hook-protocol`）是拥有薄协议核心而非包装他人的运行时。SDK 能节省协议演进的维护成本，但代价是失去本后端存在的意义所在的精确控制。

### 为什么不用模型可见的 `subagent_type` 参数（单一 Task 风格工具）？

Claude Code 自身的 Task 工具将 subagent 类型放在模型可见的 schema 中，选择一个 prompt + 工具集人格。这里的选择是在执行引擎之间做出的，而只有部署者知道哪些引擎配置了凭证——因此选择留在部署配置层，保持 `dsh-tool-subagent` 文档中的「一个提供方对应一个工具」契约。人格风格的类型选择器应是针对工具的另一个 RFC，而非针对后端。

### 为什么不用登录态凭证和用户自身的配置？

继承 `~/.claude` / `~/.codex`（订阅登录、用户设置、skill、MCP 服务器）会使子进程行为依赖宿主机状态，并在 ACP 后端和 bash 执行器确立的「凭证通过 `config.env` 显式进入，绝不隐式继承」规则上打开一个隐式例外。仅 API key 加强制配置目录隔离使运行可复现；需要共享状态的部署可以有意将配置目录字段指向一个持久目录。

### 为什么不为 Claude Code 无密钥测试注入驱动层 seam？

注入假的 `query()` 会 mock 我们自己的边界，使真实 SDK 加载路径未被测试（docs/testing.md 中的 real-over-mock 策略）。曾考虑此方案的风险——SDK↔CLI 的 stream-json 控制协议是内部实现——已被 spike 消除：假 CLI harness 今天能对真实固定版本的 SDK 正常工作。如果 SDK 升级破坏了 mock，无密钥套件会让升级 PR 失败，这正是门禁在发挥作用。

### 为什么不用 ACP 适配器（如 `claude-code-acp`）复用既有后端？

社区 shim 将两个引擎包装为 ACP，这会使它们在 `dsh-subagent-acp` 上变成「仅配置」。但这在 harness 与引擎之间插入了一个非官方的第三方层，抹去了本 RFC 暴露的原生控制面（permissionMode、sandboxMode/approvalPolicy、配置目录隔离、apiKey RPC），并以 shim 的发布节奏替换了第一方协议的稳定性。第一方接口——Agent SDK 和 app-server——才是受支持的集成点。

## 验收标准

在两个引擎和密钥均已配置的机器上：一个 REPL 驱动的模型通过 `subagent_claude_code` 完成一个真实文件任务，通过 `subagent_codex` 完成另一个，工具结果为子进程的最终答案，父会话日志中仅有 `tool/call` + `tool/result`。无密钥套件在无凭证环境下以逐文件 100% 覆盖率通过，断言隔离（清洗后的子进程环境、dispose 后无残留临时配置目录），并断言 `~/.claude` / `~/.codex` 的存在与否不影响子进程行为。取消父轮次后，两个后端在有界时间内静默，无残留子进程。e2e 套件干净地自跳过，命名缺失的前置条件。

## 风险

- `codex app-server` 被 CLI 标记为实验性，其 v1/v2 词汇共存；客户端固定 0.142.5、仅实现 v2、对未知方法/通知消费而不崩溃，但未来 codex 升级仍可能迫使返工（每次升级重新生成 schema 并重跑无密钥套件——这是上述「不做运行时版本探测」立场背后的开发时强制执行）。
- Claude Code 假 CLI mock 依赖一个内部协议：任何 SDK 升级都必须通过无密钥套件，控制协议的破坏性变更意味着返工 mock（回退方案：上面否决的驱动注入 seam 成为逃生舱口）。
- SDK 的 optionalDependencies 每平台约 280MB——已接受，限制在单个后端包内。
- SDK 的 SIGKILL 分支（EOF→SIGTERM 之后）未被观察到，信任其实现；e2e 保留无残留进程断言。
- Codex 是部署前置条件（无 npm 内置二进制）；缺失或不兼容的二进制以大声的 spawn/协议 `error` 呈现，而非版本探测。
- 每次运行付出一个全新子进程的代价，且仅最终答案浮出——思考、工具卡片和用量被消费后丢弃；连接池、中间进度浮出、`sendMessage`/`resume`、通过 SDK 的 `outputFormat` 实现 `outputSchema`、以及通过 SDK 的 `agents` 选项实现命名 subagent 类型，均为刻意推迟。
