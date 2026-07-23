# Agent Note: slot 体系标准——单一 register、props 四份额与框架 store 席位

Status: implemented

[English](2026-07-22-slot-type-chain-implementation.md) | 中文

> 范围：Web 客户端 slot 体系的终版设计——UI 插件如何拼合页面、渲染权威落在哪里、组件 props 如何定型、业务活数据住在哪里。周边语境（装载链、对象层、服务）归 [Web 客户端架构 RFC](2026-07-19-gui-web-client-architecture.md) 所有，其 slot 各节移交本文。

## Problem

页面在运行时由各自独立装载的插件拼合而成，UI 因此需要一套能以静态强制力回答四个问题的组合机制。谁可以渲染进某块区域——这份权威是可强制执行的，还是仅靠约定？组件如何在保持纯函数（零 ctx、零框架 import）的同时拿到它需要的一切，而不必把每个值都经装配代码手工穿线？业务活数据住在哪里，才能让流式更新恰好只重渲染订阅者——而不必每个插件自建一套订阅机械？以及这一切有多少能交给编译器检查，让漂移的组件、越权的渲染调用、错配的 store schema 成为单一可见调用点上的编译错误，而非运行时的意外？

## Decision

一句话：**壳只渲染 `'root'`；插件用单独一次 `register` 调用组合 UI——这一次调用同时占坑、声明并授权子坑、声明 store、注入业务面；组件是纯函数，props 分四份额到达，每一份额都从各自唯一的真源自动推导。**

### 'root' 是唯一的先验坑

`SlotsService`（client 运行时）在构造时声明 `'root'`——single/root、`owner: {}`——其 `SlotMap` 合并声明住 runtime 包（package）。壳的全部装配就是 `ctx.slots.renderSlot('root', {})`：唯一的 ctx 级渲染入口；传任何其他键、渲染器未安装、root 无人注册，一律大声失败（无 fallback）。

### register 是唯一 API；children = 声明+授权+运行时 spec

```ts ignore-check
ctx.slots.register({
  name: 'root',
  children: {
    'sidebar':      { kind: 'single', scope: 'root' },
    'conversation': { kind: 'single', scope: 'session' },
  },
  store: createLayoutStore,      // StoreHandle or factory (below)
  inject: injectFrame,           // business face (below)
}, AppFrame)
```

不存在独立的坑位定义 API。`children` 对象同时做两件事：**把子坑声明出来**，并**授权本组件渲染它们**——坑是渲染树上的一个洞，因为有人要渲染它才存在，所以坑的生命周期就是声明它的 entry 的生命周期（entry 一经 dispose（资源释放），坑随之消亡、坑内既有贡献清空）。children 的值是运行时 spec（`kind`/`scope` 驱动 outlet 的迭代形态与 binding 选择；`SlotMap` 是纯类型、运行时即被擦除，这正是键数组形行不通的原因），并与对应 `SlotMap` entry 静态对齐校验——类型与值在同一点声明、交叉验证。

对等原则：**声明子坑的 entry 独占渲染这些子坑的权力**，全部在 register 时结清（配置错误在装载时大声失败；渲染热径零校验）。装载即炸的情形：第二个 entry 声明已被声明的坑；向未声明的坑 register；同一个 store 句柄挂到两个 scope 之下。

`SlotMap` 声明合并仍是类型权威，且 entry 只声明自己的轴加 **owner 份额**——注册方注入的 props 永不进入全局表（「谁注入的，类型归谁」）。

### 组件 props：四份额，各有唯一真源

| 份额 | 类型 | 真源 | 内容 |
|---|---|---|---|
| 运行时 | `PropsRuntime<K>` | K 对应的 SlotMap entry | `OwnerOf<K>`（渲染现场传参）+ session scope 标配 `useSession`/`sessionId` + 全局 `useSessions` |
| 子坑渲染 | `PropsRenderSlots<S>` | register 的 `children` 键集 | `renderSlot(key, owner)`，键参静态收窄到 S |
| store | `PropsStore<H>` | store 工厂的返回类型 | `useStore` selector hook + `actions.*`（剥去 draft 形参） |
| 业务 | `I` | inject 的返回类型 | 普通数据+回调（禁 hook） |

