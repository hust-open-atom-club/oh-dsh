# Agent Note: 压缩作为能力 seam（抽象契约 + 基础后端）

Status: implemented

[English](2026-06-18-compaction-capability-seam.md) | 中文

## 问题

长时间运行的 agent（智能体）对话会无限增长。随着事件日志不断累积轮次，派生出的消息历史最终逼近模型的上下文窗口，模型随即截断响应（`max-tokens`）或性能退化。**上下文压缩（context compaction）** 是对此的缓解手段：用一段简洁的摘要替换一批较早的历史，保持近期上下文完整。

[session surface](../architecture/2026-06-18-session-surface.md) 正是为此而构建的基础设施：一份建立在事件日志之上的有序投影，带有专门设计的 `surfaceOp: { op: 'replace', start, end }` 操作，用于遮蔽一段条目并插入替换内容，`sourceEventSeqs` 记录溯源信息以便决策可确定性地回放。剩下的是那个*决定压缩什么、并产出摘要*的插件。

两股力量塑造了设计。第一，压缩策略与可复用的 token 测量独立变化：测量归 LLM 系列的 [`ctx.tokenMeter` 服务](../architecture/2026-07-15-replay-token-meter-service.md)所有，摘要生成则可以使用模型调用、模板或远程服务。第二，`SurfaceEventType` 封闭为五种事件类型（`user/message`、`assistant/message`、`tool/result`、`context/message`、`steering/message`）；只有这些类型可以携带 `surfaceOp`。因此一个专用的 `compaction/*` 事件**不能**出现在 surface 上，编译器与 Session 始终启用的 append/seed 边界都会拒绝在其上附加 `surfaceOp`。

## 决策

### 压缩是一个能力 seam，接口与实现分离

遵循[能力 seam Agent Note（agent 决策记录）](../architecture/2026-06-13-capability-seams.md)，压缩以独立包（package）发布，使契约、算法和（后续的）消费方 surface 各自独立演进：

1. **接口** — `@deepseek-ai/dsh-compact`：抽象 `CompactService`，拥有 `ctx.compact` 键、`CompactionResult` 词汇、`compact/*` 会话事件以及规范的检查点消息来源。它将 `compactIfNeeded()` 和 `compactRegion()` 声明为**抽象方法**——契约说明压缩*做什么*，而非*怎么做*。
2. **实现** — `@deepseek-ai/dsh-compact-basic`：具体的 `BasicCompactService`，消费 `ctx.tokenMeter`，并拥有尾→头保留遍历、通过 `ctx.llm.stream()` 生成摘要、surface 替换、锁、步骤后压力处理和规范的上下文溢出恢复。`summarize()` 是其唯一的子类钩子；计价与回放仍归 meter 所有。
3. **无模型配套服务** — `@deepseek-ai/dsh-compact-tool-result-prune`：一个具体的可选服务，在后端选择摘要范围之前，重写当前过大的 `tool/result` 节点。它不是第二种压缩实现，也不实现 `CompactService`。
4. **消费方** — 推迟。一个 `/compact` 工具和斜杠命令将 `inject: ['compact']` 并调用契约；它们被有意排除在本 Agent Note 范围之外，以便 seam 先稳定下来。

### 契约依赖 `dsh-session` 和 `dsh-llm`——有意为之的偏离

能力 seam Agent Note 规定接口包「仅依赖 cordis」（对 `dsh-bash` 成立，因为其词汇是自包含的）。压缩**无法**遵守这一点：它的动词作用于 agent 所有的 `Session`（`compactRegion(start, end, agent)`），其输出使用内容词汇（`CompactionResult.summary: ContentBlock[]`）。不引用 `Session`/`SessionEvent`（来自 `dsh-session`）和 `ContentBlock`（来自 `dsh-llm`），契约就无法表达。

