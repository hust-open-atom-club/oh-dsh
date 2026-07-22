# RFC: 移除未被消费的 web 观测接口——`providers-change` 事件与 status 方法

Status: implemented

[English](2026-07-04-drop-unconsumed-web-observation-surface.md) | 中文

## 问题

`WebService` 暴露了一组没有任何生产代码观测的观测接口：

- **`web/providers-change`**（`packages/web/web/src/index.ts`）在每次 provider 注册和 dispose（资源释放）时声明并发出，且每个注册 effect 的回滚 yield 被刻意排在 emit 之前，唯一目的是让抛出异常的 change listener 能回退注册。在该包自身的两个单元测试之外没有任何 listener（其中一个测试的存在仅仅是为了固定那个回滚顺序）。
- **`searchStatus()` / `fetchStatus()` 与 `WebCapabilityStatus` 联合类型**（同一个包）没有任何生产调用方：`dsh-tool-web` 通过 `ctx.web.search()`/`fetch()` 直接执行，并将不可用性表现为 seam 在执行时抛出的结构化 `WebError` 错误码（`packages/web/tool-web/src/search.ts`、`packages/web/tool-web/src/fetch.ts`）；唯一的 status 调用方是 web 包自身的测试。`packages/web/tool-web/README.md` 和 [architecture.md](../../../architecture.md) 中的行文声称该工具「只读取聚合的 `searchStatus()`/`fetchStatus()`」——这是一处漂移，仅因没有机制检查行文与调用点的一致性而幸存。

seam 自身的设计使这两个接口天然没有消费方：工具注册跟随产品 ENABLEMENT 而非 provider 可用性（`packages/web/tool-web/src/index.ts`），provider 选择在执行时解析且从不缓存——因此没有需要失效的缓存、没有需要重算的注册集合、也没有调用方需要一个有别于「执行并路由结构化错误」的可用性探测。HMR（热模块替换）清理由 effect disposer 自身承载。

这与 [移除未被消费的 `llm/adapter-change` 事件](../../implemented/simplification/2026-06-20-drop-unconsumed-llm-adapter-change-event.md) 如出一辙：那个 RFC 从 `LlmService` 中移除了相同的通知形态、相同的 rollback-before-emit 机制和相同的 listener-throw 测试。该 RFC 的保留/裁剪判据——为 `tools/change` 保留其合理的面向用户的工具列表消费方，裁剪启动时的后端注册表信号——将 web provider 注册表明确归入裁剪一侧；status 方法是同一判断应用于 pull 接口而非 push 接口。

## 决策

移除注册表变更事件、聚合 status 方法与类型，以及它们的专属测试。provider 私有的 status 保留用于执行时选择。面向调用方的覆盖率现在断言成功执行或结构化的选择错误，web 文档描述该按需调用契约。

## 曾考虑的替代方案

### 为什么不保留？

web seam RFC 有意指定了两者——事件作为最小的 HMR 可见性信号，status 方法作为工具的聚合诊断——且未来的 provider 状态面板是可以想象的。但同一 RFC 的其他设计选择使它们失去了消费方：按需派生的选择与基于 enablement 的注册使得没有消费方能需要这两者；已交付的工具展示了真实模式（执行并路由结构化错误）；漂移的 README 语句表明承诺的消费方从未实现。按 AGENTS.md「RFC 是提案，不是金科玉律」的原则，这些是该提案中代码已证明过度设计的部分；未来的观测者按其实际消费的需求重新引入最小的信号或查询，由该消费方塑造其形态。

## 验证

在 RFC 历史之外不再有 `providers-change`、`searchStatus`、`fetchStatus` 或 `WebCapabilityStatus` 的拼写残留；catalog 是最新的（`verify-cordis-catalog` 绿色）；注册/释放的 HMR 安全测试通过执行行为证明清理正确；tool-web README 与 architecture 段落描述了工具实际拥有的执行时错误路由契约。

## 后果

未来若有 provider 选择器 UI 或诊断面板需要变更通知或 status 查询，它将重新添加自身所消费的最小接口；相同的判断及其反转条件已记录在 LLM（大语言模型）先例中。
