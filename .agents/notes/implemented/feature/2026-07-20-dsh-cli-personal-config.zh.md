# Agent Note: dsh CLI 与来自 Harness home 的个人配置 overlay

Status: implemented

[English](2026-07-20-dsh-cli-personal-config.md) | 中文

## Problem

开发者自己的偏好——TUI 使用哪个提供方和模型、个人凭证、私有的适配器路由——除了改动已提交的文件之外无处安放。要把 TUI 示例指向个人的 Anthropic 代理 Opus 路由，只能在工作区里改 `examples/tui-agent/cordis.yml` 和 `.env`，既有提交密钥的风险，又要在每个 checkout 里重复一遍。也没有可安装的命令：想在任意项目目录里运行这个 agent，必须回到仓库根目录调用示例脚本。Loader 元数据是静态的，所以「条件组合使用 overlay」（AGENTS.md）——但 overlay 此前只以已提交的同级文件形式存在，没有机器级的层。

## Decision

两个耦合的部分，与 `dsh web` PR（#443）提出的 `apps/` 装配层对齐：

**`dsh` CLI（`apps/cli`，npm 名 `@deepseek-ai/dsh`）。** `apps/*` 作为 `packages/*` 库之上的产品装配层加入 workspaces。bin 的分发把 `web` 和 `-p`/`--prompt` 保留给 PR #443（它们以指引退出），使两个分支能以接近并集的方式合并；其余一切都运行默认表面：交互式 TUI，加载随仓库提供的 `examples/tui-agent/cordis.yml`（或显式的配置参数），并以调用目录为工作区。已提交的 `bin/dsh` 启动器通过自身真实路径解析 checkout，用仓库的 tsx **从源码**运行该 bin（带 `--expose-internals`，供配置里的 HMR 配置项使用），因此 `ln -sf "$(pwd)/bin/dsh" ~/.local/bin/dsh` 安装的命令永远执行当前工作树。`pnpm run demo:tui` 运行同一入口。

**个人配置（`dsh-app-boot`）。** 个人 overlay 存放在 Harness home——`$DSH_HOME`，否则 `~/.dsh`——由共享的 [`resolveDshHome`](../architecture/2026-07-24-single-harness-home-resolver.md)（`@deepseek-ai/dsh-paths`）解析，与 skills、AGENTS.md 解析所依据的单一根目录相同。dsh 的 TUI 表面消费其中两个可选文件；各示例 bin 仍然逐字节按已提交的配置树启动：

- `.env`——在调用目录的 `.env` 之后加载；`process.loadEnvFile` 从不覆盖已有值，因此优先级为环境变量 > 项目 `.env` > 个人 `.env`。
- `config.yaml`——顶层 YAML 数组，元素为 `@cordisjs/plugin-include` 的 `PatchOptions`，用 include 自己的 `!!js` 方言解析（`loadPersonalPatches`）并传给 `boot()`，由它作为根 include 的 `patches` 转发。补丁语义与已提交 overlay 完全一致（Code Mode overlay 是模板）：按 id 定位的补丁替换该配置项的整个 `config`，`insert` 追加配置项，未匹配的 id 记录警告并跳过。
- 文件缺失即无 overlay；文件存在但不可读、不可解析或非数组则在启动时抛出（配置错误响亮失败，绝不静默跳过）。

PTY 冒烟测试的启动器把 `$DSH_HOME` 隔离到每个测试自己的目录，与它已有的 `DSH_AGENTS_HOME` 隔离方式完全一致，开发者真实的个人 overlay 不可能泄漏进 fixture；只有 dsh CLI 读取个人配置，因此其他测试启动器无需改动。

## Alternatives considered

**独立的 `bin/dsh` 包装脚本占有 `dsh` 这个名字。** 读过 PR #443 后否决：该 PR 把 `apps/cli` 确立为带子命令分发（`web`、`-p`）的 `dsh` CLI，并且默认位空缺。两个互相竞争的 `dsh` 入口会在 `$PATH` 和产品身份上冲突；在同一包形态内认领默认位，把最终的合并冲突限制在小小的分发链上。

**pi 风格的类型化设置文件（`defaultProvider`/`defaultModel`/`providers`）。** 用户否决，选择补丁语义：个人文件是叠加在随仓库提供的默认配置之上的 cordis overlay，而不是需要另行拥有和翻译的第二套配置词汇。

**个人完整 `cordis.yml` 去 include 请求的配置。** 否决：个人文件将不得不写死叶子配置的路径，而该路径随 checkout 变化；补丁反转了依赖方向，bin 仍然选择配置树，个人层只做修正。

**把个人补丁深合并进配置项配置。** 否决：会使补丁语义与已提交 overlay 和 vendor 的 include 分叉；整个 `config` 替换已是成文契约。

**用环境变量开关代替存在性判断。** 否决：默认关闭的个人配置永远不会被用起来；存在即生效加上每个测试的显式隔离，让实际运行获得 overlay、测试获得封闭性。

## Consequences

- 在任意目录运行 `dsh`（以及 `pnpm run demo:tui`）即可零仓库改动地使用个人提供方/模型；已针对个人 Anthropic 代理与 Opus 4.8 端到端验证，包括一次 bash 工具往返。
- 由于按 id 定位的补丁替换整个 `config`，个人覆盖必须复述它保留的基础字段，并可能随基础配置项形态变化而漂移；loader 的「配置项未找到/名称不匹配」警告是仅有的诊断。
- 个人补丁只在被启动文件自身的树里解析 id，因此嵌套 include 的 overlay（Code Mode）不会被个性化；这些叶子的实际运行等价性暂缓。
- `dsh-app-boot` 依赖 `js-yaml`（外加一份只用于加载的 include `!!js` YAML 类型副本），并与 `apps/cli` 一样依赖 `@deepseek-ai/dsh-paths` 以获取 `resolveDshHome`。
- PR #443 落地时，`apps/cli/src/bin.ts` 的分发链与 `apps/cli/package.json` 的依赖列表会产生文本冲突；两者都按并集解决（他们的 `web`/`-p` 分支加上我们的默认 TUI 分支）。

## Testing

`packages/ui/app-boot/tests/personal-config.spec.ts` 固定 `!!js` 的保留与经真实启动树的端到端插值、insert 配置项、默认目录从 `$DSH_HOME` 解析、缺失/为空的无操作路径，以及三种响亮失败形态（不可读、不可解析、非数组）。`examples/tui-agent/tests/tui-keyless-smoke.e2e.ts` 在 PTY 里以三种方式启动 dsh bin：无 overlay 的默认配置、个人 `.env` + `config.yaml` 链条（打补丁的欢迎语渲染进横幅）、以及无效个人文件导致的响亮启动失败。既有冒烟与快照套件在一台真实 `~/.dsh` overlay 会改变启动模型的机器上通过——靠隔离，不靠运气。