这不是耦合异味，而是契约的领域所在。「仅 cordis」的指导原则一直是「接口仅依赖契约真正需要命名的东西，绝不依赖实现」的简写。`dsh-session` 和 `dsh-llm` 本身是接口/词汇包，不是实现；`dsh-compact` 仍然不导入任何后端。seam 的真正不变式——*消费方和实现在抽象服务背后独立演进*——完好无损。

### 抽象 `compactIfNeeded` / `compactRegion`，算法在后端

早期草案将完整算法（保留遍历、token 求和、文本提取）作为接口上的具体方法。这会将契约重新耦合到一种策略：想要不同保留策略或事件排序的后端必须与继承来的具体代码对抗。将两个核心方法都设为抽象，把所有*怎么做*的决策放在后端，并让接口保持为*做什么*的声明。token 测量根本不是压缩钩子；单例服务使多个消费方能够共享逐会话的回放折叠。

`compactIfNeeded(agent, trigger, signal)` 接受显式的 `'pressure' | 'context-overflow'` 触发原因与取消信号。它只读取最新的持久化已路由请求；没有 header 就不执行工作，任何已路由的提供方/模型目标都使用单例估算器。`compactRegion(start, end, agent, signal?)` 将 `agent.session` 作为唯一会话身份，并为手动调用方保留可选 signal。默认摘要器依次从显式配置、最新记录的已路由目标和 agent 选项解析目标，并在任何 `llm/stream` 路由后记录提供方/模型对。它回放已路由请求的前缀，并将压缩指令追加为尾部 user 消息，从而复用提供方的热 KV cache；见[摘要前缀缓存 Agent Note](../bug-fix/2026-07-21-compaction-summary-prefix-cache-reuse.md)。该调用将提供方无关的 `GenerateOptions.purpose` 设为 `compaction`；适配器可以将此用途映射为对模型隐藏的传输元数据，DeepSeek 适配器会发送 `x-deepseek-harness-compact: 1`。

### 成功的持久步骤工作完成后运行自动压力检查

成功调用的压力检查不能在步骤前运行，因为最终的 `agent/request` 路由、提供方输出、工具结果、缓冲上下文与 steering 当时尚不存在。串行的 `agent/post-step(agent, turn, step, signal)` 会在这些事实持久化后、`step/end` 之前触发。`dsh-compact-basic` 通过 `ctx.tokenMeter` 测量规范的已记录请求，因此下一个请求无需推测性覆盖信封即可看到任何替换。压力达到条件后，可选的 `ctx.toolResultPrune` 重写在摘要范围选择前运行；compact-basic 重新测量持久 surface，如果修剪恢复到安全压力便跳过摘要生成。

规范的提供方上下文溢出走另一条路径。失败步骤先关闭，`agent/request-error` 接收原始请求错误与连续重试次数，compact-basic 在强制执行一次有效且平衡的缩减前先修剪。仅当 `session.surface.replaceGeneration` 增加时，它才返回 retry；这包括没有摘要范围时仅修剪取得的进展。随后循环开启新的编号步骤，并从持久日志重建请求。没有替换、任何替换前的恢复失败、取消、耗尽的上限或无关错误都会保留原始提供方失败。如果修剪已经推进 generation，而后续摘要工作失败，恢复会从该持久的已修剪 surface 重试，除非取消或资源释放胜出。完整生命周期决策见[调用后恢复 Agent Note](../architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md)。

```
assistant/message → tool/result/context/steering
await serial agent/post-step          ⟵ pressure compaction inside the successful step
step/end

provider overflow → step/end
await waterfall agent/request-error  ⟵ forced compaction between attempts
retry → next numbered step/start      ⟵ derives from the replacement surface
```

### 保留是轮次无关的；工具配对平衡是唯一的结构守卫

自动压缩在**每个成功的**步骤之后检查，而非每轮一次。这对失控轮次存活至关重要：工具密集型的 ReAct 轮次每步追加一个 `assistant/message` + 一个 `tool/result`，因此 surface 会在一轮之内增长。步骤后检查可以在后续步骤开启前压缩早期已关闭的工具对；如果请求率先越过限制，由提供方确认的溢出仍是兜底机制。

