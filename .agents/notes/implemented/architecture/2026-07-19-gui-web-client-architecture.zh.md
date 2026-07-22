# RFC: Web 客户端架构——client cordis 插件树、slot 体系与 React-free 对象层

Status: implemented

[English](2026-07-19-gui-web-client-architecture.md) | 中文

> 分工线：通道无关的分层模型与 RPC 协议（消息模型/类型体系/契约面/客户端基类）见 [分层与 RPC 协议 RFC](2026-07-19-gui-layering-and-rpc-protocol.md)；本篇 = 浏览器侧：client cordis 树如何装载、UI 插件如何经 slot 与服务组合、React-free 对象层如何以不可变快照供给 React。

## Problem

浏览器客户端受两股力塑形。其一是流式：事件驱动的对话 UI 里，若业务状态（事件窗口、流式累积、待答交互、连接状态机）散落在 React 组件与全局 store 中，每个 token 分片都会震荡渲染树，且换 UI 库等于重写业务逻辑。其二是模块化：UI 功能（布局、侧栏、对话、主题、语言包）必须是可独立装载的插件——按 host 下发的 manifest（元数据清单）在运行时组合，而非编译进单一 bundle——同时不放弃跨插件边界的编译期类型安全。

## Decision

两端都跑 cordis。host 是一棵 cordis 插件树；浏览器里跑第二棵 client 侧 cordis 树，其中每一项 UI 能力都是插件，由壳静态持有的 loader 动态装载。树内 cordis ctx 承载一切运行时事实（服务、store、会话 scope），React 是纯投影：组件对框架零 import，一切经 props 注入，经 `useSyncExternalStore`（下称 uSES）订阅不可变快照。

```
┌─ Host ─────────────────────────┐   ┌─ Browser ─────────────────────────────────────────┐
│ sessions/agents/SessionLog     │   │ client cordis root ctx                             │
│ apiproxy: RPC + mux/host 双流  │◀─▶│  ├ loader（壳静态持有，不能经自己装载）             │
│ webserver:                     │   │  ├ immediately 先行组: connection/runtime/         │
│  ├ GET /plugins/<id>/client.js │   │  │   ui-theme/i18n（动态 bundle，并行先装）        │
│  └ GET / 注入 __DSH_BOOT__     │   │  ├ 后续组: layout/sidebar/conversation/trajectory  │
└────────────────────────────────┘   │  └ session scope ×N（观看驱动，惰性建）            │
                                     │ React: loading 页 → settled → 整 UI 一次成型       │
                                     └────────────────────────────────────────────────────┘
```

## client cordis 树与装载链

每个 UI 插件同时是一个 host 插件（双入口包）：node 半边住在 host 的插件树里，由 host Loader 管辖其生命周期；浏览器半边是 tsdown 闭包 bundle，挂在包的 `exports["./client"]` 下。host webserver 从带 `dshClient` manifest 字段的已加载插件推导启动清单，注入页面为 `window.__DSH_BOOT__`——HTML 到手即知要拉什么，零额外往返。

装载链全程：

1. `GET /` → 壳启动，挂 `ctx.loader`（loader 机件由壳静态持有——装载器不能经自己装载；其代码家在 `packages/client/runtime/src/client/loader/`，壳经 `./loader` 子路径 import，避免壳 bundle 吞掉 runtime 包其余部分），把纯库实体（react、react-dom、cordis、ui-slots、web-react、ui-primitives）播种进 require 模块表，渲染一张不依赖任何插件的 loading 页。
2. `loader.start()` 读取 `__DSH_BOOT__`。带 `immediately` 标记的条目构成先行装载组（connection、runtime、ui-theme、i18n）：并行拉取、按组内 `inject` 拓扑序 apply，**全组就位后才开始装载其余插件**。其余插件随后按 inject 序装载。
3. 每个 bundle 执行 `window.DSHClientProxy.loadPlugin({ id, factory })`。loader 调 `factory(require)`——bundle 是闭包工厂，external 依赖经注入的 `require` 到达，从模块表解析（无全局变量、无 import map；解析不到的标识符即刻大声失败）。factory 返回其模块导出面（含 cordis `apply`）；loader 执行 `ctx.plugin(apply)`，随后**以包名把该导出面登记进模块表**——inject 拓扑保证后装插件可 `require` 先装插件。插件 CSS 内联在 bundle 里，注入为 `<style data-plugin="<id>">`（CSS Modules 哈希 + 归属标记 = 隔离）。
4. `await loader.settled()` → 壳从 loading 页一次切换到真 UI。单插件装载失败在 loading 页大声报错；不存在部分可用模式（渐进渲染为后置工作）。

