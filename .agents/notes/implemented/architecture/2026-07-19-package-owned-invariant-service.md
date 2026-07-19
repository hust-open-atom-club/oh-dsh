# Agent Note: Package-owned invariant service seam

Status: implemented

English | [中文](2026-07-19-package-owned-invariant-service.zh.md)

## Problem

Runtime invariant checks span session traces, agent state, scoped dispatch, and request reconstruction. Putting all checks in one diagnostics package makes that package import product vocabularies from unrelated domains, centralizes tests away from their owners, and requires the central package to change whenever a product package adds or removes a check.

Deployments also need more than presence or absence of one plugin. A standard composition should carry the known invariant contributions while permitting a global off switch and package-selective diagnostics. Selection must remain stable when a package loads later or reloads under HMR, and disabled contributions must not allow two plugins to claim the same package name silently.

## Decision

### One registry service, package-owned contributions

`@deepseek-ai/dsh-invariants` is a product-independent Cordis service plugin that registers `ctx.invariants`. It owns configuration, registration uniqueness, child-fiber lifecycle, and package-attributed failures. It imports no session, agent, scope, or agent-loop package and contains none of their checks.

Packages expose diagnostics through optional `./invariant` companion plugins. Their root entrypoints do not import or register diagnostics implicitly, so loading a product package does not change runtime checking or require the invariant service.

### Configuration and selection

```ts
interface Config {
  enabled?: boolean
  package_allowlist?: string[]
  package_blocklist?: string[]
}
```

Defaults are `enabled: true`, `package_allowlist: []`, and `package_blocklist: []`. For a full registration name, selection is:

```ts
export function selected(enabled: boolean, package_allowlist: RegExp[], package_blocklist: RegExp[], packageName: string): boolean {
  return enabled
    && (
      package_allowlist.length === 0
      || package_allowlist.some(pattern => pattern.test(packageName))
    )
    && !package_blocklist.some(pattern => pattern.test(packageName))
}
```

Blocklist matches override allowlist matches. Each list entry is a case-sensitive JavaScript regex source compiled by `new RegExp(pattern)`. Matching is unanchored unless callers supply `^` and `$`; slash-delimited syntax and flags are not interpreted. Startup rejects blank, whitespace-padded, invalid, or duplicate sources within either list. A source that matches no loaded package remains valid because registration order, later loading, and HMR must not change config validity.

### Registration and failure ownership

The public registration boundary is `ctx.invariants.register(packageName, installer)`. It reserves one active registration per full npm package name even when filters disable installation, and returns the effect disposer. Disposing the companion or service releases the reservation and all contribution state.

An enabled installer runs in a dedicated child Cordis fiber owned by the service. `InvariantInstaller.inject` declares the child fiber's service surface explicitly; the registry carries no product-specific dependency metadata. The installer receives a bound `fail(message)` reporter. Calling it throws an `Error` subclass named `InvariantError` with stable code `INVARIANT` and the registering `packageName`; it does not extend a product-package error base.

Registration setup is transactional. If an installer fails after registering listeners, the child fiber is disposed completely and the name reservation is released before the failure escapes. Filtered registrations create no child but retain their reservation until disposal. Reloading a companion therefore begins with one clean installer state; stateful contributions rebuild baselines from their owning services.

The former functional-plugin entrypoint and one-argument `InvariantError` constructor are not retained as compatibility surfaces. The repository is pre-release and all call sites move to the service and package-attributed error together.

### Shipped companions

| Companion entry | Registration name | Owned checks |
|---|---|---|
| `@deepseek-ai/dsh-session/invariant` | `@deepseek-ai/dsh-session` | session sequence, turn/step enclosure, and same-step call/result trace |
| `@deepseek-ai/dsh-agent/invariant` | `@deepseek-ai/dsh-agent` | agent-status transitions |
| `@deepseek-ai/dsh-scope/invariant` | `@deepseek-ai/dsh-scope` | scoped-event carrier presence and subject consistency |
| `@deepseek-ai/dsh-agent-loop/invariant` | `@deepseek-ai/dsh-agent-loop` | model-request reconstruction |

Each owner contains its source and focused tests. Every companion is a separately bundled `./invariant` export with its own declarations and Loader-safe namespace plugin shape. The service package retains only registry tests.

### Scoped-event semantic map

The generated scoped-event subject resolver lives in `dsh-scope`, beside the contract and invariant that consume it. `gen-scoped-events` uses the root TypeScript Program to enumerate `this: Scoped<Base>` declarations, infer routing-key types from real `scopeTarget(base, key)` calls, and require one unambiguous payload subject or an explicit unsupported marker. The committed runtime map imports no event-owner package, so semantic completeness does not expand either the service or scope package's runtime closure.

### Standard composition and SDK output

The standard agent spine mounts the service and all four companion subpaths, forwarding `enabled`, `package_allowlist`, and `package_blocklist` to the service. Generated SDK Cordis composition emits the same entries. A subpath entry adds its installable root npm package rather than treating the subpath as a package name.

Workspace constraints recognize the separate invariant bundle, and package exports, project references, build configuration, dependency declarations, and the lockfile describe the same publication surface. Generated config catalogs, module graphs, and API documentation derive from those sources.

## Testing

Service tests cover defaults, global disablement, allow/block selection, blocklist precedence, anchoring, unanchored matching, case sensitivity, invalid configuration, zero-match patterns, late registration, duplicate ownership, disposal, rollback, and HMR re-registration. Owner tests keep each invariant's positive and negative behavior beside its source.

Composition tests cover standard-spine forwarding and generated SDK entries. Loader tests preserve each companion namespace, while built plain-Node smokes exercise the compiled subpath exports. The scoped-event freshness gate reruns its semantic Program analysis.

## Alternatives considered

- **Keep all checks in `dsh-invariants`.** Rejected because the registry would continue importing every checked product domain, owner changes would require central edits, and package tests would remain detached from the contracts they protect.
- **Let root package entrypoints register checks implicitly when `ctx.invariants` happens to exist.** Rejected because root behavior would depend on composition order and optional service presence, diagnostics could not be selected independently, and package loading would hide a registration effect outside an explicit companion.
- **Discover every `invariant.ts` file automatically.** Rejected because filesystem/package discovery is not a runtime ownership contract, makes bundled publication ambiguous, and cannot express explicit Cordis load order or dependency installation.
- **Validate allow/block entries against the currently loaded package set.** Rejected because a zero-match pattern can intentionally target a later or HMR-loaded contribution; current load order must not determine config validity.

## Consequences

- Product packages own and test their relational assertions while the service stays product-independent.
- Standard compositions can disable all checks or select package names without changing their plugin tree.
- Explicit companion entries make diagnostic cost and ownership visible in Cordis config and package exports.
- One selected contribution adds one child fiber and its listener/state cost; filtered registrations retain only name ownership.
- Regex sources are deployment configuration and remain fixed until the service reloads.
- Session storage validation, snapshotting, freezing, provenance, and surface acceptance remain always on and are not affected by invariant selection.