`compactIfNeeded` 保留估算大小达到解析后保留 token 预算的最小完整 surface 单元尾部，压缩更早的节点。一个单元是一个完整的已关闭步骤或一条无步骤消息。如果 token 截断点落在步骤内部，保留范围会扩展直到切割点满足工具配对平衡。平衡按 surface 顺序检查，而非日志序号，因为替换摘要在旧的 surface 位置拥有新的序号。`dsh-compact` 导出前后边缘辅助函数；只要 `replaceGeneration` 不变，其逐会话缓存就只折叠新增的 surface 尾部节点，面对仅日志增长时不读取事件，并在替换后重建当前成员关系与平衡。`compactRegion` 拒绝将工具调用与其结果拆分的边界。进行中的轮次不享受特殊保留。

因此失控轮次的压缩方式与其他历史完全相同：其早期*已关闭*步骤被摘要，近期步骤保持原样。当唯一可压缩的内容只剩一个不可拆分的开放尾部步骤（其工具调用尚无结果）时，压缩拒绝执行（返回 `null`）并在该步骤关闭后重试。

**部分单单元溢出仍不在范围内。** 摘要范围选择无法拆分不可分割的单元。当可移除的文本型工具结果内容占据大部分空间，且修剪后的余量能够容纳时，可选修剪器可以修复一个已关闭的工具对。仅信封压力、粘贴的 `user/message` 等不可分割的超大非工具节点，以及不可修剪余量仍然过大的工具单元，依旧不属于压缩范围；限制这些单元是另一个关注点。

### 头部锚定：一个自动检查点，始终在头部

自动压缩始终从 surface 头部开始，将先前的检查点与新压缩的历史合并，因此只保留一个自动检查点。`shadowedRange` 因此是位置性的而非数值序号区间：一个较新的摘要序号可能占据较旧的 surface 位置。`shadowedSeqs` 记录权威的 surface 顺序。手动的中间范围压缩可能留下多个检查点。

### 近似收敛不变式

`resolveConfig` 提供可用默认值：阈值比例 `0.8`、保留尾部比例 `0.16`、空的摘要提供方/模型覆盖、`maxTokens: 8192`、`compactionRetries: 1`、`maxOverflowRetries: 1` 以及 `auto: true`。可选的精确提供方/模型策略会部分覆盖顶层默认值；压力根据拥有该路由的 LLM 适配器所报告容量缩放比例，而 `retainTokens` 可以替代按比例保留。保留量必须低于最终阈值。收敛仍然是动态的，因为提供方输出上限可能被隐藏或显式的推理 token 消耗，摘要大小也不可预测。如果压力仍高于阈值，`compactIfNeeded()` 会按配置的重试次数再次压缩头部检查点，但每次提交的摘要必须小于其遮蔽的内容。溢出不需要容量元数据，并会绕过阈值和保留尾部策略，执行一次最大且平衡的头部缩减，留下最新的不可分割单元。所有权划分由[已路由模型上下文与压缩策略 Agent Note](../architecture/2026-07-20-routed-model-context-and-compaction-policy.md)规定。

### Surface 替换：`compact/*` 事件仅存在于日志；一条 `user/message` 承载摘要

由于 `SurfaceEventType` 是封闭的，摘要不能搭载在 `compact/*` 事件上。后端改为追加一条**单独的 `user/message`**，带有 `source: COMPACT_CHECKPOINT_SOURCE` 和 `surfaceOp: { op: 'replace', start, end }`；其 `content` 是（带框架的）摘要，`sourceEventSeqs` 覆盖被遮蔽的条目*和*簿记事件。接口导出该来源和 `isCompactCheckpointSource()`，使消费方无需依赖后端包身份，即可识别持久化或克隆得到的检查点。`compact/*` 事件是纯日志记录（锁 + 溯源信息）。surface 变更位于锁**内部**，`compact/end` 是最后追加的事件：

