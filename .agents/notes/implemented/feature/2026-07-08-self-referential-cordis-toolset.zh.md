# Agent Note: 自引用 cordis 工具集

Status: implemented

[English](2026-07-08-self-referential-cordis-toolset.md) | 中文

## 问题

本 harness 中的一切都是 cordis 插件，但运行在该插件运行时内部的 agent（智能体）既看不到也碰不到它：它无法枚举周围的服务和事件，无法在会话中途为自己添加新工具，也无法组合自己发明的能力。赋予模型这种能力值得探索——一个能审视并修改自身运行时的自引用 agent——但这同时引发三个正确性问题，本设计的核心正是回答这些问题，而非单纯的「让模型执行代码」机制。

第一，模型编写的注册必须在注册发生时就完成校验：格式错误的工具 schema 必须在注册时失败，而不是等到后续请求尝试将其组装进提示词时才报错。第二，模型编写的代码需要调用它从未见过源码的服务 API——靠猜测方法签名、更糟糕的是猜测返回值结构，会消耗大量盲目试探的步骤。第三，模型挂载的一切都必须完全可释放：模型可以按需释放，普通的插件生命周期在宿主插件重载时也会释放，否则长会话会积累遗留的监听器和工具。

## 决策

该工具集以 [`@deepseek-ai/dsh-tool-cordis`](../../../../packages/cordis/tool-cordis/README.md) 发布——一个新的顶层 `packages/cordis/` 分组——并由 [`examples/cordis-agent`](../../../../examples/cordis-agent/README.md) 演示。它为模型提供三个工具，操作模型自身运行其中的活跃 cordis 运行时：审视它、将模型编写的插件挂载进去、再将其释放。

vm 隔离了意外的全局污染，上下文门面隐藏了框架内部细节。但二者都不限制已暴露服务的权限：一个挂载可以调用 `ctx.bash` 以宿主执行器的权限运行命令，也能访问真实的文件系统和网络服务。这是一个需要显式启用的开发工具，信任等级与 bash 相当，不是安全边界，也不是产品默认配置。

### 三个工具

| 工具 | 契约 |
|---|---|
| `cordis_inspect` | 对活跃运行时的只读报告，每个 `what` 值对应一个 Markdown 段落（省略 `what` 则输出全部段落）。精确的 `name` 搭配 `what: "api"` 或 `what: "events"` 可收窄到一个带源码文档的目标。从不产生变更。 |
| `cordis_mount` | 在 `node:vm` 沙箱中执行 `code`（一个异步 JavaScript 函数的函数体）；代码必须 `return` 一个 cordis 插件，该插件作为 `cordis-dynamic` 分组 fiber 的子节点挂载，并以一个新 id（`dyn-1`、`dyn-2`……）跟踪。 |
| `cordis_unmount` | 按 id 释放一个动态挂载，并等到释放达到静止状态后才返回——该插件所做的每一项注册都被撤销，而不仅仅是请求停止。 |

`cordis_inspect` 的段落：`services`（每个已提供的 ctx 服务及其所属 fiber，非活跃的所有者会被标记）、`plugins`（来自 `ctx.registry` 的所有已加载插件的扁平列表及其生命周期状态——展示加载了哪些能力，刻意不展示树形结构）、`tools`（模型可调用的工具）、`dynamic`（挂载表：id、名称、状态、提供的服务、等待的服务）、`api`（来自生成目录的活跃服务签名及其引用的类型形状）和 `events`（harness 事件及其分发模式和签名）。宽泛的 `api` 和 `events` 报告省略完整 JSDoc 以保持紧凑；精确 `name` 会返回一个服务或事件，以及其原始方法/声明 JSDoc。其他段落不能搭配 name，未知目标会失败，而 API 目标必须处于活跃状态。面向模型的工具描述携带了模型在调用时所需的操作规则；[生成的工具目录](../../../../docs/tool-catalog.md)是其完整呈现。

### 沙箱语义

挂载代码以异步函数体的形式在一个新的 vm realm 中运行。其文档化的接口面将文件、网络、进程和定时器访问引导至 Cordis 服务，使挂载保持可审视和可释放。宿主 realm 的辅助手段仍然使 Node 逃逸成为可能，这与信任姿态一致。`vmTimeoutMs` 仅约束同步执行部分。

