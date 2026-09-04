# Agent Note: Portal 对话框的关闭按钮让出预留标题栏行

Status: implemented

[English](2026-08-31-portal-dialog-close-clears-titlebar.md) | 中文

## Problem

在会话中点击"查看原图"时，钉住的 DSH 运行时会把图片灯箱（image lightbox）
portal 到 `document.body`。这个灯箱是一个裸的 `role='dialog'`，其关闭控件是
一颗 36px 的圆形 `position: fixed` 按钮，固定在 `top: 20px; right: 20px` ——
这是为"顶部不保留任何空间的原生浏览器视口"写的几何。而 macOS 与 Windows 的
Desktop 表面预留了 40px 的页内标题栏行，并用 `z-index: 2147483645` 的不透明
`body::before` 条绘制它，远高于灯箱自身的 `z-index: 1000`。标题栏条盖住了
按钮的上半段：灯箱看起来像坏了 —— 菜单行下方只露出半个白色圆和 ✕ 的下尖端，
可点击区域也缩小到可见的那一小条。

灯箱的背板本身在同一条带里也是失衡的：它用上下对称的 40px 内边距让图片相对
整个视口居中，于是在预留标题栏行的平台上，图片上缘距屏幕顶部是 40px（预留）
加 40px（内边距），下缘却只有 40px 内边距 —— 预览图上方贴住标题栏条、下方悬空。
图片的高度上限也是同一个"只看视口"的假设：`max-height: calc(100vh - 80px)`
算的正是被预留行作废的那份内边距。Linux 保留原生窗口框架、不预留任何空间，
Web 从不加载 chrome 样式表，这两个表面都不可能产生上述任一缺陷。

## Decision

Desktop chrome 样式表在预留行的平台上恢复灯箱留白的对称性：背板从标题栏条
下缘开始，四边沿用上游自己的 40px 留白宽度 —— 由标题栏条顶替视口原本提供
的那条顶部留白；图片高度上限随预留行和留白收缩；关闭按钮贴着留白网格落在
角落：

```css
html[data-oh-dsh-desktop-platform='darwin'] body > [role='dialog'][aria-modal='true'],
html[data-oh-dsh-desktop-platform='win32'] body > [role='dialog'][aria-modal='true'] {
  top: var(--oh-dsh-titlebar-height, 40px) !important;
  padding: 40px !important;
}

html[data-oh-dsh-desktop-platform='darwin'] body > [role='dialog'][aria-modal='true'] > img,
html[data-oh-dsh-desktop-platform='win32'] body > [role='dialog'][aria-modal='true'] > img {
  max-height: calc(100vh - var(--oh-dsh-titlebar-height, 40px) - 80px) !important;
}

html[data-oh-dsh-desktop-platform='darwin'] body > [role='dialog'][aria-modal='true'] > button,
html[data-oh-dsh-desktop-platform='win32'] body > [role='dialog'][aria-modal='true'] > button {
  top: calc(var(--oh-dsh-titlebar-height, 40px) + 8px) !important;
  right: 8px !important;
}
```

这些选择器约定的是文档结构，而不是类名：`role='dialog'` 且是 `body` 的直接
子元素（portal 覆盖层），关闭按钮和图片都是它的直接子元素。钉住的运行时
每次构建都会重新生成 CSS-module 哈希类名（今天是 `fNh4Da_close`，下个版本
就不是了），按类名选择会在每次上游更新时静默失效，结构是唯一稳定的契约。
规则限定在 darwin 和 win32 —— 仅这两个表面预留标题栏行 —— Linux 与 Web
保留上游自身的几何不受影响。规则带 `!important`，因为钉住运行时的样式表在
chrome 样式表之后注入、同等优先级时会胜出；同一张样式表里的对话框降级规则
本来就在用 `!important`。

背板沿用上游 40px 的留白宽度，而不是另设一个 Oh-DSH 的留白尺寸：用户看到的
边框仍是上游设计的四边 40px，只是整体移入标题栏条之下的区域，由标题栏条
顶替原来的顶部留白。`max-height` 上限（`100vh - 标题栏 - 80px`）跟随变小
的内容区域 —— 80px 正是上下两条留白 —— 高图不会再从标题栏条后面溢出。

`body::before` 和菜单栏仍是预留行的唯一所有者：我们挪走覆盖层，而不是放松
标题栏条本身的防护，因为窗口拖拽、合并菜单行和窗口控制按钮都住在那条带里。

DSH 的 `Modal` 原语刻意不受影响：它的关闭按钮位于 `[role='presentation']`
包裹层内、不是 body 的直接子层，结构选择器不会命中它；它的居中布局也从不
进入标题栏带。

## Alternatives considered

**在 `cordis.patch.yml` 里给钉住的运行时包打补丁。** 否决：补丁把某个上游
版本的样式表钉死，运行时每次升级都要重新推导；而且它本质仍是一条 CSS 覆盖，
放在拥有标题栏预留权的表面里才保持该行的单一所有者。

**按运行时的类名（`fNh4Da_close`）选择。** 否决：CSS-module 哈希随每次构建
变化，修复会在下一次钉住更新时静默死亡；结构是唯一可用的稳定契约。

**只用 `data-oh-dsh-desktop` 限定、不带平台限定。** 否决：Linux 保留原生
框架、Web 不加载 chrome 样式表，两者都会无缘无故吃到 8px+40px 的偏移，
让按钮偏离它设计所在的角落。

**降低 `body::before` 的 z-index 或改成半透明，让灯箱压到标题栏条之下。**
否决：标题栏条守护着窗口拖拽、合并菜单行和 Windows 窗口控制按钮；允许
portal 覆盖层画进那条带，等于重新引入这条防护本来就要阻止的那类重叠。

**在上游 DSH 修复**（像 Better Sidebar 那样的标题栏条兼容模式）。长期来看
是正确的归宿，但在某个发布版钉入修复的运行时之前对本表面没有帮助；而且对
任何把固定控件停在视口顶部的钉住覆盖层，Oh-DSH 仍然需要一个桌面侧的答案。

## Consequences

标题栏预留多了一条常备的"例外形"规则：把裸对话框 portal 到 `body` 的覆盖层，
在 macOS 与 Windows 上会被重排进预留行之下的区域 —— 沿用上游的四边 40px
留白、图片上限随之收缩、关闭按钮贴着留白网格锚定。规则刻意收窄 —— 只匹配
直接子层结构 —— 因此未来钉住的覆盖层若换了内部结构（比如关闭按钮外面套一层
header 包裹、或图片嵌在 stage 元素里），需要扩展这一模式，而这些选择器就是
唯一的扩展点。规则的 `!important` 把 chrome 样式表的权威与预留绑定：上游
重排灯箱不会静默夺回那条带，但上游若改动自己的留白宽度，这里的字面量需要
同步更新。下面的契约测试钉住的是规则本身，视觉检查仍需手动进行，因为受影响
的几何属于钉住运行时的发布节奏。

## Testing

`tests/desktop-titlebar.test.ts` 断言限定 darwin/win32 的结构选择器：背板
`top` 落在预留行、`padding: 40px`，图片上限
`calc(100vh - 标题栏 - 80px)`，关闭按钮 `calc(标题栏 + 8px)` 与
`right: 8px`，并拒绝不加平台限定的 desktop 全局变体。在打包的 Windows
构建上，会话内打开图片灯箱时，预览图在菜单行之下被四边 40px 的留白
框住，高图不会越出这个边框，圆形关闭按钮完整显示在右上留白里，标题栏条
与窗口控制按钮仍然可点。
