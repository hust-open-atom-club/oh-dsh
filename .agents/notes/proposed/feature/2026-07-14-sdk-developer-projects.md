# Agent Note: Developer-owned SDK projects

Status: proposed

English | [中文](2026-07-14-sdk-developer-projects.zh.md)

## Problem

DeepSeek Harness composes features through Cordis plugins, but building a runnable project from an empty directory still requires a developer to understand npm dependencies, the `cordis.yml` plugin set, environment variables, TypeScript builds, local-plugin workspaces, and runtime entrypoints together. These manual steps constrain one another: omitting any one can produce a project that installs but cannot be developed, develops but cannot be built, or builds but cannot start.

A one-shot generator reduces only the initial creation cost. If the generated result is hidden inside a preset or an uneditable CLI, advanced developers cannot reshape the plugin tree, change Cordis plugin config, or add project-specific behavior. If a generated project immediately leaves tool management altogether, developers must again maintain consistency across all npm dependencies and Cordis plugin config themselves.

Initial creation and later configuration address the same builtin feature set. When those workflows maintain separate feature lists, feature options, and npm dependencies, new Cordis plugins, npm packages, and Cordis plugin config changes make them diverge. Projects also need an ordinary local-plugin development path that participates in development, build, and start flows.

## Proposal

The SDK creates an ordinary, explicit TypeScript/Cordis project owned by its developer. `cordis.yml` is the only runtime plugin tree; development and production read the same file. The generated `package.json`, `cordis.yml`, TypeScript entrypoint, build configuration, and `plugins/*` remain directly editable instead of being hidden behind a preset.

The only developer product entrypoints are `npm create @deepseek-ai/sdk` and the `dsh-sdk` commands. The initializer performs initial creation, `dsh-sdk config` manages SDK-recognized builtin features afterward, and `dsh-sdk dev`, `dsh-sdk build`, and `dsh-sdk start` own development, build, and startup; this phase provides no `dsh-sdk create`. Create and config consume one manually authored feature definition, so each feature has one source for its feature options, npm dependencies, Cordis config entries, related files, and inspection rules. The [SDK project editing architecture](../architecture/2026-07-15-sdk-project-editing-architecture.md) defines terms such as feature and feature option.

The SDK offers interaction for feature selection and finite feature options only; it does not turn arbitrary Cordis plugin config into a generic form. A feature collects the small number of dedicated inputs required by its feature options. All other Cordis plugin config remains in `cordis.yml`, with comments documenting common edits, for direct developer control.

## Developer workflow

Initial creation collects information in an order where earlier answers determine later questions: target directory and package identity, model provider and credentials, run interface, builtin features and feature options, an optional local plugin, package manager, and whether to install npm dependencies and build. Command-line arguments suppress questions they already answer. Create and config require an interactive TTY in this phase, and cancelling creation writes nothing to the target directory.

```sh
npm create @deepseek-ai/sdk my-agent
cd my-agent
npm exec dsh-sdk dev index.ts
npm exec dsh-sdk config
npm exec dsh-sdk build
npm exec dsh-sdk start index.js
```

Create rejects every target path that already exists. After committing the project files, the CLI asks whether to install npm dependencies and build. An install or build failure preserves the generated project and prints commands that can retry the failed work.

Create also offers one `none / plugin / tool` choice. `plugin` creates a fixed `plugins/plugin` Cordis plugin, while `tool` creates a fixed `plugins/tool` model-facing tool; one project creation includes at most one local plugin. The operation updates the workspace, root npm dependency, TypeScript reference, build configuration, and `cordis.yml` together, and any pre-write validation failure leaves the project absent.

## Features supported during creation

The table is the developer-visible support set for this phase. A `required` feature is always present but may still offer finite feature options; a `default` feature is preselected in the feature tree; an `optional` feature is selected explicitly. The table describes the product support set, while the runtime registry remains the implementation source of truth.

