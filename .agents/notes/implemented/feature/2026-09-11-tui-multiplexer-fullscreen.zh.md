# Agent Note: 多路复用器内 TUI 默认使用替代屏幕

Status: implemented

[English](2026-09-11-tui-multiplexer-fullscreen.md) | 中文

## 问题

用户在 zellij 中运行已安装的 `ohdsh tui`（0.2.1，dsh-TUI beta.4）时
inline 渲染错乱：输入框和状态行钉在窗格**顶部**，流式帧锚定在提示符上方
并不断向上爬（"老是从下往上跑"）。inline 渲染器依赖光标/尺寸探测把每帧
定位在提示符光标附近，而多路复用窗格对这些探测的应答与普通终端不同，
帧锚定因此反转。dsh-TUI beta.4 与 v0.10.0 都没有多路复用器处理；上游
有意不给 fullscreen 默认值，落回由 launcher 拥有的
`OH_DSH_TUI_FULLSCREEN`，所以这个选择属于 Oh-DSH launcher。

## 决策

`src/tui.ts` 的 `parseTuiArgs` 在环境显示多路复用器时把 `fullscreen`
默认为 true——设置了 `ZELLIJ`/`ZELLIJ_SESSION_NAME`/`TMUX`，或 `TERM`
以 `screen`/`tmux`/`zellij` 开头——普通终端仍默认 inline。替代屏幕完全
绕开 inline 锚定。优先级不变：显式的 `--fullscreen`/`--inline` 标志或
`DSH_OH_TUI_FULLSCREEN` 始终优先于新默认值。`--help` 文案写明两种默认。

## 后果

- tmux/zellij/screen 用户不加参数即可得到布局正确的 TUI；滚动发生在
  替代屏幕内而不是宿主回滚区，这是多路复用器会话的标准取舍。
- `--inline` 仍然可用，供想在多路复用器里保留回滚区并接受锚定怪癖的
  用户选择。
- 修复随携带它的版本发布；已安装的 0.2.1 在升级前保持旧行为。

## 考虑过的替代方案

- **给 inline 渲染器补多路复用器探测处理。** 否决：锚定逻辑分布在钉版
  上游 ink fork 的多个接缝里；各多路复用器的光标应答模拟互不相同，
  下游持续适配非常脆弱。
- **全局默认改为全屏。** 否决：普通终端里的 inline 回滚是 Oh-DSH 的
  文档化默认且工作正常；只有多路复用窗格会错乱。

## 测试

`tests/tui.test.ts` 覆盖默认矩阵：普通环境 → inline；`ZELLIJ`、`TMUX`、
`TERM=screen-256color` → 全屏；`ZELLIJ=1` 下显式 `--inline` 和
`DSH_OH_TUI_FULLSCREEN=0` 仍然生效；`TERM=xterm-256color` 保持 inline。
完整测试与 typecheck 通过。
