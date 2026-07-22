# RFC: 移除 `agent/steering` 镜像 emit

Status: implemented

[English](2026-07-04-remove-agent-steering-mirror.md) | 中文

## 问题

`agent/steering` 是最后一个仍存在的、对持久会话事件的瞬态镜像。agent loop（智能体循环）的 steering（中途引导）drain 逻辑先追加持久事件 `steering/message { turn, content, source }`，紧接着下一行就 emit `agent/steering(agent, turn, content, source)`——同一个事实以 fire-and-forget 事件的形式重复发出（`packages/core/agent-loop/src/loop.ts`，`drainSteering`）。它在生产环境中没有任何监听者：唯一的订阅方是一个 agent loop 回归测试，断言 emit 携带了 `source`——而这同一个事实已经由上一行的持久事件记录。

`agent/steering` 以相同的 payload 重复了紧接其前的持久事件 `steering/message`。`agent/queued` 仍保留为纯瞬态信号，因为它在持久化之前触发，覆盖了可能在进入日志前被取消的工作。

steering 承载着真实的生产流量：hook bridge 的轮次续行决策通过 `inbox.steer()` 注入理由，落地为持久的 `steering/message` 事件，hook-matrix 的 golden 文件对此进行固定——所有这些消费方观察的都是持久事件。没有任何消费方观察镜像事件。

## 决策

`agent/steering` 从 agent 事件分类体系中移除：`packages/core/agent/src/types.ts` 中的声明（及其在 live-events JSDoc 列表中的提及）、`drainSteering` 中的 emit（随之移除的还有当时已无用的 `ctx` 参数）、`packages/core/agent/README.md` 中的对应行，以及 loop 伪代码块中的 emit 行（`packages/core/agent-loop/src/loop.ts` 模块文档与 [architecture.md](../../../architecture.md)）；Cordis catalog 重新生成后不再包含它。唯一的回归测试改为在持久事件 `steering/message` 上固定 source 保持性——它所固定的事实存在于日志中。

三份已实施的 RFC 曾声明保留该事件，每份均按 [implemented/AGENTS.md](../AGENTS.md) 的要求修订，指向本 RFC 作为移除记录：[boundary RFC](2026-06-20-remove-agent-boundary-mirror-events.md) 的保留列表条目、[stream-chunk RFC](2026-07-02-remove-stream-chunk-mirror.md) 的范围条款，以及 [event-domain-semantics RFC](../architecture/2026-06-30-event-domain-semantics.md) 的瞬态 emit 枚举。

## 曾考虑的替代方案

### 为什么不保留？

"它是控制信号，不是边界事件"——但分类体系的操作性区分是「镜像 vs. 纯瞬态」，而非「控制 vs. 边界」，而这个事件属于镜像。需要入队时通知的消费方有 `agent/queued`（带 steering flag）；需要 drain 时通知的消费方，本质上是在请求 `steering/message` 被追加的那一刻，而 `session/event` 以相同 payload 加上持久性提供了这一通知。被否决的 [retire-mid-turn-steering RFC](../../rejected/simplification/2026-06-20-retire-mid-turn-steering.md) 捍卫的是 steering *能力*——`steer()`、持久事件、续行强制——本次移除对这些全部保持不变。

## 验证

`agent/steering` 这一拼写仅存于 RFC 行文中（本 RFC、上述三份修订的 RFC，以及冻结的[被否决的 steering 能力 RFC](../../rejected/simplification/2026-06-20-retire-mid-turn-steering.md)，其文本记录了它所拒绝的提案）；catalog 已重新生成；重定向后的测试在 `steering/message` 上固定 source 保持性。

## 后果

生产环境中没有需要迁移的监听者，两种瞬态通知需求各有归宿：入队时由 `agent/queued`（带 `steering` flag）承载，drain 时由 `session/event` 在持久事件 `steering/message` 落地时承载。
