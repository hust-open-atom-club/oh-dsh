# Agent Note: Skill system — progressive disclosure instructions for agents

Status: implemented

## Problem

Agent products have converged on a skill pattern: keep the request prompt small by listing only available instruction bundles, then load the full body when the model decides a task matches. Codex, Claude Code, OpenCode, and Kimi Code differ in details, but all separate discovery metadata from complete instructions so a workspace can carry reusable behavior without paying the full prompt cost on every turn.

DeepSeek Harness uses the same primitive so project-specific review, plugin-authoring, and tool-usage guidance lives next to the workspace or the user's agent configuration instead of being hard-coded into the loop.

## Decision

`@deepseek-ai/dsh-skill` is the pure provider registry (`ctx.skills`), `@deepseek-ai/dsh-skill-local` is the shipped local filesystem provider, and `@deepseek-ai/dsh-tool-skill` owns the session-prefix catalog and model-facing loader tool. `dsh-agent-spine-demo` loads the registry, local provider, and consumer by default so stdio and ACP apps get the same behavior while embedded or remote providers contribute skills without changing the registry or consumer. Its `skills` config forwards `registry`, `local`, and `tool` branches to those owners.

Provider plugins register synchronously during `apply()`. Provider membership is direct effect-owned state: registration and disposal invalidate completed catalogs synchronously, and discovery reads the current provider map on demand rather than observing registry-change events. Provider catalogs return ranked candidates from awaited `list()` calls, where remote providers perform initialization, authentication, and discovery while honoring the lookup abort signal. The registry validates each candidate, resolves same-name skills first-wins by rank, provider registration order, and provider-local order, then sorts summaries by skill name for deterministic consumers. It caches only completed catalog snapshots and retries when a provider/runtime revision changes during discovery, so an unload cannot freeze a stale, unresolvable skill into a session prefix. Runtime `ctx.skills.register(...)` remains a convenience for embedded in-process skills and uses project-over-user priority; `runtime` is reserved as the registry-owned provider name.

The local provider scans cwd-sensitive project roots, custom roots, and user roots in first-wins rank order: project `.dsh`, project `.agents`, `customSkillDirs`, user `.dsh`, then user `.agents`. The user `.dsh/skills` scan skips `.system` so a system-owned directory is not treated as normal user content. DeepSeek Harness does not ship built-in system skills; embedded or remote providers supply additional skills when configured.

Each skill is either `<name>/SKILL.md` or `<name>.md` with YAML frontmatter. `name` and `description` are required; `whenToUse`, `disableModelInvocation`, and `metadata` are optional. Names are kebab-case. YAML frontmatter is parsed with the `yaml` package instead of `js-yaml` or a hand-written parser: `yaml` is the already-declared modern parser for this package's limited frontmatter needs, and a narrow parser would either reject valid YAML users expect to work or grow into an unreviewed YAML subset.

Local skill filesystem I/O goes through `ctx.fs` when a filesystem service is loaded: project-root lookup probes `.git` with `resolve` and `stat`, root discovery uses `listDir`, and skill reads use `readText`. The Node filesystem remains a fallback for minimal contexts that mount `dsh-skill-local` without the fs seam. Missing roots, unreadable or malformed skill files, and transient provider `list()` failures degrade to warn-and-skip so one bad source does not make every agent request fail; malformed candidates still fail fast because they are provider contract violations.

`dsh-tool-skill` contributes one user-role `<system-reminder>` catalog through [`agent/session-prefix`](2026-07-07-session-prefix.md). The catalog contains sorted skill name and description only; it excludes bodies, paths, sources, providers, and routing hints. Descriptions are whitespace-normalized, XML-escaped, and capped by `catalogDescriptionMaxLength`, whose default is `500` and minimum is `3`. The session-prefix seam freezes the request-only catalog per loop instance and records it in the request header, preserving reconstructability without adding it to durable history. Full skill bodies are never included in the catalog.

The `skill({ name })` tool loads one full skill for the current agent cwd and returns a tool result containing `<skill_content name="...">`, `<skill_resources>`, and `<skill_instructions>`. `resourceBase` supplies a directory, URL, or opaque provider-managed base for explicitly referenced scripts, references, and assets; resources load only as needed, without directory enumeration. An unresolved name reports that the skill is unknown or no longer available; invalid names and skills marked `disableModelInvocation` retain distinct tool errors. The tool result is the model-visible disclosure path.

The data structures and catalog/tool contract are documented in [skills.md](../../../../docs/core-data-structures/skills.md), with service signatures in the generated [services catalog](../../../../docs/cordis-catalog/services.md).

## Alternatives considered

**Inject full skill bodies into every system prompt.** Rejected because it destroys progressive disclosure and makes every request pay for instructions that may not apply.

**Expose skills only as slash commands.** Rejected because model-initiated loading is the core capability; slash/ACP command advertisement does not change discovery.

**Put local filesystem scanning directly inside `ctx.skills`.** Rejected because coding agents, web agents, and future plugin ecosystems need different skill sources. A provider registry mirrors the subagent seam: the registry owns conflict resolution and consumers, while implementations own loading.

**Use a system-prompt section.** Rejected because the rendered system prompt is a single string, while the catalog is a user-role `<system-reminder>` message with request-only lifecycle requirements. [`agent/session-prefix`](2026-07-07-session-prefix.md) is the selected mechanism: it places the catalog ahead of derived history and records the composed message in the request header.

**Materialize built-in DSH authoring skills under `~/.dsh/skills/.system`.** Rejected because bundled skills do not write user home on startup, and embedded or remote providers supply configured skills.

**Recursively discover nested `**/SKILL.md`.** Rejected. Flat files and one-level directory bundles cover the configured roots while keeping duplicate handling and catalog order easy to reason about.

**Hand-parse frontmatter.** Rejected because the accepted schema includes an open `metadata` object. A narrow parser would either reject valid YAML users expect to work or grow into an unreviewed YAML subset.

## Consequences

The agent-core spine includes one session-prefix contributor, one local provider, and one model-facing tool. Skill discovery is cwd-sensitive, so callers that create agents with different session cwd values can observe different project skill overrides by design.

The catalog is deterministic for a fixed root set and runtime registration revision, but disk changes are not watched; discovery is memoized until runtime registration invalidates the cache or the process restarts.

## Deferred

Forked skill contexts (`context: fork`), parameter declarations and hints (`arguments` and `argument-hint`), and per-skill tool constraints (`allowed-tools` and `disallowed-tools`) are outside the shipped contract. The registry, local provider, and model-facing tool do not parse, advertise, or enforce these fields, and the `user-invocable` frontmatter field is likewise unparsed. Direct user invocation itself ships as a consumer-side affordance instead: the TUI front door offers a manual `/skill:<name>` command over the registry's existing `list()` and `get()` methods, without a registry, provider, or tool contract change — see [the TUI skill slash command](2026-07-21-tui-skill-slash-command.md).