沙箱全局变量刻意精简：一个带标签的直写 `console`（在宿主 stdout/stderr 上输出 `[cordis:<id>] …`，这样在挂载调用之后很久才触发的监听器输出仍能落到用户可见的地方）、`harness.defineTool` / `harness.registerTool` 注册对、新 vm 上下文缺少的编码原语（`btoa`/`atob` 作为基于 `Buffer` 的宿主闭包——这是一个经过审批的例外，`Buffer` 本身从不暴露——加上 `TextEncoder`/`TextDecoder`），以及对被扣留的 Node API 的可调用陷阱（`require`、`setTimeout`/`setInterval`/`setImmediate`/`clearTimeout`/`clearInterval`、`fetch`），这些陷阱会抛出一条重定向消息指明 cordis 替代方案。只有函数形态的全局变量才设陷阱；`process` 和 `Buffer` 保持 `undefined`，这样 `typeof` 特性探测保持惰性而不会引爆一个抛异常的访问器。

挂载代码通过三道控制跨越 vm 边界。双 realm `instanceof` 同时识别宿主和 vm 对象。`harness.defineTool` 将结果规范化为宿主 realm 的 JSON，并在记录日志前校验 `ToolExecuteReturn` 形状。挂载的插件接收的是一个白名单上下文门面，而非原始或透传的 `Context`；框架管道和以 context 为值的返回会被拒绝。服务读取需要声明 `inject`，保留 Cordis 的激活与卸载语义。`ctx.tools.get` 仅暴露 schema 视图，因此挂载代码无法绕过 `ToolRegistry.execute` 直接调用定义。

边界将无歧义的 JSON-Schema 形式规范化为 `SchemaSpec`，包括对象包装器、`integer` 和可选字段。无效词汇会报错并给出可接受的替代方案。解析错误、TypeScript 错误、缺少 return、Node API 误用和重复工具名等错误信息包含相关源码行或纠正性契约，不叙述实现内部细节。

### 动态分组与挂载生命周期

所有动态挂载都是工具插件下方 `cordis-dynamic` 分组的子节点，因此普通的 fiber 释放即可处理重载和卸载。挂载会等待 settlement；启动失败时在返回错误前释放 fiber。已 settle 但处于 pending 状态的挂载仍然可见，并列出其缺失的注入。`cordis_unmount` 等待挂载 fiber 的释放完成。

### 通过 provide/inject 实现跨挂载组合

挂载之间通过普通的 cordis 服务语义相互关联，以各自的 id 作为生命周期句柄：挂载 A 调用 `ctx.provide('foo', value)`，挂载 B 声明 `inject: ['foo']` 并在 `foo` 存在的瞬间激活；如果 B 先挂载，它保持 pending 状态并列出缺失的服务；卸载 A 使 B 回到 pending（其注册被撤销），之后重新 provide 会通过一个新的沙箱门面重新运行 B 的 `apply`；重复 provide 会明确报错并指出拥有该服务的 fiber。一个 realm 注意事项：由挂载 provide 的服务值是 vm realm 对象——从任何地方调用其方法都能工作，但消费方不得假设它具有宿主原型。

### 生成的 API 目录

`cordis_inspect` 从生成的目录提供 API 和事件数据，而非维护一份重复的表格。生成器复用 Cordis 目录的 AST 扫描，输出服务摘要、签名、原始服务方法与事件 JSDoc、事件模式、引用的类型声明以及继承的 context 接口面。有歧义的类型名被省略，过大的声明被标记为截断。

新鲜度像所有生成产物一样受门禁约束：`pnpm run verify-cordis-api`（在 `doc-sync` 中）在内存中重新生成并在有任何 diff 时失败，因此 JSDoc 或公开签名变更如果不重新生成模型读取的目录就无法合入。运行时 inspect 工具将目录与活跃运行时取交集而非直接转储：宽泛报告把有目录条目的活跃服务渲染为摘要 + 签名，把没有目录条目的活跃服务（挂载提供的）渲染为名称 + 所属 fiber，简要列出有目录条目但无活跃提供方的服务，再附上引用的类型形状。精确名称报告渲染一个活跃服务或事件，并把原始 JSDoc 紧靠在每个签名之前；让该细节按需出现，避免探索性列表承担其 token 成本。

### 配置、渲染与可观测性

该插件暴露一个配置字段，由 schemastery 校验并记录在[配置目录](../../../../docs/config-catalog.md)中：`vmTimeoutMs`（默认 5000），挂载代码同步执行部分的毫秒上限。工具名、`cordis-dynamic` 分组名和 `dyn-` id 前缀是结构性词汇，保持固定。三个工具均按[工具实操手册](../../../../docs/cookbook/adding-a-tool.md)渲染为 `generic` 卡片（`cordis_inspect` 为 `read`，`cordis_mount` 为 `execute` 并将代码作为 `rawInput` 携带，`cordis_unmount` 为 `delete`），不覆盖 `presentResult`。

