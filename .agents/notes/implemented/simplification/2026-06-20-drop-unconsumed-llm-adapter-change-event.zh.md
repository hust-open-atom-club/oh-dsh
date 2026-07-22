# RFC: 移除未被消费的 `llm/adapter-change` 事件

Status: implemented

[English](2026-06-20-drop-unconsumed-llm-adapter-change-event.md) | 中文

## 问题

`LlmService.registerAdapter()` 在注册和 dispose（资源释放）时发出 `llm/adapter-change` 事件（[packages/llm/llm/src/index.ts](../../../../packages/llm/llm/src/index.ts)）。在 `packages/*/src` 和 `examples/*/src` 中搜索 `llm/adapter-change`，只能找到声明、emit 站点、文档和测试；没有任何生产环境的监听器订阅它。

这与 `tools/change` 和 `system-prompt/change` 不同。后两个事件目前同样未被消费，但它们是合理的注册表变更信号，未来可能服务于实时工具/提示词 UI。LLM（大语言模型）适配器注册更接近启动时的实现细节：适配器不是用户可见的面板，真正的模型调用拦截 seam 是 `llm/stream`。保留一个没有监听器的 adapter-change 事件，是在更小规模上重复 [drop-the-dead-summary](../../implemented/simplification/2026-06-19-drop-mutable-session-summary.md) 的模式。

这个事件并非零成本。`registerAdapter()` 在发出 `llm/adapter-change` 之前先 yield 回滚 disposer，这样抛出异常的监听器会回退变更而非泄漏适配器条目；包内还有针对该监听器抛出路径的测试。这种防御性排序保护的是一个只有测试才能触发的失败模式。

## 决策

仅移除 `llm/adapter-change`：`dsh-llm` 的 `interface Events` 中的声明、`ctx.emit('llm/adapter-change')` 调用，以及 `LlmService.registerAdapter` JSDoc 中的 "Emits `llm/adapter-change` on registration and disposal" 语句。`registerAdapter()` 的 effect generator 保留变更与回滚 disposer 以支持 HMR（热模块替换）/dispose，但去掉了仅为已移除事件而存在的监听器抛出回滚排序。适配器 disposer 测试断言返回的 disposer 能移除适配器，而不再订阅该事件；监听器抛出回滚测试随其主题一同移除。[docs/architecture.md](../../../architecture.md) 和 [packages/llm/llm/README.md](../../../../packages/llm/llm/README.md) 中的事件分类体系在同一个变更中更新。

## 曾考虑的替代方案

### 为什么不移除所有注册表变更事件？

一个注册表主动广播变更的微内核是一种自洽的约定。`tools/change` 和 `system-prompt/change` 在 UI 能实时刷新可用工具或提示词段落时可能变得有用。本 RFC 保留该约定中有合理的面向用户消费方的部分，仅裁掉当前和可预见未来消费方都不明确的 adapter-change 事件。

如果将来需要 LLM 适配器浏览器或动态模型选择器用到此信号，届时再连同消费方一起重新引入，并提供比「something changed」更清晰的 payload。

## 验证

`llm/adapter-change` 及其 emit 已移除，重新生成的 cordis catalog 是最新的；HMR 安全性保持（dispose 一个贡献 fiber 会移除对应适配器）；`tools/change` 和 `system-prompt/change` 仍有文档和测试；没有任何生产路径的可观察行为发生变化——ACP（Agent Client Protocol）快照 golden 和 echo-agent 冒烟测试逐字节未变。

## 后果

- **移除一个已文档化的 emit 事件属于公开接口变更。** 它出现在分类体系表中，读起来像有意设计的 API。但「已声明且已发出」不等于「已被消费」——这与移除可变 summary 时的判断依据相同。分类体系表在同一个变更中更新，因此文档不会漂移。
- **注册表变更约定变得不均匀。** 这是可接受的，因为 LLM 适配器注册与工具或提示词段落不是同一层面的面向用户概念。不均匀但诚实，胜过统一但无用。

这是一个小裁剪，但它退役了一条守护着并不存在的消费方的正确性不变式。
