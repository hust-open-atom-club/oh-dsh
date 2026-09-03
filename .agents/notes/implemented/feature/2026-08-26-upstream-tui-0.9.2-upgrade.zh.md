# Agent Note: 将 pinned dsh-TUI renderer 升级到 0.9.2

Status: implemented

[English](2026-08-26-upstream-tui-0.9.2-upgrade.md) | 中文

## Problem

固定版本仍停在 0.9.0（由
[0.9.0 升级](2026-08-24-upstream-tui-0.9.0-upgrade.md)决策）；上游 0.9.2
新增会话身份（`/color`、`/recap`）、大段粘贴折叠、悬停交互、内置 OAuth 登录包
（`dsh-auth`）、`pi-ai` 订阅 LLM 路由、`/reload` 与 `/restart`，并修复了上游
`/update` 预置在 pnpm ≥ 11 下的 `ERR_PNPM_IGNORED_BUILDS` 阻断。

## Decision

- 将子模块与已发布 npm renderer 一起固定到 v0.9.2；嵌套的
  `dsh-ecosystem-spec` gitlink 移至 `2d0236f7`，`vendor/dsh-std` 不变，新嵌套
  `dsh-auth` gitlink（`fba02bcf`）随递归子模块更新取得。
- `pnpm-workspace.yaml` 的 `allowBuilds` 将两个新的传递依赖记为 `false`：
  `@google/genai` 与 `protobufjs` 均为纯 JS 包，其 postinstall 脚本对任何面的
  暂存与运行都不需要。
- 暂存依赖镜像在受限 `exports` 映射把 `./package.json` 与 main 入口都对
  `require.resolve` 隐藏时（`@earendil-works/pi-ai` 是首个此类依赖），改为从
  发起解析的包沿 node_modules 链向上查找。
- 内置 `dsh-auth` 按 renderer `link:./dsh-auth` 解析产生的嵌套副本暂存；Nix
  把已发布的 `@deepseek-harness-tui/dsh-auth@0.1.0` 包挂载进仓库形状的
  staging root，与 renderer 使用相同的已发布产物模式。
- 根 pnpm workspace 纳入嵌套 `dsh-auth` 包，并在 shared lockfile 中记录其
  importer。pnpm deploy 会把 renderer 的 `link:./dsh-auth` 改写成 file 依赖；
  显式 workspace 成员关系在保留固定子模块源码的同时，为该依赖提供锁定归属。
- 带守卫的 renderer 适配器学习新 `/restart` 命令描述的重写；0.9.2 的其他
  新增均无需适配。
- 不采纳上游的 fullscreen 默认翻转（上游默认改为开启）：Oh-DSH 启动器保持
  inline 为默认，并始终显式设置 `OH_DSH_TUI_FULLSCREEN`（Cordis patch 与
  renderer 适配器读取的变量；`DSH_OH_TUI_FULLSCREEN` 只是启动器的输入别名）。

## Alternatives considered

**采纳上游 fullscreen 默认。** 不采纳：Oh-DSH 的 inline 启动、保留 scrollback
的通知以及启动器契约都围绕 inline 默认构建；对传 `--fullscreen` 的用户没有
任何变化。

**把暂存的 `link:./dsh-auth` 依赖改写成发布态的 `"*"`。** 不采纳：嵌套副本在
运行时已可解析，且暂存 manifest 与固定源保持逐字节一致；只有 Nix 组装需要
发布形态。

**对 Windows 依赖闭包使用 pnpm legacy deploy。** 不采纳：legacy deploy 不使用
shared workspace lockfile，且 pnpm 11.21 会把嵌套包保留为指向源码的 link。
既有复制虽可解引用该 link，但依赖解析将不再受根 lockfile 固定。

## Consequences

- TUI 在既有 Oh-DSH 启动器契约下获得 0.9.2 特性（会话身份、recap、粘贴折叠、
  悬停交互、`/auth` OAuth 登录、`/reload`、`/restart`）；已在 pty 中用 Liangshen
  预设验证引导。
- Nix 组装已端到端验证：sidebar、renderer、ecosystem-spec 与 dsh-auth 源的
  fetchFromGitHub 树哈希以及 `fetchPnpmDeps` 闭包哈希均由真实 `nix build`
  刷新，完整 `oh-dsh` 包构建通过——这也是 dsh-context Nix 集成首次经真实
  构建验证。
- liangshen 预设修订号移至
  `liangshen-toolcall-full-catalog-subagents-durable-hint-v5`（持久的指令提示
  去重），Oh-DSH 侧测试无需改动。
- Windows TUI release 暂存通过确定性的 shared-lock deploy 路径保留 renderer
  内置的 `dsh-auth`。暂存契约测试同时固定 workspace 成员与 lockfile importer，
  Windows 目标的完整暂存运行覆盖真实 deploy 路径。
