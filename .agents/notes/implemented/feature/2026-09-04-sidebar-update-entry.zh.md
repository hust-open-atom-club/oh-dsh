# Agent Note: 侧边栏更新入口——DOM 锚定的桌面端独立插件

Status: implemented

[English](2026-09-04-sidebar-update-entry.md) | 中文

## 问题

在 Oh-DSH Desktop 中,进入更新流程的唯一途径是应用菜单里的 "Check for
Updates…" 项(打开更新窗口),外壳内没有任何入口,远端有更新时容易被忽略。
issue 要求在侧边栏 "Collapse sidebar" 按钮正左侧加一个下载/更新按钮,展开态与
56px 窄栏态都要可见。

左侧边栏外壳(品牌行 + 折叠按钮 + New Session)由钉版上游
`@deepseek-ai/dsh-client-ui-sidebar` 的 `SidebarRoot` 渲染(桌面为何用
`desktop-frame` 替换上游布局,由 [根框架 v21 note](../architecture/2026-08-18-desktop-root-frame-v21.md)
负责)。`SidebarRoot` 在 logo 行内没有声明任何插槽——只有
`sidebar.brand.mark/name`、`sidebar.workspaces`、`sidebar.settings`、
`sidebar.footer.action`——且 `upstream/` 已钉版、不可修改。窄栏内容区只有
36px 宽,每行恰好容纳一个 36x36 控件,第二个图标无法与折叠按钮共享同一行。

## 决策

交付一个新的桌面端专用插件 `plugins/update-button`
(`@oh-dsh/update-button`),遵循"一个能力一个插件"的惯例(先例:`plugin-marketplace`
将组件注册进上游外壳声明的 `sidebar.footer.action` 插槽)。

- **组合。** 仅在桌面 profile 启用:在根 `cordis.patch.yml` 插入
  `oh-update-button`,加入 `scripts/stage-runtime-lib.mjs` 的
  `SURFACE_PACKAGE_NAMES.desktop` 与插件装配目录、`src/profile.ts` 的
  `BUNDLED_DESKTOP_CLIENT_PLUGINS`、构建与 stage 产物清单(`scripts/build.mjs`、
  `scripts/stage-dsh.mjs`)以及 stage-runtime-lib 测试夹具。Web 面有意排除它
  (浏览器面没有更新窗口)。
- **位置。** 两个彼此无关的独立图标实例,每个折叠态一个(只加载、绝不搬动)。
  宽态:28px 下载控件,在 logo 行内紧贴折叠按钮左侧,仅在品牌按钮已存在时
  加载,因此永远不会落到 logo 前面。收起态:36px 下载控件,在鲸鱼正下方自己的
  行里(仿上游 New Session 行;36px 窄栏每行只放一个控件)。显隐由
  `data-sidebar-collapsed` 属性经 CSS 决定。活折叠时宽实例立刻离开 logo 行
  (用一个脱离布局的克隆在原位淡出,与行 150ms 淡出同步),窄实例按上游
  `.railIn` 节奏从右滑入(150ms 延迟 + 150ms 从 `translateX(49px)` 滑入)。
  仅当 React 重挂品牌把宽 host 留在行首时,一个窄范围的顺序保护才把它移回
  "品牌与折叠钮之间"。早前版本(单 host 搬家、隐藏/显示时机、footer 插槽)
  按维护者反馈被此设计取代;两个座位的图标图案已统一为下载图形。
- **动作。** 点击调用 `DesktopBridge.openUpdater()`,打开既有更新窗口;窗口
  内部总是执行 `manager.check()`,因此直接复用既有的"检查 → 下载 → 安装"
  流程,无需新增 IPC。
- **呈现。** hover/focus 气泡复刻上游 primitives `Tooltip` 的 token 与几何
  (13px、`--dsw-alias-tooltip-bg`、静态标签墨色、右侧、150ms 淡入;hover
  500ms、focus 立即)。文案通过插件自己的 `oh-dsh.update-button` locale 字典
  本地化。

## 备选方案

- **修改钉版 `upstream/` 以新增 logo 行插槽。** 否决:`upstream/` 是钉版
  源码;Oh-DSH 应把上游行为适配进 `plugins/`。
- **注册进某个既有的上游插槽。** 否决:声明的插槽没有一个位于折叠按钮旁
  (`footer.action` 在侧边栏底部)。
- **为加一个插槽而复制整个 `ui-sidebar` 外壳。** 否决:跟随钉版 npm 版本
  的维护成本过高。
- **把入口留在 `plugins/desktop-frame` 内。** 首个实现后否决:外壳类职责
  应归属独立的能力插件(按维护者意见迁移)。

## 后果

- 上游 `SidebarRoot` 的 DOM 结构成为隐式依赖;定位器按形状做保护(行末是
  (或包含)按钮、且不是所在列的最后一排的小控件行),结构漂移时静默放弃。
- 在 React 管理的行内放外来节点,需要"加载时落座 + 顺序保护"(而非持续
  重新落座);窄栏"每行一个 36x36 控件"的几何规则不可打破;logo 行内的宽
  实例是 wide-only 内容,必须在窄栏布局形成前离开该行。
- 更新态渲染已随入口交付,并且**纯粹由快照驱动**:经
  `DesktopBridge.aboutUpdate`(状态推送 + 初始快照)收到的状态里,idle /
  not-available / checking / error 时两个图标隐藏,available / downloading /
  downloaded 时显示并带红点;管理器上报 `unsupported`(dev / 非打包运行、
  以及不支持平台的打包版)时,以**无红点的可见入口**呈现——可点但绝不谎称有
  可安装的更新。**没有 dev 模拟**:无快捷键、无 localStorage 覆盖,正式版与
  dev 走同一条代码路径,任何测试性出口都不会漏进发布构建。
