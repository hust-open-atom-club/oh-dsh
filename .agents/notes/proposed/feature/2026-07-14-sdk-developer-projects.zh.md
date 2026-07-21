# Agent Note: 开发者拥有的 SDK 工程

Status: proposed

[English](2026-07-14-sdk-developer-projects.md) | 中文

## 问题

DeepSeek Harness 通过 Cordis 插件对功能进行组合，但从空目录开始搭建一个可运行工程仍要求开发者同时理解 NPM 依赖、`cordis.yml` 插件组、环境变量、TypeScript 构建、本地插件 workspace 和运行入口。手工步骤之间存在约束，漏掉任意一处都会得到能够安装却无法开发、能够开发却无法构建，或能够构建却无法启动的工程。

一次性生成器只能降低首次创建成本。若生成结果隐藏在 preset 或不可编辑的 CLI（命令行界面）内部，高级开发者无法调整插件树、修改 Cordis 插件配置或增加项目特有行为；若创建后的工程完全脱离工具管理，开发者又必须重新承担所有 NPM 依赖和 Cordis 插件配置的一致性工作。

初始创建和后续配置面对同一组内置功能。两条流程各自维护功能列表、功能选项和 NPM 依赖时，新增 Cordis 插件、NPM 包或调整配置会使二者逐渐分叉。工程还需要一条普通的本地插件开发路径，参与开发、构建和启动流程。

## 提案

SDK 创建一个普通、显式且归开发者所有的 TypeScript/Cordis 工程。`cordis.yml` 是唯一的运行时插件树；开发和生产读取同一份文件。工程中的 `package.json`、`cordis.yml`、TypeScript 入口、构建配置和 `plugins/*` 均可直接编辑，SDK 不把它们封装成不可见的 preset。

开发者产品入口只有 `npm create @deepseek-ai/sdk` 和 `dsh-sdk` 命令。前者负责首次创建，`dsh-sdk config` 在创建后管理 SDK 能识别的内置功能，`dsh-sdk dev`、`dsh-sdk build` 与 `dsh-sdk start` 负责开发、构建和启动；本期不提供 `dsh-sdk create`。create 与 config 使用同一份人工编写的功能定义，因此一项功能的功能选项、NPM 依赖、Cordis 配置项、相关文件和识别规则只有一个来源。功能、功能选项等名词由 [SDK 工程编辑架构](../architecture/2026-07-15-sdk-project-editing-architecture.md) 的术语表定义。

SDK 只为功能选择和有限功能选项提供交互，不尝试把任意 Cordis 插件配置变成通用表单。功能选项所需的少量专用输入由所属功能收集；其余 Cordis 插件配置留在 `cordis.yml` 中，并通过注释指明常用改法，由开发者直接修改。

## 开发者流程

首次创建按会影响后续问题集合的顺序收集信息：目标目录与 package 身份、模型提供方与凭据、运行接口、内置功能与功能选项、可选本地插件、包管理器，以及是否安装 NPM 依赖并构建。命令参数已提供的答案不重复询问；本期 create 和 config 都要求交互式 TTY，取消创建时不写入目标目录。

```sh
npm create @deepseek-ai/sdk my-agent
cd my-agent
npm exec dsh-sdk dev index.ts
npm exec dsh-sdk config
npm exec dsh-sdk build
npm exec dsh-sdk start index.js
```

create 拒绝任何已经存在的目标路径。工程文件提交成功后，CLI 询问是否安装 NPM 依赖并构建；安装或构建失败时保留生成结果，并打印可以重新执行的命令。

create 还提供一次 `none / plugin / tool` 选择。`plugin` 固定生成 `plugins/plugin` 的 Cordis 插件，`tool` 固定生成 `plugins/tool` 的模型工具；一次创建至多包含一个本地插件。生成操作同时更新 workspace、根 NPM 依赖、TypeScript reference、构建配置和 `cordis.yml`，任何写入前校验失败都不创建工程。

