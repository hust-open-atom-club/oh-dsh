# RFC: 审批 seam——基于 waterfall（瀑布式事件）应答者的一次性权限决策

Status: implemented

[English](2026-07-06-approval-seam.md) | 中文

## 问题

两个调用方需要向人类提出同一个问题——「这个具体操作可以继续吗？」：`tools/pre-execute` 的 `ask` 决策（包括 Claude-Code 钩子桥的 `permissionDecision: ask`）以及[沙箱 RFC](2026-07-06-sandbox.md) 中拒绝后的一次性升级重试。一个共享的 seam 使它们无需各自发明独立的结果词汇、UI 路由、取消机制和审计轨迹，同时保证没有 UI 的部署永远不会批准一个无法应答的请求。

路由问题的核心是归属：审批提示必须到达拥有发起请求的 agent（智能体）的编辑器会话（ACP（Agent Client Protocol）桥在一条连接上多路复用 N 个会话），对无人拥有的 agent（进程内 subagent、测试）失败关闭，并且不侵入没有组合 UI 的部署（headless、CI）。

## 决策

一个包 `dsh-user-approval`（`packages/ui/user-approval`），拥有词汇表和 `ctx.approval` 服务——即机制。策略——谁来应答、某个会话是否需要被询问——不在其中：应答者是 `approval/request` waterfall 监听器，由拥有通道的插件注册（ACP 桥、未来的终端 UI、测试脚本），而每会话的策略层可以在任何人类介入之前做出决定。消费方（`dsh-tools` 的 ask 路由、沙箱升级门禁）将问题解析为一个封闭结果，并从中派生各自的工具结果。刻意设计为一个包，而非能力 seam 的三包拆分（见「替代方案」）。

### 部署如何使用它

一条 `cordis.yml` 条目挂载该 seam。不加载它就是失败关闭的退出方式：消费方在没有注册任何审批代码的情况下拒绝无法应答的请求。

```yaml
- id: approval
  name: '@deepseek-ai/dsh-user-approval'
  # config:
  #   policy: never   # deployment default for sessions without an override; 'ask' when omitted
```

仅有这条条目只提供机制，不提供通道：没有组合应答者时，每次 ask 都解析为 `unavailable`，发起请求的工具调用被拒绝——失败关闭无需配置。组合 ACP 应用（`@deepseek-ai/dsh-acp-demo`，如 [acp-agent 示例的默认树](../../../../examples/acp-agent/README.md)）即可闭环：其桥注册一个应答者，通过 `session/request_permission` 向拥有该会话的编辑器发出提示，于是钩子的 `ask` 或升级请求会以一次性 Allow/Reject 提示的形式呈现，附着在已流式输出的工具调用上。`policy: never` 是无人值守姿态：每次 ask 确定性地自动拒绝，在系统提示词中声明，无人类参与。`policy` 在插件加载时对照封闭列表校验；非法值直接抛异常。

组合部署的可观测行为：`allowed-once` 仅允许该次调用继续；拒绝、关闭和通道缺失以三种不同原因拒绝，模型可以区分；每次 ask 在发起请求的 agent 的会话日志上落一对持久的 `approval/asked`/`approval/decided` 事件；授权不会在发起请求的调用结束后继续存在。

以下是该组合下的一次 ask，逐字取自沙箱示例录制的 `escalation-approved` 场景——模型请求沙箱升级，门禁发起 ask，桥向拥有该会话的编辑器发出提示，用户点击 Allow once：

```
tool/call        bash {"command": "printf 'escalated\n' > escalated.txt && cat escalated.txt",
                       "sandbox_permissions": "workspace-write",
                       "justification": "the user asked to write escalated.txt in the workspace"}
approval/asked   {"toolName": "bash", "callId": "call_00_…",
                  "reason": "escalate sandbox to workspace-write: the user asked to write escalated.txt in the workspace"}
  → session/request_permission {"toolCall": {"toolCallId": "call_00_…"},
                  "options": [{"optionId": "allow-once", "name": "Allow once", "kind": "allow_once"},
                              {"optionId": "reject-once", "name": "Reject",     "kind": "reject_once"}]}
  ← the user picks "Allow once" on the prompt the editor attaches to the streamed bash call
approval/decided {"outcome": "allowed-once"}
tool/result      "escalated" — this one call ran under the wider mode; the grant died with it
```

