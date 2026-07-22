# Agent Note: slot 类型链硬化——五条非显然实现裁定

Status: implemented

[English](2026-07-22-slot-type-chain-implementation.md) | 中文

> 范围：slot 注册/渲染类型链（`packages/client/ui-slots/src/index.ts`，消费方 `packages/client/web-react/src/scoped-slots.tsx`）为什么这样实现。设计层取舍（注册点推断优于声明表、手写白名单优于派生）住 Web 客户端架构 RFC；本文钉住五条实现决定——不写下来，将来的编辑者要么重新争论一遍，要么不经意地回退它们。

## Problem

硬化后的类型链给从 `SlotMap` 声明到组件渲染的每一跳定型：owner 份额 + 框架标配份额 + 注册方注入份额组合成组件 props，在 `register()` 处校验。让这条约束既成立又不误伤，逼出了五个单看代码显得任意的选择——每一个的存在都是因为显然的替代方案会以一种具体的、可复现的方式失败。

## Decision

### 1. 注册位用 `SlotComponent<P>`（裸调用签名）而非 `FC<P>`

`register()` 以 `SlotComponent<ComposedProps<K, NoInfer<I>>>` 约束组件，其中 `SlotComponent<P> = (props: P) => ReactNode`。React 的 `FC` 携带静态字段（`propTypes`、`defaultProps`），其类型在协变位引用 `P`；两个 `FC` 实例化之间的可赋性因此连这些静态位一起查，而 bottom 型的标配份额（见裁定 4 的 `useSession: never`）使这些协变检查拒绝掉收窄它的组件——恰恰是设计想接受的那批组件。裸调用签名只走干净的参数逆变检查。组件仍是普通函数；运行时零可见差异。

### 2. `NoInfer<I>` 把注册方份额的推断钉在 inject 工厂上

`I`（注册方注入份额）必须从 `inject` 工厂的返回类型推断——唯一权威源。没有 `NoInfer` 时，TS 还会从组件参数位收集推断候选，漂移的组件（消费一个工厂并不供给的键）会静默地把 `I` 加宽到让调用通过，把漂移吸收掉而不是报出来。组件位的 `NoInfer<I>` 移除了那个候选位，负样本⑥（owner 份额的手抄漂移件在 register 处失败）才得以成立——有推断渗漏时它会通过。将来若有人把这个 `NoInfer`「顺手简化」掉，类型链 spec 的 expect-error 位会第一个变红。

### 3. `ComposedProps` 按条目的 `owner` 键分派，支撑渐进迁移

`ComposedProps<K, I>` 只在 SlotMap 条目声明了 `owner` 份额时才组合 `owner & standard & I`；未声明的条目回落到 legacy 全量 `props` 约束（`PropsShape`）。这个条件类型就是迁移接缝：legacy 声明原样编译，条目逐个转入组合模型，两种形态走同一个 `register()`——无平行 API、无开关旗。删掉回落分支的那一刻=全仓切换时刻，不是一次清理。

### 4. 标配份额 bottom 型化；裸 `register` 的双变接受面认账不硬测

session 坑的框架供给 hook 约束为 `{ useSession: never }`（`StandardOf`）：参数性位置上的 `never` 意味着任何注册方收窄（如 runtime 定型的会话 hook）都被接受，实际到达什么的类型责任归注入侧渲染器。已知边界搭车项：对以方法语法定型或参数位本就双变的组件，TS 可能接受一个严格意义上不该过的 `register` 调用（参数双变是 TS 的有意不健全）。这个立场以文档记账而不加测试：我们不写依赖 TS 并不承诺的严格性的负样本——那钉住的是编译器版本行为，不是我们的契约。真正钉住的六个 expect-error 位（`packages/client/ui-slots/tests/type-chain.spec.tsx`）全部因契约原因失败。

### 5. `ChildrenChecked` 是按条目 `children` 声明挂载的 opt-in 校验层

子坑转授权威仍是手写白名单（组件自己 props 上的 `slots: ScopedSlots<'a' | 'b'>`）。`ChildrenChecked<K, P>` 加一层可选的第二道检查：仅当条目声明了 `children`，组件的 `slots` 面才对照授权并集校验（越界时 `slots` 坍缩为 `never`，在 register 调用处暴露）。未声明 `children` 的条目原样通过。挂点选在 `ComposedProps` 内部——即恰好在注册边界而非渲染期起效——因为 register 是条目声明与组件面两个半边同时静态可见的唯一位置；渲染期检查要为一个纯静态保证铺运行时管线。

## Consequences

register 调用点成为全链唯一收口：份额漂移、inject 键缺失、越权子坑面、keyed/list options 缺省全部在编译期于此暴露，六样本负样本 spec 逐一钉住失败模式。代价：条件类型让 register 位的悬停签名明显变宽；bottom 型标配份额把到达类型的责任转给 web-react 渲染器（记录于 `StandardOf`）；双变边界意味着一类不健全接受被知情容忍。

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| 保留 `FC`、在 register 位 cast | cast 恰好藏起类型链要抓的漂移；FC 静态位的协变噪音是机械成因，该移除噪音而非移除检查 |
| 从组件参数位推断 `I` | 推断渗漏静默吸收 props 漂移——负样本⑥无从写起 |
| 组合 props 一次性全仓迁移 | 所有 SlotMap 声明方挤进一个 PR；`owner` 键分派让条目逐个迁移、两形态共存 |
| 给双变接受边缘加负样本 | 钉住的是我们不拥有的 TS 健全性行为；编译器升级会在契约零变化时打红 spec |
| 从 `children` 声明派生转授白名单 | 手写面才是组件作者读到的 API；派生反转所有权，设计层已否——`ChildrenChecked` 做校验不做生成 |
