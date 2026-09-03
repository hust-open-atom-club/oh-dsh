# Agent Note: 内置 dsh-auth 作为订阅账号 OAuth 插件

Status: implemented

[English](2026-08-26-bundle-dsh-auth.md) | 中文

## Problem

0.9.2 renderer 捆绑了上游 `dsh-auth`（为 ChatGPT/Codex、Claude Pro/Max 与
SuperGrok 提供订阅 OAuth 登录的 LLM 路由），但只有 TUI 面加载它——经由
renderer 自己的 `oauth` patch 行。Desktop 与 Web 用户没有订阅账号入口。

## Decision

- 把 `upstream/dsh-TUI/dsh-auth` 中的固定包以上游 npm 名暂存到 Desktop 与
  Web 面，并按上游自己的行形态（`- id: dsh-auth`，条目级
  `inject: [llm, commands]`）挂载进根目录与 `web/` patch 层——沿用
  [dsh-context 内置](2026-08-25-bundle-dsh-context.md)确立的"暂存上游
  manifest、无适配层"模式。TUI 继续经由 renderer 的行加载，因此没有任何面
  重复挂载。
- 该插件是纯 host 端：`/auth` 的交互完全走 DSH 的 `user-questions` 接缝与
  commands 注册表，Desktop 与 Web 无需任何客户端代码——各面既有的问答 UI
  承载登录流程；无交互面的环境降级为明确的拒绝提示。
- 所有 peer 经由暂存运行时的 hoisted 树解析——包括 0.1.1-rc.2 运行时已经
  自带的 `@deepseek-ai/dsh-llm-pi-ai` 与 `@earendil-works/pi-ai`。
- `BUNDLED_DESKTOP_HOST_PLUGINS` 加入该包；收集测试对 host 插件的断言从
  "没有 `dsh` 键"放宽为"没有浏览器半区（无 `dsh.client`）"，因为上游 bundle
  manifest 会声明自己的 patch 层。桌面 smoke 的 host 循环改为从各暂存
  manifest 解析 `main`（此处为 `lib/index.js`）；web smoke 在组合 profile
  dump 中断言 `dsh-auth` 行。
- marketplace 保护覆盖插件 id、包名与 `ccch1mneyyy/dsh-auth` 仓库，并按
  dsh-context 用例镜像添加拒绝测试。
- Nix 把已发布的 tarball 挂载到仓库形状 staging root 的
  `upstream/dsh-TUI/dsh-auth`（npm 发布布局），由共享运行时组装器
  （`scripts/stage-runtime-lib.mjs` 的 `installDesktopPackages`）为 full 与
  web 面注册。完整 `oh-dsh` 包构建通过，`@deepseek-harness-tui/dsh-auth` 与
  `dsh-context` 均注册成功。renderer 的私有 `dsh-auth` 依赖由发布管线同一套
  依赖安装逻辑复制进其包级 `.oh-dsh-store`，因此不会回到不可变的
  bundle store 源路径。

## Alternatives considered

**做 `@oh-dsh/auth` 适配包。** 不采纳：没有任何被适配的东西——上游包原样
消费，包装 manifest 只会偏离上游版本，这正是 dsh-context 决策已记录过的
取舍。

**在 Desktop/Web 挂 renderer 的 oauth 行。** 不采纳：该行是 TUI renderer
自己的导出；挂载外部包的子路径行会让 Desktop/Web 暂存耦合到 TUI 面拥有的
renderer 包。

**等待 DSH 原生订阅登录。** 不采纳：上游包本就面向 DSH 核心接缝（llm
注册表、commands、user-questions）设计，今天就能在所有面上原样工作。

## Consequences

- `/auth` 在三个面上可用，凭据同样存储于 Oh-DSH 数据目录。
- `tests/stage-runtime-lib.test.ts` 经共享组装器暂存 full 与 TUI fixture，并要求
  `dsh-auth` 的 host peer 从暂存运行时图解析。
- Nix 装配机制已移入共享运行时组装器（见
  2026-08-27-nix-packaging-shares-stage-dsh-assembly）；本笔记保留表面归属与私有
  副本决策。
- 升级 renderer pin 会一并移动 dsh-auth 源；独立暂存 spec 指向嵌套子模块
  路径，将来上游移动该嵌套包时暂存会大声失败。
- 若上游增加客户端半区，该包将从 `BUNDLED_DESKTOP_HOST_PLUGINS` 移入
  client 列表，smoke 也会增加 client bundle 断言。
