# Agent Note: SDK 工程编辑架构

Status: proposed

[English](2026-07-15-sdk-project-editing-architecture.md) | 中文

## 问题

[开发者拥有的 SDK 工程](../feature/2026-07-14-sdk-developer-projects.md) 由 create 创建，可以通过 config 调整，并由 start 等命令构建和运行。初始创建、配置调整和编译运行都需要理解功能、功能选项、NPM 依赖、Cordis 配置项、环境变量、包管理器、本地插件和多个项目文件。如果读写项目的各个流程分别使用不同的解析协议，SDK 开发者流程会变得难以维护。

## 提案

SDK 使用一个共享的面向对象工程模型。`SdkProject` 是只读快照，`ProjectEditSession` 是唯一修改与提交边界；功能对象负责自身的功能选项、关系、资源贡献和现状识别；create 与 config 只编排各自的用户流程，并通过同一组领域操作修改工程。

结构化文件通过文档对象修改，一次性文本产物通过完整模板生成。问题由类型化对象表达，并使用 clack 交互。差异计算可以作为编辑会话的内部实现，但不成为要求调用方组装的公共执行协议。

## 术语

| 名词 | 本文用词 | 含义 |
|---|---|---|
| Feature | 功能 | SDK 人工策划和管理的产品单元；一项功能可以包含多个功能选项，并贡献多个 Cordis 配置项、NPM 依赖、环境变量占位和独占文件 |
| Feature option | 功能选项 | 一项功能内有限、可选择的实现或配置形状；根据功能规则可以固定、互斥或多选 |
| Cordis plugin | Cordis 插件 | Cordis 加载的插件实现，通常由一个 NPM 包导出；它不是 `cordis.yml` 中的一项配置 |
| Cordis config entry | Cordis 配置项 | `cordis.yml` 插件列表中的一项，通过 `id` 标识实例并通过 `name` 指向 Cordis 插件 |
| Cordis plugin config | Cordis 插件配置 | Cordis 插件公开的配置对象或配置结构；其中由功能拥有并更新的单个字段称为“配置键” |
| config key | 配置键 | Cordis 插件配置中的单个字段；功能只更新自己声明拥有的配置键，并保留未知配置键 |
| npm dependency | NPM 依赖 | `package.json` 中的包关系；`dependencies`、`devDependencies` 等字段保持原样 |
| Feature requirement | 功能依赖 | 功能或功能选项通过 `requires` 声明的关系 |

## Package 边界

| Package | 责任 | 不负责 |
|---|---|---|
| `@deepseek-ai/dsh-helper` | 编辑会话、功能配置、工程模板渲染、包管理适配和 prompt 交互适配 | 启动 Cordis 应用或决定 create/config 的终端流程 |
| `@deepseek-ai/dsh-scripts` | `dsh-sdk start/dev/build/config`、进程生命周期、项目入口加载、config 流程和所属终端文案模板 | 直接解释功能定义或修改 YAML/JSON AST |
| `@deepseek-ai/create-sdk` | `npm create @deepseek-ai/sdk` 的参数、问题顺序、首次工程创建、安装收尾和所属终端文案模板 | 成为生成工程的运行时 NPM 依赖或提供库 API |

`@deepseek-ai/create-sdk` 是仓库 `@deepseek-ai/dsh-*` 命名规则的唯一例外；npm scoped initializer 约定要求 `npm create @deepseek-ai/sdk` 对应这个 package 名。该例外是仓库架构事实，不增加第三个开发者产品入口。

三个 package 只导出相邻层实际使用的最小入口，不提供 `src/*` 深路径。scripts 的库入口与构建配置子路径服务生成代码和项目构建配置，但开发者产品合同仍由 `dsh-sdk` 命令承担。

## 工程聚合与编辑会话

`SdkProject.create(root, request)` 构造尚未写盘的新工程快照，`SdkProject.open(root)` 加载已有工程。open 只要求根 `package.json` 与 `cordis.yml` 可读，其余文件是按需存在的资源；两条路径返回同一种只读聚合，并通过显式 origin 区分来源。

`project.edit()` 克隆项目文档形成 working copy。install、configure、enable、disable 和 addPlugin 等领域命令只修改 working copy；命令完成后立即重新检查所属功能，最终 commit 再检查全部关系和文件。

