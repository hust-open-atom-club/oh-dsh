# Agent Note: 作用域分层存储——每 scope 一个聚合层与统一调度 helper

Status: proposed

[English](2026-07-12-scoped-layers-store.md) | 中文

## 问题

agent 作用域落地之后（[agent-scope Agent Note](../../implemented/architecture/2026-07-08-agent-scope-contexts.md)、[运行时设计篇](../../implemented/architecture/2026-07-12-agent-scope-runtime-design.md)），「一张全局层加若干 per-agent 层的注册表」成为反复出现的形态，而每一处都是手写的。今天已有六个登记口——`dsh-tools` 的 `tools.register`/`tools.restrict`/`tools.guard` 与 `dsh-system-prompt` 的 `section`/`tools`/`variable`——每处都围绕适用的全局或专属容器重复同一段 10-15 行的 effect 编排：读调用方上下文的标签、按需建层、校验、变更、yield 一个删除条目并回收空专属层的回滚、发适用的 change 事件，然后返回 Cordis effect 的原始 disposer。

除此之外：风险集中在编排细节上：
- 回滚必须在 change 发出之前被收集（抛错的监听器才能回卷插入而不是泄漏）
- 返回的 disposer 必须是 Cordis 自己的那个函数（包装器会静默破坏嵌套的有序拆除）
- 清空的专属层必须被回收（被 dispose 的 agent 不得留下以死 `ScopeKey` 为键的残余）

每个新消费者都要把这一切重新写对一遍，而各副本的写法已经分叉——`dsh-tools` 里有两个私有建层 helper，`dsh-system-prompt` 里是三处内联 IIFE。

最后，一个 agent 在一个服务里的贡献散落在几张互不相识的 Map 里——不存在一个「这个 scope 在这里贡献了什么」的对象——而消费者还在持续增多：专属 guard 与 per-agent 提示词/工具组合是最近落地的一批，per-agent 的 `fs/*` 策略、`llm/*` 覆盖与 compaction 策略则是同一模式的潜在后续用户。

## 提案

`dsh-scope` 新增与键类型无关的 `store.ts`，peer 依赖仍只有 Cordis。模块只抽取六个现有登记口已经共同证明的最小形状：**业务状态与校验留在显式层类里；一个 helper 统一负责选层、挂 effect、回滚、通知与回收**。一个 helper 实例属于一个服务；一个层实例聚合某 scope 对该服务的全部贡献。

- **`ScopedLayers<L>`** 是具体调度器，不作基类。它持有全局层与一张 `Map<ScopeKey, L>`，通过显式工厂按需构造专属层，并在层 `isEmpty()` 时回收。`effect(ctx, action, options?)` 只接受一个同步 action，action 只返回一个同步 undo，因为六个现有登记口的完整形状就是如此。单一 `ctx` 同时决定可见层（`scopeOf(ctx)`）与属主 Cordis fiber（`ctx.effect`），「对 X 可见、随 Y 销毁」因此不可表达。helper 在通知监听器前 yield undo，返回 Cordis 的原始 disposer，并在校验或变更抛错时回收刚建出的空层。读取接口是 `global`/`peek`，以及 `merge`（命名条目的专属遮蔽与可选全局放行谓词）、`values`（不遮蔽地依次拼接全局与专属条目）和 `keys`（限制前名字全集）。
- **显式 `ScopeLayer` 类**让每个服务的状态一眼可见。`ToolLayer` 与 `PromptLayer` 直接声明各自三项表属性与 `isEmpty()` 聚合；一个小工厂只向构造器传入 scope，闭包仍可捕获真实构造依赖。领域方法仍是普通类方法。代价是几行重复声明，收益是不用引入 mapped-type 类工厂、scheduler/layer 属主环、保留属性名和生成式运行时结构。
- **`NamedEntries<V>` 与 `AnonymousEntries<V>`** 是两种共用的保插入序条目表。命名表暴露 `insert`/查询，并通过领域 `kind` 与 per-agent alternative 标签保持现有全局/专属重名文案；匿名表只暴露 `append`，以进程内唯一 symbol 作键支持 O(1) 撤销删除。分成两类以后，无意义的命名/匿名混用不可表达，key 类型也保持健全。迭代器借用表成员与带类型的贡献值，不会 clone 或 freeze 值；`ScopedLayers` 只物化服务读路径本来就需要的合并数组或 Map。

