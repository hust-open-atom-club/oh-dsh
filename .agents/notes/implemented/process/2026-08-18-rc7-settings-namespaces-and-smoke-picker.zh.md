# Agent Note：rc7 设置命名空间、发布年龄策略与 smoke 选择器流程

Status: implemented

[English](2026-08-18-rc7-settings-namespaces-and-smoke-picker.md) | 中文

## Problem

将固定运行时升级到 DSH 0.1.0-rc.7 暴露了三处适配：rc7 用动态命名空间服务
取代了 api-proxy 的固定设置白名单；rc7 包发布在 pnpm minimumReleaseAge
窗口内；hero 工作区选择器的交互对浏览器自动化发生了变化。

## Decision

- **设置命名空间**：rc7 的 dsh-host-apiproxy 通过 settings.describe() 动态
  服务所有已注册命名空间，取代固定 WEB_SETTINGS_NAMESPACES 白名单。staging
  期的 exposeVisionSettingsNamespace 补丁（rc6）已过时并移除；vision 与
  humanize 命名空间在 host 侧注册后自动被服务。
- **发布年龄策略**：固定 assembly 的 pnpm-workspace.yaml 现在镜像仓库的
  minimumReleaseAgeExclude（'@deepseek-ai/*'），新发布的 rc 版本无需等待
  年龄截止即可安装。
- **Smoke 选择器流程**：rc7 把 hero 工作区选择器的打开绑定到触发器
  textarea（点击卡片不再生效），且非可信点击偶尔不命中，因此
  scripts/smoke-client.cjs 在卡片与 textarea 之间交替点击、aria-expanded
  翻转为 true 后停止、绝不把已打开的 picker 再点关。这使 browse 交互
  （CI）确定化，并让 native 交互（有桌面的 macOS/Windows）在 OS 对话框
  完成时走通。

## Consequences

- Staging 不再修改部署后的 api-proxy；命名空间暴露由 rc7 组合负责。
- rc 发布后可立即安装 assembly。
- desktop/web smoke 在 rc7 上通过（本地验证 check:plugins 与 smoke:web
  全绿；CI 在 Linux 上运行 browse 交互）。

## Alternatives considered

- 按 rc7 锚点继续打补丁：该机制已不存在，无可锚定；拒绝。
- 等待发布年龄截止而非豁免：每次 rc 发布后最多阻塞一天；拒绝。
- 由 smoke 驱动原生 OS 目录对话框：平台相关且脆弱；拒绝。