```text
validate feature requirements and resource ownership
  -> validate every affected document
  -> compute changed and removed paths
  -> compare existing files with the session's original text
  -> write through one commit boundary
  -> return a new SdkProject snapshot and ChangeSet
```

校验失败或检测到会话外修改时不写盘。“一次 commit”只表示写入前零副作用和单一写入口。`ChangeSet` 只描述功能、插件和文件的最终变化，用于 Review & Apply 与 create 收尾。

## 功能与资源所有权

功能是一等行为对象。浅层基类实现 install、configure、enable、disable、required/requires 校验和共同状态识别；固定功能选项、互斥功能选项与可多选功能选项共享这些生命周期。只有资源贡献依赖项目上下文或需要自定义 round-trip 的功能才使用专用行为类，其余功能通过标准化数据声明真正不同的部分。

每项功能贡献带稳定 key 的 Cordis 配置项、NPM 依赖、环境变量占位和独占文件。注册表初始化时拒绝不同功能声明同一个资源 key；同一功能的不同功能选项可以共享资源，并由该功能根据最终选项集合处理。

Cordis 配置项是功能安装锚点。NPM 包名判断配置项所属的功能，配置项 ID 区分同一插件包的多个实例；只有 NPM 依赖而没有功能拥有的 Cordis 配置项时，该功能仍视为未安装。Cordis 配置项存在后，缺失 NPM 依赖、无法读取的 Cordis 插件配置或资源冲突会使功能进入不一致状态，config 命令显示诊断并拒绝猜测式修改。

同一功能选项只更新其声明拥有的配置键，保留未知键。替换功能选项会删除旧功能选项独占且仍可确认的资源；无法确认旧资源或发现独占文件被用户修改时，整个操作失败。

## 问题与 workflow

问题由 TypeScript `Question<T>` 对象表达，默认值、校验、适用条件和类型留在同一个对象中。`PromptPort` 是领域层与终端库之间的唯一接口，helper 提供一份薄 `ClackPromptPort`；create 和 config 注入各自的命令行输入输出流，并在各自流程中决定取消、返回和收尾语义。

create 的有状态问题顺序留在一个向导中，config 的最终状态选择留在一个流程中。两者通过同一个功能配置器收集功能选项与专用输入，因此增加一项普通功能、功能选项或参数不要求同时修改两个入口。

## 项目文档与模板

只有需要读取或修改的结构化文件拥有具体文档对象，包括 `package.json`、`cordis.yml`、`.env`、`.env.example`、根 `tsconfig.json` 和 pnpm workspace 文件。文档对象拥有解析、克隆、校验和序列化行为；具体类与模块分别使用 `*File` 和 `*-file.ts` 命名，业务层不直接操作 YAML/JSON AST，异常形状在所属文档边界 fail loud。

README、入口代码、构建配置、`.gitignore` 和其他一次性文本产物使用与真实文件一一对应的完整模板。CLI usage、创建结果与恢复提示、安装与重试指导以及默认 persona 等完整产品文案也由所属 package 的本地模板提供。

helper 提供通用的数据类型化 `TextTemplate` 模板渲染器，调用 package 通过本地 asset URL 加载自己的模板。

模板使用 Handlebars strict mode 与 `noEscape`，不进行自定义处理。文件对象负责把类型化数据值编码成目标语言文本；如果不希望插值，则源码以 `\{{model}}` 等转义形式输出下游。

## 命令与运行边界

scripts 支持 `dsh-sdk start/dev/build/config`。start 动态加载模块 target 并调用其命名入口；dev 在同一路径前增加 TypeScript 与本地 workspace 源码解析；build 调用工程安装的 tsdown；config 打开一个编辑会话并在 Review & Apply 后提交。typecheck 由生成工程直接执行 `tsc -b`。

HMR 作为显式 Cordis 配置项由 dev 和 start 加载；它所需的 `node-addon-require-builtin` 由 scripts package 传递提供，不写入开发者工程的 `package.json`。

dev/start 会执行开发者入口，在开发者代码中处理命令行参数、cwd，由开发者自行传入 `--model=<name>` 与 `--resume=<session-id>` 启动标准流程。

## 仓库本地链接模式

