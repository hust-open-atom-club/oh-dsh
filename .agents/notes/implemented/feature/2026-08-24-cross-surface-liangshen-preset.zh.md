# Agent Note: 在所有交互端共享梁神 preset

Status: implemented

[English](2026-08-24-cross-surface-liangshen-preset.md) | 中文

## Problem

梁神 Agent preset 原本只随 dsh-TUI 提供，只有 TUI package 把它安装到用户根目录后
才可发现。Web 和 Desktop 使用同一个 DSH agent-preset service，但各自的 staged
deployment 没有这份 composition。

该 preset 只发布一套中文 `name` 和 `description`。DSH Web client 与 dsh-TUI 都把
用户根目录中的 preset 元数据按原文显示，因此英文 locale 仍显示中文的梁神模式名称
与说明。

## Decision

- 增加 Oh-DSH 内置 `@oh-dsh/liangshen` Host plugin，并在 Web/Desktop bundle
  patch 中挂载；plugin 在会话创建前把 pinned `presets/liangshen` composition
  安装到共享用户 preset 根目录。
- 将 package 自有 `.dsh-tui-managed.json` 的 owner 通过 DSH roster 和
  `agentPreset.list` 投影为 `managedBy`。仅本地化 owner、id、名称、说明均与 pinned
  梁神 preset 一致的行。用户创作的行即使复制了 canonical 展示文本，只要没有管理
  标记，仍显示自己发布的文本。
- Web/Desktop 适配 pinned DSH Agent preset roster、API 与 client，TUI 适配编译后的
  dsh-TUI roster 投影。两者都按当前 locale 解析梁神模式的名称与说明，不改写 preset
  文件。
- 普通 staging 与 Nix 装配只适配复制后的运行时 package。适配使用精确且幂等的
  anchor；DSH 或 dsh-TUI 布局变化会让打包失败并要求复核。
- 以只读 viewer 启动（`OH_DSH_READ_ONLY=1`）时跳过安装：viewer 与活跃
  surface 共享 data root，此时安装会覆盖那个 surface 拥有的 preset 状态。
- 在 Nix 的 `full` 与 `web` 装配中通过共享运行时组装器
  （`scripts/stage-runtime-lib.mjs` 的 `installDesktopPackages`，与发布管线
  同一实现）注册该 plugin，并从 pinned TUI release 把 preset 复制到
  `dist/` 旁；Nix 的 TUI 闭包继续使用上游 preset。
- TUI 不挂载这个 plugin；pinned dsh-TUI renderer 已经自带并暴露梁神模式。
- preset 源码继续放在 pinned dsh-TUI checkout 中，使 tool-bootstrap、压缩和子
  Agent 行为随其上游 owner 一起升级。
- 保持 `standard` 为默认值；梁神模式通过选择器、启动参数或环境变量显式启用。

## Alternatives considered

**复制到 staged DSH config root。** 不采纳，因为这会把 preset 变成 deployment
asset，而不是产品要求的、明确限定在 Web/Desktop 的内置 plugin。
让该根目录优先还会遮蔽已经占用 `liangshen` id 的非托管用户 preset，改变现有的
冲突保护行为。

**根据 `liangshen` id 或 canonical 展示文本推断所有权。** 不采纳，因为非托管用户
preset 可以合法保留任一项；替换它发布的名称与说明，会把用户自有代码误写成托管
composition。

**给 `preset.yml` 增加 locale map。** 不采纳，因为 pinned
`dsh-agent-presets` 的元数据与 API 只接受普通字符串。为一个下游 preset 扩展该协议
格式，需要同时修改 DSH、dsh-TUI 以及所有 roster 消费方。

**复制成新的 Oh-DSH plugin package。** 不采纳，因为这会产生一份由两个项目共同
维护的 composition 副本，而它的生命周期和上游归属已经由 dsh-TUI 负责。

**把梁神模式设为默认。** 不采纳，因为这会改变现有用户看到的模型工具 contract；
只提供可选能力可以保持向后兼容。

## Consequences

- Web/Desktop Agent preset 设置通过内置 plugin 解析梁神模式，TUI 继续使用 dsh-TUI
  原生实现。英文界面显示 `Liangshen mode`，中文界面显示 `梁神模式`。
- 自定义 preset 元数据仍按原文显示；Host plugin 拒绝替换、保留 canonical 中文展示
  文本但不携带 package 管理标记的 `liangshen` 行也不例外。
- 按交互端的本地 staging 只在 Web/Desktop 包含该 plugin；TUI 不会收到重复的
  Liangshen runtime package。
- Nix 的 Desktop/Web 与 staged（非 Nix）部署以相同方式解析 plugin package 及
  其 preset，由 `tests/stage-runtime-lib.test.ts` 守护。
- Nix 装配机制已移入共享运行时组装器（见
  2026-08-27-nix-packaging-shares-stage-dsh-assembly）；本笔记保留表面归属决策。
- `tests/liangshen.test.ts`、`tests/tui.test.ts` 以及 Desktop/Web 冒烟测试固定了
  marker 派生的所有权字段、canonical 元数据保护与实际提供的 client bundle。
- 每次升级 DSH 或 dsh-TUI 都需要重新验证 presentation anchor、preset
  composition 以及三端 staged copy。
