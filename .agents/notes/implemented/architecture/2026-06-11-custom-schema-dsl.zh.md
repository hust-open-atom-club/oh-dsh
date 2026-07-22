# RFC: 使用自定义类型化 tool-schema DSL 替代 schemastery

Status: implemented

[English](2026-06-11-custom-schema-dsl.md) | 中文

## 问题

工具参数必须以标准 JSON Schema 形式到达模型，同时让工具作者在 `execute(args)` 中获得类型化的参数而无需类型断言。Schemastery 已用于插件配置，但工具作者 API 需要逐属性的 `required: true` 布尔值，而非 JSON Schema 的独立 `required` 数组。

## 决策

在 dsh-tools 中实现一个小型自定义 DSL：`SchemaSpec`（逐属性规格，带 `required: true` 布尔值）；类型层面的 `InferArgs<S>` 将规格映射为参数类型（required 键为必选，其余通过 `?` 标记为真正可选）；运行时的 `schemaSpecToJsonSchema()` 转换器；以及将三者串联的 `defineTool()`。`ToolRegistry.register()` 仍然接受原始 JSON Schema 的 `ToolDefinition`——MCP 来源的工具正是以此方式注册。

## 曾考虑的替代方案

**Schemastery**（已作为 vendor 引入，用于插件 Config）经评估后被否决：它面向的是基于 StandardSchema 的校验／转换，而非 JSON Schema *生成*，因此会增加间接层却无法干净地产出协议格式（wire format）。

## 后果

- 第一方工具作者获得零类型断言的类型化参数；类型体操的成本留在核心包内部（符合 AGENTS.md 的类型安全策略）。
- DSL 有意保持小巧（string/number/boolean/object/array、enum、default、嵌套 properties/items）。相对完整 JSON Schema 的缺口（union、format、constraint）在真实工具提出需求之前暂不补齐。
- `InferArgs` 映射在类型层面有回归测试，源于早期一个可选性 bug。
