# Agent Note: Session persistence as an abstract service over the existing `SessionEvent`

Status: implemented

## Problem

Sessions lived only in memory. The example `session-jsonl.ts` plugin (duplicated byte-for-byte in both examples) was write-only telemetry: it buffered `session/event` and appended JSON lines, with no read/replay path, no crash-safety (no fsync, no atomic write, a fire-and-forget dispose drain), no listing, and no format versioning. Nothing could rehydrate a past session from disk into a live agent, so durable resume ("continue yesterday's task"), durable forking, and the ACP `session/load` method ([ACP support](../feature/2026-06-14-acp-agent-client-protocol.md)) were all impossible.

The [event-sourced model](2026-06-11-event-sourced-sessions.md) makes the append-only log the single source of truth and derives LLM history from it. Persistence had to stay faithful to that: persist the existing `SessionEvent` directly, with no parallel "persisted message" type that the log is converted to and from. The backend also had to be swappable — a file store now, a database store later — behind one interface.

## Decision

Persistence is an abstract **capability seam** ([capability seams](2026-06-13-capability-seams.md), the `dsh-bash` template), not loop or core logic:

1. **Interface** (`dsh-session-persistence`, `ctx.sessionPersistence`) — an abstract `SessionPersistence` service: `create`/`append`/`load`/`list`. Its persisted unit IS the existing `SessionEvent` (`{ type, seq, time, data }`), reused verbatim — no conversion type.
2. **Implementation** (`dsh-session-persistence-jsonl`) — an append-only JSONL log per session (a `SessionHeader` line then one `SessionEvent` per line, verbatim **including `assistant/chunk`**).

Key choices recorded here because they are durable, contested, and surprising:

- **The canonical durable log persists every `SessionEvent` verbatim, including `assistant/chunk`.** `deriveMessages()` skips chunks, and a chunk-filtered rollout (Codex's `policy.rs`) is tempting — but `seq = log.length` and the load-validation `events[i].seq === i` require a *contiguous* log; filtering chunks out would leave holes and break both the contract and resume. A chunk-filtered projection is possible later as a derived view with its own renumbering, but it is NOT the canonical log.
- **Append-only; a crashed turn is closed, never truncated.** Events through a flushed `turn/end` are never rewritten, and the loop flushes only at turn end. Because one interrupted turn may contain substantial valid work, `load` preserves its contiguous, parseable events and appends error results for unanswered tool calls, a missing `step/end`, and `turn/end` with `{ kind: 'interrupted' }`. The synthetic results keep resumed provider transcripts valid. Only an incomplete final record is discarded; a parse error or sequence gap at or before the last real `turn/end` is corruption and makes the session unloadable.
- **File backend canonical, DB backend a proven drop-in.** `SessionEvent` maps 1:1 onto a row `(session_id, seq, type, time, data)` — `append` is INSERT (in a transaction asserting the contiguous-seq contract), `load` is SELECT … ORDER BY seq. `dsh-session-persistence-sqlite` is exactly this: a `SessionPersistence` subclass with no interface change (opencode runs this exact shape on SQLite/WAL), and it passes the same `runPersistenceContract` suite as the JSONL backend — so the contract holds both backends to identical semantics (lazy materialization, interrupted-turn close on load, contiguous-seq), expressed once over file bytes and once over rows.
- **Metadata is out-of-log.** Format version, cwd, and lineage are storage concerns, not replayable conversation state, so they live in a `SessionHeader` owned by `dsh-session` and attached to a `Session` via a new readonly `session.header` — never in `SessionEventMap`, never reaching `deriveMessages()`. The alternative (a merge-extensible `session/meta` event as log line 0) was rejected: an in-log event would ride along with a seeded/forked session for free, but metadata is not replayable state, so the explicit out-of-log header seam is the cleaner cost. (The header was originally split into an immutable `SessionHeader` plus a mutable `SessionSummary` whose union was `SessionMeta`; the mutable summary was later removed as dead state — see [Drop the mutable session summary](../simplification/2026-06-19-drop-mutable-session-summary.md).)
- **`ctx.agents.create()` and `ctx.agents.resume()` are async factories; resume additionally crosses the persistence boundary.** `ctx.agents.resume({ resumeSessionId })` awaits `ctx.sessionPersistence.load`, recreates the live session with the loaded events (so `lastTurnNumber`/`deriveMessages` continue), and registers the fresh agent under the exact resumed id. The agent-loop does NOT hard-inject `sessionPersistence` (that would pend non-persistent demos forever); `resume` rejects with a clear error when it is absent.

## Alternatives considered

Each key choice above records its rejected alternative where the choice is stated: a **chunk-filtered canonical log** (Codex's `policy.rs` shape) — breaks the contiguous-seq contract; **truncating a crashed turn** — silently destroys a long autonomous run's real work; an **in-log `session/meta` event as line 0** — metadata is not replayable state; **hard-injecting `sessionPersistence` into the loop** — would pend non-persistent demos forever.

Format versioning: the header carries a `version`; `load` rejects any non-current version (no migration — the pre-release session format is pinned at `SESSION_FORMAT_VERSION = 0` and absorbs shape churn, per the AGENTS.md pre-release stance). Stated honestly: append-only + flush is robust to partial trailing writes (tolerated on load) but not to fsync-less power loss mid-line; a DB/WAL backend is the stronger option later.

## Consequences

Two new packages and the metadata seam in `dsh-session` (`session.header`, the `create(id?, options?)` signature). Bought: durable resume/fork, a read/replay path, crash tolerance, and the foundation the ACP `session/load` ([ACP support](../feature/2026-06-14-acp-agent-client-protocol.md)) needs — all over the existing event-sourced log, with the backend swappable behind one interface. The reusable `runPersistenceContract` suite holds every backend to the same append-only, contiguous-seq, lazy-materialization, and serializability semantics. Persisting the full log also settles event fidelity: `assistant/chunk` remains verbatim.
