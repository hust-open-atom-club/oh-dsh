# Agent Note: 共享作用域分层存储

Status: proposed

[English](2026-07-12-scoped-layers-store.md) | 中文

## 问题

agent（智能体）作用域机制（[决策](../../implemented/architecture/2026-07-08-agent-scope-contexts.md)、[运行时设计](../../implemented/architecture/2026-07-12-agent-scope-runtime-design.md)）让支持作用域的注册表反复呈现同一种形态：一个全局注册层，加上一个与具体 agent 精确对应的层。七个注册门面各自独立实现这一形态：`tools.register`、`tools.restrict` 和 `tools.guard`（位于 `dsh-tools`）；`SystemPrompt.section`、`SystemPrompt.tools` 和 `SystemPrompt.variable`（位于 `dsh-system-prompt`）；以及 `CommandService.register`（位于 `dsh-commands`）。

每个门面都围绕自己的领域状态重复相同的生命周期编排：从调用方上下文导出可见性，按需创建专属容器，把属主绑定到同一个 Cordis fiber，先装入 undo 再通知观察者，原样返回 Cordis 的 disposer，并回收空的专属状态。各份实现采用不同的映射与集合类型，因此服务内没有一个对象能表示某个 scope 的完整贡献，而且每张表都必须重复清理逻辑。

重复代码承载着三项不明显的要求：

- 可见性与属主必须来自同一个上下文；若分开接受二者，就能登记出对一个 scope 可见、却随另一个 scope 销毁的贡献。
- change 回调运行前必须收集 undo，抛错的回调才能回滚变更。
- 公开 disposer 必须就是 `ctx.effect()` 返回的那个函数；包装它会破坏 Cordis 基于身份的有序拆除。

共享的是生命周期与保持插入顺序的存储，而不是注册表策略。工具限制、保留传输处理、提示词求值时机、命令规范化、精确诊断和回调异常隔离，仍分别属于不同的领域契约。

## 提案

`@deepseek-ai/dsh-scope` 新增与键类型无关的 `store.ts` 实现模块。该包（package）继续将 Cordis 和 `@deepseek-ai/dsh-invariants` 列为对等依赖（peer dependency），其不变量配套模块保持不变。包根导出四个存储符号：`ScopeLayer`、`ScopedLayers`、`NamedEntries` 和 `AnonymousEntries`。`EntryValues` 仍是内部接口，`store.ts` 不是包子路径。

`ScopeLayer` 保留显式的聚合概念，同时只要求判断整个层是否为空。服务定义一个具体层，使其表结构与领域 helper 适合该服务；`ScopedLayers` 负责构造、选择、生命周期挂接、通知和聚合回收。

## 公开接口

```ts ignore-check
export interface ScopeLayer {
  isEmpty(): boolean
}

export class ScopedLayers<L extends ScopeLayer> {
  constructor(
    createLayer: (scope: ScopeKey | undefined) => L,
    onChange: () => void,
  )

  readonly global: L
  peek(scope: ScopeKey | undefined): L | undefined

  merge<V>(
    scope: ScopeKey | undefined,
    pick: (layer: L) => NamedEntries<V>,
  ): Map<string, V>

  effect(
    ctx: Context,
    action: (layer: L) => () => void,
    options: { label: string; notify?: boolean },
  ): () => void
}

export class NamedEntries<V> {
  constructor(duplicateError: (name: string) => Error)
  insert(name: string, value: V): () => void
  get(name: string): V | undefined
  has(name: string): boolean
  keys(): IterableIterator<string>
  entries(): IterableIterator<[string, V]>
  values(): IterableIterator<V>
  isEmpty(): boolean
}

export class AnonymousEntries<V> {
  append(value: V): () => void
  values(): IterableIterator<V>
  isEmpty(): boolean
}
```

## 存储契约

- 构造器只创建一次 `global`，调用的是 `createLayer(undefined)`。只有 `effect()` 会创建专属层；`peek()` 和 `merge()` 从不创建专属层，而 `peek(undefined)` 返回 `undefined`，因为全局层已经显式存在。
- `merge()` 是唯一会物化结果的通用读取接口。它按插入顺序复制全局命名条目，再按专属条目的插入顺序应用这些条目；同名条目完成遮蔽，但不会移动无关名称。
- `NamedEntries.insert()` 以原子方式检查并插入，返回幂等且只撤销该精确条目的 undo，并通过调用方提供的工厂取得所属注册表的精确重名诊断。查询与迭代器保留 `Map` 的原生顺序和活遍历语义。
- `AnonymousEntries.append()` 为每次登记分配唯一内部键，因此值相等的回调或其他值仍彼此独立。其迭代器是保留插入顺序的活迭代器。
- `effect()` 通过 `scopeOf(ctx)` 导出键，并把 action 挂到同一个 `ctx.effect()` 上。它只接受一个同步 action，且该 action 只返回一个同步 undo；action 要么返回其 undo，要么必须在保留任何贡献之前抛错。helper 不会规范化更宽泛的 Cordis `Effect` union。
- `effect()` 在调用 `onChange` 前收集 action 的 undo，并原样返回 `ctx.effect()` 的 disposer。销毁时先运行 action undo 再通知；Cordis 保证其幂等性；只有整个层的 `ScopeLayer.isEmpty()` 变为 true 后，helper 才删除专属层。
- `options.notify` 默认为 `true`。回调自身的策略仍具最终效力：工具与提示词的 change 回调可以抛错并触发登记回滚；`CommandService.notifyChange()` 会隔离观察者失败；工具 guard 传入 `notify: false`。