`dsh-tools` 把工具、已编译 restriction 与 guard 三张表合并进一个 `ToolLayer`。restriction 放行判断与 guard 求值归层所有；`run_code` 保留名、当前已知全局名集合等依赖服务配置的领域校验仍留在门面。只读 allow/deny 输入只编译一次，成为内部 Set。`dsh-system-prompt` 同样把 section、tool provider 与 variable 合并进一个 `PromptLayer`。每个登记门面先完成公开参数校验，再以 label 做一次 `effect` 调用；guard 额外传 `silent: true`。通用 helper 不理解「restriction 必须由 scoped context 调用」之类领域规则。

`assemble` 留在 `SystemPrompt` 门面，三条理由：主体 scope 的层可能不存在，读路径不得创建它；遮蔽语义要求先合并再求值，被遮蔽的 section provider 绝不能被调用；组装 waterfall 与 `toolOrder` 使用服务级资源。section 与 tool provider 保持既有的派生视图物化；variable provider 则直接遍历全局与专属 `NamedEntries`，保留 provider 在组装期间登记另一 variable 时的现有活 Map 行为。tool guard 同样直接遍历其 `AnonymousEntries`。

迁移保持公开行为与精确重名文案不变。内部聚合层会在三张表全部清空后才回收，而不是某一张表清空时回收；服务 API 不暴露层身份。直接活遍历保留现有 variable-provider 与 guard 重入行为，selector helper 则继续物化门面今天已经在构造的 section、tool-provider 与工具解析视图。

`ScopeLayer`、`EntryValues`、`ScopedLayers`、`NamedEntries` 与 `AnonymousEntries` 都是带 export JSDoc 的 `dsh-scope` 根导出。消费者从 `@deepseek-ai/dsh-scope` 导入；`store.ts` 是实现模块，不是 package subpath。

## API 草图

```ts ignore-check
export interface ScopeLayer {
  isEmpty(): boolean
}

export class ScopedLayers<L extends ScopeLayer> {
  constructor(createLayer: (scope: ScopeKey | undefined) => L, options: { onChange?: () => void })
  readonly global: L
  peek(scope: ScopeKey | undefined): L | undefined
  merge<T>(scope: ScopeKey | undefined, pick: (layer: L) => NamedEntries<T>, admitGlobal?: (name: string) => boolean): Map<string, T>
  values<T>(scope: ScopeKey | undefined, pick: (layer: L) => EntryValues<T>): T[]
  keys<T>(scope: ScopeKey | undefined, pick: (layer: L) => NamedEntries<T>): string[]
  effect(ctx: Context, action: (layer: L) => () => void, options: { label: string; silent?: boolean }): () => void
}

export interface EntryValues<V> {
  values(): IterableIterator<V>
  isEmpty(): boolean
}

export class NamedEntries<V> implements EntryValues<V> {
  constructor(kind: string, perAgentAlternative: string, scope: ScopeKey | undefined)
  insert(name: string, value: V): () => void
  get(name: string): V | undefined
  has(name: string): boolean
  keys(): IterableIterator<string>
  entries(): IterableIterator<[string, V]>
  values(): IterableIterator<V>
  isEmpty(): boolean
}

export class AnonymousEntries<V> implements EntryValues<V> {
  append(value: V): () => void
  values(): IterableIterator<V>
  isEmpty(): boolean
}
```

迁移后的消费者长什么样——现存最重的登记口从 30+ 行编排缩为一份声明加一行门面：

```ts ignore-check
class ToolLayer implements ScopeLayer {
  readonly tools = new NamedEntries<ToolDefinition>('tool', 'variant', this.scope)
  readonly restrictions = new AnonymousEntries<CompiledToolRestriction>()
  readonly guards = new AnonymousEntries<ToolGuardRegistration>()

  constructor(
    readonly scope: ScopeKey | undefined,
  ) {}

  isEmpty(): boolean { return this.tools.isEmpty() && this.restrictions.isEmpty() && this.guards.isEmpty() }
  addRestriction(filter: ToolRestriction): () => void { /* compile to sets, append */ }
  admits(name: string): boolean { /* intersection over this.restrictions.values() */ }
  guardReason(view: Readonly<ToolExecution>): string | undefined { /* first monotonic denial */ }
}

class ToolRegistry extends Service {
  private readonly layers = new ScopedLayers(
    scope => new ToolLayer(scope),
    { onChange: () => this.ctx.emit('tools/change') },
  )

  register(definition: ToolDefinition): () => void {
    return this.layers.effect(this.ctx,
      layer => layer.tools.insert(definition.name, definition),
      { label: 'tools.register()' })
  }

  private resolveVisible(scope?: ScopeKey): ToolDefinition[] {
    const scoped = this.layers.peek(scope)
    return Array.from(this.layers.merge(scope, layer => layer.tools, name => scoped?.admits(name) ?? true).values())
  }
}
```

