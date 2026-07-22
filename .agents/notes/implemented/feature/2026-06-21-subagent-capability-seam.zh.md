# RFC: Subagent 能力 seam

Status: implemented

[English](2026-06-21-subagent-capability-seam.md) | 中文

> 完整 seam 已交付：`dsh-subagent` 接口、`dsh-subagent-mock` 测试后端与 `dsh-tool-subagent` 消费方；两个进程内后端（`dsh-subagent-spawn`、`dsh-subagent-fork`）；嵌套 agent 快照基础设施（[逐会话快照回放](../testing/2026-06-22-subagent-snapshot-replay.md)）；以及进程外后端 `dsh-subagent-acp`（[其 RFC](2026-06-22-acp-subagent-backend.md)）。

## 问题

harness 有一个长期搁置的 seam 用于 **subagent**：一个 agent（智能体）将工作委派给另一个 agent。这一意图在 `Agent`/`AgentLoop` 接口中已有草案（[packages/core/agent/src/types.ts](../../../../packages/core/agent/src/types.ts)、[packages/core/agent-loop/src/index.ts](../../../../packages/core/agent-loop/src/index.ts)）：一个创建选项引用父 agent（fork = 用父会话的事件日志初始化子会话；spawn = 全新会话），子 agent 以 `Agent` 句柄返回，使 steering（中途引导）和事件订阅可以统一工作。本 RFC 实现了这个 seam；上方横幅列出了已交付的内容。

决定整体设计走向的核心需求是：**多种 subagent 实现必须在运行时共存**。一个父 agent 可能在同一个会话中既需要一个廉价的进程内子 agent 处理有限范围的子任务，又需要一个隔离的进程外子 agent（通过 ACP（Agent Client Protocol））。我们预见的传输方式：

- **进程内**：在同一个 `Context` 上创建子 `ReactLoopAgent`（最廉价，且鉴于现有 agent 工厂几乎零成本）；
- **ACP**：作为 ACP *客户端*驱动另一个 agent 进程（可以是自身的另一个实例）；
- 后续：**A2A**、**Codex app-server** 与 **Claude Code Agent SDK**——每种都与 ACP 后端相同的进程外形状：「启动子 agent、发送提示词、流式接收更新、取消」。

## 曾考虑的替代方案

### 为何不采用 bash seam 的形状

bash seam（[能力 seam](../../implemented/architecture/2026-06-13-capability-seams.md)）在每个 context 中只注册恰好一个 `BashExecutor`；加载第二个会抛异常。这对 bash 是正确的（一台机器、一种执行命令的方式），但对这里是错误的：共存才是需求。因此 subagent 服务是一个**命名提供方注册表**——每个实现以唯一名称注册，调用方按名称选择——镜像 **LLM（大语言模型）适配器注册表**（`LlmService.registerAdapter`），而非单服务的 bash 执行器。seam 仍然是由三个包构成的结构（接口 / 实现 / 消费方）；只是「一个 vs. 多个实现」这个维度不同。

## 决策

### 由三个包构成的 seam

新建包（package）组 `packages/subagent/`：

| 包 | 角色 |
|---|---|
| `@deepseek-ai/dsh-subagent` | 接口：`SubagentService`（`ctx.subagents`）、`SubagentProvider`、`SubagentRun`、请求/结果/能力词汇、`subagent/*` 事件 |
| `@deepseek-ai/dsh-subagent-spawn` | 实现：通过 `ctx.agents.create` 创建全新的进程内子 agent |
| `@deepseek-ai/dsh-subagent-fork` | 实现：用父 agent 日志快照初始化的进程内子 agent |
| `@deepseek-ai/dsh-subagent-acp` | 实现：作为 ACP 客户端驱动已配置的子进程 |
| `@deepseek-ai/dsh-subagent-mock` | 辅助：用于通过真实加载路径测试 seam 的脚本化提供方 |
| `@deepseek-ai/dsh-tool-subagent` | 消费方：基于 `ctx.subagents` 的面向模型的 `subagent` 工具 |

### 原语：异步 `start → SubagentRun`

提供方暴露 `start(request) → Promise<SubagentRun>`。完成时发布一个就绪的子 agent 并将其运行句柄转交给调用方。一个信号覆盖就绪前后的取消；`dispose()`（资源释放）取消剩余工作并等待静止。启动失败时清理部分资源，不发出生命周期事件。`start` 与传输方式无关；`spawn` 仅指代全新的进程内后端。

