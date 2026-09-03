# Agent Note: 按 surface 与平台限定 Desktop chrome

Status: implemented

[English](2026-08-26-platform-scoped-desktop-chrome.md) | 中文

## Problem

Desktop 客户端曾用一个 surface 级选择器处理由不同操作系统拥有的窗口
chrome。Windows 需要为渲染器自绘的窗口按钮留空，macOS 需要在原生红绿灯
周围提供可拖拽区域，Linux 则保留原生窗口边框。把 Windows 的工具栏留空规则
应用到所有 Desktop 平台后，macOS 的面板按钮偏离了右上角；共享拖拽声明被
移除后，macOS 的 `hiddenInset` 窗口也失去了可拖拽区域。Web 不应继承任何
原生窗口几何。

## Decision

Desktop bridge 的平台值发布为 `data-oh-dsh-desktop-platform`，现有的
`data-oh-dsh-desktop` 标记继续只表示 surface。平台选择器只负责原生窗口
几何：

- macOS 预留 40px 页内标题栏，面板工具栏与右边缘保持 8px，并在红绿灯与
  面板按钮之间挂载一个只负责拖拽的区域；
- Windows 为渲染器菜单和窗口按钮预留同一行，面板工具栏与右边缘保持
  154px；
- Linux 保留原生边框和共享面板工具栏位置，不注入标题栏，也不绘制圆角内框；
- Web 不加载 Desktop bridge 或 chrome 样式，因此保留共享面板工具栏几何。

macOS 拖拽区使用真实 DOM 元素而非伪元素，以便独立于装饰性标题栏背景持有
`-webkit-app-region: drag`。macOS 与 Windows 使用 28px 按钮和 1px 工具栏
内边距，使带描边的工具栏上下各留 4px，不再与标题栏分隔线相接。工具栏仍为
`no-drag`。Desktop 客户端 effect 销毁时会同时移除拖拽元素与平台标记。

## Alternatives considered

**继续让所有 Desktop 平台共用一个选择器**：surface 标记无法表达原生窗口
边框的差异，Windows 留空或 macOS 拖拽规则仍会泄漏到其他操作系统。

**macOS 与 Linux 也统一改成无边框、自绘 chrome**：这会替换 macOS 原生
红绿灯和 Linux 窗口管理器边框，而本缺陷只要求按平台处理位置与拖拽。

**通过浏览器样式能力推断平台**：能力检测无法区分受支持的窗口所有权模型；
隔离的 Desktop bridge 已将主进程平台作为显式契约提供。

## Consequences

渲染器新增一个平台标记和一个仅 macOS 存在的拖拽元素。作为交换，每个已交付
surface 都只有一个几何所有者：macOS 与 Windows 选择自定义标题栏间距，Linux
保持原生边框，Web 留在原生 chrome 之外。拖拽区边界按当前红绿灯与面板按钮
预留，因此任一按钮组尺寸变化时都必须同步更新回归契约。

## Testing

`tests/desktop-titlebar.test.ts` 固定 Desktop/Web 边界以及 macOS、Windows、
Linux 三个平台的几何分支。另在打包后的 arm64 macOS 应用中检查真实渲染器：
面板工具栏距右边缘 8px，拖拽区报告 `-webkit-app-region: drag`，指针拖拽使
原生窗口按要求水平移动 100px、垂直移动 60px。

## Related

渲染器自绘的 Windows 控件归属于
[Desktop v21 根框架](../architecture/2026-08-18-desktop-root-frame-v21.md)，
其原生状态同步归属于
[Desktop chrome 生命周期](../architecture/2026-08-20-desktop-chrome-state-lifecycle.md)。