`escalation-rejected` 孪生场景以 `{"outcome": "rejected"}` 结束：不执行任何操作，模型的结果携带发起方的逐字失败关闭文本（`the user rejected escalating this command to "workspace-write"`）。钩子的 `permissionDecision: ask` 走完全相同的协议；只有发起方和拒绝文本不同（§ dsh-tools 中的 Ask 路由）。在 headless 环境下，同一请求完全跳过提示，直接结算为 `unavailable`。

### 设计细节

#### seam：机制与策略分离

经过校验并追加 `approval/asked` 后，`request()` 解析为 `allowed-once`、`rejected`、`cancelled` 或 `unavailable`。服务借用只读请求，运行应答者 waterfall，与取消竞速，并将抛出异常或无效应答规范化为 `unavailable`。然后追加匹配的 `approval/decided`，以 `ApprovalRequestId` 配对。

两个审计事件都必须在一个打开的轮次内；接受或预提交追加失败会拒绝该请求。提交后的观察者由会话容纳。`allowed-once` 仅授权所请求的操作，服务不保留任何授权状态。

应答者是 `approval/request` waterfall 监听器。监听器为它拥有的 agent 返回结果，否则调用 `next()`。没有应答者时默认为 `unavailable`；因此卸载 UI 即失败关闭，不会留下悬空通道。由于兄弟插件的注册顺序不确定，部署应组合一个终端应答者，仅对「先决策或委派」门禁使用 `prepend`。

`ApprovalRequest` 携带 agent、工具名、可选的 `callId`、原因和 signal。agent 同时路由提示和审计事件。请求使用 `dsh-llm` 的 `CallId` 而不导入 `dsh-tools`，避免包循环。工具参数被省略，因为 UI 应答者附着在已渲染的调用上。

#### dsh-tools 中的 Ask 路由

`ToolRegistry.execute()` 在进入拒绝路径之前，将 `ask` 发送到审批 seam。只有 `allowed-once` 才继续执行；拒绝、取消和通道不可用产生三种模型可见的不同原因。注册表按调用查找可选服务，因此服务缺失或未加载时失败关闭，不会阻塞注册表 fiber。无 agent 的执行同样失败关闭，因为无法路由或审计。

#### 每会话策略层

seam 拥有会话策略 `'ask' | 'never'`，遵循[沙箱 RFC](2026-07-06-sandbox.md) 中的切换契约。生效的会话或配置策略在应答者之前应用：`'never'` 在 `request()` 内部直接拒绝，`'ask'` 则派发请求，无人应答时降级为 `unavailable`。提示词仅声明确定性的 `'never'`；叙述者报告切换，每个请求仍收到其审计对。

#### ACP 应答者

ACP 桥找到拥有该会话的编辑器，为该 `callId` 发送 `session/request_permission`，并将一次性 allow、reject、cancel 响应映射到 seam 词汇。未知选项永远不授权。外部 agent 和没有 `callId` 的请求通过 `next()` 委派；RPC 失败变为 `unavailable`。桥应答请求，但不决定哪些调用需要审批。

应答者通过 [ACP 支持 RFC](../../implemented/feature/2026-06-14-acp-agent-client-protocol.md) 描述的桥反向映射归属 seam 进行路由，实现了[多会话 RFC](../../implemented/feature/2026-06-14-acp-multi-session.md) 要求的每会话权限归属。

#### 审计，以及模型看到什么

`approval/asked` 和 `approval/decided` 是持久的仅日志事件。模型只看到发起方派生的已记录 `tool/result`。每个被接受的请求追加一条匹配的决策，包括取消和被容纳的应答者失败。

#### 实体与依赖

`dsh-user-approval` 拥有固定的派发与审计机制；`dsh-tools` 发起请求，`dsh-acp` 应答。可替换的应答者作为监听器留在其通道拥有者插件中，因此三包能力拆分只会多出一个空的实现层。沙箱执行器仍然只负责传输，静态能力授权与交互式审批保持分离。

### 测试

- **单元/集成测试：** 覆盖先到先得的委派、失败关闭默认值、畸形和抛异常的应答者、取消竞速与迟到应答丢弃、观察者失败时的审计配对、不可绕过的 `'never'`、不同的工具拒绝原因，以及 ACP 每会话路由/结果映射。
- **快照测试：** 对沙箱升级的两个分支编排权限应答并固定 `'never'` 提示词加策略切换通知。无组合应答者时钩子产生的 ask 仍作为失败关闭拒绝被覆盖。

