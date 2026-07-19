# Agent Note: SDK 后续功能

Status: proposed

[English](2026-07-17-sdk-follow-up-capabilities.md) | 中文

## 问题

首个 SDK 版本通过[开发者工程 Agent Note](2026-07-14-sdk-developer-projects.md) 和 [SDK 工程编辑架构](../architecture/2026-07-15-sdk-project-editing-architecture.md)定义的共享模型创建和编辑开发者拥有的 Cordis 工程。create 和 config 工作流仅支持交互调用，接入外部 Cordis 插件需要手工修改依赖和配置，命令行遥测没有明确的所属边界，交互分支也缺少稳定的测试策略。

这些缺口彼此关联。create 和 config 已经共享问题、功能配置和 `ProjectEditSession`；若另建自动化路径，就会复制领域逻辑。安装外部插件必须同时修改包管理器文件和 `cordis.yml`。遥测需要观察 create、build 等不会启动 Cordis 的命令。交互测试需要覆盖 Harness 自身行为，同时避免把终端渲染固化成脆弱的产品契约。

## 提案

SDK 扩展现有提示词与工程编辑边界，不另建平行工作流。非交互式 `PromptPort` 实现和结构化功能计划驱动 create 与 config；`dsh-sdk create <source>` 先把依赖解析交给工程的包管理器，再通过 `ProjectEditSession` 挂载解析所得的包；启动器侧遥测包住 `create-sdk` 和每个 `dsh-sdk` 命令；交互测试主要通过注入的提示词输入输出流完成。

| 功能 | 产品入口 | 所属机制 | 必须达到的结果 |
|---|---|---|---|
| Headless 工程创建 | `create-sdk --config <file>` 或 `--config-json <json>`，可搭配 `--json` | `HeadlessPromptPort`、结构化工程答案和完整功能计划 | 不阻塞等待终端；明确报告缺失的必答输入 |
| 外部 Cordis 插件安装 | `dsh-sdk create <source>` | 包管理器原生 `add` 加 `ProjectEditSession` | 依赖和 `cordis.yml` 配置项指向包管理器解析出的包 |
| 开发周期遥测 | `create-sdk` 和每个 `dsh-sdk` 命令 | 启动器侧的上报条件判断、遥测内容构建、脱敏、匿名身份和传输服务 | 上报采用尽力而为语义，不能改变命令结果 |
| 交互回归覆盖 | create 和 config 测试 | 注入的 `PromptPort` 输入输出和文件系统断言 | 测试覆盖 Harness 决策与生成文件，不快照终端重绘 |

## 共享 headless 工作流

### 结构化输入和生命周期事件

Headless create 通过 `--config-json` 接收内联 JSON 对象，或通过 `--config` 从文件读取。标量字段提供普通 create 答案，`features` 提供完整的已选功能、功能选项、secret（密钥）和专用值。只有所属问题明确声明的默认值才有效；headless 路径绝不为必答问题臆造答案。

使用 `--json` 时，stdout 是 NDJSON 事件流。`done` 表示创建及要求执行的安装和构建均已完成，`action-required` 指明一个尚未回答的必答问题，`error` 报告其他失败。面向人的进度信息和包管理器输出写入 stderr，确保 stdout 每一行都能解析成一个事件。调用方收到 `action-required` 后补充缺失值，再次运行命令。

Create 和 config 使用相同的功能计划形状。create 通过上述命令行输入公开该形状；config 在共享工作流边界使用同一形状，使后续自动化入口无需另建功能选择模型。

### Prompt 与工程编辑边界

`PromptPort` 仍是 SDK 问题与交互实现之间的唯一边界。`ClackPromptPort` 负责终端交互。`HeadlessPromptPort` 使用问题契约公开的默认值，否则通过未回答问题快速失败；预填值通常会让流程根本不调用该 port。

两条路径使用相同的 `Question` 对象、`FeatureConfigurator`、`SdkProject` 和 `ProjectEditSession`。因此，headless 路径只改变答案的到达方式，不改变功能解释或文件提交方式。