「模型可见 ⟺ 已记录」成立，且无需新的会话事件类型：挂载或卸载仅通过其自身的 `tool/call` / `tool/result` 对可见（循环会记录它们），而挂载引起的工具集变化由循环在 schema 在步骤间发生变化时发出的完整变更 request header 记录。刻意不设 `cordis/mount` 溯源事件——它只会重复工具调用对已记录的内容。动态挂载是进程生命周期的，不是会话状态：恢复一个持久化的会话会重建对话，但不会重新挂载插件。

## 曾考虑的替代方案

**用结构化的逐能力注册工具替代 `cordis_mount`。** 最具吸引力的替代方案是一个带有显式 `name` / `description` / `parameters` / `code` 字段的 `cordis_register_tool`（以及兄弟工具 `cordis_register_listener`、`cordis_register_service`……），而非单一的「挂载一个插件」原语。否决原因：它唯一的真正优势——对最常见的单一场景免去插件样板代码——不足以抵偿其代价，而单一的 mount 原语能一次性覆盖所有能力。

| 维度 | 结构化逐能力工具 | 单一 `cordis_mount` |
|---|---|---|
| Schema 正确性 | `parameters` 仍然是模型编写的 JSON 对象，需要 SchemaSpec 校验，只是提前了一步 | 同样的校验在沙箱边界运行，同样的指导性错误信息 |
| 代码字段 | `execute` 函数体仍然是 vm 中模型编写的 JS；realm 和服务调用的正确性问题不变 | 一个沙箱、一条规范化路径、一处受保护的注册 |
| 能力覆盖面 | 仅限工具；监听器、服务、`inject` 关系各需另一个结构化工具——接口面无限增长 | 一套词汇（cordis 插件）覆盖当前和未来的所有效果 |
| 跨挂载组合 | 在工具注册载荷中无法表达 | 原生 `provide`/`inject`，普通的 cordis 语义 |
| 可审视性 | 注册的东西无法在插件列表中显示为插件 | 模型挂载的正是 `cordis_inspect` 渲染的 |
| 模型人机工程学 | 对最常见的单一场景有优势（无插件样板） | 通过 mount 描述中的规范示例加边界错误信息教会正确调用来缓解 |

因此正确性投入放在能一次性为所有能力带来回报的地方：通过 `cordis_inspect` 呈现的生成 API 目录，以及沙箱边界校验（其错误信息教会正确的调用方式）。结构化注册工具日后仍可作为语法糖添加，由它合成 mount 代码；本设计不排斥这一可能。

**在工具中手工维护服务/事件参考。** inspect 工具的第一版携带了一份手写的服务方法签名表。它被生成的 `api-catalog.ts` 取代，因为手写表在签名变化的瞬间就会与 JSDoc 脱节且没有门禁约束这种漂移，而生成产物的新鲜度由文档使用的同一套 AST 检查。

**新增 `cordis/mount` 会话事件。** 一个持久的溯源事件记录每次挂载（源码、名称）有明确先例（`hook/invoked`、`compact/start`）。v1 中予以否决：挂载和卸载已经作为 `tool/call` / `tool/result` 对可见，工具集变化已经作为完整的变更 request header 被记录，因此专用事件只会重复记录。如果审计用例需要将挂载溯源从工具调用中分离出来，日后仍可添加。

**加固的/能力受限的沙箱。** 对 Node 内置模块设陷阱并向挂载代码提供白名单门面而非原始 context，可能暗示意图是为安全而沙箱化。这里明确不是：陷阱和门面收窄的是挂载代码所见的*接口面*——将其引导至 cordis 服务、远离易泄漏的 Node 内置模块和框架内部——目的是正确性和封堵未受保护的 context 逃逸，但门面暴露的能力（`ctx.bash`、`ctx.fs`、`ctx.web`）触及真实运行时，因此它不是安全边界。真正的安全边界（独立进程、权限提示）超出了一个开发/显式启用工具集的范围，且会与其核心目的——将活跃运行时交给模型——相冲突。

## 后果

该工具集是刻意的显式启用设计，具有完全特权的 `ctx`，因此部署方采用它的意识程度应与 bash 工具相当。以下几个事实由工具描述直接告知模型：一个 waterfall（瀑布式事件）监听器（如 `tools/pre-execute`）如果不调用 `next()` 就返回，会否决整条链，因此一个挂载的监听器可以瘫痪 agent 自身的工具分发（[waterfall 语义](../../../../docs/cordis-primer.md#cordis-waterfall-semantics)）；挂载代码在当前轮次的工具调用内运行，因此 await 任何只在该轮次结束后才 resolve 的东西会导致死锁；`vmTimeoutMs` 仅约束同步执行；挂载不会在会话恢复后存活。
