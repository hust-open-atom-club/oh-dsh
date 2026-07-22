# Agent Note: TUI skill slash command

Status: implemented

English | [中文](2026-07-21-tui-skill-slash-command.zh.md)

## Problem

The [skill system](2026-07-05-skill-system.md) shipped with model-initiated loading as its only path: the `skill({ name })` tool lets the model pull a skill body into a turn, but a person driving the TUI could not load a skill on demand. Other coding agents expose a `/skill:<name>` slash command for exactly this — the user, not the model, decides a task matches a skill and injects its instructions. The skill-system note listed direct user invocation as deferred work, and the interactive front door is where it belongs.

## Decision

The [`@deepseek-ai/dsh-tui`](../../../../packages/ui/tui/README.md) front door owns a `/skill:<name> [instructions]` command. On submit it loads the named skill and delivers one text block as a user turn — sent with `agent.send()` while idle and `agent.steer()` while running, the same rule as ordinary editor input. The block is `renderSkillInvocation(skill, instructions)`: a `<skill name="…">` element wrapping the skill body, preceded by one resource-base line when the provider exposes one, with the user's trailing text appended after a blank line. The command is a TUI-only affordance; it adds no model-facing tool and changes no skill-system package contract.

The TUI reads the skill service through `ctx.get('skills')`, not a declared injection, because skills mount conditionally: a deployment without the registry keeps a working front door, and `/skill:` there reports that skills are unavailable rather than failing to mount. `createTuiChat` is synchronous while `ctx.skills.list()` is async, so autocomplete seeds the static slash commands immediately and rebuilds the provider with `skill:<name>` entries once the catalog resolves; a resolution that arrives after disposal is dropped, and a rejected lookup keeps the base commands.

Autocomplete lists only model-invocable skills — it is built from `list()`, which omits `disableModelInvocation` skills — while manual submission resolves through `get()`, which the skill registry documents as the trusted-caller path that returns disabled skills too. So a person can load any skill by typing its exact name, but the completion menu never advertises a skill the model is meant not to see. An unknown name, an empty name after the prefix, and a lookup failure each surface as a transcript notice without sending anything.

`renderSkillInvocation` and the resource-base line are the TUI's own, deliberately not reused from `dsh-tool-skill`'s `skill` tool result. The tool wraps a body in `<skill_content>`/`<skill_resources>`/`<skill_instructions>` for a *tool result*; a manual invocation is a *user turn*, and coupling the two renderers would force one model-facing shape to serve both surfaces. The cost is two renderers that both format a skill body; the benefit is that each surface's model-facing text evolves independently, and each is pinned where it is produced.

## Alternatives considered

**Add a `user-invocable` frontmatter field and enforce it in the registry.** Rejected for this change. The skill-system note defers that field, and manual invocation does not need it: the TUI is a trusted local caller, so `get()` already authorizes loading any skill, and autocomplete visibility keys off the existing `disableModelInvocation`. A new per-skill field would add a contract to the registry, local provider, and tool with no current consumer beyond visibility, which `disableModelInvocation` already covers.

**Declare `skills` as a TUI injection.** Rejected because skills mount conditionally; a declared injection would make the front door require the registry and refuse to mount without it, contradicting the package's optional-service stance. `ctx.get('skills')` reads the global store and tolerates absence.

**Reuse `dsh-tool-skill`'s renderer.** Rejected because its output is a tool-result shape (`<skill_content>` and siblings) written for the model's tool channel, while a slash invocation is a user message. Sharing it would either leak tool-result vocabulary into a user turn or fork the shared renderer on a `surface` flag — more coupling than two small formatters.

**Route submissions through the model's `skill` tool.** Rejected because the user has already decided; a tool call would spend a model round-trip to fetch a body the front door can load directly, and would not work while the agent is mid-turn.

## Consequences

Manual invocation always reloads the full skill body: the TUI does not detect a skill already present in the conversation, so a repeated `/skill:` appends its instructions again — acceptable because re-injection is sometimes the intent, and documented under the package README's Known Limitations. The two-renderer duplication is a standing maintenance cost accepted above. The `<skill name="…">` wrapper is stable model-visible text and is pinned verbatim in unit tests against a real `SkillService`; the help-panel line is pinned by the `errors-and-help` terminal snapshot. Autocomplete population and the disposed-lookup and failed-lookup branches are covered by unit tests that mount the real registry or a controllable service. End-to-end delivery is proven by a dedicated real-composition test: the `examples/tui-agent` keyless PTY smoke (`tui-keyless-smoke.e2e.ts`) boots the production TUI/agent/skill stack through the Loader under a genuine pseudo-terminal with only the model scripted, drops a fixture skill under the agents-home `skills/` root, types `/skill:<name>` as live keystrokes, and asserts the scripted adapter echoes the fixture's body marker only when the rendered `<skill>` block arrives — exercising `ctx.get('skills')` resolution in the shipped tree, the client-side parse, the local provider load, and the user turn reaching the model together. That fixture's frontmatter description avoids a `: ` colon-space so its YAML stays a plain scalar; an invalid-frontmatter skill is silently dropped during discovery.
