# Agent Note: Codex 风格质感层与 macOS 边到边窗口

状态：已实现

[English](2026-09-11-codex-finish-layer.md) | 中文

## 问题

Desktop 表面还带着 0.1.2 时代的窗口装饰：页内标题栏填充条 + 1px 分隔线、
窗口 1px 外框、带边框的侧栏、描边式按钮。用户要求换成 ChatGPT desktop
（Codex）的质感——亮度分离、多层柔和阴影、连续圆角、干净的顶部边缘——
并且 Web 和 Desktop 两个表面都要。

## 决策

参考设计系统直接从本机安装的 ChatGPT.app `app.asar` 提取
（其 `webview/assets/*.css` 携带完整令牌集），而不是对照截图目测：

- `corner-shape: superellipse(1.5)` 配 1.25× 圆角缩放，包在
  `@supports` 门内；圆角阶梯 2xs–4xl 基于 0.25rem 网格。
- 高度令牌：0.5–1px 描边环 + 两层漫射阴影；composer 阴影即 ChatGPT
  原值 `0 0 0 1px #0000000a, 0 2px 8px #0000000a, 0 4px 80px 8px
  #00000006`。
- 中性灰表面靠亮度阶梯区分，不用边框。
- 动效曲线 `cubic-bezier(0.2, 0.8, 0.2, 1)`。

`plugins/skins/src/client/finish.css`（由 skins 客户端插件注入到每个
表面）持有该层：质感令牌、侧栏行 squircle、无框侧栏按钮、composer
阴影、浮层面板阴影。它只寻址运行时承诺的结构钩子
（`[data-slot]`、`[data-composer-card]`），绝不碰哈希 CSS-module 类名。
每个 skin 的 `--dsw-specific-sidebar-fill` 改为比画布低一档，激活行
做亮度提升（浅色皮肤为白色药丸），替换掉“同色填充”——正是它逼着
边框存在的。

macOS 窗口沿用同一 asar 里 ChatGPT 主窗口的配方：
`titleBarStyle: 'hiddenInset'` + `vibrancy: 'menu'` +
`acceptFirstMouse: true`。页内标题栏条、分隔线、窗口外框全部移除；
由 frame 的三个列在内部保留 40px chrome 行，让侧栏填色一直铺到窗口
边缘、红绿灯悬浮其上。Windows 保留原有页内标题栏不变。
`DEFAULT_UI_ZOOM_FACTOR` 从 1.12 降为 1：非整数设备缩放会把所有
1px 发丝线碎成虚线状——即用户报告的“composer 虚线边框”。

Desktop frame 比例收紧（侧栏默认 280→260px，右栏默认 360→420px），
侧栏去掉右边框，右列改为发丝线 + 向左漫射阴影浮在画布上。

## 否决的备选

- 样式化运行时哈希类（`hHd-Xa_*`、`uV2eYG_*`）：每次运行时 pin 升级
  都会静默失效；结构钩子则能存活。
- `titleBarStyle: 'hidden'` 不加 vibrancy：窗口失焦时 macOS 仍会在
  内容上绘制原生标题栏材质。
- 保留 1.12 缩放并去掉描边环：描边环是参考观感的组成部分；整数
  缩放才治本。

## 后果

- Web 与 Desktop 都通过已加载的 skins 插件获得该层；表面适配器仍
  持有渲染权，符合架构规则。
- 偏好更大默认界面的用户需要显式缩放（此前的 1.12 是任意值，不是
  无障碍承诺）。
- skins 测试改为断言亮度阶梯（侧栏填充 ≠ 画布、显式 hover/active
  行），不再是填充 === 画布。
- ChatGPT.app 的 asar 仅作为设计参考在本地读取；未向仓库复制任何
  资产或代码。
