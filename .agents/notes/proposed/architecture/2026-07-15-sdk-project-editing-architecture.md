# Agent Note: SDK project editing architecture

Status: proposed

English | [中文](2026-07-15-sdk-project-editing-architecture.zh.md)

## Problem

[Developer-owned SDK projects](../feature/2026-07-14-sdk-developer-projects.md) are created through create, adjusted through config, and built and run through commands such as start. Initial creation, configuration changes, and build and runtime commands all need to understand features, feature options, npm dependencies, Cordis config entries, environment variables, package managers, local plugins, and several project files. If each project-reading and project-writing workflow uses a separate interpretation protocol, the SDK developer workflows become difficult to maintain.

## Proposal

The SDK uses one shared object-oriented project model. `SdkProject` is a read-only snapshot, and `ProjectEditSession` is the only mutation and commit boundary. Feature objects own their feature options, relationships, resource contributions, and current-state inspection. Create and config orchestrate only their respective user workflows and modify projects through the same domain operations.

Structured files are modified through document objects, while one-shot text artifacts are generated from complete templates. Questions are typed objects presented through clack. Diff calculation may remain an edit-session implementation detail, but it is not a public execution protocol that callers must assemble.

## Terminology

| Term | Usage in this Agent Note | Meaning |
|---|---|---|
| Feature | feature | A product unit curated and managed by the SDK; one feature may contain several feature options and contribute several Cordis config entries, npm dependencies, environment placeholders, and owned files |
| Feature option | feature option | A finite selectable implementation or configuration shape within one feature; feature rules may make options fixed, exclusive, or additive |
| Cordis plugin | Cordis plugin | A plugin implementation loaded by Cordis, usually exported by an npm package; it is not an item in `cordis.yml` |
| Cordis config entry | Cordis config entry | One item in the `cordis.yml` plugin list, identified as an instance by `id` and referring to a Cordis plugin through `name` |
| Cordis plugin config | Cordis plugin config | The configuration object or shape exposed by a Cordis plugin; an individual field owned and updated by a feature is a config key |
| config key | config key | One field in Cordis plugin config; a feature updates only the config keys it declares as owned and preserves unknown config keys |
| npm dependency | npm dependency | A package relationship in `package.json`; literal fields such as `dependencies` and `devDependencies` keep their names |
| Feature requirement | feature requirement | A relationship declared through `requires` by a feature or feature option |

## Package boundaries

| Package | Responsibility | Does not own |
|---|---|---|
| `@deepseek-ai/dsh-helper` | Edit sessions, feature configuration, project-template rendering, package-manager adaptation, and prompt interaction adaptation | Booting Cordis applications or deciding create/config terminal workflows |
| `@deepseek-ai/dsh-scripts` | `dsh-sdk start/dev/build/config`, process lifecycle, project entry loading, the config workflow, and its terminal-copy templates | Interpreting feature definitions directly or modifying YAML/JSON ASTs |
| `@deepseek-ai/create-sdk` | Arguments, question order, initial project creation, installation finish, and terminal-copy templates for `npm create @deepseek-ai/sdk` | Becoming a generated project's runtime npm dependency or providing a library API |

`@deepseek-ai/create-sdk` is the only exception to the repository's `@deepseek-ai/dsh-*` naming rule. npm's scoped-initializer convention requires that package name for `npm create @deepseek-ai/sdk`. The exception is a repository architecture fact and does not add a third developer product entrypoint.

The three packages export only the narrow entrypoints consumed by adjacent layers and provide no `src/*` deep imports. The scripts library entrypoint and build-config subpath serve generated code and project build configuration, while the developer product contract remains the `dsh-sdk` commands.

## Project aggregate and edit session

`SdkProject.create(root, request)` constructs a new project snapshot that has not been written, while `SdkProject.open(root)` loads an existing project. Open requires only readable root `package.json` and `cordis.yml` files; every other file is an optional resource. Both paths return the same read-only aggregate and distinguish their source through explicit origin state.