| Feature | Create state | Feature options | Constraints and relationships |
|---|---|---|---|
| `provider` | required | `deepseek` (default) / `custom` | DeepSeek collects an API key; custom also collects a base URL, and a CLI option may override the model name |
| `app` | required | `stdio` (default) / `acp` / `embed` | Selects the run interface |
| `spine` | required | `default` | Timer, the LLM seam, session storage, system prompt, the tool registry, the agent registry, and the agent loop |
| `bash` | required | `local` (default) / `sandbox` | The two feature options are exclusive and independent of the run interface, and both install the model-facing bash tool; sandbox installs the local sandbox provider and sandboxed bash backend |
| `persistence` | required | `jsonl` (default) / `sqlite` | Every project selects exactly one persistence backend |
| `hmr` | default | `default` | Loads `@cordisjs/plugin-hmr`; dev and start both enable it with the plugin defaults |
| `fs` | default | `local` | Installs the local filesystem, policy, and model-facing tools; the process sandbox does not confine in-process fs tools |
| `todo` | default | `default` | Provides the `todo_write` tool |
| `skill` | default | `default` | Installs the skill registry, the local skill provider, and the model-facing skill tool |
| `web` | optional | `deepseek` (default) / `exa` / `perplexity` / `fetch-only` | Search feature options are exclusive; Exa and Perplexity collect their API keys; timeout policy is recommended |
| `subagent` | optional | `spawn` (default) / `fork`, multiple | This phase provides only in-process backends |
| `workflow` | optional | `workerthread` | Requires the subagent `spawn` feature option |
| `compact` | optional | `basic` | Uses SDK-provided context-compaction parameters |
| `hooks` | optional | `claude` (default) / `codex`, multiple | Each feature option creates a separate editable configuration file |
| `guard` | optional | `repeat-tool` | Provides repeated-tool-call reminders |
| `timeout-policy` | optional | `default` | Applies a uniform policy to tools that declare timeout budgets |
| `ask-user` | optional | `default` | Provides the `ask_user_question` tool; only `acp` and `stdio` can select it because those two feature options provide the injected user-interaction service |

Both `bash` feature options apply to ACP, stdio, and embed and are not selected by the run interface. The sandbox feature option writes no active config key and therefore keeps `dsh-bash-sandbox`'s `read-only` default. Generated `cordis.yml` includes a commented example that developers can change explicitly to `workspace-write`:

```yaml
- id: bash
  name: '@deepseek-ai/dsh-bash-sandbox'
  # Uncomment to allow writes under the project workspace.
  # config:
  #   mode: workspace-write
  #   workspaceRoot: !!js process.cwd()
```

Feature contributions reference only single-plugin npm packages and never bundle packages such as `agent-spine-demo`, `stdio-demo`, or `acp-demo`. Plugins outside the table are not managed by create in this phase; advanced developers may still compose them by editing the ordinary project files directly.

## Generated project

With default answers, an npm project uses the DeepSeek provider, the stdio interface, local bash, JSONL persistence, and the preselected hmr, fs, todo, and skill features. Its initial tree is:

```text
my-agent/
├── .env
├── .env.example
├── .gitignore
├── README.md
├── cordis.yml
├── index.ts
├── package.json
├── tsconfig.base.json
├── tsconfig.json
└── tsdown.config.ts
```

`.env.example` always exists, and the SDK keeps its placeholders aligned with the current feature set. A gitignored `.env` is also created when a secret is captured or the developer confirms an empty credential to fill later. The SDK only appends differently named variables that are not already present in `.env` and never updates or removes existing contents. Feature-option changes may remove obsolete `.env.example` placeholders, while old credentials remain in `.env` for the developer to manage. pnpm and Yarn projects add their required workspace files, but do not fork the runtime plugin tree or TypeScript entrypoint.

Generated `package.json` provides the following scripts. `dev`, `build`, `start`, and `config` invoke `dsh-sdk`, while `typecheck` invokes TypeScript directly:

| Script | Behavior |
|---|---|
| `dev` | Run `dsh-sdk dev index.ts`, registering development-time resolution for TypeScript and local workspace plugins |
| `build` | Run `dsh-sdk build`, invoking the project's installed tsdown for the root entrypoint and `plugins/*` packages |
| `typecheck` | Run `tsc -b` directly |
| `start` | Run `dsh-sdk start index.js`, starting the built entrypoint without an implicit build |
| `config` | Run `dsh-sdk config` to edit the current project's feature tree |

`dsh-sdk start` and `dsh-sdk dev` accept a module target and forward arguments after `--` unchanged to the project entrypoint. Generic argument parsing uses Node `parseArgs()` with zero schema: valued flags use `--key=value`, bare flags become `true`, and `--no-*` becomes `false`.

- Stdio projects pass the selected model through `--model=<name>` and create or resume an agent according to optional `--resume=<session-id>`;
- ACP uses protocol `session/load`
- Embed uses the model written into the generated code.

Each feature-owned Cordis config entry keeps its developer-editable Cordis plugin config and explanatory comments in `cordis.yml`. When `dsh-sdk config` changes other features, it preserves unknown fields, formatting on untouched nodes, and comments. HMR is an ordinary leaf config entry: when the feature is selected, dev and start load the same watcher, and the command does not change the plugin tree implicitly.

## Post-creation configuration

`dsh-sdk config` requires only readable root `package.json` and `cordis.yml` files in the current directory. It inspects standard features and their current feature options, expresses the final desired state through one feature tree, and shows feature changes and affected files before Review & Apply.

`dsh-sdk config` can install missing features, enable or disable installed features, and switch finite feature options. Required features cannot be removed. An npm dependency change runs the project package manager's install once after the file commit; installation failure does not roll back committed project files.

