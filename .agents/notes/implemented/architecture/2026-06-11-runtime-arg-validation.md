# Agent Note: Runtime arg validation at the model boundary

Status: implemented

## Problem

`defineTool` ([the custom schema DSL](2026-06-11-custom-schema-dsl.md)) gives tool authors a typed `execute(args)` via the `InferArgs<S>` mapping. But that type is a compile-time claim about a value that arrives at runtime as model-generated JSON: nothing forced the model to honor the schema, so a malformed call — missing a required key, a string where a number was declared, an enum value outside the set — reached `execute` typed-in-name-only. The tool body then either crashed on the bad shape (a generic stack trace the model can't act on) or, worse, silently misbehaved. Meanwhile the converter already encodes the exact structure a validator would need to walk.

## Decision

`validateArgs(spec, args): string[]` interprets a `SchemaSpec` over a runtime value, returning human-readable violations (empty = valid), and is total (never throws). `defineTool` runs it before the typed body; on violations it throws `ToolArgsError` (`code: 'INVALID_ARGS'`, message listing the violations), which the registry's existing execute-waterfall catch turns into an `isError` result the model reads and self-corrects from.

The validator mirrors `schemaSpecToJsonSchema` semantics exactly — same structure walked, same rules: top level must be a non-array object; required keys come only from `required: true`; extra keys are allowed (no `additionalProperties: false`); `default` is not applied; an `object`/`array` prop without `properties`/`items` only type-checks; `enum` is membership. Raw-registered (MCP) tools are not touched — they validate their own input.

## Consequences

- The model gets actionable feedback on its own malformed calls instead of an opaque crash, closing the gap between `InferArgs`'s promise and runtime reality.
- The validator and `InferArgs` must stay in agreement; [a property test](../testing/2026-06-11-property-based-testing.md) generates args satisfying a spec and asserts they pass `validateArgs` (with targeted corruptions rejected), closing that drift risk mechanically.
- `ToolArgsError` is a plain `Error` with a `code` field for now; if a harness-wide error taxonomy lands it becomes a subclass without changing callers that read `.message`.
- Validation cost is negligible next to a model call.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
