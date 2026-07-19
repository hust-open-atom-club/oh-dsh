# Agent Note: SDK follow-up capabilities

Status: proposed

English | [中文](2026-07-17-sdk-follow-up-capabilities.zh.md)

## Problem

The first SDK release creates and edits developer-owned Cordis projects through the shared model defined by the [developer-project Agent Note](2026-07-14-sdk-developer-projects.md) and the [project-editing architecture](../architecture/2026-07-15-sdk-project-editing-architecture.md). Its create and config workflows are interactive, external Cordis plugins require manual dependency and configuration edits, command-line telemetry has no owning boundary, and interactive branches lack a stable test strategy.

These gaps are coupled. Create and config already share questions, feature configuration, and `ProjectEditSession`; adding separate automation paths would duplicate that domain logic. External-plugin installation must update both the package manager's files and `cordis.yml`. Telemetry must observe commands such as create and build that do not boot Cordis. Interactive testing must exercise Harness behavior without making terminal rendering a brittle product contract.

## Proposal

The SDK extends the existing prompt and project-editing boundaries instead of creating parallel workflows. A non-interactive prompt port and structured feature plan drive create and config, `dsh-sdk create <source>` delegates dependency resolution to the project package manager before mounting the resolved package through `ProjectEditSession`, launcher-side telemetry wraps `create-sdk` and every `dsh-sdk` command, and injected prompt streams provide the primary interactive-test seam.

| Capability | Product entrypoint | Owning mechanism | Required outcome |
|---|---|---|---|
| Headless project creation | `create-sdk --config <file>` or `--config-json <json>` with optional `--json` | `HeadlessPromptPort`, structured project answers, and a complete feature plan | No terminal blocking; missing required input is explicit |
| External Cordis plugin installation | `dsh-sdk create <source>` | Native package-manager `add` plus `ProjectEditSession` | The dependency and `cordis.yml` entry identify the package manager's resolved package |
| Developer-cycle telemetry | `create-sdk` and every `dsh-sdk` command | Launcher-side consent, payload, redaction, anonymous identity, and delivery services | Reporting is best-effort and cannot change the command result |
| Interactive regression coverage | Create and config tests | Injected `PromptPort` input/output and filesystem assertions | Tests cover Harness decisions and generated files without snapshotting terminal repainting |

## Shared headless workflow

### Structured input and lifecycle events

Headless create accepts a JSON object either inline through `--config-json` or from a file through `--config`. Scalar fields supply the ordinary create answers, while `features` supplies the complete selected feature set, feature options, secrets, and dedicated values. Defaults remain valid only where the owning question declares one; the headless path never invents an answer for a required prompt.

With `--json`, stdout is an NDJSON event stream. `done` means creation and any requested setup completed, `action-required` names an unanswered required prompt, and `error` reports another failure. Human-readable progress and package-manager output go to stderr so every stdout line remains parseable as one event. A caller responds to `action-required` by adding the missing value and running the command again.

Create and config consume the same feature-plan shape. Create exposes it through the command-line inputs above; config uses it at the shared workflow boundary so a later automation entrypoint does not need a second feature-selection model.

### Prompt and project-editing boundaries

`PromptPort` remains the only boundary between SDK questions and an interaction implementation. `ClackPromptPort` handles terminals. `HeadlessPromptPort` consumes defaults exposed by the question contract and otherwise fails with the unanswered prompt; prefilled values normally prevent the port from being called.

Both paths use the same `Question` objects, `FeatureConfigurator`, `SdkProject`, and `ProjectEditSession`. The headless path therefore changes how answers arrive, not how features are interpreted or files are committed.

### Agent skill

The repository ships a thin `SKILL.md` that teaches an agent to construct the structured input, request NDJSON, fill an `action-required` value, and retry. The skill invokes the public CLI and does not import an internal SDK API or introduce another project specification.

## External Cordis plugin installation

`dsh-sdk create <source>` accepts a package-manager-native npm specifier such as `pkg@version` or a GitHub specifier such as `github:owner/repo#ref`. After confirmation, it asks the project's package manager to add the source, compares the direct dependency names before and after the operation, reopens the project, and mounts each newly resolved package in `cordis.yml` through `ProjectEditSession`.

The package manager owns source parsing, version or commit resolution, integrity data, lockfile updates, and any build policy. The SDK does not download or unpack a second copy through giget or pacote. An external plugin remains a dependency under `node_modules`; local plugin scaffolding remains a separate project-creation concern.

## Launcher telemetry

### Consent and collection

Telemetry wraps the `create-sdk` initializer and the `dsh-sdk` launcher command lifecycle because project initialization, plugin creation, and build do not reliably boot Cordis. One event records the command name, duration, success, a random per-user anonymous identifier, and redacted `cordis.yml` and `package.json` text when those project files are eligible.

Reporting is enabled unless a present telemetry config entry is explicitly disabled. `DO_NOT_TRACK` and CI deny reporting regardless of project configuration. A missing `cordis.yml` does not itself deny the event, but `package.json` content is included only when `cordis.yml` establishes that the directory is an SDK project.

### Safety and delivery

The payload builder never reads `.env`. It redacts secret-shaped keys and values, known token forms, PEM blocks, URL credentials, and high-entropy opaque strings in the two eligible text files. Redaction is a safety backstop rather than a guarantee; SDK projects must keep credentials in `.env`.