create-sdk 保留隐藏的 `--link-workspace` 选项供 Harness 仓库开发和 e2e 使用。该选项可以被解析，但不出现在 help、公开 flag 清单或普通用户文档中，也不接收仓库路径参数；仓库根从正在执行的 create-sdk 模块位置向上确定。

链接模式保持普通工程的文件形状。`@deepseek-ai/*` 指向 `packages/`，Cordis 相关 NPM 依赖指向 `vendor/`，共享底层 package 锚定到仓库实际使用的同一物理拷贝，避免 Cordis 类型合并产生多个模块类型定义。npm 使用 `file:`，pnpm 使用 `link:` 并关闭自动 peer 安装，Yarn 使用 `portal:` 与 resolutions；仓库 package 需要先构建。

## 后续工作

- **可替换的 required 主干角色。** 当前 `spine` 以一个固定功能选项拥有整组实现，包含 SystemPrompt、LLMService 等。无法让开发者对其进行替换和切换，只能手工修改 Cordis 配置项。
- **Service contract 与 package 声明。** 替换特定内建服务时，Cordis 插件目前无法通过 `provides` 元数据声明其提供的服务，因此 SDK 无法在开发阶段辅助配置，也无法在运行时检查兼容性。后续需要设计相应协议。
- **功能参数描述。** 当前功能的专用输入必须手工声明；SDK 无法从任意 Cordis 插件配置或 NPM package.json 信息中自动推导可交互参数。后续可以定义有限的声明式参数元数据，但不把任意 Cordis 插件配置转换成通用表单。
- **SDK 应用级配置。** 当前项目资源模型只描述 Cordis 配置项及单个 Cordis 插件拥有的配置键，因此所有受 SDK 管理的配置都必须归属某个插件。跨插件或面向整个 SDK 应用的设置没有独立持久化位置；后续需要定义应用级配置文档及其所有权、读取和修改边界。

## 曾考虑的替代方案

**保留静态 Catalog 与中心 engine。** 该方案改动最小，但功能参数、round-trip、独占文件和 create/config 复用都会继续进入同一个协调中心；拆文件只能缩短单文件，不能收拢职责。

**使用 `wizard.json` 与通用 Questionnaire。** 静态表单无法直接表达功能依赖、选项切换、已有值回填和项目资源变化；类型、gate 和动态 option 最终仍要通过字符串 registry 与过程式 `run()` 连接，形成新的内部 DSL。

**公开本地链接 flag。** 该模式依赖 Harness monorepo 布局和未发布 package，只服务仓库开发；公开后会形成无法对外兑现的项目创建合同，因此保持隐藏。

## 验收标准

- create 与 config 只通过 `SdkProject` 和 `ProjectEditSession` 修改工程，写入前的任何业务、文件或并发校验失败都不产生磁盘变化
- 新增普通功能、功能选项或参数只扩展类型化 spec 或所属行为对象，create/config 流程不增加中央 switch
- 功能模型、NPM 依赖与其他资源配置、不一致检测由 helper 统一实现
- 结构化文件通过 `*File` 文档对象修改；一次性文件和完整产品文案通过所属 package 的 Handlebars 模板生成，业务决策不进入模板 DSL
- `dsh-sdk start/dev/build/config` 是运行产品面，typecheck 直接使用 `tsc -b`，HMR 不通过命令隐式注入，`node-addon-require-builtin` 只由 scripts package 传递提供
- `--link-workspace` 只作为隐藏的仓库开发选项存在，并对 npm、pnpm 和 Yarn 保持单一模块身份

## 风险

- 行为对象与类型化 spec 并存会形成两种扩展形状；专用类必须只用于确实依赖项目上下文或自定义的功能，否则会重新产生无意义的类型层次
- 乐观并发检查与写前校验不能解决写入中途的 I/O 故障，调用方仍需向开发者报告可能的部分提交
- 隐藏链接模式依赖仓库目录与 package manager 链接语义，仓库布局或工具行为变化时必须与实现一起更新
- Cordis loader 从自身模块路径加载 `node-addon-require-builtin`；npm、pnpm 或 Yarn 的 NPM 依赖布局变化时，scripts package 必须继续满足该可选对等依赖（optional peer dependency）
- Handlebars 的 `noEscape` 把目标语言编码责任交给 typed model 构造方；新增模板字段时必须在 owner 处完成正确转义，下游 Handlebars 占位符必须在模板源码中显式转义