凡声明 `scope: 'session'` 之处，`sessionId` 一律由框架供给——owner 传参不携带它。register 调用点是双向锁的收口：组件的 renderSlot 键集超出 `children` 声明、漏接某个已声明的面、store/inject 形状漂移，任何一条都在那一行上报编译错误。转授就是普通的 props 传递（把 `renderSlot` 函数递下去，可按需包一层更窄的签名）——不存在白名单面对象，也不存在铸面 API。

### store 席位：引擎归框架，schema 归注册方

框架拥有恰好一台订阅机械：快照 store 引擎（zustand vanilla + immer + 可选 localStorage 持久化）住 **runtime 包**（`./client` 主出口——无子路径），产出裸的可观察源；web-react 在 outlet 处把它们绑定成 hook（按源缓存的 uSES 绑定）。store 里*装什么*是注册方的声明，且必须写成工厂函数，使模块级句柄根本无从存在（模块级句柄会成为跨插件重载存活的事实单例）：

```ts ignore-check
export function createChatStore() {
  return defineStore({
    init: () => ({ selection: null as SelectionTarget | null, draft: '' }),
    persist: 'dsh.conversation.chat',
    actions: {
      select:    (d, t: SelectionTarget) => { d.selection = t },
      clearDraft:(d) => { d.draft = '' },
    },
  })
}
```

一个工厂，三个消费点：① `register`——独占 store 直接传工厂；要共享实例，则在 `apply` 里调用一次工厂、把同一句柄传给多次 register（跨插件共享构造性不可能：句柄从不出包）；② `PropsStore<ReturnType<typeof createChatStore>>` 推导出组件的 store 份额，零手写成员；③ 测试自己调用工厂并 `.create()` 出真引擎实例，把 `useSelector`/`actions` 直接当 props 喂进去——生产 outlet 走的正是同一条 `create` 路径，不存在第二套机械。

store 的 scope **从挂载 entry 的 scope 推导**（session 坑→每个会话一个实例，随会话生灭；root 坑→每个 entry 一个）。读 = `props.useStore`；写 = 仅 `props.actions.*`——裸实例（带 `update`/`set`）永远到不了组件，声明的 actions 就是完整且可审计的变更面。生产代码在 `apply` 之外从不调用工厂或 `create`。

### inject：注册方的业务面，立足自己的 ctx

inject 工厂只收其声明挣来的形参——session 坑得 `sessionId`，声明了 store 的得绑定好的 `actions`，否则无参——取服务一律经 **apply 闭包自己的 ctx**，其能力边界因此就是本插件声明的 `inject` 拓扑（cordis property proxy 原生生效；不存在携带更宽 ctx 的装配句柄）。返回值只含普通数据与回调：本插件自有服务的收窄读写面、跨服务编排（如 `send` = `actions.clearDraft()` + `ctx.conversation.send(...)`）、以及 per-(entry×session) 的装配副作用。禁 hook、禁 ReactNode 生产者、禁递整个服务对象——收窄本身就是价值：组件能做什么，恰由工厂返回值的形状圈定。

### 数据界线纪律

hook 只许框架造：`useSession`、`useSessions`、`useStore`、`renderSlot` 是仅有的四席，各实现一次、正确性由框架担保；业务代码在父子组件之间只传普通数据与回调（组件自用、不订阅任何外部数据源的行为 hook 不在此限）。活数据恰有三条通道：父知道的，作为 owner props 在 renderSlot 现场传入；只有组件自己知道的，是本地 state；需要跨 entry 共享或跨重挂载存活的，是声明的 store。派生是对框架 hook 数据做纯函数（`useMemo`），绝不自成一路订阅。

### 树上语境与渲染器安装缝