## 注册表迁移

`dsh-tools` 定义一个 `ToolLayer`，其中包含命名工具以及匿名的已编译 restriction 和 guard 登记。`ToolRegistry` 保留其私有领域解析器，由它处理可见定义、限制前的已知名称、可限制的全局名称、专属遮蔽、restriction，以及保留的 `run_code` 插入。guard 求值继续先活遍历全局登记，再活遍历专属登记，因此重入时新增的登记保持现有行为。

`dsh-system-prompt` 定义一个 `PromptLayer`，其中包含命名的段落与变量，以及匿名工具提供方。组装流程在求值前合并段落，因此被遮蔽的提供方不会被调用。每次组装只物化一次工具提供方成员集合。变量提供方继续先活遍历全局表，再活遍历专属表，从而保留重入登记行为。

`dsh-commands` 定义一个单表层，其中包含 `NamedEntries<RegisteredCommand>`。生效视图使用 `merge()`；`CommandService` 则保留对定义的规范化与冻结处理、精确重名诊断、经过排序的不可变描述符、直接执行、HMR（热模块替换）清理，以及对各个 `commands/change` 观察者分别隔离失败的行为。

七个门面都把校验与诊断留在所属注册表中，并继续返回 Cordis 的原始 disposer。迁移既不改变公开注册表行为，也不改变模型可见或人类可见的输出，以及协议、持久化或配置层面的可见输出。

## 备选方案

**保留彼此独立的实现。** 这样不必新增库接口，但七个门面仍会重复生命周期顺序、disposer 身份和 scope 回收。

**每张表一个 helper。** 这能减少一部分局部代码，但会保留多张按 scope 划分的映射，而且无法正确回收某个 scope 的聚合贡献。

**每 scope 一个注册表实例。** 子注册表需要通过委托获得全局加专属的视图，对 restriction 进行特殊的减法处理，并跨实例发现观察者。这只会转移复杂度，而不会消除复杂度。

**注册方法上的显式 scope 参数。** 分开的可见性与属主输入让不匹配的生命周期成为可表达状态，而遗漏 scope 则会静默变成全局登记。

**接受完整的 Cordis `Effect` union。** 七个登记口都没有异步 setup、多份 undo 或独立 settlement 边界。通用规范化会在没有现有消费者需要它时重复 Cordis 的生命周期 machinery。

**暴露 `ScopedLayers.values()`、`ScopedLayers.keys()` 或全局放行谓词。** 这些操作会编码消费方特有的活遍历或物化策略，以及过滤策略。直接遍历条目表可保留显式的活语义，`merge()` 覆盖共享的命名遮蔽操作，而 `ToolRegistry` 继续保有功能更丰富的私有解析器。

**把 `values()` 放在 `ScopeLayer` 上，或导出 `EntryValues`。** 一个层会聚合异构表，因而没有一致的值类型或迭代策略。`EntryValues` 只适合在两个表类之间共享实现细节；将其公开只会扩大接口，却不能为调用方提供有意义的整层读取方式。

**通过 mapped-type 表描述生成层。** 三表与单表具体层都很短、易于检查，并可自由持有领域 helper。类生成器会增加第二种构造模型和生成式运行时形状，收益却很小。

## 验收标准

- `dsh-scope` 从包根恰好导出拟议的四个存储符号，并覆盖全局构造、专属层延迟构造、非创建式读取、命名遮蔽、聚合回收、失败清理、通知顺序、原始 disposer 身份、调用方拥有的重名错误、相同匿名值的独立登记和活迭代器。
- `dsh-tools`、`dsh-system-prompt` 与 `dsh-commands` 迁移全部七个注册门面，同时保留校验顺序、精确诊断、视图、通知策略、重入行为和 HMR 清理。
- `dsh-scope` README 与作用域核心数据文档描述公开契约；架构和运行时设计引用标识共享 store，但不重复其内容。各消费方 README 继续聚焦其未改变的公开行为。
- 实现 PR 将本组文件移入 `implemented/architecture`，把 `Proposal` 改为以现在时书写的 `Decision`，并记录已落地的后果与验证。现有无密钥快照保持逐字节一致。

## 风险

- 未来的登记可能需要异步 setup 或多份分别拥有属主的 undo。该消费方必须先明确其属主与 settlement 边界，再拓宽这个刻意保持同步的接口。
- 抛错的 action 若在返回的 undo 契约之外产生变更，通用 helper 无法修复。条目操作是原子的；迁移会在插入前执行可能失败的校验；测试会钉住工厂失败和保留贡献前的 action 失败清理。
- 聚合回收会让专属层一直存活到所有表都清空。这是有意行为，并且只能通过内部存储生命周期观察到；测试会钉住销毁一张表时不会丢弃同层的其他贡献。
- 公开类新增了一项可复用的包契约。保持读取接口狭窄并把领域策略留在消费方，可以减少未来代码必须维持的契约范围。