```
compact/start    → log-only. Acquires the lock.
[summarize older range via the backend]
compact/summary  → log-only. Provenance: raw summary, range, shadowed seqs, token count.
user/message     → canonical checkpoint source + surfaceOp { op:'replace', start, end }.
                   THE surface mutation (framed summary).
                   deriveMessages() renders it as a user-role message.
compact/end      → log-only. Releases the lock (carries `error` on a recoverable failure).
```

`deriveMessages()` 随后产出 `[summary_as_user_message, ...retained_entries]`。复用 `user/message` 是诚实的而非变通：摘要确实*是* user 角色的上下文。

### 检查点框架 + 增量合并（后端私有）

基础后端将摘要包装为已建立的检查点上下文，并标记以便下一轮增量合并。原始摘要保留在 `compact/summary` 上。框架是后端策略；seam 承诺由一条替换 user 消息承载可能带框架的摘要，并使用规范的检查点来源。

### 通过日志记录的锁实现阻塞，加上崩溃/可恢复失败的分类

`compact/start … compact/end` 括号的存在理由，按当前实际承担的职责排序：

1. **可检测的崩溃孤儿 + 来源追溯**（首要）。摘要生成是一次慢速模型调用，持久化在 `compact/start` *之后*。摘要生成中途崩溃会留下一个没有匹配 `compact/end` 的 `compact/start`——一个可检测的孤儿。最后释放锁（而非最先）将崩溃窗口从*静默损坏*转变为可检测的孤儿。
2. **防止并发压缩。** 如果当前轮次持有未匹配的 `compact/start`，`compactRegion` 拒绝启动。（循环在任一 awaited 自动 seam 上都是单线程的，因此这也是重入绊线——抛出「already in progress」表示真正的 bug。）

该锁只排除另一项压缩，不排除无关的仅日志事实。基础后端会在 `compact/start` 之后对 token meter 的 surface 节点取快照，并在异步摘要后再次比较；任何 surface 变更都会使替换前的检查失败，而标题或其他仅日志追加不会使已选范围失效。

两种失败路径，均有文档记录：

- **崩溃**（循环在摘要生成中途死亡）：悬空的 `compact/start`，无关闭事件。由于 `compact/*` 是**仅日志**事件，孤儿是**惰性的**，不会落地摘要替换。派生 surface 保持为 `compact/start` 时已经持久化的 surface：如果修剪未产生替换，就是完整历史；如果已经修剪，就是已修剪历史。通用轮次修复（`interruptedTurnClosers`）用合成的 `turn/end` 关闭轮次；孤儿位于该 `turn/end` *之前*，因此轮次范围内的进行中检查永远看不到它，崩溃不会卡住未来的压缩。
- **可恢复**（摘要生成抛出异常但循环存活）：后端追加设置了 **`error`** 字段的 `compact/end`，但不落地摘要替换。步骤后压力处理发出警告，并从最新的持久 surface 继续：如果尝试前没有替换，就是完整历史；如果修剪已经落地，就是已修剪 surface。溢出恢复只会在没有任何替换前委托；先前修剪带来的 generation 进展允许从该持久 surface 重试，除非取消或资源释放胜出。

`compact/end` 保留其 `error?` 字段（与 `tool/result` 的自包含错误一致——一个事件即可区分成功与失败，无需关联兄弟事件）。没有单独的 `compact/error` 事件。

**核心 session 修复保持对压缩无感知——这是有意为之。** `interruptedTurnClosers` 从不被教导 `compact/*`。如果教导它，每个未来的 `xxx/start … xxx/end` 插件对都必须修补核心模块——这恰好是能力 seam 架构存在的意义所要避免的耦合。由于仅日志的孤儿是惰性的，不需要特殊修复：通用轮次修复加上未落地 surface 变更的惰性就足够了。

## 曾考虑的替代方案