## 创建时支持的功能

下表是本期 create 面向开发者展示的支持集。`required` 始终存在但仍可切换有限功能选项；`default` 在选择树中预选；`optional` 由开发者主动选择。表格说明产品支持集，运行时注册表是实现的事实源。

| 功能 | create 状态 | 功能选项 | 限制与关系 |
|---|---|---|---|
| `provider` | required | `deepseek`（默认）/ `custom` | DeepSeek 收集 API key；custom 另收集 base URL，模型名可由 CLI 参数覆盖 |
| `app` | required | `tui`（默认）/ `acp` / `embed` | 选择运行接口 |
| `spine` | required | `default` | timer、LLM seam、会话存储、系统提示词、工具注册表、agent 注册表，以及 agent loop |
| `bash` | required | `local`（默认）/ `sandbox` | 两个功能选项互斥、与运行接口正交，且都安装面向模型的 bash 工具；sandbox 安装本地沙箱提供方和沙箱 bash 后端 |
| `persistence` | required | `jsonl`（默认）/ `sqlite` | 每个工程恰好选择一个持久化后端 |
| `hmr` | default | `default` | 加载 `@cordisjs/plugin-hmr`；dev 和 start 都启用，使用插件默认配置 |
| `fs` | default | `local` | 安装本地文件系统、策略和模型工具；进程沙箱不约束进程内 fs 工具 |
| `todo` | default | `default` | 提供 `todo_write` 工具 |
| `skill` | default | `default` | 安装 skill（技能）注册表、本地 skill 提供方和面向模型的 skill 工具 |
| `web` | optional | `deepseek`（默认）/ `exa` / `perplexity` / `fetch-only` | 搜索功能选项互斥；Exa/Perplexity 收集各自 API key；建议同时启用 timeout policy |
| `subagent` | optional | `spawn`（默认）/ `fork`，可多选 | 本期只提供进程内后端 |
| `workflow` | optional | `workerthread` | 要求 subagent 的 `spawn` 功能选项 |
| `compact` | optional | `basic` | 使用 SDK 提供的上下文压缩参数 |
| `hooks` | optional | `claude`（默认）/ `codex`，可多选 | 各功能选项生成独立的可编辑配置文件 |
| `guard` | optional | `repeat-tool` | 提供重复工具调用提醒 |
| `timeout-policy` | optional | `default` | 对声明超时预算的工具执行统一策略 |
| `ask-user` | optional | `default` | 提供 `ask_user_question` 工具；注入的 user-interaction 服务由 acp/tui 两个功能选项提供，因此仅这两个接口可选 |

`bash` 的两个功能选项都适用于 ACP、TUI 和 embed，不由运行接口决定。sandbox 功能选项不写任何生效的配置键，因而沿用 `dsh-bash-sandbox` 的 `read-only` 默认值；生成的 `cordis.yml` 保留注释示例，开发者可以显式改为 `workspace-write`：

```yaml
- id: bash
  name: '@deepseek-ai/dsh-bash-sandbox'
  # Uncomment to allow writes under the project workspace.
  # config:
  #   mode: workspace-write
  #   workspaceRoot: !!js process.cwd()
```

功能贡献只引用单插件 NPM 包，绝不引用 `agent-spine-demo`、`tui-demo`、`acp-demo` 这类组合 NPM 包。表格之外的插件不由本期 create 管理；开发者仍可直接编辑普通工程文件进行高级组合。

## 生成工程

使用默认答案创建 npm 工程时，provider 为 DeepSeek，运行接口为 TUI，bash 为 local，持久化为 JSONL，hmr、fs、todo 与 skill 处于选中状态。初始目录树为：

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

