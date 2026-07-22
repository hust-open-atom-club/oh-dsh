# Agent Note: GUI testing system — the three-tier structure

Status: implemented

> Path update (2026-07-22, plugin-system refactor): the three-tier philosophy and golden-path method here remain current; homes moved — object-layer specs now live in `packages/client/runtime/tests/` (was web-runtime), wire specs in `packages/client/connection/tests/`, and the `web-ui` coverage exclusion is gone with the package (component specs are per-plugin jsdom suites under each `packages/client/*/tests/`). Current test-system authority: `missions/tasks/20260721-1520-web-plugin-rfc/architecture.md` §18.

English | [中文](2026-07-20-gui-testing-system.zh.md)

> Division of labor: this note covers only the test structure specific to the GUI (`packages/{client,host}/*` + `apps/web`); repo-wide testing policy (tiering principles, the with-key policy, real-implementation-first, REAL-composition) lives in [docs/testing.md](../../../../docs/testing.md) and is not restated here.

## Problem

The GUI stack spans multiple application shapes, and within one shape multiple runtime environments (the Node host, the data protocol layer, the browser object layer, React/DOM); a single-lane test suite cannot give a meaningful signal. Every link needs effective tests of its own, plus the base capability for full-chain testing.

## Decision

Cut along the architecture's natural test seams into three tiers, bottom-up:

| Tier | Under test | Key technique | File location |
|---|---|---|---|
| 1 Protocol isomorphism | `AbstractApiClient` + `toFetchHandler` (bidirectional data / rpcId / zod types / SSE streams / batching / timeouts) | **The full chain at the isomorphic point**: `InProcessApiClient(toFetchHandler(脚本化 impl))` skips the network but genuinely runs the wire serialization — zero browser, pure node env | `packages/host/apiproxy/tests/client-handler.spec.ts` |
| 2 Object-layer orchestration | `Session`/`SessionManager`/`ConnectionController` (state machines and timing: stitching / dedup / paging / optimistic draft clearing / pendingBuffers / reconnect / backoff) | **The "event sequence in → snapshot out" golden path**: programmable fakes + deferreds controlling timing + fake timers controlling backoff | `packages/client/web-runtime/tests/{session,manager,connection,…}.spec.ts` |
| 3 Browser smoke | Build artifacts × a real browser (the page boots, one conversation round-trips) | Bare playwright library (chromium headless, no @playwright/test framework), minimal pass-through; fixture level + real-host level (self-skips without a key) | `apps/web/tests/smoke-{fixture,real}.e2e.ts` |

Inter-tier discipline: **each tier tests its own layer, upper tiers never re-test lower ones** — smoke only proves the wiring is alive (the fixture level asserts zero `/api` requests and zero pageerror), interaction detail belongs to the verify scripts (see the lane map), wire semantics to tier 1, data semantics to tier 2. Pure-function layers (lineage/partial/notifier/fold-adapter) are tested directly with zero fakes in the same package's tests/ alongside tier 2.

- **Host side** (apiproxy/runtime/webserver): under the repo-wide `test:coverage` gate, per-file 100%.
- **Client side**: web-runtime **is already under the per-file 100% gate** (12 defensive unreachable arms carry reasoned `/* v8 ignore */` comments); the `vitest.config.ts` coverage.exclude is down to `packages/client/web-ui/src/**` (temporary — lifted progressively as component specs fill in after the component redo); tests still run, the exclusion only keeps web-ui src out of the thresholds. web-ui takes the **jsdom route (landed)**: jsdom + @testing-library/react entered root devDependencies (dev-only), first spec `web-ui/tests/utils.spec.tsx` (utils pure functions + component RTL render + hook uSES probe); the environment uses the per-file `// @vitest-environment jsdom` pragma, zero impact on the other node-env packages.
- The exclusion is an **explicitly annotated ruling**, not a silent waiver; the lift path = delete the exclude line + add a justified exclusion or the missing tests.

## Lane map

| Scenario | Command | Content | When to run |
|---|---|---|---|
| Baseline | `pnpm run test:gui` | Tier 1+2 vitest (`packages/client packages/host`), seconds-fast, no browser, no server | Casually, after touching any GUI source |
| Browser end-to-end | `pnpm run test:web` | Rebuilds the front-end dist first, then runs the tier-3 two-level smoke (fixture level + real-host level self-skip) | After touching the build surface/boot/carriage; before delivery |
| Gate | `pnpm run test:coverage` | The repo-wide gate (host-side GUI packages included, client side excluded) | The PR window |

**Division of labor between the verify scripts and vitest**: verify owns browser black-box regression (sequential steps = a user-operation script, one shared browser session, streaming PASS/FAIL output for the agent to locate the break), vitest owns first-class data-layer semantic assertions (reference stability `toBe`, state-machine timing, wire shapes). The two lanes complement each other, neither absorbs the other — scripts do not migrate to vitest (tearing apart an ordered script is a net loss); promoting one means wrapping a spawn shell hooked into the e2e lane, never rewriting the script body.

## Anti-regression discipline

- **Every bug fix pins an assertion**: a browser-visible bug is pinned into the regression section of its owning verify script (one pin = one report line); a data-layer bug is pinned into the matching spec (precedent: the res-close misjudgment pinned in the webserver bridge suite — pure Node, reproduces in seconds, no longer needs the 12s browser sentinel as the only defense).
- **All-green on fixture is not done, the real host must pass too**: what the fixture short-circuits is exactly the wire carriage chain (node:http bridge close semantics, real network timing); both empirically confirmed bugs hid there. Changes touching connection/bridge/handler/SSE must run `verify-session-real`.
- The code-on-disk-is-the-answer reconciliation workflow: when a behavior change lands and turns existing cases red, reconcile on the spot (fix the test or fix the code, with the RFC/contract as arbiter); no red left hanging.

## Consequences

Each lane tests its own tier: touching any GUI source gets seconds-fast `test:gui` feedback, wire/object-layer semantics assert in milliseconds in node env, and the browser carries only wiring-liveness smoke. On the gate surface, the host side is fully under per-file 100%; on the client side web-runtime is under the gate while web-ui waits behind the explicitly annotated exclude. The accepted cost: the inter-tier discipline (upper tiers never re-test lower ones) is upheld by review rather than a machine gate, and web-ui's coverage gap persists until component specs fill in after the component redo.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| Single e2e (everything through the browser) | Browser startup is seconds × N slower and timing is uncontrollable; wire/object-layer invariants can be fully asserted in milliseconds in node env |
| Migrating the verify scripts to vitest | An ordered script shares one browser session; splitting the cases either formalizes it (sequential + shared page) or re-runs the preamble × N; streaming PASS/FAIL output is exactly the agent's locating interface |
| Reusing FixtureApiClient in tests | The demo script runs on a real clock, tests need deferred hand-controlled timing — orthogonal purposes; forced reuse chains the tests to the demo's rhythm |
| A standalone vitest config for GUI packages (once designed as vitest.gui.config.ts) | Package-level tests/ are already scanned by the root include; `vitest run packages/client packages/host` path filtering is the tight loop — zero new config |
| Deferring hooks/component-layer unit tests (the original ruling) | Once deferred as "components are consumables, revisit after the redo"; overturned by the user on 2026-07-20 — **the jsdom mainline enters coverage** (no browser infrastructure in CI is the decisive reason, playwright demoted to a local enhancement), the RTL dependencies entered devDependencies, the first spec landed |