**双实例禁令**：模块表包若被内联进插件 bundle，会复制运行时身份（两份 React、两套 store 注册表——一次真实白屏 P0 的根因）。tsdown client 预设在构建期把守纯度：模块表包的裸名 import 必须解析为 external（适用时改写为其 `/client` 形态），其余任何非 inline 安全 wire/类型层的 workspace 泄漏都令构建大声失败（`packages/client/tsdown.client.ts`，由 `scripts/client-bundle-purity.spec.ts` 钉住）。

dev 与 prod 同链：插件在 `tsdown --watch` 下重编译，刷新即重走同一条链；vite 只管壳（`apps/web`）。类型宇宙在聚合层拆分——`tsconfig.host.json` 是 host program、`tsconfig.client.json` 是 client program，二者由 solution 根 `tsconfig.json` 引用，因为两侧都在相同键（`sessions`、`loader`）上对 cordis `Context` 做声明合并且服务不同；client 包经纯类型子路径（`@deepseek-ai/dsh-session/types` 等）消费协议词汇，host 侧的声明合并不会搭车进入 client program。

## slot 体系：页面怎么拼

slot 体系有自己的 RFC——[slot 体系标准](2026-07-22-slot-type-chain-implementation.md)——本文整体移交给它。此处只留一段定位摘要：壳只渲染 `'root'`；插件用单独一次 `register` 调用组合 UI——占坑、声明并授权子坑（`children` spec 对象）、声明 store、注入业务面；组件 props 分四份额自动推导到达（`PropsRuntime<K>` / `PropsRenderSlots<S>` / `PropsStore<H>` / inject），各有唯一真源。`SlotMap` 声明合并仍是类型权威，entry 只携带 owner 份额（「谁注入的，类型归谁」）；每个被渲染的注册项都在 per-entry 错误边界之内。

实现的家：注册表核心与 props 份额类型在 `packages/client/ui-slots`，出口组件/渲染器/uSES 桥在 `packages/client/web-react`。

## 服务与 scope 寻址

服务是插件对其他插件的唯一 API 面（UI 组件与注入面都不是 API；无人调用的插件不挂服务——ui-trajectory 即最小插件样板：无 ctx 服务，只 merge 视图表）。名册：`ctx.connection`（api client + 流句柄）、`ctx.slots`（注册表包装层，发 `slots/changed`，渲染入口，渲染器安装缝）、`ctx.sessions`（列表 store、当前会话状态、scope 树）、`ctx.loader`、`ctx.theme`、`ctx.i18n`、`ctx.layout`（跨插件视图导航）、`ctx.conversation`（send/cancel/views/startSession）、`ctx.toolviews`（具名按工具渲染注册表，带按会话 scope 过滤）。过去住在服务 store 里的观看态（面板宽、选中、草稿）现按 [slot 体系标准](2026-07-22-slot-type-chain-implementation.md) 住 entry 声明的 store。

SlotMap 之外还有两条同 declare-merge 惯例的类型化注册环：**视图环**（`ConversationViewMap`——entry 可声明 `chromeProps`/`extraProps` 扩展形状；`ConvViewPropsOf<Id>`/`ChromePropsOf<Id>` 组合基座+扩展，无声明的视图免费得基座，ui-trajectory 的两个 entry 带真 per-view props）与**工具环**（tool 名保持开放集——无全局键表；类型强化在 entry 内部：`ToolViewProps.block` 是 runtime 定义的真 `ToolCallBlock` union，register 同 slots 一样推断注册方注入份额）。

**scope 寻址**与 host 侧 agent scope 惯例同构：服务是 root 单例，方法不收 sessionId——它们读调用方 ctx 上的 scope 标（`scopeOf(ctx)`）。在会话 scope 内，`ctx.conversation.send('hi', 'queue')` 自动打到该会话；跨会话调用换 ctx 定向（`ctx.sessions.scope(id)!.conversation.send(...)`）；从 root ctx 直接调 scoped 方法即 throw。client 会话 scope 的铸造方式与 host agent scope 相同（no-op 插件 fiber + scope 键 extend），首次观看时惰性建，只有会话被移除且无人观看才拆——仅 host 会话死亡不拆 scope（冻结为只读视窗）。

## 数据对象层（`packages/client/runtime/src/client/sessions/`）

帧从这里进、快照从这里出、fold 坐在中间——React-free（零 React import，grep 可断言）：

```
mux/host 帧（ConnectionController 泵入，sinks 注入）
        │
        ▼
SessionManager.handleMuxEnvelope / handleHostEnvelope
        │ 带 sessionId 的帧只投已存在实例（审批/问答 requested 例外：进 pendingBuffers 缓冲）
        ▼
Session.handleMuxEnvelope ──► events 窗口（seq 连续升序）
        │                        │ 定稿事件            │ chunk
        │                        ▼                    ▼
        │                   FoldAdapter        PartialAccumulator
        │                  （→ nodes）          （→ partial）
        ▼
Notifier 微任务合批 ──► ConversationSnapshot 缓存 ──uSES──► 组件
```