`.env.example` 始终存在，并由 SDK 根据当前功能维护占位。收集到 secret 或开发者确认稍后填写空凭据时，同时生成 gitignored `.env`。SDK 只向 `.env` 追加尚不存在的不同名变量，绝不覆盖或删除已有内容；切换功能选项可以清理 `.env.example` 中不再需要的占位，但旧凭据仍留在 `.env` 中供开发者自行处理。pnpm 和 Yarn 工程增加各自所需的 workspace 配置文件，但运行时插件树和 TypeScript 入口不分叉。

生成的 `package.json` 提供以下 scripts；其中 `dev`、`build`、`start` 与 `config` 调用 `dsh-sdk`，`typecheck` 直接调用 TypeScript：

| script | 行为 |
|---|---|
| `dev` | 运行 `dsh-sdk dev index.ts`，为 TypeScript 和本地 workspace 插件注册开发期解析 |
| `build` | 运行 `dsh-sdk build`，调用工程安装的 tsdown 构建根入口和 `plugins/*` package |
| `typecheck` | 直接运行 `tsc -b` |
| `start` | 运行 `dsh-sdk start index.js`，启动已构建入口且不隐式构建 |
| `config` | 运行 `dsh-sdk config`，修改当前工程功能树 |

`dsh-sdk start` 与 `dsh-sdk dev` 可以接收模块 target，并把 `--` 后的参数原样转发给工程入口。通用参数解析使用 Node `parseArgs()` 的零 schema 模式：带值 flag 采用 `--key=value`，bare flag 转换为 `true`，`--no-*` 转换为 `false`。

- TUI 工程通过 `--model=<name>` 传入所选 model，并根据可选的 `--resume=<session-id>` 创建或恢复 agent；
- acp 使用协议 `session/load`
- embed 使用生成代码中的 model。

每个功能拥有的 Cordis 配置项在 `cordis.yml` 中保留自己的可编辑 Cordis 插件配置和说明注释；`dsh-sdk config` 修改其他功能时必须保留未知字段、未修改节点的格式和注释。HMR（热模块替换）是普通叶子配置项：选择该功能后，dev 和 start 加载同一个 watcher，命令不隐式改变插件树。

## 创建后的配置

`dsh-sdk config` 只要求当前目录具有可读的根 `package.json` 与 `cordis.yml`。它检查标准功能及其当前功能选项，以一棵功能树表达最终目标状态，并在 Review & Apply 前展示功能变化和受影响文件。

`dsh-sdk config` 可以安装缺失功能、启停已安装功能和切换有限功能选项。required 功能不能取消。改变 NPM 依赖后只运行一次项目包管理器安装；安装失败不回滚已经提交的工程文件。

SDK 只修改功能明确拥有的 Cordis 配置项、配置键、NPM 依赖、`.env.example` 占位和独占文件。同一功能选项的更新保留 Cordis 配置项中的未知配置键；手写或第三方插件只支持按稳定 ID 启停。已知功能被手改成不完整、歧义或无法读取的形状时，`dsh-sdk config` 显示诊断并拒绝自动修改，直到开发者手工修复。

一次 config 会话在内存工作区上累计全部修改。Apply 前完成功能关系、资源冲突和文件形状校验，并比较受影响文件与会话打开时的原文；校验失败或检测到外部修改时不写盘。实际写盘开始后不提供跨文件事务回滚。

## 维护模型

Builtin 支持集由 SDK 人工策划，不根据 NPM 依赖名称或目录约定自动暴露。一个功能可以组合多个 Cordis 配置项，功能选项可以共享资源，并声明对其他功能或特定功能选项的功能依赖；新增普通功能或功能选项不应要求同时修改 create 和 config 两个命令流程。

## 后续工作

- `dsh-sdk add [package-spec]`：统一本地插件创建与外部 Cordis 插件接入；未指定 package 或仓库来源时创建本地 plugin/tool，指定来源时增加 NPM 依赖和 `cordis.yml` 配置项，来源模型为 GitHub 仓库等扩展保留空间
- 非交互 create/config：本期两个流程都要求 TTY，不提供供自动化调用的完整输入合同
- 更多功能专用参数输入：本期产品只展示有限功能选项、secret 和少量专用值，不为 Cordis 插件配置提供通用参数界面

