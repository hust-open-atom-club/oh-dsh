# RFC: 模型边界处的运行时参数校验

Status: implemented

[English](2026-06-11-runtime-arg-validation.md) | 中文

## 问题

`defineTool`（[自定义 schema DSL](2026-06-11-custom-schema-dsl.md)）通过 `InferArgs<S>` 映射为工具作者提供了类型化的 `execute(args)`。但该类型只是对运行时值的编译期声明，而这个值实际上是模型生成的 JSON：没有任何机制强制模型遵守 schema，因此畸形调用（缺少必需键、声明为数字的位置传入字符串、枚举值超出集合）会以「仅名义类型化」的状态到达 `execute`。工具函数体要么在错误形状上崩溃（产生模型无法据以自我修正的通用堆栈跟踪），要么更糟——静默地行为异常。与此同时，转换器已经编码了校验器遍历所需的完整结构。

## 决策

`validateArgs(spec, args): string[]` 对运行时值解释一个 `SchemaSpec`，返回可读的违规列表（空数组 = 合法），且是全函数（永不抛出异常）。`defineTool` 在调用类型化函数体之前运行它；存在违规时抛出 `ToolArgsError`（`code: 'INVALID_ARGS'`，消息中列出违规项），注册表既有的 execute-waterfall（瀑布式事件）catch 将其转为模型可读取并据以自我修正的 `isError` 结果。

校验器严格镜像 `schemaSpecToJsonSchema` 的语义——遍历相同结构、执行相同规则：顶层必须是非数组对象；必需键仅来自 `required: true`；允许额外键（不设 `additionalProperties: false`）；不应用 `default`；没有 `properties`/`items` 的 `object`/`array` 属性仅做类型检查；`enum` 是成员资格检查。原始注册的（MCP）工具不受影响——它们自行校验输入。

## 后果

- 模型在自身畸形调用上获得可操作的反馈，而非不透明的崩溃，弥合了 `InferArgs` 的承诺与运行时现实之间的鸿沟。
- 校验器与 `InferArgs` 必须保持一致；一项[属性测试](../testing/2026-06-11-property-based-testing.md)生成满足 spec 的参数并断言它们通过 `validateArgs`（同时断言定向破坏的参数被拒绝），以机械方式封堵漂移风险。
- `ToolArgsError` 目前是带 `code` 字段的普通 `Error`；如果日后引入 harness 级别的错误分类体系，它将变为子类，但不影响读取 `.message` 的调用方。
- 校验开销相对于一次模型调用可忽略不计。

<!-- rfc-format: alternatives-not-recorded (pre-format RFC) -->