- **Session**（session.ts）：懒建、常驻——建成后在后台持续吃帧，切走切回秒显。操作面：`prompt`/`cancel`（RPC 透传；失败落进快照的 `promptError`）、`open`（拉尾页 history，幂等）、`loadOlder`（向上翻页，防重入）、`resync`（重连 = 清窗口重跑 open）。订阅面：`subscribe`/`getSnapshot`（恒返缓存引用）——`implements ObservableSnapshot<ConversationSnapshot>`，构造时挂 `useSelector = bindSnapshotSelector(this)`，Session 本身就是 uSES 源。帧分发是一个 switch：`session/event` 帧按 seq 去重（唯一去重键），open 在途时缓冲，否则追加 + 增量 fold；open/缝合按 seq 合并 live 缓冲并去重，`subscribed.lastSeq` 超出窗口尾则回补一次。
- **ConversationSnapshot**（conversation.ts）：不可变快照契约——`nodes`（fold 产物，surface 序）、`partial`、`runningCalls`、`pending`、`running`、`removed`、`openState`、`hasMore`、`promptError` 等。**引用纪律**（memo 与 uSES 的前提）：顶层对象每变必新；nodes 数组重建但元素引用来自缓存；未变的子结构复用上一快照的引用。
- **SessionManager**（manager.ts）：实例簇 + 帧总入口 + 会话列表。带 sessionId 的帧只投已存在实例（mux 广播不得把每个会话都实例化）；例外是审批/问答 `requested` 帧——它们不落 history、open 无法回补，故缓冲进 `pendingBuffers`，实例化时回放。
- **Notifier**（notifier.ts）：两条通知通道，按变更来源取用。`markDirty()`（默认；帧驱动一律用它）按微任务合批——N 次变更、一次通知、一次重渲染；flush 先重建快照缓存再通知。`notifyNow()`（仅用户手势的直接回响）同 tick 重建并通知——受控输入的回响若延到微任务，DOM 会回滚、光标跳尾。帧驱动代码用 notifyNow 会让合批塌回逐帧渲染；禁。
- **FoldAdapter / PartialAccumulator**：fold 复用核心 SurfaceManager（`@deepseek-ai/dsh-session/surface`），垫哨兵事件使 seq > 0 起头的分页窗口满足核心的 `seq === index` 断言；跨窗口 replace 时降级为容错线性扫描并置 `foldDegraded`。分片完全不进 fold（O(1) 跳过）：累积器把 StreamChunk 折叠成 `AssistantBlock[]`，一次增量只换该块引用；定稿消息到达即在同一批内弃掉累积器（提升无闪烁）。成本模型：一个分片 = 一次字符串拼接 + 一个脏标记；帧风暴下未订阅的 Session 只花那个标记。
- **ConnectionController**（在 `packages/client/connection`）：开 mux/host 双流、for-await 泵入，代际围栏之内指数退避重连（500ms 翻倍至 10s 封顶、抖动、无限重试）；sinks 单向注入（Controller 不认识 Session）。重连 = 重建：`onConnected` → 列表刷新 + 各已打开会话 resync。对象层只面向 `IApiClient`；Web 承载（HTTP POST 载两个 client→server 象限、SSE 载两个 server→client 象限）与客户端类族归分层 RFC 属地。

## React 面（`packages/client/web-react`）

胶水包就是整条 ctx↔React 边界；组件保持零框架依赖。

- 快照 store 引擎**住 runtime 包**（zustand vanilla + 草稿式更新，缺省 `flush: 'sync'`，帧驱动 store 可选 `'raf'` 合批，可选整值 localStorage 持久化，dev 深冻结——全部从 `runtime` 的 `./client` 主出口导出，无子路径）：store 产物是裸的可观察源，不带任何 hook 成员。插件只经 [slot 体系标准](2026-07-22-slot-type-chain-implementation.md) 的 `defineStore` 声明触及引擎。web-react 在绑定处（`bindSnapshotSelector`，按源缓存）从 React 消费的唯一数据契约合成每个 hook：`ObservableSnapshot<T>`（`getSnapshot`/`subscribe`）——Session 对象与快照 store 同构满足它。业务插件包只依赖 runtime 与 ui-slots；web-react 是仅壳可用的胶水。
- `bindSnapshotSelector(source)`：把一个源绑定为经 uSES-with-selector 的带类型 selector hook。uSES 契约四条按构造成立：getSnapshot 恒返缓存引用；subscribe 是绑定期闭包（引用永稳）；纯 CSR 不传 server snapshot；相等性缺省 `Object.is`，按调用可选 `shallowEqual`。
- `useInvoke(fn)`：把异步动作包成引用恒定的触发器加 pending 标志；pending 走 per-hook 外部 store 经 uSES 读出（渲染路径零 setState），并发调用计数，invoke 引用永不变。
- 相等性协议，全链一致：生产端结构共享；消费端以 `Object.is` 或 `shallowEqual` 短路；`React.memo` 浅比较。深比较全链禁止。