## 曾考虑的替代方案

**不可编辑的 preset 或生成器托管工程。** 该方案可以缩短初次创建路径，但会隐藏真实插件树和构建边界，使高级开发者无法直接组合 Cordis 插件，也让项目行为依赖 CLI 版本而不是检入的工程文件。

**只提供一次性生成器。** 创建后完全依赖手工维护，会让功能依赖、功能选项切换和多文件更新再次分散；共享 registry 的 config 流程为生成工程保留持续管理机制。

**为开发和生产维护两份 `cordis.yml`。** 两份插件树会使开发成功无法证明生产加载相同功能；dev 只增加 TypeScript 与本地 workspace 解析，运行配置保持唯一。

**为任意 Cordis 插件配置生成通用表单。** Cordis 插件配置包含嵌套结构、表达式和插件特有语义，通用表单会形成第二套不完整 schema。SDK 只管理有限功能选项和专用 secret，复杂配置继续由开发者直接编辑。

**使用私有协议发现本地插件。** 普通 package manager workspace、根 NPM 依赖、TypeScript references 和 Cordis 配置项已能表达完整关系；额外发现协议会创造只能由 SDK 理解的隐藏状态。

**在现有工程中提供 `dsh-sdk create`。** create 已能生成一种可编辑的本地插件骨架，后续插件可以沿用普通 workspace 和 Cordis 机制手工添加；再提供同构命令会增加第二条脚手架产品面，却不增加新的组合功能。

**把每个新 Cordis 插件自动暴露为 builtin。** package 无法说明多个插件如何组合成一项产品功能，也无法推导互斥关系、功能依赖、secret、接口适用性和安全限制；支持集需要人工策划，自动化只适合检查候选是否完成分类。

## 验收标准

- `npm create @deepseek-ai/sdk` 按本文顺序收集项目身份、provider、interface、功能、可选本地插件、包管理器和安装选择，并在取消时保持目标路径不存在
- 默认 npm 工程具有本文目录树和 `dev`、`build`、`typecheck`、`start`、`config` scripts，且 dev/start 使用同一份 `cordis.yml`
- create 展示本文功能及功能选项；`bash` 的 local/sandbox 二选一且默认 local，sandbox Cordis 配置项保留可编辑的注释配置示例；HMR 默认选中并同时由 dev/start 加载
- create 的 `plugin` 或 `tool` 选择至多生成一个固定名称的本地插件，并原子更新插件文件与根工程关系；本期不提供 `dsh-sdk create`
- `dsh-sdk config` 从现有工程读取同一支持集，能够安装、启停和切换支持的功能选项，保留未知配置与注释，并拒绝修改不一致配置
- `.env.example` 反映当前功能所需变量；`.env` 只追加缺失的不同名变量，从不覆盖或清理已有内容
- npm、pnpm 和 Yarn 生成的 workspace 能安装、构建和启动；本地插件在 dev 中使用源码，在 start 中使用构建产物

## 风险

- 开发者可以把 builtin 手改成 registry 无法识别的形状；SDK 选择停止自动化而不是猜测并覆盖配置
- 多文件写入前的校验和外部修改检测不能提供写入阶段的事务回滚；I/O 中途失败可能留下需要人工修复的部分提交
- sandbox 功能选项依赖目标平台存在可用的本地沙箱后端；后端不可用时必须 fail closed，不能退回无沙箱执行
- HMR 在生产启动中也保持文件 watcher 和热重载行为；这是显式插件选择的结果，不是仅限开发环境的隐式服务
- `.env` 的仅追加策略会保留已经不用的凭据，SDK 不判断这些用户数据何时可以安全删除
