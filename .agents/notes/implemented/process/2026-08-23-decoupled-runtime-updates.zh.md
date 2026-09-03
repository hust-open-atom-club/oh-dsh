# Agent Note：解耦的应用内 DSH 运行时更新

Status: implemented

[English](2026-08-23-decoupled-runtime-updates.md) | 中文

## Problem

DSH 运行时在构建期固定，并随每个 Desktop 应用构建一起发布（#123）。
一个新的 DSH 版本——例如新的 Vision 模型——必须先发布完整的 Oh-DSH
Desktop 才能到达用户。

## Decision

- 由现有 release workflow 把暂存的运行时发布为独立 Release 资产
  `oh-dsh-runtime-<dshVersion>-<platform>-<arch>.tar.gz`（附带
  `.sha256`）。该 bundle 就是应用打包用的同一份 `.stage/dsh-runtime`
  树，因此 pnpm 装配、桌面插件注入、settings boundary 补丁和 Linux
  landlock 启动器仍在构建期完成。
- `dsh-source.mjs` 在每次暂存前重新解压已通过完整性校验的 npm assembly。
  tar 在 archive 与 extraction directory 的共同父目录下接收两个 basename，
  因而 Windows Git Bash 不会把 archive 参数中的盘符解释成远程主机。
- `src/runtime-update.ts` 在主进程新增 `RuntimeUpdateManager`：检查
  GitHub Release 中比当前运行时更新的最新 bundle，带进度下载，校验
  发布的 SHA-256，用系统 tar 解压到 `~/.ohdsh/runtimes/<version>/`，
  校验 manifest 版本，用内置 Node 冒烟执行 `dsh --version`，最后写入
  指针 `~/.ohdsh/runtimes/current.json` 并只重启 Harness 进程。
- 运行时选择：`main.ts#runtimePaths()` 优先使用通过校验的暂存运行时
  （指针 + `lib/bin.js` + manifest 版本一致），否则回退应用内置运行时；
  显式的 `OH_DSH_RESOURCES_ROOT`/`DSH_OH_WEB_ROOT` 覆盖仍然最高。
  Node 与 pnpm 始终随应用内置——运行时 bundle 只包含 `dsh-runtime`。
- 更新窗口新增 "DSH Runtime" 区块（与应用更新器相同的沙箱 preload
  与发送方校验 IPC 模式），提供 Check / Update / Use Bundled Runtime
  （回滚即删除指针并重启 Harness）。

## Consequences

- 每个 bundle 携带 `oh-dsh-runtime-manifest.json`（`dshVersion`、
  `bundledByAppVersion`、`runtimeContract`）。兼容性由 `package.json`
  中显式声明的 `runtimeContract` 契约版本（`ohDshRuntimeContract`）
  判定，而非应用包版本：bundle 内嵌本项目的表面插件，只有契约版本
  一致才能保证其边界。缺失 manifest 或契约不匹配的 bundle 以不可
  重试错误拒绝；安装错误会报告实际失败的阶段
  （download/verify/extract/activate）。运行时选择在每次启动时重新
  校验契约，契约升级后由旧应用暂存的 bundle 会自行失效。激活后的
  下载清理为尽力而为，绝不会把已提交的激活变成报错的失败。`workflow_dispatch` 的
  "Runtime release" 工作流可单独发布 bundle（tag 通过 `--target`
  固定到派发的提交），DSH 升级不再需要应用发版。Desktop 处于查看端
  （运行时锁被其他表面持有）时，IPC 边界拒绝
  `install`/`rollback`。
- 下载、校验和冒烟检查任何一步失败都不会改变当前生效的运行时；
  回滚只需删除一个指针文件。
- 运行时更新要求 Release 实际携带本平台的运行时 bundle；更早的
  Release 会显示"已是最新"。
- 指针位于共享数据根，后续 Web/TUI 表面经 Desktop 安装的启动器也可以
  识别它（它们目前解析各自的打包运行时）。
- 否决了应用内 `pnpm deploy` 方案：暂存运行时内嵌的 Oh-DSH 插件包的
  host 依赖是指向该运行时自身 pnpm store 的相对符号链接，运行时现场
  装配无法安全复用。

## Alternatives considered

- 在应用内运行完整 `stage-dsh.mjs` 流水线：需要仓库、curl、git 和
  `dist/` 产物；否决。
- 复用 marketplace 插件事务：marketplace 交换的是 profile bundle，
  不是承载该 profile 的基础运行时；基础运行时切换未复用，但"验证后
  激活"的形态与之一致。
- 向 tar 传绝对 Windows 路径并加 `--force-local`：不采用。release 在各平台
  使用宿主 tar 实现；切换到共同工作目录并传相对参数，无需依赖实现专属选项。