## 备选方案

**每 scope 一个注册表实例，父子委托链。** 实例爆炸；「部署工具加我的工具」的合并视图要每个服务手写一个委托注册表；单订阅观察者（持久化、ACP bridge）必须逐实例发现并订阅；委托链表达不了减法（restriction）。子注册表还得反向触及父上下文，扩大暴露面。

**注册 API 上的显式 scope 参数。** agent-scope Agent Note 已否决：漏传参数即静默注册为全局，且该形状能表达「对 X 可见、随 Y 销毁」——几乎必然是 bug。

**只抽数据结构、编排留在服务。** 消掉的是重复里安全的那一半，留下的是危险的那一半——回滚先于 emit 的顺序、原始 disposer、回收规则，恰是 bug 所在。

**让 layer action 接受完整 Cordis `Effect` union。** 六个现有登记口都没有异步 setup、多份 undo 或独立 settlement 边界。现在就规范化 Promise、iterable、async iterable、LIFO 合成与部分失败，会重复一套纯属推测的生命周期 machinery。store 只接受一个同步 action 与一个 undo；未来出现真实边界时再凭证据拓宽。

**由 mapped-type 表 DSL 生成层类。** 两个消费者各自只有三张表。类工厂省下几行代码，却引入生成式运行时形状、保留名、多态 `this` 类型和第二种构造模型。显式类更易检查，同时仍可复用两种条目表与 `ScopedLayers`。

**内置视图语义的固定容器 helper。** 容器形态与合并策略被钉死在 helper 里；业务没有自由度，任何命名或单值变体都变成对 helper 的功能诉求。

**每张表一个 helper。** 复刻今天的散装簿记——那正是被替换的现状：每服务 N 张 scope Map，agent 的贡献没有聚合。

**`helper.get(ctx).effect(...)` 两步式登记。** 把建层与挂生命周期拆成两步；两步之间抛错会搁浅一个空层，返回的 handle 还是每次调用一笔额外分配。

**层持有 ctx、自己注册 effect。** 把数据对象变成生命周期管理者，编排在每个业务类里重演一遍。

## 验收标准

- `store.ts` 落在 `dsh-scope`（peer 依赖不变：仅 Cordis；模块图位置不变），逐文件 100% 覆盖选层与回收、同步 action/undo 顺序、action 抛错清理、change 监听器抛错回滚、原始 disposer 身份、`label`/`silent`、工厂类型、合并 selector，以及分开的命名/匿名条目语义。五个公开符号从 package 根重导出并带 export JSDoc。
- `dsh-tools` 与 `dsh-system-prompt` 各收敛为一个 `ScopedLayers`；每个登记门面先校验领域契约再做一次 `effect` 调用，并继续返回 Cordis effect 的原始 disposer。
- 既有行为、重名文案、校验顺序、variable-provider 活重入与 guard 活重入不变。测试另行钉住聚合回收时机与 selector 物化。
- 文档随同一变更落地：`dsh-scope`/`dsh-tools`/`dsh-system-prompt` 的 README；实现后本 Agent Note 移入 `implemented/`，并就地更新[运行时设计 Agent Note](../../implemented/architecture/2026-07-12-agent-scope-runtime-design.md) 的注册章节。

## 风险

- 层/门面边界可能不适配某个未来消费者的形状。缓解：`ScopeLayer` 只要求 `isEmpty()`；工厂闭包可捕获构造依赖，无需让层反向持有 scheduler。
- 未来登记口可能真的需要异步 setup 或多份独立属主的 undo。helper 刻意不预测这种生命周期；该消费者必须先说明 owner 与 settlement 边界，再连同测试拓宽契约。
- 显式层声明会在两个消费者中各重复三行属性初始化与一段 `isEmpty()`。接受：这点重复让运行时状态和类型保持可见，避免为两个类引入第二套 DSL。
- 两个核心注册表同时迁移。缓解：设计期已完成逐行为对比，且 store 连同钉住等价性的测试先于任一迁移 commit 落地。