## 延后

- **`allow_always` 授权存储**：兑现持久授权意味着设计存储、作用域标识（调用？路径？前缀？会话？时间窗口？）和撤销；在设计完成之前，只展示一次性选项（[沙箱 RFC](2026-07-06-sandbox.md) § Escalation 记录了开放的作用域问题）。
- **有组合应答者时录制的钩子产生的 ask**：升级场景录制了人类提示的协议格式（wire format），而当前钩子 fixture（测试前置数据）固定的是无服务拒绝；二者组合的生产者/应答者路径仍由单元测试覆盖。
- **将子 agent 的审批路由到父会话**：`subagent-acp` 的子侧自动应答自己的 `permission` 请求；将其呈现给父会话的编辑器是独立的设计。

## 曾考虑的替代方案

- **单一注册提供方而非 waterfall 监听器**：否决。`registerProvider()` 接口迫使所有组合问题——允许列表预过滤、外部钩子决策者、脚本化测试应答、人类前面的策略门禁——都塞进一个提供方实现。waterfall 从运行时已有的机制中获得组合能力、缺失时失败关闭和 HMR（热模块替换） dispose（资源释放）；seam 的 JSDoc 以约定固定单决策槽语义，而非发明一个提供方注册表。
- **在 ACP 桥中内联 `tools/pre-execute` 权限门禁**：否决。对桥拥有的每次调用都弹出提示，会将请求策略硬编码进 UI 插件，无法服务第二个发起方（沙箱升级发生在执行开始之后，没有 pre-execute 时刻），且钩子产生的 `ask` 决策没有共享机制。
- **通用用户交互 seam（`ctx.userInteraction`）**：否决作为审批机制。二者骨架相似（按 agent 路由、阻塞等待人类、处理缺失），但审批的契约在每个关键维度上都更窄：封闭的结果词汇而非自由文本、附着在工具调用上的协议原生提示而非通用表单、强制的缺失时失败关闭、以及审计事件。因此审批不走已交付的 `packages/ui/user-interaction` / `ask_user_question` 引出路径——引出表单不是权限提示，自由文本应答不是封闭结果；如果二者将来趋同，共享提供方管道仍然开放。
- **`dsh-tools` 中的静态可选注入**：否决。vendor 的 Cordis `Inject` 类型没有 optional 标志——对象形式将服务名映射到拦截配置，声明的 inject 会阻塞 fiber。`ctx.get('approval')` 是文档化的机会性消费模式（`tool-bash` 的 owner-token 查找、loop 的持久化探测），按调用读取存在性，跨 HMR 正确降级，无需额外机制。
- **能力 seam 的三包拆分**：否决。接口/实现/消费方适合实现可替换的 seam（bash-local vs bash-sandbox）。此处服务体是固定机制，可变部分是留在各自通道拥有者插件中的监听器——拆分只会制造一个空的实现包（「不要预防性拆分」）。
- **现在就提供 `allow_always`**：否决。协议能表达它，但兑现它意味着设计授权存储、作用域标识和撤销（§ 延后）。展示 harness 无法兑现的选项只会制造注定失败的授权。

## 后果

- 只有 `allowed-once` 才会派发被询问的操作；缺失、拒绝、取消或应答失败的路径一律拒绝。
- 会话归属路由提示、策略和审计事件，不跨越编辑器会话。
- 被接受的请求追加一对持久审计事件；模型只看到最终的工具结果。
- 没有该服务的部署不产生审批提示或审计事件，在工具边界拒绝每一个 `ask`。

代价与已接受的局限：

- **两个急于决策的应答者竞争同一槽位。** 兄弟插件的监听器顺序不确定，seam 无法仲裁竞争的终端应答者。通过约定缓解（每个部署一个终端应答者；仅对「先决策或委派」门禁使用 `prepend`），而非事件总线不具备的优先级机制。
- **生产环境验证依赖单一组合。** `ask` 有两个生产者家族——钩子桥通过 `tools/pre-execute`，沙箱升级通过自己的门禁——协议格式录制在沙箱示例的快照套件中；因此在更多部署组合它之前，seam 的真实覆盖面就是这一种组合。
- **归属以 `Agent` 对象标识为键。** 应答者通过桥已有的 WeakMap 解析会话；当前所有路径在 loop 和各 seam 之间传递同一对象，但未来如果某个边界克隆或代理了 agent，桥会委派并失败关闭——安全，但静默无 UI——届时需要改用 session-id 匹配。