The SDK modifies only Cordis config entries, config keys, npm dependencies, `.env.example` placeholders, and owned files explicitly owned by a feature. Updating the same feature option preserves unknown config keys in its Cordis config entries. Handwritten and third-party plugins support enable and disable by stable ID only. When a known feature has been edited into an incomplete, ambiguous, or otherwise unreadable shape, `dsh-sdk config` displays diagnostics and refuses automatic changes until the developer repairs it manually.

One config session accumulates every change in an in-memory working copy. Before Apply, it validates feature relationships, resource conflicts, and document shapes, then compares each affected existing file with the text read when the session opened. Validation failure or an external edit causes zero writes. Once physical writes begin, the SDK does not provide cross-file transactional rollback.

## Maintenance model

The SDK curates its builtin support set instead of exposing npm packages automatically by npm dependency name or directory convention. One feature may compose several Cordis config entries, feature options may share resources, and a feature option may declare a feature requirement on another feature or a specific feature option. Adding an ordinary feature or feature option does not require changes to both create and config command workflows.

## Future work

- `dsh-sdk add [package-spec]` unifies local-plugin creation with external Cordis plugin installation: without a package or repository source it creates a local plugin/tool, while a supplied source adds the npm dependency and `cordis.yml` config entry; the source model leaves room for GitHub repositories and other extensions
- Non-interactive create/config: both workflows require a TTY in this phase and provide no complete input contract for automation
- More feature-specific inputs: this product surface exposes only finite feature options, secrets, and a few dedicated values in this phase rather than a generic parameter interface for Cordis plugin config

## Alternatives considered

**An opaque preset or generator-owned project.** This shortens initial creation but hides the real plugin tree and build boundaries, prevents advanced developers from composing Cordis plugins directly, and makes project behavior depend on the CLI version rather than committed project files.

**A one-shot generator only.** Leaving all later maintenance manual redistributes feature requirements, feature-option switches, and multi-file updates. A config workflow over the shared registry retains continuing management for generated projects.

**Separate `cordis.yml` files for development and production.** Two plugin trees mean a successful development run does not demonstrate that production loads the same features. Dev adds only TypeScript and local-workspace resolution; runtime configuration remains singular.

**A generic form for arbitrary Cordis plugin config.** Cordis plugin config contains nested structures, expressions, and plugin-specific semantics. A generic form would become a second incomplete schema. The SDK manages finite feature options and dedicated secrets, while developers continue to edit complex config directly.

**A private local-plugin discovery protocol.** Ordinary package-manager workspaces, root npm dependencies, TypeScript references, and Cordis config entries already express the complete relationship. Another discovery protocol would create hidden state understood only by the SDK.

**A `dsh-sdk create` command for existing projects.** Create already provides one editable local-plugin skeleton, and later plugins can use ordinary workspace and Cordis mechanisms manually. A parallel command would add a second scaffolding product surface without adding composition functionality.

**Automatically expose every new Cordis plugin as a builtin.** An npm package cannot say how several plugins compose into one product feature, nor can it derive exclusivity, feature requirements, secrets, interface applicability, or security constraints. The support set requires human curation; automation is suitable only for checking whether candidates have been classified.

## Acceptance criteria

- `npm create @deepseek-ai/sdk` collects project identity, provider, interface, features, an optional local plugin, package manager, and installation choice in the documented order, and cancellation leaves the target path absent
- A default npm project has the documented tree and `dev`, `build`, `typecheck`, `start`, and `config` scripts, with dev and start sharing one `cordis.yml`
- Create offers the documented features and feature options; local and sandbox bash are exclusive with local as the default, the sandbox Cordis config entry retains the editable commented config example, and HMR is selected by default and loaded by both dev and start
- Create's `plugin` or `tool` choice creates at most one fixed-name local plugin and atomically updates its files and root-project relationships; this phase provides no `dsh-sdk create`
- `dsh-sdk config` reads the same support set from an existing project, installs, enables, disables, and switches supported feature options, preserves unknown config and comments, and refuses to modify inconsistent config
- `.env.example` reflects variables required by the current features; `.env` only appends missing differently named variables and never updates or removes existing contents
- npm, pnpm, and Yarn workspaces install, build, and start; local plugins resolve from source under dev and from built output under start

## Risks

- Developers can edit a builtin into a shape the registry cannot recognize; the SDK stops automating that feature instead of guessing and overwriting config
- Pre-write validation and external-edit detection do not provide transactional rollback once multi-file writes begin; an I/O failure can leave a partial commit requiring manual repair
- The sandbox feature option depends on an available local sandbox backend for the target platform; an unavailable backend must fail closed instead of falling back to unsandboxed execution
- HMR retains its filesystem watcher and hot-reload behavior under production start; this is the result of an explicit plugin choice, not an implicit development-only service
- The append-only `.env` policy retains credentials that are no longer used; the SDK does not decide when user-owned secret data is safe to delete
