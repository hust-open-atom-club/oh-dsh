# RFC: 裁剪无生产者的词汇变体（块缓存提示、`agent` 消息来源、`continuation` 轮次触发器）

Status: implemented

[English](2026-07-04-prune-producerless-vocabulary-variants.md) | 中文

## 问题

可合并扩展的词汇映射表设计上通过声明合并来增长，代码库已在 `TurnEndReasonMap`（`packages/core/session/src/types.ts`）上明确了准入策略：像 `refusal` 这样的变体「在适配器或循环首次发出它之前，有意不纳入」。三个已声明的词汇项违反了该策略——每个都既无生产者也无消费方，其中两个甚至没有测试：

- **`CacheHint` 及其 `cache?: CacheHint` 块字段**，位于 `TextBlock`/`ToolResultBlock`（`packages/llm/llm/src/types.ts`；image block 上还有第三个同类字段，已随 image block 一起移除——见[移除 image block 的 RFC](2026-07-04-drop-image-content-block.md)）。没有任何地方构造过带 `cache:` 的块——src、测试和文档粘贴全部搜索为空——两个适配器也都不读 `.cache`：DeepSeek 的 prompt 缓存是自动的，适配器只从响应中映射出 `prompt_cache_hit_tokens`，从不向请求中发送提示。这是 Anthropic 风格的 `cache_control` 接口面，却没有能兑现它的提供方。
- **`MessageSourceMap.agent`**（`{ kind: 'agent'; agentId: string }`，同一文件）。零个构造点，包括测试在内。它预期的生产者在实现时并未使用它：subagent 后端将父级的 prompt 发送给子级时不带 `source`，因此记录为 `{ kind: 'user' }`，通用信封渲染器在插值 `source.kind` 时也从未对其做路由。
- **`TurnTriggerMap.continuation`**（`packages/core/session/src/types.ts`）。agent loop（智能体循环）在结构上不可能发出它——continuation 发生在一个轮次*内部*作为后续步骤，而非作为新轮次——循环只构造 `message` 和 `injection` 触发器。唯一的写入者是一个手工构建的测试 fixture（测试前置数据），它只需要一个任意的非 message 触发器（`packages/support/llm-replay/tests/llm-replay.spec.ts`），`injection` 触发器同样满足需求；唯一的生产环境触发器读取方 ACP 桥接层只过滤 `kind === 'message'`。

## 决策

删除 `CacheHint`、其 `cache?` 块字段、`agent` 消息来源变体与 `continuation` 轮次触发器变体：发布的词汇表不再包含它们。llm-replay fixture 改用 `injection` 触发器（任何非 `message` 触发器均满足其用途）。[core.md](../../../core-data-structures/core.md) 和 [session.md](../../../core-data-structures/session.md) 中的 type-equiv 粘贴与裁剪后的映射表一致——两个符号保留在 `scripts/type-equiv.manifest.json` 中，因为每个映射表本身仍然存在，只是少了一个成员——[内容块词汇 RFC](../architecture/2026-06-11-content-block-vocabulary.md) 的后果部分将缓存提示记录为「受生产者门控」而非「已有归属」，依照 [implemented/AGENTS.md](../AGENTS.md)。

每个变体在获得真正的生产者之日回归，这正是映射表设计的增长方式：缓存功能连同传输它的适配器一起重新添加 `cache`；subagent 归属连同打标的后端和路由它的消费方一起重新添加 `agent`；真正启动新轮次的自动续行功能连同发出它的插件一起重新添加 `continuation`。

## 曾考虑的替代方案

### 为什么不保留它们？

[内容块词汇 RFC](../architecture/2026-06-11-content-block-vocabulary.md) 将「缓存提示……已有归属」列为设计后果，预留槽位确实能表达意图。但一个空槽位是每个实现和消费方都必须考虑的契约面（我的适配器需要兑现 `cache` 吗？我的渲染器需要路由 `agent` 来源吗？），而同族映射表自身的 JSDoc 已经拒绝了「无发出者的预留」——`refusal` 和 `max_turn_requests` 被明确标注为*当某物首次发出它们时*再添加的变体，而非提前声明。对已声明但无生命的变体施加同样的标准，使词汇表具有实际意义：如果它在映射表中，就一定有东西在生产它。

## 验证

对 `CacheHint`、`agent` 消息来源拼写和 `continuation` 触发器拼写执行 `rg` 搜索，结果仅返回 RFC 记录（本文，以及[移除 image block 的 RFC](2026-07-04-drop-image-content-block.md) 中关于 image block 自身 `cache` 字段的说明）；llm-replay fixture 使用 `injection` 触发器断言了相同的回放行为；core-data-structures 粘贴与 type-equiv manifest 保持同步。

## 后果

没有任何运行时行为改变——本来就没有东西能构造这些值。镜像事件的移除（[boundary-mirror RFC](2026-06-20-remove-agent-boundary-mirror-events.md)、[stream-chunk RFC](2026-07-02-remove-stream-chunk-mirror.md)）只涉及瞬态的 `agent/*` 事件，从不涉及持久词汇，因此不存在冲突。其他地方准入策略已经成立：`rejected`、`prompt/blocked` 和 `hook/invoked`/`hook/result` 各自都有活跃的生产者——本 RFC 将同一标准延伸到缺少生产者的三个变体。image block 自身的 `cache?` 字段属于[移除 image block 的 RFC](2026-07-04-drop-image-content-block.md)，已随该块一起移除；本 RFC 覆盖的是留存块类型上的两个字段。
