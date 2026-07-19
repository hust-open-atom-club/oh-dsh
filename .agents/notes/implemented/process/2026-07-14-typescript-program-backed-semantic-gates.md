# Agent Note: TypeScript Program-backed semantic gates

Status: implemented

English | [中文](2026-07-14-typescript-program-backed-semantic-gates.zh.md)

## Problem

Repository gates sometimes need facts that TypeScript syntax does not carry by itself: whether a receiver is a Cordis `Context`, which concrete event names reach a forwarding helper, and whether declaration merging changed an event signature.

The existing gates use TypeScript's single-file syntax model and maintain these facts through naming conventions, handwritten tables, and JSDoc.

The repository needs one semantic source of truth without introducing runtime package cycles, broad fallback heuristics, or machine-readable annotations that restate information already available to TypeScript.

## Decision

Repository gates can combine project-wide type information through `ts.Program` and use `TypeChecker` to extract **strongly typed** facts, reducing their reliance on naming conventions, handwritten tables, and JSDoc metadata.

The repository applies this model to two gates.

### One project model expands the root solution

[`TypeScriptProject`](../../../../scripts/ts-project.ts) parses the root `tsconfig.json`, recursively expands every project reference, and combines the referenced source roots into one no-emit semantic program. A normal program created from the solution config can redirect referenced projects to built declarations; explicit expansion keeps the package `src` files available for AST traversal and symbol identity.

The wrapper owns config diagnostics, semantic compiler options, repository-relative paths, source lookup, and the shared checker. Individual gates do not glob package sources or construct partial programs independently.

### A. Event relations follow receiver and value types

[`gen-doc-graphs`](../../../../scripts/gen-doc-graphs.ts) classifies calls by assignability to the repository's actual `Context`, `AgentEventDispatch`, and Cordis `EventsService` types. Variable names and property spellings do not determine whether a call is an event operation.

Context and agent-dispatch calls contribute only finite string-literal event sets. Direct `EventsService.dispatch()` calls recover the event slot through array literals, constant aliases, conditional branches, and resolved call sites of non-exported local helpers. Generic forwarding parameters are not concrete producers: attribution stays with the call sites that supply a closed event value.

Every declared harness event must have a discovered producer. A missing producer fails generation as dead vocabulary or an unsupported semantic dispatch shape; listener-free extension points remain valid. `internal/dispatch` instrumentation is not treated as a subscription to every event it observes, so the matrix contains direct product listeners rather than manually asserted indirect relationships.

### B. Scoped-event routing generates one typed resolver map

[`gen-scoped-events`](../../../../scripts/gen-scoped-events.ts) scans real `scopeTarget(base, key)` calls to establish the routing-key type for each scoped base. It then finds Cordis `Events` members with `this: Scoped<Base>` and searches every payload parameter plus one public property level for a type identical to that key after removing `null` and `undefined`.

Exactly one match generates a resolver. Multiple matches are ambiguous and fail. Zero matches require `@dshScopeScan unsupported`, which is reserved for events whose routing key intentionally stays outside the payload, such as owner-keyed session events and parent-keyed subagent lifecycle events. The annotation records an unsupported scan; it does not encode an event name, parameter index, property path, or replacement type.

The committed [`scoped-events.generated.ts`](../../../../packages/support/invariants/src/scoped-events.generated.ts) imports every scoped-event owner for its type-side `Events` contributions. Each generated lambda accepts `Parameters<Events[K]>`, and the complete object satisfies a `Record` over the derived `ScopedEventName` union. Ordinary TypeScript compilation therefore checks event existence, parameter position, property access, and scoped-event completeness. The only cast adapts Cordis's runtime `unknown[]` dispatch boundary to the already type-checked resolver.

The invariants plugin consumes this generated runtime map instead of maintaining its own table. Additional event-owner packages are dev dependencies and project references of `dsh-invariants`, not peer dependencies, so the compile-time aggregation does not expand the plugin's runtime closure.

### Semantic gaps fail explicitly

The generators reject missing declarations, config diagnostics, widened or generic event names, inconsistent routing-key types, ambiguous payload matches, unnecessary unsupported annotations, and stale generated output. Recovery through local helper call sites is deliberately narrow: exported or unresolved dataflow requires a new semantic rule rather than a package-specific override.

## Verification

`verify-doc-graphs` freshness-checks semantic producer/listener discovery, and `verify-scoped-events` freshness-checks the generated resolver map. The root TypeScript build compiles the resolver against merged `Events`; workspace constraints and runtime-closure checks ensure its type-only aggregation does not become a deployment dependency.

## Alternatives considered

- **Keep syntax-only scans with receiver allowlists and manual overrides.** This is simple per exception but makes renames and new helper shapes update a second representation. Completeness can detect a missing producer, but it cannot prove that the override still describes the source.

## Consequences

- Event relation generation follows semantic receiver identity and closed event values instead of local naming conventions.
- Scoped-event membership, subject extraction, and runtime invariant coverage come from event declarations and real dispatch contracts rather than handwritten tables.
- Refactors that change event names, parameter positions, subject properties, or routing-key types fail generation or compilation at the owning contract.
- Building a flattened Program costs more startup time and memory than parsing isolated files, and semantic gates depend on a valid root project graph.
- Generated TypeScript remains committed source: changes to event owners or dispatch shapes must regenerate it and the affected documentation.