## 目录形态

十二个 `packages/client/*` 包（ui-slots、ui-primitives、web-react、connection、runtime、ui-layout、ui-sidebar、ui-conversation、ui-trajectory、ui-theme、i18n、web）加 `apps/web`——vite 应用，壳 boot 导出之上的薄 `main`。插件包的浏览器半边在 `src/client/` 下；**一切构建产物落 `lib/`**——node 半边为 `lib/index.js`/`lib/invariant.js`，浏览器 bundle 为 `lib/client.js`（共享 tsdown client 预设两者皆出；无 `dist/` 目录，`exports["./client"]` 指向 `./lib/client.js`）。依赖方向：`ui-slots ← web-react ← runtime ← ui-*（并列）← web`，ui-primitives/ui-theme/i18n 为零依赖旁路。

多域插件包的 client 半边还按未来包边界再拆——ui-conversation 即样板：

```
src/client/
  contract/    the only shared face between domains (types + composed props shares)
  service.ts   cross-domain orchestration (imports contract only)
  skeleton/    domain: shell components (ConversationRoot/InputBar/EmptyState/DetailsPanel)
  chat/        domain: the chat view
  toolviews/   domain: the tool-row registry and samples
  apply.ts     the ONLY file allowed to import across domains (assembly point)
  index.ts     thin re-export shell (contract + apply + components)
```

域实现文件永不 import 兄弟域——共享面一律走 `contract/`（如 chat 经 `ToolViewResolver` 读面接口消费工具注册表，不碰注册表类）。`scripts/verify-client-domain-graph.ts` 把守分层（contract=0、域=1、apply/index=2；import 只准指向 ≤ 自己的层级；兄弟域边即失败）。将来拆包=每个域目录升格为包+机械改写 import 路径。

## 怎么开发

- **新 UI 功能** = 新插件包：package.json 声明 `dshClient`（+ `inject` 拓扑），浏览器半边写在 `src/client/`（apply 挂服务/建 store、注册 slot 与 toolview），无 host 逻辑时 node 半边保持空 apply，用共享预设构建。把插件加进 host 配置；清单与装载随之自动跟上。
- **新 slot**：见 [slot 体系标准 RFC](2026-07-22-slot-type-chain-implementation.md)——契约合并进 `SlotMap`，在父 entry 的 `children` 里声明，经自动注入的 `renderSlot` prop 渲染。永不全局导出组件。
- **消费新帧类型**：带 sessionId → Session 分发 switch 加一个分支；host 级 → Manager 路由表；UI 需要时给 `ConversationSnapshot` 加字段并守住引用纪律。
- **状态住哪**：业务数据（事件、流式、待答）→ 永远对象层；父知道的 → renderSlot 现场的 owner props；单组件私有（滚动、搜索词、展开集）→ 组件状态；跨 entry 共享或跨重挂载存活（选中、草稿、面板宽）→ entry 声明的 store（[slot 体系标准](2026-07-22-slot-type-chain-implementation.md)）。
- **通知通道**：帧驱动/异步 = `markDirty` 合批；受控输入需要同 tick 的用户手势直接回响 = `notifyNow`。

## Consequences

token 流不再震荡渲染树：帧风暴对未订阅会话只花一个脏位，对被订阅视图每微任务一次合批重渲染（帧驱动 store 走 raf 合批）。UI 功能以独立插件的粒度装载、失败、停用——一个崩溃的 slot 注册项只黑一张卡，一个装载失败的 bundle 在 UI 切入之前大声报错。接受的代价：loader/模块表机件是团队端到端自持的定制基建；一次成型启动（无渐进渲染）用首屏粒度换装配简单；双类型 program 让「这个文件归哪个聚合」成为开发者偶尔要回答的问题。

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| 静态链接的单 SPA bundle | 插件必须由 host 在运行时按配置组合；单体把每个 UI 功能重新耦回一次构建 |
| window 全局变量 / import map 供共享依赖 | DI require 表让共享显式、大声失败、可替换；全局变量静默泄漏身份与版本 |
| 业务数据进 zustand 切片 | 事件窗口/累积器是行为状态机，不是扁平切片；对象层保住快照粒度与合批的可控性 |
| 工具行走字符串键的全局组件注册表 | 工具视图被多个视图共同消费且要按会话差异化——带 scope 过滤的具名服务（`ctx.toolviews`）才是诚实形态 |
| P-I 就做渐进/Suspense 启动 | 一次成型严格更简单；loader 的按插件状态面已保留，渐进点亮日后可落地而无需重构 |