### Agent skill

仓库提供一份轻量 `SKILL.md`，指导 agent skill（智能体技能）构造结构化输入、请求 NDJSON、补充 `action-required` 指明的值并重试。该 skill 调用公开 CLI，不导入 SDK 内部 API，也不引入另一套工程规格。

## 外部 Cordis 插件安装

`dsh-sdk create <source>` 接受包管理器原生的 npm package specifier，例如 `pkg@version`，也接受 `github:owner/repo#ref` 等 GitHub package specifier。用户确认后，命令要求工程包管理器添加来源，对比操作前后的直接依赖名，重新打开工程，再通过 `ProjectEditSession` 把每个新增且已解析的包挂载进 `cordis.yml`。

包管理器负责来源解析、版本或 commit 解析、`integrity` 数据、lockfile 更新和构建策略。SDK 不再通过 giget 或 pacote 下载、解压第二份副本。外部插件是 `node_modules` 下的依赖；本地插件脚手架仍属于独立的工程创建问题。

## Launcher 遥测

### Consent 与采集

遥测包住 `create-sdk` 初始化命令与 `dsh-sdk` launcher 的命令生命周期，因为工程初始化、插件创建和 build 都不会稳定地启动 Cordis。每个事件记录命令名、时长、成败、随机生成的用户级匿名标识符，以及符合条件时经过脱敏的 `cordis.yml` 与 `package.json` 文本。

除非当前存在的遥测配置项被明确禁用，否则允许上报。`DO_NOT_TRACK` 和 CI 无论工程配置如何都禁止上报。缺少 `cordis.yml` 本身不会禁止事件，但只有 `cordis.yml` 能证明目录是 SDK 工程时，遥测内容才包含 `package.json` 文本。

### 安全与传输

Payload 构建器绝不读取 `.env`。它会脱敏两个符合条件的文本文件中的疑似密钥键和值、已知 token 形式、PEM 块、URL 凭据和高熵不透明字符串。脱敏只是安全兜底，不能提供绝对保证；SDK 工程必须把凭据放进 `.env`。

`TelemetryReporter` 使用固定 endpoint，每条发送路径都会正常结束且不抛错。命令分发通过 `finally` 路径记录成败，在命令结果已确定后启动上报，并在有界时间内等待传输结束。只有遥测边界会吞掉上报条件解析、遥测内容构建、存储或网络错误，这些错误绝不改变命令退出码。

## 交互工作流测试

Create 和 config 测试向现有工作流注入 `PromptPort` 和脚本化输入输出流。参数化场景覆盖功能选择、功能选项、secret、取消、评审和应用行为，再断言最终的 `cordis.yml` 及其他工程文件。稳定的产品断言是生成后的工程状态，不是 clack 的 ANSI 重绘序列。

可以用一到两个可选的真实 PTY 冒烟测试覆盖注入无法复现的发布二进制和 TTY 检查。除非原生 PTY 工具在仓库支持的 Node 与宿主版本上足够可靠，否则它不进入必跑路径。

## 延后工作

- 扩展 headless create 规格，使其能表达本地 `plugin` 或 `tool` 脚手架，而不是把该交互选择默认为 none。
- 在 create 和 config 中公开遥测关闭选项，同时保留只有禁用时才写入遥测配置项的上报许可表示。
- 明确 GitHub 来源依赖必须预先构建，还是允许运行由包管理器控制的 preparation script（准备脚本），并在安装前向用户展示该策略。
- 发布前把遥测包中的 `.invalid` endpoint 占位符替换为生产端点。

## 曾考虑的替代方案

**另建 headless 创建引擎。** 该方案会复制问题、功能依赖、配置行为和工程编辑规则。复用提示词与编辑会话边界，可以保证工程语义只有一份实现。

**把规格文件作为主要自动化接口。** Agent 可以内联传入相同的类型化 JSON 对象，人和 CI 仍可选用文件。文件专用协议会增加持久化与清理工作，却不增加语义。

