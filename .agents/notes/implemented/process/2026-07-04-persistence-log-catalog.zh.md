# RFC: 生成式持久化日志事件目录

Status: implemented

[English](2026-07-04-persistence-log-catalog.md) | 中文

## 问题

`SessionEventMap` 是磁盘上的词汇，但其声明分散在拥有它的 session 包（package）与声明合并中。生成式持久化目录是所有事件与 payload 的唯一参考；手工维护的表格会漂移，已被移除。这些记录不是 Cordis 事件，观察者通过单一的 `session/event` 总线事件接收它们，因此 Cordis 目录无法覆盖。生成器发现所有声明，doc-sync（文档同步门禁）的新鲜度门禁拒绝遗漏或陈旧的输出。

## 决策

从源码生成 `docs/persistence-catalog.md`，配合新鲜度门禁，作为第四个参考面：持久化会话日志可以包含的*记录*，与 Cordis 目录（接线）、核心数据结构（词汇）和工具目录（工具）互补。

`gen-persistence-catalog.ts` 使用 TypeScript AST 扫描所有拥有方与声明合并的 `SessionEventMap`。它渲染源码 JSDoc、payload 类型、派生的 surface 徽章、参考链接与源码位置。doc-sync 新鲜度检查会拒绝任何词汇变更后未重新生成目录的情况。

具体选择：

- **JSDoc 完整性，强制执行。** 每个成员必须带有描述性文字——JSDoc 即为目录条目，与 Cordis 目录对总线事件施加的强制机制相同。成员上的 `@mode` 标签是硬错误：dispatch mode 属于 Cordis 总线事件，日志事件没有 mode，该标签会被误读为「此事件以模式 X 在总线上触发」。违规项聚合为一条错误，列出所有违规者。
- **surface 徽章由派生得出，而非手工列举。** `SurfaceEventType`（产生 LLM（大语言模型）消息且可能携带 `surfaceOp` 的子集）从拥有方包中的 union 声明解析；如果 union 成员命名了一个未声明的事件，则为硬错误（否则陈旧的 union 成员会静默地不标注任何内容）。其余一律渲染为 **log-only**。
- **专用围栏。** payload 块使用 ` ```ts persistence-catalog ` 信息字符串，`doc-typecheck` 识别并跳过它，不计入 opt-out 比例——与 `ts cordis-catalog` 的处理方式相同（裸 payload 片段无法独立编译）。
- **仓库范围。** 目录枚举本仓库中的包，与兄弟文档的 packages-only 范围一致；下游插件可以合并更多事件类型，它们在设计上不在目录范围内。遍历过程用硬错误保护自身假设：拥有方的顶层 `interface SessionEventMap` 必须是 `@deepseek-ai/dsh-session` 中唯一的导出声明（无关的、局部的或同名重复的接口不能被当作磁盘词汇编入目录）；任何声明不得携带 `extends`（继承的键会加入 `keyof SessionEventMap` 却没有对应的目录行）；每个成员必须是带有显式 payload 类型的属性签名（方法形式的成员会加入 `keyof` 却在静默遍历中被漏过）；跨声明的重复成员也会失败。

本方案取代了手工副本：session.md 的 `hook/*` 表格、精简版 README 的事件表格、hook-protocol README 的 payload 条目列表，以及 session README 的名称列表现在链接到目录，而不再重述 payload（周围的语义说明文字保留原位）。hook-protocol 合并成员上的两个误加的 `@mode emit` 标签已被移除——新门禁将它们作为类别错误拒绝。

## 曾考虑的替代方案

- **基于启动的生成器（类似工具目录）**：日志词汇完全是静态的，AST 遍历无需启动任何东西即可读取全部真相。
- **保留手工副本**：手工副本只能检查作者已经写下的名称；目录落地时，session README 的合并说明已经漂移。

## 后果

- 目录不会漂移：词汇变更若未反映在已提交的文件中，`verify-persistence-catalog` 会在 pre-push 钩子和 CI 中失败；新合并的事件若缺少 JSDoc，生成器直接报错——插件不再能添加未文档化的磁盘记录类型。
- 事件描述有唯一归属地，即声明处的 JSDoc；JSDoc 写得单薄，目录条目就单薄，这迫使作者在源头做好文档。
- `SurfaceEventType` union 现在对文档具有结构性承载作用：重命名事件而不更新 union（或反过来）会导致生成器失败，而不仅仅是编译器失败。
- 徽章派生假设 union 始终是一组封闭的字符串字面量且只有一个拥有方；如果重构偏离了这一形状，必须在同一个变更中更新生成器。
