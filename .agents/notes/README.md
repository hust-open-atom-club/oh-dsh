# Agent Notes

One kind of design doc lives here. An **Agent Note** records a decision or proposal that shapes this codebase — the *why* and *what we gave up*, the parts code and docs can't carry. This file is the front door and contract: where Agent Notes live, when to write one, and [the in-file format](#the-file-format).

## Layout and naming

Every Agent Note has two axes, both encoded in its **path** — `{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`:

- **Lifecycle** (the top-level folder) is the Agent Note's status, and an Agent Note moves between folders as that status changes:
  - **`proposed/`** — proposals reviewed before implementation; not yet built (or only partly).
  - **`implemented/`** — the decision shipped. The file records what was decided and what was rejected, and is **kept current with what actually shipped**: when the code later moves a file, renames a package, or changes a key/default, the Agent Note is updated in the same change to match (facts only — paths, names, structure — not the decision itself). See [implemented/AGENTS.md](implemented/AGENTS.md).
  - **`rejected/`** — the proposal was considered and declined. Kept for the record so the rejection isn't re-litigated.
- **Class** (the nested folder) is the *kind* of decision — see [Classification](#classification) below.

The date in the filename is when the topic was **first proposed** (per git history). Cross-references between Agent Notes use relative markdown links (`[topic](../../implemented/architecture/2026-…-….md)`) — never bare prose or numbers — so they are mechanically checkable and survive moves between folders.

The tree is the inventory: browse its lifecycle/class folders or search the repository. Do not add a centralized `INDEX.md`; the [no-index Agent Note](implemented/process/2026-07-19-remove-generated-agent-note-index.md) owns the rationale.

## Classification

Each Agent Note belongs to one path-encoded class from the closed set in `scripts/agent-note-tree.ts`; the classification gate rejects other folders. Adding a class requires updating the canonical set and this section. See the [classification Agent Note](implemented/process/2026-06-20-agent-note-classification.md).

| Class | What it covers |
|---|---|
| `feature` | A new user- or model-facing capability. |
| `bug-fix` | Corrects a defect or closes a gap a postmortem surfaced. |
| `simplification` | Removes code, behavior, or surface area without adding a capability. |
| `architecture` | A structural decision about the **shipped source** — how packages relate, what the runtime vocabulary is. |
| `process` | Tooling, policy, or workflow **around** the code — gates, the package manager, vendoring — not runtime behavior. |
| `testing` | Test infrastructure and strategy. |

The `architecture` / `process` line: **architecture** is about the source we ship; **process** is the surrounding tooling and workflow. (`refactor` is deliberately absent — it overlaps `simplification`, whose discriminator, "does observable behavior change?", already covers it.)

## When to write one

Write an Agent Note when a decision is **durable** (it shapes the codebase beyond a single function or package), **contested** (there was a real alternative a reasonable engineer might have chosen), and **surprising** (a future reader would otherwise ask "why on earth is it done this way?"). A proposal for substantial future work starts in `proposed/`; a decision already made starts in `implemented/`. Pick the class folder that matches the decision (see [Classification](#classification)).

Do NOT write one for a mechanical or local choice (a variable name, a one-file refactor), for anything already enforced and explained by a gate or a convention in AGENTS.md, or for a still-provisional decision tagged `TODO(...)` in the code — record those as TODOs and promote to an Agent Note only once they settle. An Agent Note is never edited into a *different decision*: supersede it with a new one and cross-link. (Editing an `implemented/` Agent Note to track where its already-made decision now *lives* — a moved file, a renamed package — is not a different decision and is required, not forbidden; see [implemented/AGENTS.md](implemented/AGENTS.md).)

## The file format

Every Agent Note follows one in-file format, enforced by `pnpm run verify-agent-note-format` ([scripts/verify-agent-note-format.ts](../../scripts/verify-agent-note-format.ts), part of `doc-sync`); the rationale for the format — and the alternatives it rejected — is [the uniform-format Agent Note](implemented/process/2026-07-05-uniform-agent-note-format.md).

### The header block

The first three lines of every Agent Note are exactly:

```markdown
# Agent Note: <title>

Status: <status>
```

followed by a blank line. The `Status:` value is one of three forms, and must agree with the lifecycle folder the file sits in — the gate cross-checks them:

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <why, in one line>`

The status carries no dates and no parentheticals: the filename holds the first-proposed date, git holds everything else, and an "accepted in amended form" note is body content (state the amendment where the decision is stated). The rejection reason is the one status with content, because a rejected Agent Note's verdict is the fact readers come for.

### The body skeleton

Every Agent Note opens its body with `## Problem` — the motivation, written to stand without the solution. What follows depends on the lifecycle; recurring sections use these canonical names and nothing else, while genuinely bespoke technical sections (package topology, wire contracts, schemas) remain free-form between the required ones.

#### `proposed/`

```markdown
## Problem
## Proposal
…bespoke sections…
## Alternatives considered
## Acceptance criteria
## Risks
```

`## Proposal` is the intended change and may legitimately speak in the future tense — plans, migration steps, and open questions belong here while the work is unbuilt. `## Acceptance criteria` says what observable state means done. `## Risks` covers both what could go wrong and what the change knowingly gives up.

#### `implemented/`

```markdown
## Problem
## Decision
…bespoke sections…
## Alternatives considered
## Consequences
```

`## Decision` describes shipped reality in the present tense, and the whole file is kept current with it per [implemented/AGENTS.md](implemented/AGENTS.md). `## Consequences` records what the trade-off cost **and** bought. Proposal-era headings are spec-speak here and the gate rejects them: `## Proposal`, `## Plan`, `## Migration plan`, and `## Acceptance criteria` may not appear in an implemented Agent Note (the [slop checklist](../../docs/AGENTS.md) names why). A `## Testing`, `## Deferred`, or `## Related` section is fine where it states present-tense fact.

#### `rejected/`

A rejected Agent Note is the proposal, frozen: it keeps whatever proposal-time sections it had (including `## Acceptance criteria` or `## Plan`), and the verdict lives on the `Status:` line. Only the header block, the `## Problem` opener, a `## Proposal` section, and the Alternatives-considered mandate below apply.

### Alternatives considered — mandatory

Every Agent Note carries an `## Alternatives considered` section: each genuine alternative and why it lost, one bold-led paragraph per alternative or a `### Why not <X>?` subsection per contested one. A decision recorded without what it beat invites re-litigation — the failure Agent Notes exist to prevent.

Alternatives are recorded, never invented. An Agent Note dated before 2026-07-05 whose alternatives are not reconstructible from the record carries this exact comment in place of the section, which the gate accepts for pre-format files only:

```markdown
<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
```

### Moving between lifecycles

Moving a file between lifecycle folders means updating the `Status:` line and re-satisfying that folder's skeleton in the same change — the gate fails the move otherwise. Concretely, `proposed/` → `implemented/` rewrites `## Proposal` into a present-tense `## Decision`, folds `## Acceptance criteria` and `## Risks` into `## Consequences` (or a present-tense `## Testing`/`## Verification` section for what now pins the behavior), and drops plans in favor of what shipped — the rewrite [implemented/AGENTS.md](implemented/AGENTS.md) requires, made mechanical. `proposed/` → `rejected/` only adds the reason to the `Status:` line and freezes the file.

### Chinese counterparts

A `.zh.md` counterpart mirrors its English sibling's structure section-for-section under the [i18n contract](../../docs/i18n/README.md); the machine-checked header tokens (`# Agent Note: ` and the `Status:` line) stay in English verbatim. The format gate skips `.zh.md` files — the pairing gate owns their consistency.
