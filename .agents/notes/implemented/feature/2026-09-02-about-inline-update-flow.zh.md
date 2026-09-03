# Agent Note: inline update flow on the About page

Status: implemented

[English](2026-09-02-about-inline-update-flow.md) | 中文

## Problem

Issue #178 要求在设置中提供自主升级入口。第一版在 About 页放了一个打开
独立软件更新窗口的按钮；后续补了页内检查与明确状态，但下载与安装仍发生在
窗口里。这种割裂让流程显得异常：页面回答了"是否有更新"，却把用户送到
另一个地方执行操作，且更新窗口的呈现与 About 页的结构互不匹配。

更早的两份记录（[Settings About page](2026-08-31-settings-about-page.md)、
[inline update check](2026-09-01-about-inline-update-check.md)）通过只向
主窗口暴露只读投影，把下载与安装保留在沙箱更新窗口内。

## Decision

About 页现在内联驱动完整的更新流程。投影（`AboutUpdateSnapshot`）携带下载
进度（percent、transferred、total、speed），命令面（`AboutUpdateCommand`）
恰好三个步骤：`check`、`download`、`install-now`。主进程处理器
`desktop:about-update:command` 用 `parseAboutUpdateCommand` 解析这个封闭
集合，并把 `install-now` 映射到更新窗口同款的
`scheduleImmediateUpdateInstall` 路径（退出应用，运行暂存的安装程序）。

About 卡片把流程渲染为一个状态机："检查更新"（idle / 无更新 / 出错后）→
"正在检查…"（禁用）→ "发现新版本 X" 附"下载更新" → "正在下载 N% — a of b"
（无按钮，进度由镜像的状态推送驱动）→ "新版本 X 已就绪，可安装" 附
"安装更新" → 退出并安装。Web 无桌面 bridge，不渲染更新卡片；`unsupported`
显示开发版提示，无按钮。

## Alternatives considered

**下载与安装保留在更新窗口**（上一个决策）。被产品所有者否决：先在此检查、
再去彼处执行的割裂流程看起来就像功能损坏，而 issue 要求的是设置中的自主
升级入口，不是第二个窗口的启动器。

**放宽 `assertUpdateWindowSender` 以复用更新窗口的
`desktop:update:command` 门禁通道。** 否决：那会把单发送方门禁变成双发送方
通道。本次为 About 开设了独立通道和独立的封闭命令集，更新窗口的门禁原封
不动，两个界面都无法调用对方的命令。

**检查发现更新后自动下载。** 否决：卡片把下载保留为显式的按钮步骤，与
要求的交互一致。

## Consequences

- About 页端到端满足 #178 的自主升级标准：检查、带进度的下载、安装全部在
  一张卡片内完成。
- 主窗口现在可以触发下载与安装——早前决策的核心保证（"主窗口无法发起
  下载"）被本决策取代。仍然保留的边界：更新源仍为 GitHub-only，不可达时
  经 release 镜像（gh-proxy generic provider）绕行；下载经
  electron-updater 的签名/校验和验证；安装走与更新窗口相同的
  退出加暂存安装程序路径。
- 镜像只服务一个更新周期（回退检查及其下载）；下一次检查会还原 GitHub
  更新源，瞬时的网络故障不会把客户端长期钉在第三方镜像上。镜像重试同时
  覆盖 Node 风格的网络错误码（`ENOTFOUND`、`ETIMEDOUT` 等），而不只是
  Chromium 的 `ERR_*`；磁盘满之类的本机故障（`ENOSPC`）不会触发重试。
- 更新窗口及其通道不受影响地继续工作；两者观察同一 manager，状态保持
  一致。
- `tests/about-page.test.ts` 锚定封闭命令集
  （`check | download | install-now`）、三条 IPC 通道，以及插件只调用
  这些命令。

## Testing

- `pnpm run typecheck`、`pnpm test`（283 通过；9 个为既有 Windows
  symlink-EPERM 失败）、`pnpm run build`。
- 本地端到端：0.0.1 打包版对 0.1.11 GitHub release——检查在 GitHub 超时后
  回落到 gh-proxy 镜像，报告 "Found version 0.1.11"，下载经镜像启动，
  增量 blockmap 缺失时自动转为全量下载。
