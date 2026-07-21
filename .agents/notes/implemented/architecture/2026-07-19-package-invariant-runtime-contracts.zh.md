# Agent Note: 有意义的包不变量契约

Status: implemented

[English](2026-07-19-package-invariant-runtime-contracts.md) | 中文

## 问题

包自有不变量接缝让发布和注册实现了全覆盖，但最初的生成基线允许空安装器。后续方案又用针对插件名称、注入、effect、服务方法和固定纯函数示例的通用断言替代这些空实现。这些断言虽然让每个 companion 都能执行，却没有提高系统安全性：TypeScript、Cordis 启动、包测试和模块加载测试已经约束这些形状，而不变量服务应当发现不可能出现的运行时状态。

有用的运行时不变量会关联时间上的多个观测，或关联可变数据结构中的多个部分。例如：终止事件没有对应的开始事件、LLM delta 指向未打开的 block，或持久化结果的身份与请求不同。仅确认声明的方法存在、插件名称符合预期，或常量示例仍返回已知值，都不属于这种关系。

有些包确实没有可持续观测的关系。纯工具、仅负责组合的包、薄适配器、可执行入口和测试支持包可能仍有重要契约，但类型检查、加载检查、聚焦单元测试或集成测试更适合执行这些契约。强迫这些包添加合成运行时断言，只会让实现围绕通过门禁优化，而不是检测损坏。

## 决策

### 注册必须全覆盖；断言必须有意义

每个 workspace 包都发布单独构建的 `./invariant` companion，并用完整 npm 包名注册。companion 只能采用以下两种形式之一：

- 安装包自有的事件流或相关可变数据结构检查，并通过绑定的 `fail(message)` 报告器报告违规；或
- 使用空安装器，并在其声明前写一条该包专属的 `No runtime invariant:` 注释，说明为什么该包没有合理的运行时关系可供观测。

空形式是明确的架构结论，不是生成占位符。如果后续包变更引入可变状态或事件协议，就必须用相应检查替换该说明。

中央 `dsh-invariants` 服务只负责配置、注册唯一性、子 fiber 生命周期、回滚、释放和归属到包的失败。它不暴露通用插件形状、服务形状或启动断言 helper，也不导入产品包。

### 已实施的检查

当前 103 个包的 workspace 包含 21 个可执行 companion 和 82 个有理由的空 companion。

| 所有者 | 运行时关系 |
|---|---|
| `dsh-session` | 序号严格递增、turn/step 包围关系，以及同一 step 内的工具调用/结果配对。 |
| `dsh-agent` | agent 状态不得重复，并且不能离开终态 disposed。 |
| `dsh-scope` | scoped event 必须携带 carrier，且路由 subject 保持一致。 |
| `dsh-agent-loop` | 从 session 事件日志重建带显式标记的冻结 loop 请求。 |
| `dsh-llm` | stream block 文法、delta 类型/索引匹配、单次 usage、block 闭合和终止 finish。 |
| `dsh-llm-retry` | 持久化重试记录指向当前打开 turn 中最近关闭的 step；每个 step 的记录保持唯一，重试次数单调递增，并且重试次数和非负的定时器延迟均保持在边界内。 |
| `dsh-tools` | pre/execute/post 阶段单调推进，以及最终 execution/result 快照不可变。 |
| `dsh-system-prompt` | 权威 assembly 中 section、tool 和 variable 的数据约束。 |
| `dsh-compact` | compaction start/summary/end 配对、范围端点、token 数量和成功时必须存在 summary。 |
| `dsh-hook-protocol` | hook invocation/result 的关联、dialect、身份和 duration 约束。 |
| `dsh-sandbox-policy` | 持久化 `sandbox/mode` 事件必须使用封闭的 sandbox-mode 词表。 |
| `dsh-fs` | 文件系统决策/观测事件必须携带可用的 target 和 version 身份。 |
| `dsh-goal` | 持久化目标快照保持来源归属、渲染内容、修订号、生命周期和时间戳关系，并保证已准入的目标回合连续编号。 |
| `dsh-goal-session` | 目标来源的继续执行消息必须匹配根据此前持久化目标状态重建的提示词。 |
| `dsh-subagent` | provider add/remove 和 child start/end 事件必须保持身份与配对。 |
| `dsh-permission` | 持久化 permission 决策必须引用当前 permission 表中的 preset。 |
| `dsh-user-approval` | approval asked/decided 记录按 call 配对，并使用有效 outcome 和 policy。 |
| `dsh-workflow` | workflow 和 child-agent start/end 事件保持 run metadata、身份、outcome、数量和 error 关系。 |
| `dsh-tasks` | 当前与终态 task snapshot 保持 id/kind、owner、status 和 timestamp 关系。 |
| `dsh-tool-todo` | 持久化全量 snapshot 使用唯一且已 trim 的条目、封闭 status，并且最多有一个活动条目。 |
| `dsh-time-context` | 标注插件来源的时钟 reading 必须匹配 session 当前打开的 turn、下一个 step 开始前的位置和 elapsed baseline；渲染时间必须可解析，且不得晚于对应事件。 |

