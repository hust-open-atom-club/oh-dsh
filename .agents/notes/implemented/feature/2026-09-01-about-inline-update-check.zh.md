# Agent Note: inline update check on the About page

Status: implemented

[English](2026-09-01-about-inline-update-check.md) | 中文

## Problem

设置 About 页此前唯一的更新入口是一个打开独立软件更新窗口的按钮。Issue #178
的验收标准要求"无更新时给出明确状态"——检查动作发生在另一个窗口里，About
页本身从未回答"当前是否为最新版本"，这个标准在为它而建的页面上没有达成。

更早的决策记录（[Settings About page](2026-08-31-settings-about-page.md)）
否决过把完整 `DesktopUpdateBridge` 暴露到主窗口，在那之前这个缺口一直无解。

## Decision

主进程向主窗口暴露一个只读为主的更新状态投影：
`desktop:about-update:get-state`（快照）、`desktop:about-update:check`
（触发检查）和 `desktop:about-update:state` 推送（镜像变化）。三者都限定
为主窗口 webContents 发送方，与 marketplace 通道同款门禁。投影类型
`AboutUpdateSnapshot` 只保留页面渲染所需的信息——状态、当前/最新版本、
错误——最初刻意省略 release notes、下载进度以及 `check` 之外的一切命令。
（后来的[内联更新流程](2026-09-02-about-inline-update-flow.md)为投影补上
了下载进度和封闭命令集；本记录保留最初的接缝设计。）

`window.dshDesktop.aboutUpdate` 承载这三个调用；About 页的更新卡片渲染
内联状态行与状态驱动按钮：空闲或检查失败时显示"检查更新"；检查或下载
进行中不显示操作按钮；无更新时显示"已是最新版本"。下载与安装最初仍只
发生在沙箱更新窗口内，现按上述后续记录在页面内完成。Web 没有桌面
bridge，照旧不渲染更新卡片。

## Alternatives considered

**向主窗口暴露完整 `DesktopUpdateBridge`**，让页面内联下载与安装。再次
否决，理由与之前相同：扩大受信 IPC 面，且重复更新窗口的展示。窄投影在不
付出这两个代价的前提下满足了 #178 的实际诉求。

**复用带门禁的 `desktop:update:get-state`/`command` 通道，放宽
`assertUpdateWindowSender` 接受主窗口。** 否决：这会把更新窗口的独占门禁
变成双发送方通道，削弱前一决策守护的隔离性。

**检查完成后让 About 页自动打开更新窗口。** 否决：窗口不请自来是敌意
行为；用户自己决定何时离开当前页面。

## Consequences

- About 页在页面内满足 #178 的"无更新时给出明确状态"标准：
  idle/checking/最新/可更新/错误全部内联渲染。（`available`/`downloaded`
  最初深链到承载特权操作的更新窗口；后来的[内联更新流程](2026-09-02-about-inline-update-flow.md)
  取代了该决策，卡片可在页面内下载并安装。）
- 新增三条主窗口 IPC 通道，均限定主窗口发送方；更新窗口自身的通道仍是
  独占。只读投影最初无法发起下载或安装——直到上述后续记录加入了封闭的
  `desktop:about-update:command` 通道（`check`、`download`、`install-now`）。
- 投影折叠了更新窗口的若干状态（`scheduled` → `downloaded`、
  `cancelled`/`unsupported`/终态 `error` → `idle`），卡片不会出现死胡同；
  完整状态机仍由更新窗口承载。
- `tests/about-page.test.ts` 最初锚定：两条通道存在、插件源码只调用
  `check`；后续记录放宽了命令集。

## Testing

- `pnpm run typecheck`、`pnpm test`（283 通过；9 个失败为既有 Windows
  symlink-EPERM 环境问题）与 `pnpm run build` 在 contracts、preload、
  main 与 About client 全链路接通后通过。
- `tests/about-page.test.ts` 新增上述只读投影测试。