- **完整算法作为接口的具体方法**——否决，因为它将契约重新耦合到一种保留策略。两个核心方法都是抽象的；可复用测量属于单独的 LLM 系列服务，`summarize()` 是 basic 唯一的钩子。
- **在 `agent/request` 或临时 `agent/pre-step` 输入上执行压缩**——否决，因为两者都无法证明最终的持久请求，而且都会将通用生命周期耦合到压缩专属的信封数据。步骤后回放与规范溢出恢复同时覆盖成功和被拒绝的调用。
- **`compact` 布尔值或无类型的请求元数据 map**——否决，因为多个辅助调用种类会变成互斥标志，而开放 map 会丢弃由编译器检查的词汇。一个类型化的 `purpose` 判别字段可以扩展其他调用种类，而无需再为 `GenerateOptions` 添加字段。
- **单独的 `compact/error` 事件**——否决：`compact/end` 保留 `error?` 字段，与 `tool/result` 的自包含错误一致——一个事件即可区分成功与失败，无需关联兄弟事件。
- **教导核心轮次修复识别 `compact/*`**——否决：仅日志的孤儿是惰性的，为每个未来的 `xxx/start … xxx/end` 插件对修补核心模块恰好是能力 seam 架构存在的意义所要避免的耦合。

## 后果

- **包**：`packages/compact/compact` 提供接口，`compact-basic` 提供后端，`compact-tool-result-prune` 提供可选的确定性重写。`packages/llm/token-meter` 独立拥有回放感知的测量。消费方层推迟。
- **自动 seam**：`agent/post-step`（`@mode serial`）处理成功调用的压力，`agent/request-error`（`@mode waterfall`）处理失败步骤关闭后的最终请求失败。通用 `agent/pre-step` 保持为四参数检查点，不携带压缩专属的提示词/前缀 payload。
- **`SessionEventMap`** 通过声明合并（merge-extensible）获得 `compact/start` / `compact/summary` / `compact/end`；`SurfaceEventType` **未被**触及。这些是会话事件，不是 cordis `Events`，因此事件分类门禁无需新增条目。
- **`dsh-compact`** 拥有 `COMPACT_CHECKPOINT_SOURCE`、`isCompactCheckpointSource(source)`、`toolPairingBalancedBefore(session, seq)` 与 `toolPairingBalancedAfter(session, seq)`。该标记用于跨后端实现识别替换摘要。带缓存的 surface 边缘检查会防止 `compactRegion` 和 `compactIfNeeded` 拆分工具调用/结果对，按 seq 校验当前成员关系，从每个切割点的一条平衡序列回答两侧边缘，并拒绝陈旧或缺失的 seq 与孤立结果。
- **`dsh-session`** 通过唯一的 surface 管理器校验位置替换、完整溯源信息和仅内容的单节点 `tool/result` 重写。其不变式配套插件将新追加的工具结果视为执行，要求存在已打开的步骤与待处理调用；已校验的替换仍是位于轮次内的重写。
- **接线**：`examples/tui-agent/cordis.yml` 依次加载零配置的 `dsh-token-meter`、`dsh-compact-tool-result-prune` 和 `dsh-compact-basic`；服务级默认值使组合无需重复数值策略即可使用。

## 测试

- **单元测试：** 使用真实 Loader 和 invariant 插件覆盖完整单元保留、修剪配置与回放、富块顺序、元数据保留、收敛、`compact/end` 的两种结果、开放尾部拒绝、仅修剪与带摘要的溢出恢复、generation 证明、上限和原始错误保留。
- **循环测试：** 测试固定步骤后处理发生在持久工具结果之后、`step/end` 之前，使用实际 `agent/request` 路由，关闭失败步骤，分配新的重试编号，并覆盖完整的抛出/带内溢出 → 压缩 → 重建重试组合。
- **带密钥 e2e：** 真实模型和 bash 会话在降低的限制下触发压缩，记录完整的 `compact/start…end` 对，缩小 surface，并完成任务。
- **快照缺口：** 失控轮次压缩尚无法回放，因为摘要调用未记录 `assistant/chunk` 事件或 `sessionId`；交错摘要调用的回放仍是后续工作。