基于 session 的 companion 在加载时验证已有持久化事件；关系依赖事件顺序时，会使用每个候选事件之前的事件前缀。其他检查观测权威 live event 边界或可变服务结果。如果接受无效事件会提交错误状态，验证就在发布前执行。

### 仓库门禁与测试

`verify-package-invariants` 发现每个 workspace 包，并强制 companion 源文件、完整名称注册、仅含具名 export 的 Loader 形状、`./invariant` export、发布文件、依赖、TypeScript reference 和 bundle entry 完整。其 AST 规则拒绝生成标记、默认导出和没有解释的空安装器。非空安装器必须接收并使用失败报告器，注册时还必须传入该经检查的本地 `install` 函数。门禁不会通过方法名或 helper 调用推断语义质量。

Vitest 为每个包测试拓扑使用 `{ enabled: true }` 挂载 `InvariantService`，并加载所有者 companion。不变量 subpath 的 path mapping 会解析源 companion，而不是陈旧的构建输出。聚焦 suite 覆盖每个可执行 companion 的有效和无效观测；穷举拓扑通过真实 Loader 命名空间归一化运行每个源 companion。产物门禁会按每个包的精确 `npm pack` 文件清单暂存文件，在 plain Node 下导入该包已编译的 `./invariant` 自引用，并重复执行该 Loader 形状检查；这样，未发布的共享运行时分片会在正式发布前导致门禁失败。合成事件流的测试必须构造有效的外围生命周期，除非测试本身就是在断言违规。

## 考虑过的替代方案

- **保留生成的空 companion。** 拒绝，因为包获得有意义的运行时关系后，没有解释的占位符仍可能继续存在。
- **要求每个包都执行断言。** 拒绝，因为方法存在性、插件形状和固定示例断言会重复更强的类型、加载和单元测试契约，却没有检查运行时一致性。
- **在服务中保留通用形状 helper。** 拒绝，因为这会混淆编译期 API 验证和运行时不变量，并鼓励在中央定义产品假设。
- **把产品检查移入服务。** 拒绝，因为产品词汇、依赖、测试和变更所有权应归属于产生这些数据的包。
- **从根入口隐式注册 companion。** 拒绝，因为组合顺序和可选服务存在性会产生隐藏 effect。

## 后果

- 每个包都有可见的所有权与发布 wiring，但只有具备合理运行时关系的包才会增加 listener 或 trace 状态。
- 空 companion 是带包专属说明、可评审的决策；删除说明后门禁会失败。
- 类型声明、Cordis 可加载性、插件 metadata、服务方法形状和纯代数继续由所属的编译、加载、单元或集成门禁覆盖。
- 运行时失败会标明所属 npm 包，并指出不一致的观测，而不是复述必要的 API 形状。
- 原有 selection、blocklist 优先级、重复所有权、回滚、释放和 HMR 服务契约保持不变。
