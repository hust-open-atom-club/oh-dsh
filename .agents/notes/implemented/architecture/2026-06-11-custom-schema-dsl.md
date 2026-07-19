# Agent Note: Custom typed tool-schema DSL instead of schemastery

Status: implemented

## Problem

Tool parameters must reach the model as standard JSON Schema while giving tool authors typed `execute(args)` without casts. Schemastery already serves plugin config, but the tool-author API needs per-property `required: true` booleans rather than JSON Schema's separate `required` array.

## Decision

A small custom DSL in dsh-tools: `SchemaSpec` (per-property specs with `required: true` booleans), type-level `InferArgs<S>` mapping a spec to the argument type (required keys non-optional, others genuinely optional via `?`), a runtime `schemaSpecToJsonSchema()` converter, and `defineTool()` tying them together. Raw JSON-Schema `ToolDefinition`s remain accepted by `ToolRegistry.register()` — that's how MCP-sourced tools arrive.

## Alternatives considered

**Schemastery** (already vendored, used for plugin Config) was evaluated and rejected for this use: it targets validation / transformation against StandardSchema, not JSON Schema *generation*, so it would add indirection without producing the wire format cleanly.

## Consequences

- First-party tool authors get zero-cast typed args; the type gymnastics cost stays inside the core package (sanctioned by the AGENTS.md type-safety policy).
- The DSL is deliberately small (string/number/boolean/object/array, enum, default, nested properties/items). Gaps vs full JSON Schema (unions, formats, constraints) are accepted until real tools demand them.
- The `InferArgs` mapping is regression-tested at the type level after an early optionality bug.