**使用 `npx skills add` 创建工程。** Skills CLI 只安装 Markdown skill，不创建 SDK 工程，也不安装 npm 包。因此，agent skill 驱动 SDK 初始化命令，而不是取代它。

**通过 giget 或 pacote 获取 GitHub 与 npm 来源。** 第二套获取层会复制包管理器的解析、完整性、lockfile 和生命周期策略。原生 package specifier 让这些决策留在所选包管理器中。

**把遥测实现成 Cordis 运行时插件。** Create 和 build 不一定启动 Cordis，因此运行时插件无法观察完整的开发命令周期。Launcher 是这些命令共用的边界。

**从 git 元数据派生匿名标识符。** 仓库的 git remote 可能识别工程或组织。随机的用户级标识符能够支持聚合，同时不编码仓库身份。

**只采集聚合计数。** 仅聚合事件可以降低暴露，但无法回答开发者实际使用哪些插件、依赖和配置形状。本提案接受采集脱敏后的工程文本，并明确记录这项暴露。

**把真实 PTY 和 transcript（文本记录）快照作为主要测试策略。** 原生 PTY 依赖与终端重绘序列会带来平台和渲染不稳定性，而且主要是在测试 clack。注入交互并断言生成文件，可以直接测试 SDK 拥有的行为。

## 验收标准

- Create 能依据完整结构化输入在没有 TTY 时运行；使用 `--json` 时 stdout 只输出 NDJSON；缺少必答输入时通过 `action-required` 报告，且不写入部分工程。
- Create 和 config 通过共享的问题、功能配置和工程编辑代码路径解析相同的功能计划契约。
- `dsh-sdk create <source>` 使用工程选定的包管理器，挂载该操作实际新增的依赖名；无法识别新增依赖时快速失败。
- 初始化命令与每个 `dsh-sdk` 命令都进入同一条尽力而为的遥测收尾路径；明确禁用的配置项、`DO_NOT_TRACK` 或 CI 会阻止传输，遥测失败绝不改变命令结果。
- 遥测绝不读取 `.env`；没有 `cordis.yml` 时不发送无关的 `package.json` 内容；两个符合条件的文本都经过脱敏；匿名标识符与 git 元数据无关。
- 交互测试通过注入交互覆盖 create 和 config 决策，并断言已提交的工程文件；真实 PTY 覆盖只作为窄范围冒烟层。
- Agent skill 说明公开的结构化输入与事件契约，不依赖包的私有导出。

## 风险

- 即使经过脱敏，完整的 `cordis.yml` 与 `package.json` 文本仍会向 endpoint 运营方暴露插件名、依赖名、URL、路径和配置值；启发式脱敏也可能漏掉 secret。
- 没有遥测配置项时默认上报可能让开发者意外；发布前 CLI 必须让关闭方法易于发现。
- 在 `ProjectEditSession` 挂载插件前，包管理器的 add 操作已经可能修改 `package.json`、lockfile 和安装文件；后续挂载失败会留下需要手工恢复的依赖改动。
- GitHub 依赖可能按包管理器策略执行 preparation 或 lifecycle script；尚未解决的构建策略会带来供应链与可复现性风险。
- 注入提示词交互的测试无法证明真实终端中的 raw mode、signal 或重绘行为；可选冒烟层只应覆盖这些残余契约。

## 参考资料

- [Vercel Eve](https://github.com/vercel/eve) 与 [Vercel Labs Skills](https://github.com/vercel-labs/skills) 用于区分 headless 初始化命令与 skill 分发。
- [npm package specifications](https://docs.npmjs.com/cli/v11/using-npm/package-spec)、[pnpm add](https://pnpm.io/cli/add)和 [Yarn add](https://yarnpkg.com/cli/add)说明包管理器原生来源。
- [`DO_NOT_TRACK`](https://donottrack.sh/)定义环境级关闭约定。
- [Clack](https://github.com/bombshell-dev/clack) 和 [Vitest snapshots](https://vitest.dev/guide/snapshot) 说明注入提示词交互与生成文件断言。
