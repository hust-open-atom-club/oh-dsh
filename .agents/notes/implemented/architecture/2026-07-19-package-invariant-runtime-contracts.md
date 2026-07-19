# Agent Note: Executable package invariant contracts

Status: implemented

English | [中文](2026-07-19-package-invariant-runtime-contracts.zh.md)

## Problem

The package-owned invariant seam made registration and publication exhaustive, but its generated baseline treated package-name ownership as sufficient. An empty installer could satisfy the repository gate while observing no runtime state and rejecting no invalid state. That made the exhaustive count a wiring claim rather than protection for the package contract.

Every package shape cannot use the same invariant. Cordis plugins own fibers, injections, effects, and services; service seams admit structural third-party implementations; stateful domains need event relations; pure libraries and bin packages expose algebra, parsing, normalization, or entrypoint constraints. The repository needs one enforceable obligation without moving those contracts back into a central product-aware package.

Vitest also mounts every companion globally. Companion modules therefore cannot eagerly import every product entrypoint before a test module establishes its hoisted mocks, and a name-based observer cannot mistake an anonymous child fiber that inherits its parent's display name for the package plugin itself.

## Decision

### Every companion executes a package contract

Every workspace package keeps its separately published `./invariant` companion and exact npm-name registration, but the installer must execute at least one package-specific check through the bound `fail(message)` reporter. The ownership-baseline generator and its root script entry are removed; generated markers, empty installers, and installers that never reference the reporter are repository errors.

The implemented contracts use four forms:

| Owner shape | Runtime contract |
|---|---|
| Stateful session, agent, scope, and agent-loop owners | Validate event ordering, enclosure, status transitions, scoped subjects, and reconstructable model requests. |
| Cordis plugin owners | Validate the plugin's own declared runtime name, required injections, owned effects, provided services, and package-specific all-or-none or config-dependent relations. |
| Cordis service seams | Validate the structural method and descriptor surface of current and future implementations. |
| Pure libraries, bins, and support packages | Validate stable parser mapping, protocol precedence, retention and timeout algebra, path resolution, normalization, environment scrubbing, or deliberately empty runtime entrypoints. |

At implementation time this covers all 91 workspace packages: four stateful companions, 62 plugin-fiber companions, eight service-shape companions, and 17 pure/bin/support companions.

### Product-independent observers

`observePluginInvariant` checks existing fibers immediately and future active fibers through global Cordis lifecycle events. A contract may supply an exact callback when that import is safe. Otherwise it matches `fiber.runtime.name`, the name declared by that fiber's own plugin runtime, rather than the inherited `fiber.name`; anonymous `ctx.inject()` children are therefore not misidentified as their parent package. The observer checks required injection keys, recursively collected effect labels, services provided by that exact fiber, and an optional owner validator. Config-dependent packages encode symmetric relations, such as automatic compaction owning both listeners or neither when disabled.

`observeServiceInvariant` checks the current service and every later binding. `serviceShapeViolation` validates callable members and non-empty string descriptors structurally instead of using `instanceof`, so conforming third-party backends and complete test doubles remain valid while incomplete stand-ins fail.

`assertInvariant` handles synchronous package algebra. Pure-package companions register an asynchronous child effect and dynamically import their owner inside that effect. This preserves atomic service-owned rollback while allowing the test module, Loader, or deployment to establish mocks and module resolution before the invariant samples the owner.

### Gate and test execution

`verify-package-invariants` discovers every workspace package and retains the publication checks for the exact registration name, `./invariant` export, published files, invariant peer and development dependencies, TypeScript reference, and bundle entry. Its source check additionally parses the local `install` function, rejects a generated marker or empty body, requires a second failure-reporter parameter and its use, and rejects duplicate name-based plugin observers across packages. These AST checks are a minimum acceptance rule, not a claim that source shape proves semantic quality.

The Vitest setup host mounts `InvariantService` with `{ enabled: true }` and all 91 companions before an ordinary Cordis root's first plugin. The host joins companion startup to the test's root-level composition boundary, so asynchronous pure checks and plugin-observer setup fail the test rather than becoming background diagnostics. Focused selection, lifecycle, and owner suites build their own enabled topology to avoid duplicate registrations while still testing invariants.

Helper tests reject invalid plugin names, missing injections, effects, services, custom relations, malformed service shapes, and failed assertions. Package suites then activate real plugins across their existing config and HMR paths. Test-only service stand-ins must implement the complete checked seam rather than bypass global invariants.

## Alternatives considered

- **Keep generated ownership-only companions.** Rejected because registration without an executable assertion cannot reject a broken package and makes the exhaustive gate misleading.
- **Generate one synthetic assertion into every package.** Rejected because a universal assertion would again optimize for satisfying the gate instead of protecting an owner-specific contract.
- **Move the per-package contract matrix into `dsh-invariants`.** Rejected because product imports, vocabulary, and change ownership would return to the central service.
- **Import every owner entrypoint statically from its companion.** Rejected because the global test host would preload packages before hoisted mocks and shipped compositions would pay unrelated module initialization costs.
- **Require first-party service-class identity.** Rejected because service seams are structural extension boundaries; `instanceof` would reject valid external implementations and test doubles.
- **Register invariants implicitly from package root entrypoints.** Rejected for the composition-order and hidden-effect reasons in the package-owned service RFC.

## Consequences

- Every package contributes an executable check; adding a package without one fails the top-level gate.
- The invariant service remains product-independent while providing reusable lifecycle and shape observers.
- Ordinary unit, snapshot, and e2e tests run with global invariant enablement and every companion registered.
- Plugin names used for name-based observation must be unique within one Cordis root; packages may opt into exact callback identity when safe.
- Pure-package checks sample stable startup contracts. Mutable behavior must use an event, service, or plugin-fiber observer.
- More companion work runs during tests and selected deployments, trading small startup cost for immediate package-attributed failures.
- The original regex selection, blocklist precedence, registration uniqueness, rollback, disposal, and HMR contracts remain unchanged.
