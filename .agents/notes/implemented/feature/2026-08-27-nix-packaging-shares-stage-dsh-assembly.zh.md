# Agent Note：Nix 打包与 stage-dsh 共享运行时组装

Status: implemented

[English](2026-08-27-nix-packaging-shares-stage-dsh-assembly.md) | 中文

## Problem

`nix/oh-dsh.nix` 用一条平行的管线组装打包运行时——`register-plugins.py`
（硬编码的插件目录与各 surface 集合）、`collect-deps.py`、手工 pnpm 暂存、
手工合并的运行时依赖清单——与 `scripts/stage-dsh.mjs` 的布局逻辑重复。两份
事实源持续漂移：desktop-frame、tui-marketplace、plugin-marketplace 曾缺席
Nix 注册表；pnpm 没有暂存到 `node-runtime/lib/node_modules/pnpm`；Landlock
argv 缺 `/dev/null`。官方的每一次 staging 变更都要用 Python 和 shell 重写一遍。

## Decision

把 `stage-dsh.mjs` 的运行时暂存操作抽到 `scripts/stage-runtime-lib.mjs`。
`createStageRuntime(context)` 闭包持有暂存上下文（`root`、`stage`、
`runtime`、`nodeRuntime`、`dshSource`、平台标志、`npmRelease`、
`run`、`adapters`），导出与发布管线完全相同的函数——`installDesktopPackages`、
编译包/宿主依赖安装器、`alignBetterSidebarPtyDependency`、
`exposeHoistedPackages`、`recordExposedDependencies`、
`ensureLinuxLandlockLauncher`、`ensureLinuxPtyBuild`、
`stagePnpmIntoNodeRuntime`、`restoreExecutableHelpers`、
`pruneRuntimeDevelopmentFiles`、`assertSelfContained`——外加作为唯一
surface-package 事实源的 `SURFACE_PACKAGE_NAMES`，以及供离线消费方使用的
小型 CLI 子命令（`install-packages`、`stage-pnpm`、
`restore-executable-helpers`）。

`stage-dsh.mjs` 只保留网络获取（Node 下载、DSH npm tarball、pnpm
install/deploy）、裁剪与冒烟；所有布局决策都委托给工厂。

Nix 消费同一个工厂。bundle 派生把已发布的 release 树（dsh-TUI renderer 及其
打包好的编译 `@dsh-std` node_modules、dsh-auth、dsh-context）覆盖到仓库形状的
staging root 上，复制选定的 DSH 运行时源，并运行 `install-packages
--release-graph` 与 `restore-executable-helpers`。final 派生通过
`stage-pnpm` 暂存 pnpm，并运行 `SURFACE_PACKAGE_NAMES` parity 守卫：任何
surface package 缺失都会让构建失败。`register-plugins.py` 与
`collect-deps.py` 删除；final 派生引用整个 `scripts/` 目录，保证组装器的
相对导入能从 store 副本解析。

对抽取代码的唯一刻意偏差：`runtimeDependencyTarget` 用 `existsSync()`
保护 `.pnpm` store 扫描，使无 pnpm store 的扁平运行时抛出描述性错误而非
`ENOENT`。

## Alternatives considered

**在 Nix 中原样运行 `stage-dsh.mjs`。** 不采纳：顶层副作用与 Node/DSH
tarball 的 `curl` 下载无法在离线 Nix 沙箱内执行。

**保留 `register-plugins.py` 只加 parity 测试。** 不采纳：surface 布局仍有两份
事实源；下一次加插件时漂移会重来。

**把 workspace 的 `node_modules` 送进 final 派生。** 不采纳：增加约 1GB 的
store 闭包；bundle 级组装只多一份运行时副本。

## Consequences

- 桌面插件清单、pnpm 布局、Landlock argv、依赖接线（包级 `.oh-dsh-store`
  副本、宿主依赖走运行时图）以及 profile-fallback 依赖清单，现在只有一份由
  发布管线与 Nix 共享的实现；Nix 构建对 parity 漂移 fail-closed。
- Nix 组装不再需要 `python3`；`collect-deps.py` 的传递闭包复制由
  `installCompiledPackageDependencies` 取代。
- `tests/stage-runtime-lib.test.ts` 取代 `tests/nix-register-plugins.test.ts`
  与 `tests/nix-collect-deps.test.ts`；`tests/landlock-launcher.test.ts`、
  `tests/settings-boundary.test.ts`、`tests/liangshen.test.ts`、
  `tests/stage-surface.test.ts` 改为钉住共享组装器。
- renderer 的私有 `dsh-auth` 依赖改由共享依赖安装器提供，见
  2026-08-26-bundle-dsh-auth。本笔记部分取代 2026-08-24-cross-surface-liangshen-preset、
  2026-08-25-bundle-dsh-context 与 2026-08-26-bundle-dsh-auth 的 Nix 机制章节；
  它们的 surface 归属决策仍然有效。
- 验证：CI typecheck、`node --test`（仅沙箱受限的 `install-sh` 测试失败）、
  `pnpm run build` 通过；对原始 llm-agents 运行时副本执行 `install-packages
  --release-graph` 冒烟无缺失 surface package；Nix 包构建通过
  （`oh-dsh-desktop-0.1.10`），组装后的运行时通过 parity 守卫，pnpm 11.21.0
  暂存于发布路径，renderer 编译入口（`lib/types/index.js`）齐全，sidebar 的
  依赖 store 保持包级，并在 Landlock 启动器下正常启动（0.1.0-rc.7）。
