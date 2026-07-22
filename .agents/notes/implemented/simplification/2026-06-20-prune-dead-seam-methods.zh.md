# RFC: 从 persistence seam 中移除无用方法

Status: implemented

[English](2026-06-20-prune-dead-seam-methods.md) | 中文

> **实现说明：** 最终只移除了 `SessionPersistence.has()` 和 `.delete()`。`BashExecutor.get()` 和 `.list()` 保留，因为移除它们的单行查询接口需要在消费方引入大量额外的完成状态追踪机制。它们的 id 品牌化由 [branded-ids RFC](../architecture/2026-06-20-branded-ids.md) 覆盖。

## 问题

一个能力 seam（[接口／实现／消费方](../../implemented/architecture/2026-06-13-capability-seams.md)）承载着没有任何消费方调用的抽象方法。seam 的存在是为了让实现与消费方独立演进，但一个没有消费方编程依赖的方法不是 seam，而是每个实现仍须实现和测试的投机性接口面。

### `SessionPersistence.has()` 与 `.delete()`

该抽象服务在 create/append 之外声明了更多操作：`load`、`list`、`has`、`delete`。`ctx.sessionPersistence` 的生产消费方只用了两个：agent loop（智能体循环）的恢复路径调用 `load()`（[packages/core/agent-loop/src/index.ts:176](../../../../packages/core/agent-loop/src/index.ts)），ACP（Agent Client Protocol）桥接层为 `session/list` 调用 `list()`（[packages/ui/acp/src/index.ts:494](../../../../packages/ui/acp/src/index.ts)）。在 `packages/*/src` 和 `examples/` 中 grep 所有 `sessionPersistence.*` / `persistence.*` 的使用，找不到对该服务的 `has(` 或 `delete(` 调用。`packages/ui/acp/src/index.ts` 中的 `.has(`/`.delete(` 调用作用于内存中的 `SessionStore` 和一个本地的 loading id `Set`，而非 persistence。`has`/`delete` 的唯一调用者是契约测试套件和各后端的 spec。

`has()` 不仅是未使用——它还是共享协调器中最复杂的分支：一个 tracked-vs-untracked 双探测（`loadLive(id, cwd)` 用于活跃追踪的会话，`loadStored(id)` 用于未追踪的会话），附带多行注释说明理由。`delete()` 则拖带了 `deleteStored` 后端钩子，每个后端都必须实现它。这与 [drop-mutable-session-summary](../../implemented/simplification/2026-06-19-drop-mutable-session-summary.md) 是同一模式：契约测试覆盖了两者，但没有任何发布代码会问「这个会话是否已持久化？」或删除一个会话。

## 决策

没有消费方使用的方法被移除——从抽象 seam、实现，以及仅为覆盖它们而存在的契约/spec 测试套件中移除：

- `SessionPersistence.has()` / `.delete()` 已移除：抽象声明、协调器的 `has`/`delete`/`deleteCore`，以及 `PersistenceBackend.deleteStored` 钩子（jsonl 和 sqlite 各自实现 `deleteStored` 仅为满足该钩子——这些实现也一并移除）。后端属于[双后端](../../implemented/architecture/2026-06-14-session-persistence.md)设计，本身不在本次范围内；移除它们为无消费方实现的钩子是移除钩子的一部分，而非后端重新设计。
- 所有文档和源码注释中的引用都已更新为存留的四方法、仅含 `list()` 的契约——不仅是字面的 `has(`/`delete(`/`deleteStored` 拼写，还包括 `{@link has}`/`{@link delete}` JSDoc 链接和「六个公开方法」之类的计数——涉及 seam 和后端 README、[docs/architecture.md](../../../architecture.md)、[session-persistence](../../implemented/architecture/2026-06-14-session-persistence.md) 和 [write-coordinator](../../implemented/architecture/2026-06-18-shared-persistence-write-coordinator.md) RFC，以及协调器/后端的 JSDoc。

## 曾考虑的替代方案

### 为什么不以「seam 应当完整」为由保留？

「persistence seam 理应提供 delete」这种直觉是真实的——但它恰恰是预发布阶段所警惕的投机性完整（[AGENTS.md](../../../../AGENTS.md)：为正确的基础优化，而非为你并不拥有的假想调用者优化）。`delete()` 是一个方法，等消费方真正需要时再加回来即可：一个删除旧会话的会话管理 UI 会需要它——到那时再加，基于该 UI 的真实需求来设计（软删除？级联？确认？），而非现在猜测。

在有活跃消费方的情况下重新添加一个 seam 方法，成本低且设计更优，因为消费方锚定了契约。在无人使用的情况下保留它，意味着每个实现（以及未来的每个后端）都必须实现和测试一个无实际作用的方法。

## 验证

`has`/`delete`/`deleteStored` 已从 persistence seam、实现和契约测试套件中移除，没有新增无用导出；剩余操作（`create`/`append`/`load`/`list`）未受影响，ACP `session/list` 和崩溃恢复行为完全一致；seam README 和 `docs/architecture.md` 仅列出存留的方法。

## 后果

- **`delete()` 是产品最终会需要的操作。** 确实如此，但「最终」正是关键。现在删除、将来基于真实消费方重新添加，严格优于发布一份猜测的契约。两个后端各自减少了一个 `deleteStored` 实现，这是在本次范围之外的包中的有限改动。
- **低耦合。** 移除局限于 persistence seam + 实现 + 测试；没有跨包消费方引用被移除的方法，因此除文档外没有涟漪效应。

规模不大，但它将 seam 从「实现必须为无人提供什么」恢复为「恰好是消费方使用的东西」。