`project.edit()` clones project documents into a working copy. Domain commands such as install, configure, enable, disable, and addPlugin modify only the working copy. Each command immediately re-inspects its owning feature, and the final commit checks all relationships and files again.

```text
validate feature requirements and resource ownership
  -> validate every affected document
  -> compute changed and removed paths
  -> compare existing files with the session's original text
  -> write through one commit boundary
  -> return a new SdkProject snapshot and ChangeSet
```

Validation failure or an external edit causes zero writes. “One commit” means only zero pre-write side effects and one write entrypoint. `ChangeSet` describes final feature, plugin, and file changes for Review & Apply and create completion.

## Features and resource ownership

A feature is a first-class behavior object. Shallow base classes implement install, configure, enable, disable, required/requires validation, and common state inspection. Features with fixed, exclusive, or additive feature options share these lifecycles. Only features whose resource contributions depend on project context or require custom round-tripping use dedicated behavior classes; other features declare their actual differences through standardized data.

Each feature contributes stable-keyed Cordis config entries, npm dependencies, environment placeholders, and owned files. The registry rejects two features that declare the same resource key during initialization. Different feature options within one feature may share resources, which that feature resolves from the final option set.

A Cordis config entry anchors feature installation. The npm package name assigns the entry to a feature, and the entry ID distinguishes several instances of one plugin package. An npm dependency without a feature-owned Cordis config entry leaves the feature uninstalled. Once a Cordis config entry exists, a missing npm dependency, unreadable Cordis plugin config, or resource conflict puts the feature into an inconsistent state; the config command shows diagnostics and refuses speculative modification.

Configuring the same feature option updates only its owned config keys and preserves unknown keys. Replacing a feature option removes old resources that are exclusive and still confirmable. If an old resource cannot be confirmed or an owned file was modified by the developer, the whole operation fails.

## Questions and workflows

TypeScript `Question<T>` objects keep defaults, validation, applicability, and types together. `PromptPort` is the only interface between the domain layer and the terminal library, and helper provides one thin `ClackPromptPort`. Create and config inject their own command-line input and output streams and retain ownership of cancellation, return, and completion semantics in their workflows.

Create keeps its stateful question order in one wizard, while config keeps final-state selection in one workflow. Both use the same feature configurator for feature options and dedicated inputs, so adding an ordinary feature, feature option, or parameter does not require changes to both entrypoints.

## Project documents and templates

Only structured files that helper reads or modifies have concrete document objects: `package.json`, `cordis.yml`, `.env`, `.env.example`, the root `tsconfig.json`, and the pnpm workspace file. Document objects own parsing, cloning, validation, and serialization. Concrete classes and modules use `*File` and `*-file.ts` names respectively. Business code does not manipulate YAML/JSON ASTs directly, and malformed shapes fail loudly at the owning document boundary.

README, entrypoint code, build configuration, `.gitignore`, and other one-shot text artifacts use one complete template per real file. Complete product copy such as CLI usage, creation and recovery messages, installation and retry guidance, and the default persona also comes from package-local templates owned by the package that presents it.

Helper provides the generic typed `TextTemplate` renderer, and caller packages load their own templates through package-local asset URLs.

Templates use Handlebars strict mode and `noEscape` without custom processing. File owners encode typed values for the target language. Template source escapes interpolation as `\{{model}}` when it must emit the downstream literal unchanged.

## Command and runtime boundary

Scripts supports `dsh-sdk start/dev/build/config`. Start dynamically loads a module target and calls its named entrypoint. Dev adds TypeScript and local-workspace source resolution before following the same path. Build invokes the project's installed tsdown. Config opens one edit session and commits after Review & Apply. Generated projects run `tsc -b` directly for typechecking.

HMR is an explicit Cordis config entry loaded by dev and start. Its required `node-addon-require-builtin` package is supplied transitively by the scripts package and is absent from the generated project's `package.json`.

Dev and start execute the developer entrypoint, where developer code handles command-line arguments and cwd. Developers pass `--model=<name>` and `--resume=<session-id>` to start the standard flow.

