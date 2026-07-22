# Agent Note: 单文件可执行的 SDK 运行时分发（single-exe）

Status: implemented

[English](2026-07-10-single-file-executable-sdk-runtime-distribution.md) | 中文

## 问题

DeepSeek Harness 需要为 Python 库专门提供一种无需安装 Node、可直接在目标平台运行的 SDK 分发形态：一个单文件可执行程序（下称 exe），通过 stdio 提供 JSON-RPC 对外服务接口（`HarnessSdkServer`，Python SDK 的对端），且实际启动的插件与配置完全由 exe 外部输入的 `cordis.yml` 决定。

- 与 Python SDK 通信的 JSON-RPC 协议已经过验证
- 需要提供通过标准化 `cordis.yml` 加载所有插件（ES 模块）的能力
- 分发物要自带 Node 运行时，并支持本地源码链接的调试模式

## 决策

### 打包路线：@yao-pkg/pkg 的 `--sea` 模式

exe 使用 [@yao-pkg/pkg](https://github.com/yao-pkg/pkg)（vercel/pkg 归档后的活跃维护 fork）的 **`--sea`（enhanced SEA）模式**打包。相比 Node 原生 SEA，pkg 在其上增加 `/snapshot` 虚拟文件系统（VFS）与运行时模块钩子，将 ESM 入口原样交给 Node 默认的 ESM loader，不依赖任何 ESM→CJS 转译。
> 实测（macos-arm64、node24 构建目标、pkg 6.21.0）：VFS 内裸包名 ESM 动态 `import()`（含顶层 `await`）、CJS 互操作、`node:sqlite`、集合外包名明确报错、VFS 外磁盘 ESM `import()` 全部通过，`import.meta.url` 原样为 `file:///snapshot/...`。

`--sea` 要求构建目标 ≥ node22，exe 统一以 node24 为构建目标；每次 pkg 调用只打包一个构建目标，多平台各调用一次。

术语提醒：pkg 的 `/snapshot` VFS 与本仓库测试体系的“快照”（ACP 回放预期输出、`$DSH_SNAPSHOT`）无关，本文用“VFS”指前者。

### 对外服务接口也是插件：ui/jsonrpc + examples/jsonrpc-demo 两包

确定性协议实现（`server.ts` / `transport.ts`）按 `ui/acp` + `examples/acp-demo` 的既有模式落为两包——对外服务接口本身也是插件：

- [`packages/ui/jsonrpc`](../../../../packages/ui/jsonrpc/README.md)（`@deepseek-ai/dsh-jsonrpc`）：纯协议插件；执行 `apply` 时，在进程 stdio 上挂载 `HarnessSdkServer` 与按行传输的 JSON-RPC 层，资源释放走 `ctx.effect()`。是否提供服务由 `cordis.yml` 决定；未挂载该插件的配置会启动一个不提供此服务的合法进程。协议级退出归插件所有（应答 `shutdown` 请求后 dispose 自身 fiber，再调用 `exit(0)`；HMR 式卸载只停止服务，不退出进程）。
- [`packages/examples/jsonrpc-demo`](../../../../packages/examples/jsonrpc-demo/README.md)（`@deepseek-ai/dsh-jsonrpc-demo`）：轻量应用入口——`installFailLoud` + `loadEnv` + 配置发现 + [`dsh-app-boot`](../../../../packages/ui/app-boot/src/index.ts) 的 `boot()`；`boot()` 完成后入口即完成，服务器由 `cordis.yml` 中的 `dsh-jsonrpc` 条目启动。它只依赖 `app-boot`。进程级退出归 `bin` 所有（stdin EOF/SIGTERM → dispose 后返回 0，SIGINT → 130）。

配置发现有两个通道，均缺失时立即报错：优先使用 `DSH_CORDIS_CONFIG` 环境变量（SDK 客户端约定），其次使用 argv 位置参数；没有默认路径或内置回退——“实际启动的插件由外部 `cordis.yml` 决定”是硬语义。

### 插件解析：VFS 装载真实包树，闭包清单就是部署根目录

exe 的 VFS 内是**构建产物形态的真实包树**（各包的 `lib/` + 真实 `node_modules`）。loader 通过标准动态 `import()` 解析插件名：裸包名从 VFS 内 loader 所在位置沿 `node_modules` 向上解析，自然落在 VFS 内。封闭集不需要白名单代码——VFS 中安装了什么，集合中就有什么；`import()` 集合外的名称会失败。

部署根目录是 [`python/sdk-runtime/package.json`](../../../../python/sdk-runtime/package.json)（`dsh-jsonrpc-agent-pkg`，pnpm 工作区成员、零代码纯依赖清单），也是“exe 安装哪些插件”与“Python 运行时分发什么”的统一事实源。向 exe 添加插件，就是在清单中增加一行依赖后重新打包。[`scripts/verify-runtime-closure.ts`](../../../../scripts/verify-runtime-closure.ts) 遍历该清单覆盖的全部工作区包，要求每个非可选的工作区对等依赖（peer dependency）都显式列在运行时根目录，并报告“引用包 → 缺失对等依赖”的完整链路；CI 静态检查、pre-push 与 single-exe 构建都会在打包前运行该门禁。部署还会依据各包的 `files` 字段打包，因此 tsdown 拆出的共享分片必须被 `files` 覆盖。

### 构建管线与产物

[`scripts/build-exe-for-python-sdk.ts`](../../../../scripts/build-exe-for-python-sdk.ts)：运行时闭包校验 → `pnpm run build` →（清空后）`pnpm --filter dsh-jsonrpc-agent-pkg deploy --legacy --prod --config.node-linker=hoisted --config.auto-install-peers=false --config.link-workspace-packages=true` **直接写入** `python/sdk-runtime/src/deepseek_harness_runtime/runtime/node/` → 注入 pkg 配置（`bin` 指向闭包内的 `node_modules/@deepseek-ai/dsh-jsonrpc-demo/lib/bin.js`；`assets` 使用全量 glob，因为动态 `import()` 对 pkg 静态分析不可见，必须显式打入全部内容）→ 每个构建目标调用一次 `pkg --sea` → 可执行文件 `dsh-jsonrpc-agent-pkg-<platform>-<arch>` 写入 `dist-exe/`，并拷回运行时目录。CI 将这些文件作为测试中间输入，只保留对应平台的 wheel 包。四个部署标志都有实测依据：未启用 `inject-workspace-packages` 时必须使用 `--legacy`；`hoisted` 产出无符号链接的文件树（对 pkg VFS 最稳定，并从物理上保证只有一个 Cordis 实例）；关闭对等依赖自动安装可避免未发布包名触发注册表解析；`link-workspace-packages` 让闭包指向工作区/vendor 源码。

CI 使用 [`.github/workflows/build-exe-for-python-sdk.yml`](../../../../.github/workflows/build-exe-for-python-sdk.yml)，且只允许显式触发：手动派发 `workflow_dispatch`，或给 PR 添加 `build-exe` 标签。linux-x64、linux-arm64（`ubuntu-24.04-arm`）和 macos-arm64 三个平台分别进行原生构建，并缓存 `~/.pkg-cache`；macOS 的 ad-hoc 签名由 pkg 处理。每个平台都使用模拟 SSE 模型，分别通过默认配置和自定义 `cordis.yml` 驱动 SDK，再通过 NDJSON JSON-RPC 直接驱动 exe，校验 JSONL 与最终响应；最后把发布形态的 wheel 包安装到干净的 venv 中，并在不传 `runtime_bin` 的情况下运行。Linux 还会检查 GLIBC 依赖，并在 manylinux 2.28 容器中运行。完整构建三个目标时保留 4 个产物，每个产物只含一个发布文件：平台无关的 SDK wheel 包与 3 个原生运行时 wheel 包；手动选择部分目标时保留 SDK wheel 与所选运行时 wheel。裸 exe 与源码包只作为测试中间输入。[`.gitlab-ci.yml`](../../../../.gitlab-ci.yml) 只接受版本与根目录 `package.json` 匹配的 `python-vX.Y.Z` 标签流水线，构建一个 SDK wheel 包和 3 个原生运行时 wheel 包，再由单个串行任务校验并将这 4 个文件发布到项目的 PyPI 注册表。Windows 不在目标范围内。

### Python SDK 分发：双载体，exe 用于生产，`node` 用于开发

Python SDK 位于 [`python/`](../../../../python/README.md)：`python/sdk` 是客户端，`python/sdk-runtime` 是运行时载体包。运行时包的数据目录包含三类内容：检入的默认 `runtime/cordis.yml`、构建注入的平台 exe，以及构建注入的 `runtime/node/` 闭包树。`resolve_bundled_launch_args()` 的自动解析**只查找 exe**；`node` 载体仅在显式设置 `DSH_RUNTIME_MODE=node` 时启用（运行 `runtime/node/node_modules/@deepseek-ai/dsh-jsonrpc-demo/lib/bin.js`，需要系统 Node ≥22.19），定位为本仓库成员的开发验证通道，不随 wheel 包分发。

[`scripts/build-python-release.py`](../../../../scripts/build-python-release.py) 从仓库根目录的 `package.json` 读取权威的稳定版本 `X.Y.Z`，以该版本暂存两个包，并让 SDK 精确依赖 `deepseek-harness-runtime-bin==X.Y.Z`。可选的 `python-vX.Y.Z` 发布标签只是一项一致性断言，与仓库版本不同时会被拒绝；源码 `pyproject.toml` 中的开发占位版本从不决定发布版本。SDK 是 `py3-none-any` wheel 包；只提供 wheel 包的运行时包恰好包含一个 exe，标签为 `py3-none-manylinux_2_28_x86_64`、`py3-none-manylinux_2_28_aarch64` 或 `py3-none-macosx_11_0_arm64`。其 Hatch 钩子拒绝 sdist、通用标签、混合可执行载荷以及不支持的平台。

exe“必须显式配置”的硬语义不变；零配置体验由包装层恢复：调用方没有提供 `cordis`、没有显式指定运行时，且环境中没有 `DSH_CORDIS_CONFIG` 时，客户端将检入的默认 `cordis.yml`（`agent-core` + 预载的 `llm-deepseek` + JSONL 持久化 + `bash-local` + `dsh-jsonrpc` 对外服务条目，并通过 `!!js` 使用环境变量兜底）显式注入 `DSH_CORDIS_CONFIG`。

### 命名血统

`@deepseek-ai/dsh-jsonrpc-demo`（包）→ `dsh-jsonrpc-agent`（`bin`）→ `dsh-jsonrpc-agent-pkg`（闭包清单；没有作用域前缀，刻意避开 `constraints` 对 `@deepseek-ai/dsh-*` 的包形状规则）→ `dsh-jsonrpc-agent-pkg-<platform>-<arch>`（exe 产物）。协议字段 `serverInfo.name` 保持为 `deepseek-harness-sdk-runtime`（协议稳定值）；Python 分发名为 `deepseek-harness` / `deepseek-harness-runtime-bin`。

## 工作线程插件

exe 内支持 `dsh-workflow-workerthread` 与 `dsh-code-runtime-worker`。两个后端构建后的宿主都通过 `fileURLToPath()` 转换相邻 `lib/worker.cjs` 的 URL，再将所得文件系统字符串传给 `Worker`；pkg 的 Worker 钩子可以用这种形式解析 VFS 内文件。该钩子会把 VFS 内的工作线程文件作为 CommonJS 编译，所以工作线程入口采用 CommonJS。工作流引擎在未构建的源码执行中仍保留 `data:` URL 引导程序，只有构建后的相邻入口使用文件系统字符串。自定义配置的可执行文件冒烟测试会加载两个后端，实际调用 `run_code` 与不启动 agent 的 `workflow`，并要求两个工作线程都从 pkg 的 VFS 内返回 `42`。

## 测试

验证面分三层。机制层：`--sea` 链路的实测结论内嵌在“决策”各节（VFS 内 ESM 动态 `import()`、单一 Cordis 实例、明确报错的配置链路、`node:sqlite`、macOS ad-hoc 签名可运行）。SDK 层：完整的无密钥 pytest 套件以假运行时对端覆盖客户端协议、子进程清理、绝对 `cwd` 传递、双载体启动与载体解析；根 CI 在 Python 3.10 上运行全部用例。端到端层：每个平台构建都通过默认 SDK 路径、自定义配置和直接二进制协议，对模拟端点完成一个轮次，并校验最终文本与 JSONL。自定义配置还会通过打包进 VFS 的真实工作线程文件执行 `run_code` 和不启动 agent 的 `workflow`。同一构建任务还会经 Python SDK 运行一组检入的 exe 专用快照：无密钥脚本化模型挂载一个会注册工具的 Cordis 插件，从 `run_code` 调用该工具，运行一个由 spawn 提供方直接启动的 subagent（子 agent）和一个会通过 spawn 启动第二个子 agent 的工作流，随后卸载该插件。比较时会规范化 SDK 结果与通知流，以及父会话和两个子会话的 JSONL 日志。该 harness 与 ACP 的 `pnpm run test:snapshot` 保持独立，因为二者的协议和构建产物不同。随后把平台 wheel 包安装进干净的 venv，并在不传 `runtime_bin` 的情况下运行。

手工驱动注意：`bin` 将 stdin EOF 视为“客户端已离开”并立即 dispose，短命管道会中止进行中的轮次——管道驱动必须保持 stdin 打开，直到轮次结束。

## 曾考虑的替代方案

**裸用 Node 原生 SEA。** 注入的主脚本必须是 CJS 单文件，blob 内没有文件系统与模块解析，因此动态 `import()` 无法解析裸包名；只能把插件静态编译进主脚本并手工注册。这会绕过标准模块解析并硬编码插件集合，与“配置决定一切”相悖。最终路线实际是“官方 SEA 基础 + pkg 的 VFS/模块钩子层”；否决的是裸用方式，而不是 SEA 本身。

**pkg 标准模式。** PoC 证明该模式不可行，而非权衡后放弃：它通过 esbuild 将 ESM 转为 CJS + V8 字节码，但运行时 VM 编译没有接入动态 `import()` 回调，任何 `import()` 都会抛出 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`，`--options experimental-require-module` 也无效；此外，它依赖社区补丁版 Node 二进制（macos-arm64 没有预编译版本，现场从源码编译约需 10 分钟）。该模式不适用于本仓库架构。

**每包 ESM→CJS 预打包进 VFS。** 保持真实解析语义、只降级模块格式的折中；`--sea` 直接通过实测，这层构建复杂度无需引入。

**让 jsonrpc-agent 承担完整闭包依赖。** 应用入口将声明 53 个以上自身并不 `import()` 的依赖，使“打包清单”伪装成真实依赖关系，还会迫使 `constraints` 为其增加 `cordis-in-dependencies` 与 `files` 通配符两个例外。将闭包清单放在 Python 侧的清单包后，`constraints` 不需要任何例外，`bin` 也能保持与 acp-agent 同构的正常包形状。

**开放插件集（从磁盘加载用户插件）。** 本期采用封闭集；PoC 同时证实，可以通过 `ctx.baseUrl` 相对路径通道从 VFS 外的磁盘 `import()` ESM。该能力列为后续演进，届时还需解决外部插件与 exe 内 Cordis 实例的共享问题。

## 后果

**买到的**：目标平台零依赖的单文件分发；插件语义与源码运行严格一致（同一棵真实包树，无转译、无注册表）；对外服务接口、插件集与配置全部收敛到 `cordis.yml` 和一份依赖清单这两个事实源；exe 与 `node` 双载体使用同一棵树和相同语义，开发验证无需等待打包；官方 Node 二进制消除了补丁版二进制的供应链顾虑。

**付出的**：产物约 174MB，且源码原样进入 blob（没有字节码混淆；闭源分发诉求需要另行评估）；pkg 的 VFS/模块钩子层仍由社区维护（构建脚本钉死 `@yao-pkg/pkg@6.21.0`，升级需要显式改动）；`--sea` 每个构建目标调用一次（与 CI 每个平台一个任务相匹配，本地多平台构建串行执行）。
