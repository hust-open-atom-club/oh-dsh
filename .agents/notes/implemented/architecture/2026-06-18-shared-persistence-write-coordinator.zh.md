# RFC: 共享持久化写入协调器

Status: implemented

[English](2026-06-18-shared-persistence-write-coordinator.md) | 中文

## 问题

`dsh-session-persistence-jsonl` 与 `dsh-session-persistence-sqlite` 有意在不同存储介质上证明同一份 `SessionPersistence` 契约，但它们的写入路径编排是重复的：per-session 状态、`session/created` 接管、后端特定的前缀读取、write-behind 缓冲区、序列化的 flush 链、HMR（热模块替换）种子注入与 dispose（资源释放）排空。纯粹的种子前缀碰撞检查与可序列化守卫已迁入 seam 包；剩余的编排仍然对正确性要求很高，且同样的修复被应用了两次。代码级 diff 表明两个后端在全部这些逻辑上要么字节相同、要么算法相同：四个 map（`states`/`buffers`/`chains`/`inits`）、`installWritePath`、`initFor`、`onCreated` 的四种分支、`flush`、`drain`、`serialize`、`adopt`、`adoptLivePrefix`、`assertVersion`，以及 `create`/`append`/`load` 的骨架。唯一的差异在于存储原语（写字节 vs. INSERT 行）。

## 决策

将一个后端无关的 `PersistenceCoordinator` 提取到 `dsh-session-persistence` 中。协调器统一拥有编排逻辑；每个第一方后端组合一个协调器实例（`new PersistenceCoordinator(ctx, this)`），实现一个小型 `PersistenceBackend` 钩子接口，并将其四个公开服务方法（`create`/`append`/`load`/`list`）委托给协调器。

组合，而非继承。协调器是后端持有的具体类，不是后端继承的基类。本 RFC 的风险——「协调器不得让非常规后端与继承层级作斗争」——由此规避：后端只暴露钩子；它无法触及协调器的私有编排状态，且公开的 `SessionPersistence` 服务形状不变，因此第三方后端仍然可以完全不使用协调器、直接实现抽象服务。

### 钩子接口（`PersistenceBackend<TornMarker>`）

六个方法（五个必需 + 一个可选的生命周期钩子）——协调器与存储之间唯一的 seam：

- `name`——后端标签，用于 dispose 失败时的 `AggregateError`。
- `loadStored(id)`——按 id 读取已存储的前缀，扫描任何存储范围（JSONL 的每个 cwd bucket；SQLite 的 id 全局唯一）。用于恢复/加载，以及通过 `!== undefined` 进行创建碰撞探测。
- `loadLive(id, cwd)`——读取限定于 `cwd` 的已存储前缀。**与 `loadStored` 有意区分**：HMR live-adoption 只能接管与存活会话处于同一 cwd 的持久化日志；同 id 但不同 cwd 的日志是碰撞而非恢复。合并二者会重新引入跨 cwd 接管 bug。SQLite 忽略 `cwd`。
- `appendBatch(meta, events, isMaterialized)`——持久追加一个连续批次，在尚未物化时原子地惰性物化会话（物化写入与首批事件必须一起提交——崩溃不得留下一个已物化但为空的会话；这就是为什么没有单独的 `materialize` 钩子）。
- `commitRepair(meta, tornMarker, closers)`——使崩溃修复持久化：截断损坏的尾部（当且仅当 `tornMarker !== undefined`）并追加 `closers`。**不要求原子性**——JSONL 合理地分两步 fsync（先截断再追加），SQLite 在一个事务中完成 DELETE+INSERT。用于 `load`（截断 + 合成 closers）和 live-adoption（仅截断，`closers = []`）。
- `list()`——列出所有已存储的元数据。
- `close?()`——可选的生命周期清理（SQLite 关闭 db 句柄；JSONL 省略），在 dispose effect 中于静默排空之后被 await，因此 close 失败不会掩盖排空错误。

### 不透明的 torn marker

保持 seam 整洁的唯一设计选择：崩溃修复中「损坏尾部在哪里」的 token 对协调器是不透明的。协调器计算合成 closers（它拥有来自 `dsh-session` 的 `interruptedTurnClosers`），但它只测试 `tornMarker !== undefined` 并将值原样传回 `commitRepair`——从不检视其内容。每个后端选择自己的 marker 类型：JSONL 使用要截断到的字节偏移，SQLite 使用要从其开始删除的 seq（两者恰好都是 `number`）。JSONL 后端将其 `committedBytes < buffer.byteLength` 比较折叠在钩子内部，因此返回的 marker 已经是 `number | undefined`；如果不做这层折叠，协调器就必须了解字节长度。

## 测试

共享的 `runPersistenceContract`（公开 API 契约）继续为每个后端运行。新增的 `runCoordinatorContract`（`tests/coordinator-contract.ts`）覆盖写入路径编排——接管、HMR、碰撞、dispose 排空、崩溃尾部修复——通过 `CoordinatorFixture`（内存参考实现 + jsonl + sqlite）为每个后端运行一次。各后端自身的测试规格缩减为仅覆盖存储机制（JSONL：路径安全、fsync 回滚、bucket 列举；SQLite：schema 版本、`scanRows`、事务回滚）。每个真实后端有一个经由协调器的 torn-tail→load→`commitRepair` 测试（通过 `corruptTail` fixture（测试前置数据）钩子），确保协调器的 torn-marker 修复分支在 100% per-file 门禁下被覆盖——契约崩溃测试只产生合成 closers 而不产生 torn marker，因此无法触达该分支。

## 曾考虑的替代方案

- **后端继承的基类**——否决，改用组合：后端只暴露钩子，无法触及协调器的私有编排状态，且第三方后端仍可完全不使用协调器、直接实现抽象服务。
- **更宽的钩子面**——每个候选钩子都被折叠掉：没有单独的 `materialize` 钩子（物化写入必须在 `appendBatch` 内与首批事件原子提交）；没有单独的创建碰撞探测（即 `loadStored(id) !== undefined`）；`list()` 也不经由协调器透传（列举不需要任何编排）。

## 后果

协调器增加了一层间接和一个不透明的 torn marker，但将此前每个后端重复的、对正确性要求很高的编排逻辑集中到一处。其钩子面保持窄小：碰撞检查复用 `loadStored`，物化保持在 `appendBatch` 内原子完成，列举绕过协调器。新后端只需实现存储原语，而无需复制事件-缓冲区-flush 生命周期。
