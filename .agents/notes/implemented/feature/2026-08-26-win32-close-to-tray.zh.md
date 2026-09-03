# Agent Note: Windows 关闭窗口最小化到系统托盘

Status: implemented

[English](2026-08-26-win32-close-to-tray.md) | 中文

## 问题

在 Windows 上，所有关闭手势——自定义标题栏的 × 按钮、应用菜单的"关闭窗口"role，以及它们最终汇入的 `desktop:window-close` IPC——都会完整执行 `window.close()`，随后 `window-all-closed` 触发、整个应用退出，被监管的 DSH 运行时与所有活跃会话一并被带走。在 × 上的一次误点击就摧毁了工作台状态，且没有任何提示告诉用户关闭窗口意味着退出整个进程树。Windows 上的桌面工作台类应用惯例是从系统托盘保持运行。

## 决策

关闭到托盘是 `src/main.ts` 中纯主进程的决策。win32 上在 `app.whenReady()` 之后创建 `Tray`（图标：打包后的 `resources/oh-dsh-desktop.png` 或开发时的 `assets/icons/16x16.png`，缩放到主显示器 `16 × scaleFactor` DIP）；macOS 与 Linux 永远不会创建。主窗口的 `close` 处理器只在托盘存在、窗口不是插件预览、且没有退出正在进行时调用 `event.preventDefault()` + `window.hide()`——其余情况关闭行为与之前完全一致。托盘持有隐藏窗口期间 `window-all-closed` 不再退出（退出进行中除外），`will-quit` 销毁托盘，进程结束后不会残留孤儿图标。托盘的单击与其菜单（**显示主窗口** / **退出**）与 macOS 的 `activate` 路径共享 `revealMainWindow()`；二次启动经既有的 `second-instance` 处理器重新聚焦隐藏窗口。每个会话的首次隐藏会展示一次 `displayBalloon` 提示，告知应用仍在托盘运行。托盘标签与应用菜单共用同一张双语 `labels()` 表，并在每次 `buildMenu()` 重建时同步，因此托盘跟随菜单语言。渲染层、preload 与 contracts 零改动：`desktop:window-close` 仍只是调用 `window.close()`，隐藏还是退出完全由 Electron 主进程决定——契合 desktop-titlebar 的边界：渲染层拥有 chrome 行，Electron 拥有 BrowserWindow 生命周期。图标缺失或为空时 `createTray()` 返回 `undefined`，静默回退为普通的关闭即退出，而不是让窗口困在无处可去的状态。`tests/desktop-tray.test.ts` 用静态断言固定拦截门、退出路径、回退与双语菜单。

## 考虑过的替代方案

- **全平台托盘。** 否决：macOS 本就让应用常驻 Dock 并以 `activate` 揭示，Linux 的托盘支持取决于桌面环境（GNOME 默认无扩展即无托盘）；仓库规则要求 macOS/Linux 行为逐字节保持不变，而这个问题只存在于 Windows。
- **关闭确认对话框（退出还是最小化）。** 否决：它打断每一次关闭；托盘加一次性 balloon 提示在事后达成同样的知情选择。
- **控制关闭行为的用户偏好开关。** 暂时否决：需要跨 surface 的设置存储与 UI，收益有限，还会新增 data-root 规则所不建议的持久化偏好面。
- **把最小化也路由到托盘。** 否决：最小化到任务栏是 Windows 的用户预期；只有 × 背后的退出意图被重定向，语义保持在单一可审计的位置。
- **在 `DesktopBridge` 上暴露托盘 API 给渲染层。** 否决：隐藏还是退出的决策属于 Electron 生命周期而非页面；纯主进程拦截是最小 diff，并让 bridge 契约保持冻结。

## 后果

- Windows 用户关闭窗口后，DSH 运行时与会话在托盘中保持存活；通过托盘或应用菜单的退出均可退出，两者都到达 `app.quit()` 并走既有的有序停机（包括 install-on-quit 更新，它们经 `quitting`/`quittingForUpdate` 门绕过拦截）。
- macOS 与 Linux 行为不变；托盘图标加载失败时降级为旧的关闭即退出，而不是卡死的隐藏窗口。
- 运行时死掉的隐藏窗口在下一次揭示时显示错误 splash；`revealMainWindow()` 只显示既有窗口，绝不在用户背后重建。
- 自动化覆盖只有静态断言；真实托盘渲染、balloon 行为与多显示器 DPI 需要在发布前于 Windows 上手动冒烟。
