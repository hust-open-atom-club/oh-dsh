# Agent Note: 原生风格的工作区下拉菜单

Status: implemented

[English](2026-08-25-native-workspace-dropdowns.md) | 中文

## Problem

工作区信息使用浏览器原生 `<select>` 来选择执行环境和分支。平台弹窗会以独立的白色表面渲染，与设置页菜单和侧栏主题不一致。

## Decision

将两个 select 替换为工作区内部锚定的自绘下拉菜单。触发按钮保留在工作区信息行中，菜单从按钮下方展开，选中项使用共享的工作区 SVG 勾选图标。菜单提供 `aria-haspopup="listbox"`、`aria-expanded` 和选中状态。Escape 和外部指针输入可以关闭菜单；ArrowUp、ArrowDown、Enter 和 Space 支持键盘选择。分支切换继续复用原有 mutation 路径和禁用状态。

## Alternatives considered

**保留浏览器原生 select。** 不采用：弹窗样式由宿主平台控制，会明显偏离设置页的视觉表面。

**引入第三方 select 依赖。** 不采用：侧栏已经拥有所需的视觉语言，这个交互足够小，可以在本地实现而不增加依赖。

## Consequences

执行环境和分支选择现在共享设置页菜单的深色表面、间距、选中状态和箭头行为。长分支名会在触发按钮中省略，分支列表较长时菜单可以滚动。菜单始终锚定在工作区信息行，不会变成脱离入口的对话框。

## Testing

`node --test tests/sidebar.test.ts tests/workspace-tools.test.ts tests/diff-stats.test.ts` 通过，共 13 个测试。`corepack pnpm@11.21.0 run typecheck` 通过。`git diff --check` 通过。