### 两类可选能力，两种发现方式

- **启动时特性**（`outputSchema`、`depthLimit`、`toolFilter`、`persona`）挂在静态的 `provider.capabilities` 描述符上。服务在委派之前检查每个被请求的特性，如果提供方不支持则**大声拒绝**（`SubagentError('UNSUPPORTED_CAPABILITY')`），绝不接受后静默忽略。这些特性必须在 run 存在之前检查，因此不能是运行时方法。
- **运行时特性**（通过 `sendMessage` 进行 steering、通过 `resume` 进行后续对话）是 `SubagentRun` 上的**可选方法**。方法的存在本身即为能力，TypeScript 类型收窄即为发现机制：消费方不经收窄就无法调用不存在的方法，因此不存在静默降级路径，也不需要额外的 flags 对象来保持同步。

### Fork 与 fresh 是独立后端，而非一个 flag

全新子 agent 与 fork 子 agent 是独立的提供方，而非请求中的一个 flag。`dsh-subagent-spawn` 启动隔离的子 agent；`dsh-subagent-fork` 用一个平衡前缀初始化子 agent，该前缀仅包含已完成的父轮次。进行中的轮次被排除，因为其 subagent 调用尚无结果，无法构成有效的回放历史。

### 子 agent 隔离与父日志

每个 subagent 运行在**自己的 `Session`** 中（独立 id、`parentSession` 谱系），独立持久化。父日志仅记录 spawn `tool/call` 及其 `tool/result`（子 agent 的最终输出）——子 agent 的内部步骤和工具调用留在子 agent 自己的会话中，绝不注入父日志。这是唯一在所有传输方式下行为一致的设计：ACP 子 agent 的内部事件在物理上无法注入我们的父日志，因此让进程内行为保持一致，使 seam 真正与传输方式无关。

### 同步收集（首版）

`dsh-tool-subagent` 将其执行信号传给 `start()`，等待子 agent 结果，并在 `finally` 中 dispose 该 run。非完成态的结果变为错误结果，而非成功的部分输出。这个前台消费方不使用 run 的可选 steering 方法。

### 提供方选择是配置，不面向模型

`dsh-tool-subagent` 绑定到恰好一个提供方名称（`Config.provider`）；模型只看到 `{ description, prompt }`。若要暴露多种传输方式，请多次加载该工具插件，每次绑定不同的提供方和不同的 `toolName`（工具注册表拒绝重名）。*服务*持有多提供方注册表；*工具*选择其中一个——本版 schema 中没有 provider/type 参数。

## 测试

seam 通过真实的 Cordis Loader/export 路径测试，这能捕获[事后分析 0001](../../../postmortem/0001-acp-default-export-drops-inject.md) 中描述的 export 形状错误。注册表测试覆盖重载安全性、重名和启动时能力拒绝；嵌套 agent 场景通过[逐会话快照回放](../testing/2026-06-22-subagent-snapshot-replay.md)进行无密钥回放；进程内后端还有真实循环的单元测试和带密钥的 e2e 测试。

## 后果

- **递归。** 如果不设限制，进程内子 agent 能看到委派工具并递归调用。进程内后端实现了可选的绝对深度限制和有作用域的实时全局 `toolFilter`；ACP 声明这两项能力为关闭状态，并拒绝此类请求。[subagent 组合控制 RFC](2026-07-12-subagent-persona-tool-filter-and-depth.md) 负责定义它们的确切语义和安全边界。
- **阻塞父轮次。** 同步收集在子 agent 的整个持续时间内保持父 agent 的 `runStep` 打开。这对首版是可接受的；**后台 / 轮询 / 溢出语义推迟到未来的重新设计，该设计将统一 subagent 和 bash 的长时间运行工具处理**（一个 subagent 和一个长时间运行的 `bash` 后台任务面临相同的问题——「模型启动了一个慢操作，之后如何收集结果」——应共享一套机制，而非各自发明）。
- **实时进度。** 本版仅暴露生命周期事件与最终结果；逐分片的子→父更新流推迟到后台重新设计时一并处理。
- **ACP 客户端接口。** 将 ACP 子 agent 的 `fs`/`terminal` 代理回父 agent（共享工作区模式）是后续工作；首版不声明这两项能力，子 agent 在自己的进程中自行服务。