## FAQ

- **在完全没有应答者的部署中（headless、CI）会发生什么？** 每次 ask 穿过空的 waterfall 降级为 `unavailable`，工具调用以「no approval channel is available」原因被拒绝。失败关闭是零监听器的默认行为，不是配置。
- **授权能持久化吗——「始终允许」？** 不能。`allowed-once` 仅授权单次被询问的操作，服务在请求之间不存储任何内容；`allow_always` 在授权存储设计完成之前刻意不展示（§ 延后）。
- **模型看到审批的什么？** 只看到发起方从结果派生的工具结果——审计对永远不进入 transcript（文本记录）。三种非授权原因各不相同，模型可以区分人类说「不」、提示被关闭、通道缺失。
- **谁决定一次调用是否需要 ask？** 策略生产者：返回 `permissionDecision: ask` 的钩子、任何 `tools/pre-execute` 监听器、或沙箱升级门禁。seam 和桥只负责路由和应答；二者都不注入自己对「什么值得弹出提示」的判断。
- **用户关闭提示或轮次在 ask 进行中中止时会发生什么？** 关闭映射为 `cancelled` 并携带自己的拒绝文本。已中止的 signal 直接结算为 `cancelled` 而不派发；ask 进行中的中止丢弃迟到的应答——无论哪种情况都恰好一对审计事件，绝不会两对。
- **如果客户端以 harness 从未提供的选项应答呢？** 除已提供的 `allow_once` 之外的任何选项都映射为 `rejected`——来自不合规客户端的未知 optionId 永远不能授权。
- **subagent 的审批如何路由？** 没有应答者拥有的 agent 穿过整个 waterfall 委派并失败关闭——进程内 subagent 被刻意设计为不可应答。`subagent-acp` 的子侧自动应答是独立的；将子 agent 的 ask 路由到父会话的编辑器已延后（§ 延后）。
- **`policy: 'never'` 在运行时实际改变了什么？** 服务在派发任何应答者之前，将该会话的每次 ask 解析为 `rejected`（在服务内部，因此没有注册顺序能绕过它）；系统提示词声明该策略；切换在边界处被叙述；每次自动拒绝仍落一对审计事件。
- **热重载或 UI 插件在会话中途卸载时会发生什么？** 应答者随其拥有的 fiber 一起 dispose，因此下一次 ask 降级为 `unavailable` 而非挂在死通道上；重新挂载会重新注册应答者，无需追赶状态。
- **用户在哪里看到自己在批准什么？** 在工具调用本身：提示通过 `callId` 附着在已流式输出的调用上（包含参数），并添加发起方的人类可读 `reason`；请求本身不携带参数副本。

## 先例

本设计复用或对照的仓库内先例：

- `fs/write-intent` 门禁（`packages/fs/fs/`）——文档化的单占用决策槽 waterfall 语义（先到先得，通过 `next()` 委派），应答者契约复用了它。
- `hook/invoked`/`hook/result`——仅日志审计对先例，`approval/asked`/`approval/decided` 沿用了它；[钩子桥 RFC](2026-06-30-hook-bridges.md) 交付了 `permissionDecision: ask`，即第一个生产者。
- [拦截 seam RFC](2026-06-30-interception-seams.md)——`tools/pre-execute` 的 `allow`/`deny`/`ask` 词汇，本 seam 服务其中的 `ask`。
- [ACP 支持 RFC](../../implemented/feature/2026-06-14-acp-agent-client-protocol.md)——应答者路由所经过的 `WeakMap<Agent, sessionId>` 归属 seam；[多会话 RFC](../../implemented/feature/2026-06-14-acp-multi-session.md)——本设计实现的每会话权限归属阻塞项。
- 机会性 `ctx.get()` 消费模式（`tool-bash` 的 owner-token 查找、loop 的持久化探测）——`dsh-tools` 消费该 seam 而不阻塞其 fiber 的方式。
