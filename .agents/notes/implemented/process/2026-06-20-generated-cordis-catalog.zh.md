# RFC: 生成式 Cordis 事件与服务目录

Status: implemented

[English](2026-06-20-generated-cordis-catalog.md) | 中文

## 问题

插件作者需要两个参考面，而此前没有任何单一文档能提供：他们可以监听的每一个 Cordis **事件**（含精确签名与分发模式），以及他们可以调用的每一个 `ctx.<key>` **服务**（含精确接口）。相关信息虽然存在，但散落各处：`docs/architecture.md` 中一张手工维护的事件分类*表格*（名称 + 行文描述的 Mode/Purpose，由 `verify-event-taxonomy` 做名称集合校验）、一张服务映射表（8 行角色描述），以及 `interface Events` / `interface Context` 声明本身。分类表格还有一个盲区：它无法捕获全新的*未记录*事件——名称集合校验器只检查两侧已有的名称。

这是 [core-data-structures 目录](../../../core-data-structures/core.md)（[其 RFC](2026-06-20-core-data-structures-catalog.md)）在连线轴上的补充：后者编目的是 agent loop（智能体循环）流转的*数据结构*（经校验的手工粘贴）；本 RFC 编目的是移动这些数据结构的*事件与服务*。

## 决策

从源码生成目录，取代手工维护表格并校验子集的方式。

`scripts/gen-cordis-catalog.ts` 使用 TypeScript 编译器 API，从声明和源码 JSDoc 分别输出事件参考与服务参考。事件包含分发模式；服务包含公开签名。确定性的 `--write` 和 `--check` 模式使两个页面成为生成产物，新鲜度由 `doc-sync`（文档同步门禁）强制保障。

纯生成在此处是正确的，因为代码库足够规范，AST 就是全部事实：每个事件/服务名称都是字符串字面量，可以往返映射到静态声明——不存在动态命名的事件，也不存在仅运行时的服务。因此生成的文档不可能出错，且从结构上消除了未记录事件的缺口（生成器枚举源码，而非校验手写子集）。

具体选择：

- **`@mode` 标签，交叉校验。** 每个 harness 事件的 JSDoc 携带一个显式的 `@mode emit|waterfall|parallel|serial` 标签；缺少标签时生成器直接报错。当签名形状具有决定性时——尾部参数为 `next: () => …` 在结构上即为 waterfall（瀑布式事件）——生成器断言标签与之一致，矛盾时直接报错。emit/parallel/serial 的区别在结构上不可见（`session/flush` 返回 `Promise<void> | void` 且无 `next`，有序的 `agent/pre-step` 检查点亦然），因此信任标签。编写规则见 [AGENTS.md](../../../../AGENTS.md)。
- **分层范围。** harness 层（8 个 `@deepseek-ai/dsh-*` 服务及其事件）从源码完整渲染。继承层（cordis-core 的 `ctx.on/emit/effect/provide/…` + `internal/*` 事件 + loader/hmr/timer）是插件同样可见的固定 vendor 源码；它从生成器中一张人工维护的表格简洁渲染（名称 + 一行描述 + 源码指针），而非遍历 vendor AST。原因是 cordis-core 的 `Context` 混合了真正的 ctx 成员与非服务字段（`root`、`baseUrl`、`logger`），且 vendor 接口面仅在有意的 vendor 同步时才变化。
- **交叉链接到数据结构目录。** 签名中的类型名（`GenerateOptions`、`StreamChunk`、`ToolDefinition` 等）链接到记录该类型的 core-data-structures 页面。映射是生成器中一个小型的人工维护常量，而非 `type-equiv.manifest.json`——后者记录的是 `…Map` 符号，而签名引用的是派生联合类型名，且有少数符号出现在两个页面上。
- **专用围栏。** 签名块使用 ` ```ts cordis-catalog ` 信息字符串，`doc-typecheck` 识别后跳过（裸签名片段不能独立编译），并排除在 opt-out 比例之外——与 `type-equiv` 块获得相同待遇。

本决策**取代** [doc-sync 强制](2026-06-11-doc-sync-enforcement.md)中事件分类的那一半：`verify-event-taxonomy` 及其 `docs/architecture.md` 表格退役（architecture.md 的标题保留，正文改为指向目录；服务映射的角色表格作为人工行文保留）。doc-typecheck、verify-md-wrap、verify-md-links 和 verify-type-equiv 不受影响。

## 曾考虑的替代方案

- **校验而非生成（退役的分类检查所做的事）**：*仅对本参考面*反转了这一策略。此处的数据可以机械地完整获取，因此生成严格强于对手工表格做名称集合校验（完整签名、不会漂移、能捕获未记录事件）。
- **遍历 vendor AST 以获取继承层**：否决，改用人工维护表格。cordis-core 的 `Context` 混合了真正的 ctx 成员与非服务字段，且固定的 vendor 接口面仅在有意同步时才变化。
- **复用 `type-equiv.manifest.json` 作为签名交叉链接映射**：否决，改用小型人工维护常量。manifest 记录的是 `…Map` 符号，而签名引用的是派生联合类型名，且有少数符号出现在两个页面上。

## 后果

- 目录不会漂移：源码变更而已提交文件未反映时，`verify-cordis-catalog` 在 pre-push 钩子和 CI 中失败。新事件缺少 `@mode` 标签，或标签与签名矛盾，生成器直接报错。
- 事件的行文描述现在有了唯一归属地——声明处的 JSDoc。JSDoc 写得单薄，目录条目就单薄，这迫使作者在源码处做好文档（生成器是 AGENTS.md「每个导出都有语义 JSDoc」规则的强制函数）。
- 继承层是手工摘要，因此 vendor 同步若新增或重命名了 cordis-core 事件或 `ctx` 成员，需要同步编辑 `gen-cordis-catalog.ts` 中的人工维护表格。这是不遍历固定 vendor 源码的有意代价；它很少变化，且在生成器中有明确标注。
- `verify-event-taxonomy.ts` 被删除，`docs/architecture.md` 的事件表格也已移除；之前链接到特定表格行的人现在会落在生成目录上。
