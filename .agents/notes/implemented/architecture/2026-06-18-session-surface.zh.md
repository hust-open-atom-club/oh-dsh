# RFC: 会话 surface——基于事件日志的链表，用于 LLM 消息派生

Status: implemented

[English](2026-06-18-session-surface.md) | 中文

## 问题

事件日志是权威数据源，但历史操纵此前没有持久化的共享机制。如果没有这样的机制，上下文压缩（context compaction）等插件只能通过顺序敏感的监听器改写派生请求，不留溯源信息，且每次新增操纵都要反复修改 `deriveMessages()`。

## 决策

新增一个 **surface**：一条派生的、缓存的链表，由「surface 节点」（事件中产出 LLM（大语言模型）消息的子集）组成，通过事件日志中的 `surfaceOp` 标记维护。

### `SessionEvent` 新增两个顶层字段

每个 `SessionEvent` 获得两个可选字段（结构性元数据，与 `seq`/`time` 同级）：

- **`sourceEventSeqs?: number[]`**：作为溯源来源的事件 seq 编号（例如构成 `assistant/message` 的各 `assistant/chunk` 的 seq，或被压缩标记遮蔽的 surface 节点）。溯源是核心设计原则；没有它，replace-range 操作在回放时无法被验证。
- **`surfaceOp?: SurfaceOp`**：该事件如何进入 surface。非 surface 事件不携带此字段。

### SurfaceOp：两种操作

```ts
export type SurfaceOp =
  | 'append'                                    // normal tail append
  | { op: 'replace'; start: number; end: number }  // shadow [start, end] inclusive
```

1. **Append**：在尾部追加一个新节点。`user/message`、`assistant/message`、`tool/result`、`context/message`、`steering/message` 使用此操作。agent loop（智能体循环）在所有此类追加上传入 `surfaceOp: 'append'`，并在适用时附带 `sourceEventSeqs`（例如 `assistant/message` 记录其 `assistant/chunk` 来源；`tool/result` 记录其 `tool/call` 来源）。

2. **Replace**：移除从 `start` 到 `end`（两端包含）的节点，并在其位置插入一个新节点。`start` 和 `end` 都必须是当前 surface 上有效的 surface 节点 seq；`start === end` 表示替换单个节点。该节点的 `sourceEventSeqs` 必须包含所有被遮蔽的 surface 节点。被遮蔽的事件仍留在日志中，但不再出现在 surface 上。

### SurfaceManager：基于增量，而非全量重建

`SurfaceManager` 类（`Session` 私有）维护缓存的链表。它跟踪 `_lastProcessedSeq`，仅处理**增量**（自上次访问以来的新事件），而非重新扫描整个日志。由于日志是仅追加的，先前的事件不会改变；种子日志只是在首次访问时折叠的初始增量。

无新事件时增量处理为 O(1)，有新事件到达时为 O(新事件数)。

`deriveMessages()` 在存在 surface 标记时使用 surface，对没有标记的会话回退到既有的线性扫描（向后兼容）。

### 持久化

新字段作为顶层 JSON 属性序列化。JSONL 后端无需任何改动：`JSON.stringify`/`JSON.parse` 透明地保留一切。SQLite 后端的 `events` 表新增两个可空 TEXT 列（`source_event_seqs`、`surface_op`）。磁盘上的 `SCHEMA_VERSION` 递增以反映列集变化，并且按照预发布的 bump-and-reject 策略，由其他构建写入的数据库在打开时被拒绝而非迁移（没有需要升级的持久化用户数据）。会话格式 `version` 固定为 `SESSION_FORMAT_VERSION = 0`（「不稳定/预发布」立场）：可选的 surface 字段被吸收而不递增版本号。

### 崩溃恢复

`repair.ts` 模块在崩溃后为孤立的工具调用合成 `tool/result` 闭合事件。这些闭合事件携带 `surfaceOp: 'append'` 和指向孤立 `tool/call` 事件的 `sourceEventSeqs`，确保重建的 surface 有效。

### 不变式

开发模式下的不变式插件验证：`sourceEventSeqs` 引用（非空、无重复、引用更早的事件、引用已知 seq）以及 `surfaceOp`（replace 的 `start ≤ end`、两个端点都在被跟踪的 surface 上、范围在 surface 位置上不反转、`sourceEventSeqs` 包含该范围遮蔽的每个节点）。

每个 surface 可达事件都必须携带 `surfaceOp`，否则它将从派生历史中消失。类型化的 `append` 重载对字面事件类型强制执行此规则；`append` 和种子构造函数中的运行时检查覆盖宽化联合类型和加载的日志。按照预发布格式策略，无效的种子被拒绝而非升级。

## 曾考虑的替代方案

- **逐插件的 `agent/request` 包装**（surface 之前的历史操纵模式）：监听器排序脆弱、无法持久记录改动内容，且每种新操纵都迫使核心 `deriveMessages()` 再次修改。
- **半开区间 `[start, endExclusive)` 的 replace 范围**：否决。surface 是双向链表，端点自然以节点 seq 命名，单节点替换（`start === end`）在闭区间语义下读起来更自然。
- **脏标记后全量重建**替代增量处理：在会话生命周期内为 O(N²)，每次单事件追加都要重新扫描所有先前事件。

## 后果

- **`packages/core/session`**：新增 `surface.ts`（`SurfaceManager`）、新类型（`SurfaceOp`、`SurfaceIntent`）、`SessionEvent` 新字段、修改 `append()`（第三个必选参数 `SurfaceIntent`）、重构 `deriveMessages()`（以 surface 遍历作为唯一派生路径）、surface 感知的 `repair.ts`。种子构造函数拒绝缺少 `surfaceOp` 标记的 surface 可达种子事件（见「不变式」一节）。
- **`packages/core/agent-loop`**：所有 surface 可达的追加操作传入 surface 选项。收集 chunk seq 用于 `assistant/message` 溯源；捕获 `tool/call` seq 用于 `tool/result` 溯源。
- **`packages/session-persistence/session-persistence-sqlite`**：`events` 表新增两个可空 TEXT 列（`source_event_seqs`、`surface_op`）；`SCHEMA_VERSION` 递增（bump-and-reject，无迁移）。
- **`packages/support/invariants`**：surface 相关验证规则。
- **`packages/session-persistence/session-persistence-jsonl`**：无需改动。
- **`packages/session-persistence/session-persistence`**：抽象接口不变。

Surface 是未来历史操纵的基础。压缩或 tool-result-prune 插件追加一个既有的消息产出事件类型（例如一条携带摘要的 `user/message`），附带 `surfaceOp: { op: 'replace', start, end }` 和覆盖被遮蔽节点的 `sourceEventSeqs`——新节点在 surface 上取代该范围的位置，而插件自身的 trace 事件（如 `compaction/start`、`compaction/end`）不进入 surface。回放以确定性方式保留该决策。