`SessionProvider` 是框架组件，**以标配席形式送达**：`children` 里声明了 session scope 坑的 entry 经 prop 收到它（类型住 ui-slots，值由渲染器注入）——组件永不对它做值 import。它框架自接线（内部自读 runtime 的当前会话状态，装配方零传参），render-prop 形——`children(sessionId)` 外加 `empty` 分支，以 `key={sessionId}` 重挂。`BindingContext` 属机械内部；业务组件可见的 React Context 为零。inject 工厂有意在 outlet 内部执行（per-entry 错误边界接得住它们；崩溃的注册方只黑掉自己那一格，装配错误则重抛）；outlet 把树上语境当作仅机械可用的暗参读取——即「身份出自 register 闭包、现场出自树位置」的分工。

渲染住在一条安装缝之后，runtime 因此保持 React-free：`SlotRenderer`（接口住 ui-slots，实现 `createSlotRenderer()` 住 web-react）在壳 boot 时经 `ctx.slots.install(...)` 安装一次；双重安装与安装前渲染均 throw。归属记账是服务里的单一 `Map<key, entry>`——账本、坑、贡献、渲染绑定、store 实例全部沿同一条 entry 轴生灭，跨插件重载的陈旧权威窗口由此在构造上关闭（已 dispose 的 entry 所捕获的 `renderSlot`，一进入口即抛陈旧授权（stale-authorization）错误）。

### 类型链实现裁定

register 签名里的两条硬化裁定之所以存在，是因为显然的替代方案会以具体、可复现的方式失败；将来的编辑者不应重新争论它们：

1. **注册位用 `SlotComponent<P>`（裸调用签名）而非 `FC<P>`。** React 的 `FC` 携带静态字段（`propTypes`、`defaultProps`），其类型在协变位引用 `P`；两个 `FC` 实例化之间的可赋性检查连这些静态位一起查，会拒绝设计本想接受的组件。裸调用签名只走干净的形参逆变检查；组件仍是普通函数。
2. **`NoInfer<I>` 把业务份额的推断钉在 inject 工厂上。** 没有它，TS 还会从组件形参位收集推断候选，漂移的组件（消费一个工厂并不供给的键）会静默把 `I` 加宽到让调用通过——恰好吸收掉类型链本要抓的漂移。负样本 spec 钉住这一点：若这个 `NoInfer` 日后被「顺手简化」掉，expect-error 位会第一个变红。

## Consequences

渲染权威从此可强制执行，而非仅靠约定：谁渲染什么是装载期事实，审计 UI 结构 = 通读 register 调用。每个 props 面都从单一真源静态推导（SlotMap entry、children 键集、store 工厂、inject 返回值），schema 变更由编译器传播，而不靠 grep。插件不再自带任何订阅机械——store 生命周期（每会话实例、dispose、持久化）是钉在 entry 轴上的框架语义。代价：注册选项稠密（children spec 对象）；框架背上实打实的推断机械（`defineStore` 的 init/actions 同轮推断可能需要柯里化兜底）；编译期双向锁意味着原型阶段的漂移直接是硬错误，而非警告。

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| 独立的 define/register 两步式 API | 拆分让渲染权威无从强制、招来时序 bug；children 进 register 让声明、授权、spec 在同一个可见位置结清 |
| 白名单面对象（`ScopedSlots` + 收窄辅助件） | 白名单已在组件的 props 类型里，面可由机械推导；可铸造的面对象是第三个权威面，且只有运行时校验 |
| 装配句柄把 root ctx 带进 inject | 绕开声明的 inject 拓扑——每个工厂都摸得到每个服务，package.json 的依赖声明就此失去意义 |
| `children` 用键数组形 | kind/scope 是运行时分派数据；SlotMap 已被擦除，数组形必然逼出第二个 spec 注册 API——定义 API 复活 |
| 业务经 inject 自定义 hook | 每个插件都变成自己的订阅机械；框架 store 席位用一台受审计的机械承载同样的数据 |
| 模块级 store 句柄 | 模块级句柄是跨插件重载与跨测试用例的单例；工厂形把身份圈定在单次 apply/测试调用内 |
| 组件直收 store 实例 | 渲染代码里能用 `update`/`set`，变更面就无从审计；声明的 actions 让「什么能变」保持为 register 现场的事实 |
| 注册位用 `FC` / 从组件推断 `I` | FC 静态位产生协变噪音、拒绝合法组件；组件侧推断静默吸收 props 漂移（见上文裁定） |
