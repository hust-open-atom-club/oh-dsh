# Agent Note: SessionStore fork API

Status: implemented

[English](2026-06-30-session-store-fork-api.md) | 中文

## 问题

事件溯源的会话日志已经具备 fork 所需的原语：创建一个带有种子事件前缀的新会话，然后像回放一样从该种子日志推导模型历史。这个原语有意保持底层：`ctx.sessions.create(id, { seed, meta })` 接受任何合法种子，但常规的活跃会话分支需要围绕以下问题制定策略：哪些前缀可以被复制、子会话应打上哪些元数据、以及错误如何分类。

语义上的风险在于 fork 边界。一个合法的用户可见 fork 种子必须是连续的且封闭在轮次内。如果在一个活跃轮次内部 fork，会复制一个未关闭的 `turn/start`、可能还有一个未关闭的 `step/start`，以及可能悬空的工具调用。这违反了轮次封闭性与 provider-transcript 不变式，并且会创建一段误导性的子历史——看起来子会话参与了父会话中一个尚未完成的轮次。现有的 [subagent seam](2026-06-21-subagent-capability-seam.md) 有意解决的是另一个问题：工具触发的 subagent fork 通常发生在父轮次仍然打开时，因此 `dsh-subagent-fork` 会将种子裁剪到父会话最后一个已完成轮次的前缀。通用的会话 fork 不应静默裁剪；它应当要么在请求的边界处 fork，要么拒绝请求。

## 决策

`dsh-session` 直接在 `ctx.sessions` 上拥有常规活跃会话 fork 的能力。不设独立的 `dsh-session-fork` 包（package），也不设 `ctx.sessionFork` 服务：该 API 没有独立的后端、事件词汇、生命周期或持久化行为，所有持久化工作都委托给现有的 session store 和持久化后端。

store 暴露一个操作：

```ts ignore-check
type SessionForkSource = Session | SessionId

class SessionStore extends Service {
  fork(source: SessionForkSource, boundary?: number, childSessionId?: SessionId): Session
}
```

`boundary` 是要复制到的源事件 `seq`（含该序号）。省略时默认为源会话当前的最后一个事件；对空源会话省略 `boundary` 则创建一个空的子会话。fork 特有的校验仅检查请求的边界是否存在且为 `turn/end`。选定的前缀随后被深拷贝到子会话的种子中。子会话继承源会话的 `cwd`，将 `parentSession` 设为源会话 id，并将 `seedLength` 设为已复制前缀的长度。省略 `childSessionId` 时，`SessionStore` 使用其现有的 id 策略生成一个。

空前缀可以被 fork；任何非空边界都必须是一个安全的、已存在的、位于 `turn/end` 的序号，无论结束原因为何。类型化的错误区分源缺失、对象陈旧、子 id 重复和边界无效等情况。更广泛的日志校验与崩溃恢复仍由其现有的负责方处理。

## 曾考虑的替代方案

**独立的 `ctx.sessionFork` 服务。** 这是最初的实现，但评审表明它过度套用了 capability-seam 模式。代码没有可替换的后端、没有额外的事件面、没有独立的所有权生命周期，也没有超出 `ctx.sessions.create({ seed, meta })` 的持久化行为。保留独立包会迫使调用方为了在 session store 原语之上执行一层策略而去发现并安装第二个服务。

**两个函数：`snapshot()` 加 `fork()`。** 这保留了一个可复用的种子/元数据计算，但唯一支持的消费方会立即创建会话。它还使接口看起来比用户实际需要的具体操作更抽象。单一的 `fork()` 加显式 `boundary` 使 API 保持直接，同时仍支持对先前时间点的 fork。

**静默裁剪未关闭轮次到最后一个已完成边界。** 这对 `dsh-subagent-fork` 是正确的——委托通常在父轮次仍然打开时开始，子会话应只继承已完成的前缀。但对常规的用户/会话分支而言是错误的，因为它隐藏了请求的 fork 点实际上不是合法边界这一事实，并且静默丢弃了父轮次的尾部。

## 后果

公开接口保持精简且易于发现：活跃会话分支是 `ctx.sessions` 的一部分，紧邻 `create({ seed })`，而非一个独立服务或一对两步辅助函数。持久化继续通过现有的 `session/created` 和 `session/flush` 行为运作：fork 出的子会话以种子事件开始生命，因此现有后端只需持久化该种子一次，并在 header 中保存 `parentSession`／`seedLength`。

v1 范围仍然排除 ACP（Agent Client Protocol） `session/fork`、对未加载的已持久化会话的 fork、面向模型的工具，以及 subagent 重构。如果未来添加 ACP 方法，应在具备 transcript（文本记录）/快照覆盖后才广播该能力；本 Agent Note 不添加面向编辑器的更新，因此当前不需要 ACP 快照。fork 子会话的回放仍由现有的[种子边界测试 Agent Note](../testing/2026-06-22-fork-child-replay-seed-boundary.md) 覆盖，而本 API 则获得专门的 `dsh-session` 单元测试加 JSONL 持久化覆盖。
