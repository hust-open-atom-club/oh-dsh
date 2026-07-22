# Agent Note: 会话持久化作为基于现有 `SessionEvent` 的抽象服务

Status: implemented

[English](2026-06-14-session-persistence.md) | 中文

## 问题

会话此前仅存在于内存中。示例插件 `session-jsonl.ts`（在两个示例中逐字节重复）是只写的遥测：它缓冲 `session/event` 并追加 JSON 行，没有读取/回放路径，没有崩溃安全性（无 fsync、无原子写入、fire-and-forget 的 dispose 排空），没有列表功能，也没有格式版本控制。没有任何机制能将磁盘上的历史会话重新注入到活跃的 agent（智能体）中，因此持久恢复（「继续昨天的任务」）、持久 fork 以及 ACP（Agent Client Protocol）的 `session/load` 方法（[ACP 支持](../feature/2026-06-14-acp-agent-client-protocol.md)）都无法实现。

[事件溯源模型](2026-06-11-event-sourced-sessions.md)将仅追加日志作为唯一真源，并从中派生 LLM（大语言模型）历史。持久化必须忠实于这一设计：直接持久化现有的 `SessionEvent`，不引入需要来回转换的并行「持久化消息」类型。后端也必须可替换——当前用文件存储，以后用数据库存储——统一在一个接口之后。

## 决策

持久化是一个抽象的**能力 seam**（[能力 seam](2026-06-13-capability-seams.md)，`dsh-bash` 模板），而非循环或核心逻辑：

1. **接口**（`dsh-session-persistence`，`ctx.sessionPersistence`）：一个抽象的 `SessionPersistence` 服务，提供 `create`/`append`/`load`/`list`。其持久化单元就是现有的 `SessionEvent`（`{ type, seq, time, data }`），原样复用，无转换类型。
2. **实现**（`dsh-session-persistence-jsonl`）：每个会话一个仅追加的逻辑 JSONL 日志（一行 `SessionHeader`，之后每行一个 `SessionEvent`，逐字节保留，**包括 `assistant/chunk`**），默认编码为[带校验和的 Zstandard 帧](2026-07-19-zstandard-jsonl-session-logs.md)，也可通过配置使用原始行。

以下关键选择记录于此，因为它们是持久性的、有争议的、且出人意料的：

- **规范的持久日志逐字节保留每个 `SessionEvent`，包括 `assistant/chunk`。** `deriveMessages()` 跳过 chunk，而过滤 chunk 的方案（Codex 的 `policy.rs`）很有吸引力，但 `seq = log.length` 以及加载验证 `events[i].seq === i` 要求日志是*连续*的；过滤掉 chunk 会留下空洞，同时破坏契约和恢复功能。基于 chunk 过滤的投影可以作为派生视图在后续实现（带有自己的重新编号），但它不是规范日志。
- **仅追加；崩溃的轮次被关闭，而非截断。** 已刷写的事件永不被重写。[语义检查点策略](../bug-fix/2026-07-21-semantic-session-checkpoints.md)会在模型分发前排空请求、在工具分发前排空已记录的顶层调用，并在步骤结束后排空完整的响应/结果批次；循环则排空最终轮次边界。由于一个被中断的轮次可能包含大量有效工作，`load` 保留其连续、可解析的事件，并为未应答的 assistant 调用追加按风险分类的错误结果、补一个缺失的 `step/end`，以及带 `{ kind: 'interrupted' }` 的 `turn/end`。合成的结果保证恢复后的 provider transcript（文本记录）仍然有效。只有不完整的最后一条记录会被丢弃；在最后一个真实 `turn/end` 处或之前出现解析错误或序号间隙，属于数据损坏，会使该会话不可加载。
- **文件后端为规范实现，数据库后端为经过验证的直接替换。** `SessionEvent` 1:1 映射到一行 `(session_id, seq, type, time, data)`：`append` 是 INSERT（在一个断言连续 seq 契约的事务中），`load` 是 SELECT … ORDER BY seq。`dsh-session-persistence-sqlite` 正是如此：一个 `SessionPersistence` 子类，接口无变化（opencode 在 SQLite/WAL 上运行的正是这个形状），且通过与 JSONL 后端相同的 `runPersistenceContract` 测试套件。该契约以相同的语义约束两个后端（惰性物化、加载时关闭中断轮次、连续 seq），一次表达在文件字节上，一次表达在数据库行上。
- **元数据在日志之外。** 格式版本、cwd 和谱系是存储关注点，不是可回放的对话状态，因此它们存放在 `dsh-session` 拥有的 `SessionHeader` 中，并通过新的只读属性 `session.header` 附加到 `Session` 上——永远不进入 `SessionEventMap`，永远不到达 `deriveMessages()`。替代方案（一个可合并扩展的 `session/meta` 事件作为日志第 0 行）被否决：日志内事件会随 seed/fork 的会话免费携带，但元数据不是可回放状态，因此显式的日志外 header seam 是更干净的代价。（header 最初被拆分为不可变的 `SessionHeader` 加可变的 `SessionSummary`，二者的联合类型为 `SessionMeta`；可变 summary 后来因属于死状态而被移除——见 [移除可变会话摘要](../simplification/2026-06-19-drop-mutable-session-summary.md)。）
- **`ctx.agents.create()` 和 `ctx.agents.resume()` 是异步工厂；resume 还跨越持久化边界。** `ctx.agents.resume({ resumeSessionId })` 等待 `ctx.sessionPersistence.load`，用加载的事件重建活跃会话（使 `lastTurnNumber`/`deriveMessages` 得以延续），并以原样恢复的 id 注册新 agent。agent loop（智能体循环）不会硬注入 `sessionPersistence`（那样会让非持久化的演示永远挂起）；当它不存在时，`resume` 以明确的错误拒绝。

## 曾考虑的替代方案

上述每个关键选择都在陈述处记录了被否决的替代方案：**过滤 chunk 的规范日志**（Codex 的 `policy.rs` 形式）破坏连续 seq 契约；**截断崩溃的轮次**会静默销毁长时间自主运行中的真实工作；**日志内 `session/meta` 事件作为第 0 行**——元数据不是可回放状态；**将 `sessionPersistence` 硬注入循环**会让非持久化的演示永远挂起。

格式版本控制：header 携带一个 `version`；`load` 拒绝任何非当前版本（不做迁移——预发布阶段的会话格式固定为 `SESSION_FORMAT_VERSION = 0` 并吸收形状变动，遵循 AGENTS.md 的预发布立场）。坦率地说：仅追加 + 刷写对部分尾部写入是健壮的（加载时容忍），但对行写入中途的无 fsync 断电不健壮；数据库/WAL 后端是后续更强的选项。

## 后果

新增两个包（package），以及 `dsh-session` 中的元数据 seam（`session.header`，`create(id?, options?)` 签名）。收益：持久恢复/fork、读取/回放路径、崩溃容忍，以及 ACP `session/load`（[ACP 支持](../feature/2026-06-14-acp-agent-client-protocol.md)）所需的基础——全部基于现有的事件溯源日志，后端在一个接口之后可替换。可复用的 `runPersistenceContract` 测试套件以相同的仅追加、连续 seq、惰性物化与可序列化语义约束每个后端。持久化完整日志还确定了事件保真度：`assistant/chunk` 保持逐字节不变。
