# Agent Note: 设置中的关于页与构建期注入的版本信息

Status: implemented

[English](2026-08-31-settings-about-page.md) | 中文

## Problem

用户无法在 Settings 里查看自己正在运行的版本：Oh-DSH 产品版本、固定的上游
DeepSeek Harness 版本（`dsh-source.json`）、内置插件版本
（`plugins/*/package.json` 以及固定的上游 `dsh-context` 与 `dsh-auth`）、
关键工具链依赖版本，全都看不到。原生 About 对话框和菜单项几乎不承载信息，
更新流程也只存在于应用菜单的“检查更新…”和独立更新窗口里。Issue #178 要求
新增一个 About 设置分区，展示这些信息并提供自助升级入口。

## Decision

新增纯 client 插件 `plugins/about`（`@oh-dsh/about`），在 Desktop 与 Web 两
个组合层上注册一个 `settings.section` 条目（id `oh-dsh-about`，order 90，
命名空间 `oh-dsh.about`）。分区渲染居中的 hero（品牌标识、产品名、副标题、
版本徽章）、展示上游 DSH 固定版本及其 npm 包的「运行时信息」卡片、带两张
可展开行（内置插件、关键依赖，点开 chevron 展示版本表）的「组件」卡片、
「软件更新」卡片，以及带 GitHub 与许可证链接的页脚。所有颜色均来自 DSH
主题 token（`--dsw-alias-brand-primary`、`--dsw-alias-state-success-*`、
label/border/background 系列 alias），页面跟随当前主题与深色模式；只有
`var()` 回退值携带字面量 hex。

版本数据从不在运行时读取文件。`scripts/build.mjs` 在构建期读取仓库清单，
在既有 `__OH_DSH_BUILD_VERSION__` 之外注入四个 esbuild `define` 常量：
`__OH_DSH_SOURCE_VERSION__` 与 `__OH_DSH_SOURCE_PACKAGE__`（固定上游发布
的版本号与 npm 包名，来自 `dsh-source.json`）、
`__OH_DSH_PLUGIN_VERSIONS__`（每个 `plugins/*/package.json` 加上固定的上游
submodule 清单，排序后注入）和 `__OH_DSH_DEPENDENCY_VERSIONS__`（根清单中
的 electron、electron-updater、semver）。`plugins/about/src/client/versions.ts`
声明这些常量并做防御性解析。submodule 缺失只会让对应行消失，不会让构建
失败。

Desktop 的更新入口通过一条新的、带发送方校验的 IPC 通道复用既有主进程能
力：`desktop:open-updater` 校验发送方是主窗口后调用既有的
`openUpdateWindow()`。（About 更新卡片此后已改走自己的内联通道，见
[内联更新流程](2026-09-02-about-inline-update-flow.md)。）外部链接走既有
的 `openExternal` bridge，Web 端回退到 `window.open`；本分区不添加配置目
录按钮——设置外壳已自带该动作。Web 端没有 `window.dshDesktop`，更新卡片
不渲染，hero、版本卡片与页脚链接照常显示。

## Alternatives considered

**把完整的 `DesktopUpdateBridge` 暴露给主窗口渲染进程**，让 About 页面内
嵌实时更新状态和下载进度。否决：这会扩大受信任的 IPC 面（要么放松
`assertUpdateWindowSender` 门禁，要么为第二个发送方复制通道），并且为了
有限的 UX 收益重复实现更新窗口的整套状态呈现。更新窗口已经双语渲染
checking/not-available/download/install 各状态。

**运行时从仓库或 staged 文件读取版本**（扫描 `node_modules`、从磁盘解析
`dsh-source.json`）。否决：打包后的应用不携带仓库布局，每个 surface 都要
实现各自的文件发现路径，文件缺失或移动会让页面残缺。构建期注入是完备的：
client bundle 自带事实，Web 发行版也不依赖任何文件系统。

**构建期用 `git describe` 读取 submodule 修订号**，与
`THIRD_PARTY_NOTICES.md` 的提交钉扎对应。推迟：这会让构建依赖完整的 git
checkout（CI 的浅克隆和源码包会失败或回退），而且 submodule 内的包清单已
经携带两个上游插件的权威版本。

**把 About 页面并入现有插件**（sidebar 或 desktop-frame）。否决：设置分
区按契约由 feature 自持；跨切面的版本清单本身就是独立 feature，独立挂载
也让组合层可以自由去掉它。

## Consequences

- About 清单在构建期固化：运行中的安装展示的是它构建时的版本，而不是实
  时的包管理器状态。对打包发行版而言这正是想要的“如实呈现”，但安装后手
  改 `node_modules` 的用户会看到过期标签。
- 新增内置插件或升级关键依赖后，下一次构建自动更新 About 页面，无需改代
  码；新增一类版本事实（例如 submodule 修订号）才需要扩展
  `aboutVersionDefines` 和插件的 props。
- 新增一条主窗口 IPC（`desktop:open-updater`），与 marketplace 同类通道
  一样做发送方校验；更新窗口的隔离完好无损。（About 页面此后获得了自己
  的内联更新通道与封闭命令集；`desktop:open-updater` 保留给旧调用方。）
- 测试锁定契约：`tests/about-page.test.ts` 守护分区注册、四个注入常量、
  更新 IPC、主题 token 驱动的样式和两个组合层；
  `tests/stage-runtime-lib.test.ts` 与 `scripts/smoke-web.mjs` 把新包纳入
  surface 清单；`scripts/smoke-runtime.mjs` 通过
  `BUNDLED_DESKTOP_CLIENT_PLUGINS` 端到端验证插件加载。
- TUI 仍不在范围内：其启动横幅已打印运行时版本，且其设置机制是上游适配
  器体系而非浏览器 slot 图。

## Testing

- `pnpm run typecheck`、`pnpm test`（`tests/stage-runtime-lib.test.ts` 与
  `tests/tui-install.test.ts` 中既有的 Windows symlink-EPERM 失败在干净
  checkout 上同样复现）、`pnpm run build`、`pnpm run smoke:runtime` 与
  `pnpm run smoke:web` 在两个 surface 均启用插件的情况下全部通过。
