# Agent Note: Runtime arg validation at the model boundary

Status: implemented

## Problem

`defineTool` ([the unified schema DSL](2026-07-20-unified-json-value-schema-dsl.md)) gives tool authors a typed `execute(args)` via the `InferArgs<S>` mapping. But that type is a compile-time claim about a value that arrives at runtime as model-generated JSON: nothing forced the model to honor the schema, so a malformed call — missing a required key, a string where a number was declared, or a literal outside the declared set — reached `execute` typed-in-name-only. The tool body then either crashed on the bad shape or silently misbehaved.

## Decision

`validateArgs(spec, args): string[]` compiles a `ParameterSchemaSpec` and delegates to the shared `validateJsonSchemaValue()` walker, returning human-readable violations for a well-formed declaration. `defineTool` snapshots the compiled parameter schema at definition time and runs that validation before the typed body; violations throw `ToolArgsError` (`INVALID_ARGS`), which the registry returns as an error result the model can correct.

The validator and compiler therefore share exact semantics: the implicit parameter root is an open object; required keys come only from `required: true`; defaults remain annotations; explicit nested objects honor their declared openness; arrays recurse through `items`; scalar literal constraints are type-correct; and `oneOf` accepts exactly one matching branch. Raw-registered tools own their input validation.

## Consequences

- The model gets actionable feedback on its own malformed calls instead of an opaque crash, closing the gap between `InferArgs`'s promise and runtime reality.
- The validator and `InferArgs` must stay in agreement; [a property test](../testing/2026-06-11-property-based-testing.md) generates args satisfying a spec and asserts they pass `validateArgs` (with targeted corruptions rejected), closing that drift risk mechanically.
- `ToolArgsError` is a plain `Error` with a `code` field for now; if a harness-wide error taxonomy lands it becomes a subclass without changing callers that read `.message`.
- Validation cost is negligible next to a model call.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