The reporter uses a fixed endpoint and resolves every send path without throwing. Command dispatch records success or failure in a `finally` path, starts reporting after the command outcome is known, and drains within a bounded interval. Consent parsing, payload construction, storage, or network failures are swallowed only at this telemetry boundary and never alter the command's exit code.

## Interactive workflow testing

Create and config tests inject a `PromptPort` and scripted input/output streams into the existing workflows. Parameterized scenarios cover feature selection, feature options, secrets, cancellation, review, and apply behavior, then assert the resulting `cordis.yml` and other project files. The stable product assertion is the generated project state, not clack's ANSI redraw sequence.

One or two optional real-PTY smoke tests may cover the shipped binary and TTY guard that injection cannot reproduce. Native PTY tooling does not belong on the required path unless it is reliable across the repository's supported Node and host versions.

## Deferred work

- Extend the headless create specification to express local `plugin` or `tool` scaffolding instead of defaulting that interactive choice to none.
- Expose the telemetry opt-out in create and config while preserving the consent representation in which only a disabled telemetry entry is written.
- Define whether GitHub source dependencies must be prebuilt or may run package-manager-controlled preparation scripts, and surface the policy before installation.
- Replace the telemetry package's `.invalid` endpoint placeholder with the production endpoint before release.

## Alternatives considered

**Build a separate headless creation engine.** This would duplicate questions, feature requirements, configuration behavior, and project-editing rules. Reusing the prompt and edit-session boundaries keeps one implementation of project semantics.

**Make a specification file the primary automation interface.** Agents can pass the same typed JSON object inline, while people and CI may still use a file. A file-only protocol adds persistence and cleanup without adding semantics.

**Use `npx skills add` as the project creator.** The skills CLI installs Markdown skills; it does not create SDK projects or install npm packages. The agent skill therefore drives the SDK initializer instead of replacing it.

**Fetch GitHub and npm sources through giget or pacote.** A second fetch layer would duplicate package-manager resolution, integrity, lockfile, and lifecycle policy. Native dependency specifiers keep those decisions in the selected package manager.

**Implement telemetry as a Cordis runtime plugin.** Create and build do not necessarily boot Cordis, so a runtime plugin cannot observe the complete developer command cycle. The launcher is the boundary shared by those commands.

**Derive the anonymous identifier from git metadata.** Repository remotes can identify a project or organization. A random per-user identifier supports aggregation without encoding repository identity.

**Collect only aggregate counters.** Aggregate-only events reduce exposure but cannot answer which plugins, dependencies, and configuration shapes developers actually use. This proposal accepts collection of redacted project text and makes that exposure explicit.

**Use real PTYs and transcript snapshots as the primary test strategy.** Native PTY dependencies and terminal repaint sequences add platform and rendering instability while mostly testing clack. Injected interaction plus generated-file assertions tests the SDK-owned behavior directly.

## Acceptance criteria

- Create runs without a TTY from a complete structured input, emits only NDJSON on stdout under `--json`, and reports missing required input as `action-required` without writing a partial project.
- Create and config resolve the same feature-plan contract through the shared question, feature-configuration, and project-editing code paths.
- `dsh-sdk create <source>` uses the selected project package manager, mounts the dependency name that operation actually added, and fails loudly when no new dependency can be identified.
- The initializer and every `dsh-sdk` command reach one best-effort telemetry completion path; an explicit disabled entry, `DO_NOT_TRACK`, or CI prevents delivery, and telemetry failures never change the command result.
- Telemetry never reads `.env`, withholds unrelated `package.json` content when no `cordis.yml` exists, redacts both eligible text payloads, and uses an identifier unrelated to git metadata.
- Interactive tests cover create and config decisions through injected interaction and assert committed project files; any real-PTY coverage remains a narrow smoke layer.
- The agent skill documents the public structured-input and event contracts without depending on private package exports.

## Risks

- Full redacted `cordis.yml` and `package.json` text still reveals plugin and dependency names, URLs, paths, and configuration values to the endpoint operator, and heuristic redaction can miss a secret.
- Default-on reporting may surprise developers when no telemetry entry exists; the CLI must make the opt-out discoverable before release.
- A package-manager add can change `package.json`, the lockfile, and installed files before `ProjectEditSession` mounts the plugin, so a later mount failure can leave dependency changes that require manual recovery.
- GitHub dependencies may execute preparation or lifecycle code according to package-manager policy; an unresolved build policy is a supply-chain and reproducibility risk.
- Injected prompt tests do not prove raw-mode, signal, or repaint behavior in a real terminal; the optional smoke layer must cover only those residual contracts.

## References

- [Vercel Eve](https://github.com/vercel/eve) and [Vercel Labs Skills](https://github.com/vercel-labs/skills) for the distinction between a headless initializer and skill distribution.
- [npm package specifications](https://docs.npmjs.com/cli/v11/using-npm/package-spec), [pnpm add](https://pnpm.io/cli/add), and [Yarn add](https://yarnpkg.com/cli/add) for package-manager-native sources.
- [`DO_NOT_TRACK`](https://donottrack.sh/) for the environment-level opt-out convention.
- [Clack](https://github.com/bombshell-dev/clack) and [Vitest snapshots](https://vitest.dev/guide/snapshot) for injected prompts and generated-file assertions.
