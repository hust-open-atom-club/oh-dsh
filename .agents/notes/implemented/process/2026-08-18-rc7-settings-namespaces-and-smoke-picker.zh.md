# Agent Note：rc7 设置命名空间边界、发布年龄策略与 smoke 选择器流程

Status: implemented

[English](2026-08-18-rc7-settings-namespaces-and-smoke-picker.md) | 中文

## Problem

将固定运行时升级到 DSH 0.1.0-rc.7 暴露了三处适配：rc7 的 api-proxy 用动态
命名空间服务取代了固定设置白名单，移除了 rc.6 的配置客户端边界；rc7 包发布
在 pnpm minimumReleaseAge 窗口内；hero 工作区选择器的交互对浏览器自动化
发生了变化。

## Decision

- **设置命名空间边界**：rc7 的 dsh-host-apiproxy 通过 settings.describe()
  动态服务所有已注册命名空间，并接受对任意命名空间的设置写入；rc.6 的
  staging 补丁（exposeVisionSettingsNamespace）只是向上游白名单追加一个
  命名空间，已无法表达该边界。staging 现在执行 restoreSettingsBoundary()，
  在部署后的 api-proxy 上重建完整显式白名单：settings.describe 把命名空间
  过滤到 Web 偏好、产品与插件白名单加上模型提供方命名空间，且每个设置写入
  （update/replace/mutate）对其他命名空间一律以 `settings-not-exposed`
  拒绝。白名单为 WEB_SETTINGS_NAMESPACES（agent-loop、shell、locale、
  permission、ui-conversation、ui-theme、web-search-deepseek）、
  PRODUCT_SETTINGS_NAMESPACES（ui-onboarding、settings）以及
  oh-dsh-vision，与 rc.6 的 exposedNamespaces() 并集一致。这让
  [2026-07-30-config-plane-boundaries.md](../architecture/2026-07-30-config-plane-boundaries.md)、
  [2026-08-10-web-plugin-configuration.md](../feature/2026-08-10-web-plugin-configuration.md)
  与
  [2026-07-31-permission-default-for-new-sessions.md](../feature/2026-07-31-permission-default-for-new-sessions.md)
  记录的配置客户端边界保持成立：注册插件默认仍然不能远程读写自己的配置。
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

- Staging 再次修改部署后的 api-proxy；由显式白名单而不是注册插件决定
  命名空间是否到达配置客户端。
- rc 发布后可立即安装 assembly。
- desktop/web smoke 在 rc7 上通过（本地验证 check:plugins 与 smoke:web
  全绿；CI 在 Linux 上运行 browse 交互）。

## Alternatives considered

- 直接信任 rc7 的动态服务：settings 的 redaction 对 union、intersection
  或 transform 背后的 secrets 不是 fail-closed（见
  config-plane-boundaries），已加载的 client 插件可能读取或修改从未经过
  Web 面评审的命名空间；拒绝。
- 证明 rc7 redaction fail-closed 后保留动态服务：上游 seam 并不承诺这一
  点，且每个版本都去证明不值得丢失边界；拒绝。
- 等待发布年龄截止而非豁免：每次 rc 发布后最多阻塞一天；拒绝。
- 由 smoke 驱动原生 OS 目录对话框：平台相关且脆弱；拒绝。
