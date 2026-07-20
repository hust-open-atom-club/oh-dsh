# Agent Note: ACP snapshot tests — record-once / replay-deterministic

Status: implemented

## Problem

Unit tests do not exercise the complete ACP subprocess transcript, while real-API tests are nondeterministic and key-gated. Editor-facing `session/update` output can therefore regress despite green unit coverage, as the [default-export postmortem](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md) demonstrated.

The blocker for a full-transcript test is the model: the agent's output is driven by a non-deterministic LLM, and a key-gated test that hits the real API on every run is neither deterministic nor CI-runnable. We want the fidelity of a real run with the determinism of a fixture.

This Agent Note records the decision to add a third test tier — **snapshot tests** — and the design choices that make it deterministic, keyless-in-CI, and cheap to maintain.

## Decision

A snapshot test boots the real ACP example, drives its stdio protocol from a deterministic script, and compares normalized output with committed expected outputs. A session log recorded once from the real API supplies all later model streams. The fixture is the product's ordinary persisted JSONL.

### The fixture is the persisted session JSONL

Each scenario's `session.jsonl` is harvested from a real run. `assistant/chunk` events reproduce the model streams; tool, message, and boundary events capture the harness behavior. One ordinary session artifact therefore serves as both replay source and behavioral expected output.

### Replay derives the model script from the log

`llm-replay` short-circuits the provider-agnostic `llm/stream` waterfall. `deriveReplayScript()` groups recorded chunks by `(turn, step)` and serves one group per model call. The loop makes one stream call per step, so the grouping is exact and includes error finish chunks without special handling.

### The in-memory replay entry honors the full LLM contract

`deriveReplayScript` produces a list of `ReplayEntry`, the in-memory unit the replay listener serves positionally:

```
{ kind: 'chunks', chunks: StreamChunk[] }
| { kind: 'throw', chunks: StreamChunk[], message: string, code: string }
| { kind: 'hang' }
```

Logs derive chunk entries. Pre-stream throws and hangs have no reconstructable chunk representation, so those scenarios provide `replay.override.json`. A throw entry may include prefix chunks for mid-stream failure. Explicit overrides avoid inferring adapter behavior from lossy turn-end reasons.

### Positional replay, one in-flight stream

Replay is positional and therefore permits only one in-flight model stream per scenario. Concurrent-session snapshots require request-keyed entries. Changed call order requires re-recording, and missing or exhausted fixtures fail loudly.

### Recording harvests the log; keyless replay needs a providerless config

Recording runs the scenario with the real `llm-deepseek` adapter and the JSONL persistence backend, then copies the produced `.jsonl` into the scenario dir. Per-event appends are durable, but the harness shuts the subprocess down gracefully (close stdin → `await ctx.dispose()`) before harvesting so the final events are flushed. `llm-replay` itself does no recording — it is replay-only.

Replay uses a `cordis.snapshot.yml` overlay that replaces the real adapter with `llm-replay` while retaining the live composition. Recording uses the ordinary config and a harness-supplied persistence root. Replay mode skips `.env` loading, so a stray API key cannot trigger a live call. See the [single-source config Agent Note](2026-07-04-single-source-acp-replay-config.md).

### Two surfaces: normalize, then compare

A snapshot run asserts **two** normalized surfaces, because the harness's external surfaces are distinct:

1. The **stdout transcript** — the framed `session/update` JSON-RPC the editor sees. Catches regressions in the ACP bridge's event→update translation (`streamSessionEventUpdate`). Compared against a committed `stdout.expected.jsonl`.
2. The **re-persisted session JSONL**, normalized and compared with `session.jsonl`. The same fixture is both replay source and expected log. Prompt text is scrubbed; one scenario per header class pins readable prompt and tool content as described in the [header-pinning Agent Note](2026-07-06-pin-request-header-content-in-one-scenario.md). Override scenarios derive model behavior solely from their sidecar.

The surfaces are complementary: stdout covers bridge projection, while JSONL covers loop, tool, and boundary structure that the projection omits.

Normalization replaces session, cwd, protocol-id, timestamp, path, and process volatility while preserving deterministic sequence numbers. Scenarios constrain real bash use to stable commands. The stdout expected output remains wire-shaped JSONL and every raw line must parse as JSON. Vitest updates only the stdout expected output; normalized session equality never overwrites the replay fixture.

### Isolation: normalization now, sandbox later

Tool determinism comes from a temporary cwd, scrubbed environment, fresh non-login shell, constrained commands, and normalization. It does not claim OS confinement. A sandboxed executor can replace the local backend through the existing [capability seam](../architecture/2026-06-13-capability-seams.md) if a stronger tier is needed.

### The replay plugin is its own package

`@deepseek-ai/dsh-llm-replay` is a support package rather than example-local glue. It replaces the real adapter by short-circuiting `llm/stream` with streams reconstructed from JSONL, and its package placement keeps the replay logic under normal coverage gates.

### Two subcommands, replay in the default gate

`pnpm run test:snapshot` replays committed fixtures keylessly; `test:snapshot:record` uses the real API and rewrites the harvested session log and stdout expected output. Missing fixtures fail loud. Every scenario carries `input.json`, `stdout.expected.jsonl`, and `session.jsonl`; no-model cases use a header-only log. `replay.override.json` is required only for scenarios marked `overridden`, because its presence replaces derived replay. Fixture guards reject missing, mismatched, and orphaned files. Both commands accept scenario filters.

## Alternatives considered

- **A hand-authored `llm.json` of model chunks** — the earlier draft; reusing the real session log makes the fixture a genuine product of the system rather than a hand-built mock, and doubles it as a behavioral expected output.
- **A byte-level HTTP-record library (Polly/nock/MSW)** — rejected: adapter-specific, awkward with streaming SSE, and lower-level than the thing under test.
- **Synthesizing throw/cancel entries from `turn/end {kind:'error'|'aborted'}`** — rejected: it couples `llm-replay` to loop-internal turn-closing semantics, and the `turn/end` reason is lossy (it cannot distinguish a thrown 401 from a finish-error); the explicit `replay.override.json` sidecar is the cleaner seam.

## Consequences

The new tier adds reviewed per-scenario input, session, stdout, optional override, and optional workspace fixtures. Workspace seeds are copied into the temporary cwd for both record and replay. In return the tier provides deterministic keyless transcript coverage through the real Loader and tool composition. The subprocess, input, workspace, normalization, and replay harness can support examples beyond ACP.

This Agent Note relates to but does not supersede the [proposed determinism Agent Note](../../proposed/testing/2026-06-11-deterministic-and-stress-testing.md): that proposal's "universal replay fixture" re-derives session *message history* after every test (an internal-consistency invariant), whereas snapshot tests pin the *external protocol output*. They are complementary — one guards the event-sourcing invariant, the other guards the editor-facing contract.