## Repository live-link mode

Create-sdk retains a hidden `--link-workspace` option for Harness repository development and e2e. The parser accepts it, but help, public flag lists, and ordinary user documentation omit it. It accepts no repository-path parameter; the repository root is derived upward from the executing create-sdk module.

Link mode preserves the ordinary project file shape. `@deepseek-ai/*` points into `packages/`, Cordis-related npm dependencies point into `vendor/`, and shared lower-level packages resolve to the same physical copy used by the repository so Cordis type merging cannot produce multiple module type definitions. npm uses `file:`, pnpm uses `link:` with automatic peer installation disabled, and Yarn uses `portal:` plus resolutions. Repository packages must be built first.

## Future work

- **Replaceable required spine roles.** The current `spine` owns the full implementation set, including SystemPrompt and LLMService, through one fixed feature option. Developers cannot replace or switch these roles and must edit Cordis config entries manually.
- **Service contracts and package declarations.** When replacing a builtin service, a Cordis plugin currently cannot declare the services it provides through `provides` metadata, so the SDK cannot assist configuration during development or check compatibility at runtime. A corresponding protocol remains to be designed.
- **Feature parameter descriptions.** Feature-specific inputs currently require handwritten declarations. The SDK cannot derive interactive parameters automatically from arbitrary Cordis plugin config or npm package.json information. Future declarative metadata may expose a limited parameter set without turning arbitrary Cordis plugin config into a generic form.
- **SDK application-level configuration.** The current project resource model describes Cordis config entries and config keys owned by individual Cordis plugins, so every SDK-managed setting must belong to one plugin. Cross-plugin or whole-application settings have no independent persistence location. Future work must define an application-level configuration document and its ownership, read, and mutation boundaries.

## Alternatives considered

**Keep the static Catalog and central engine.** This minimizes the initial rewrite, but feature parameters, round-tripping, owned files, and create/config reuse continue to accumulate in one coordinator. Splitting files shortens the file without consolidating responsibility.

**Use `wizard.json` and a generic Questionnaire.** Static forms cannot directly express feature requirements, option switches, existing-value refill, and project-resource changes. Types, gates, and dynamic options still connect through string registries and a procedural `run()`, creating another internal DSL.

**Expose the live-link flag.** The mode depends on Harness monorepo layout and unpublished packages and serves repository development only. Making it public would create a project-creation contract that the SDK cannot support outside the repository.

## Acceptance criteria

- Create and config modify projects only through `SdkProject` and `ProjectEditSession`; any business, document, or concurrency validation failure before writing leaves the filesystem unchanged
- Adding an ordinary feature, feature option, or parameter extends only its typed spec or owning behavior object, without adding a central switch to create or config workflows
- Helper owns the feature model, npm dependency and other resource configuration, and inconsistent-state detection
- Structured files change through `*File` document objects; one-shot files and complete product copy come from package-owned Handlebars templates, and business decisions do not enter a template DSL
- `dsh-sdk start/dev/build/config` is the runtime product surface, typecheck uses `tsc -b` directly, HMR is not injected by command mode, and only the scripts package transitively supplies `node-addon-require-builtin`
- `--link-workspace` exists only as a hidden repository-development option and preserves one module identity under npm, pnpm, and Yarn

## Risks

- Behavior objects and typed specs create two extension shapes. Dedicated classes must remain limited to features that truly depend on project context or custom behavior, or the design will grow a meaningless type hierarchy
- Optimistic concurrency checks and pre-write validation cannot recover from an I/O failure during writing; callers must still report a possible partial commit to the developer
- Hidden link mode depends on repository layout and package-manager link semantics and must change with either one
- The Cordis loader resolves `node-addon-require-builtin` from its own module path, so the scripts package must continue to satisfy that optional peer under npm, pnpm, and Yarn npm dependency layouts
- Handlebars `noEscape` makes typed model construction responsible for target-language encoding; new template fields must be escaped correctly at the owning boundary, and downstream Handlebars placeholders must be escaped explicitly in template source
