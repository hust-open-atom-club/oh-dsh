# Agent Note: 通过 Windows Window Controls Overlay 实现单行桌面 chrome

Status: implemented
Archived: 2026-08-26

[English](2026-08-17-desktop-single-row-titlebar.md) | 中文

## Problem

在 Windows 上，Desktop 窗口在会话区上方堆了三段横向 chrome：原生菜单栏一行、原生标题栏一行、以及 `src/client.ts` 为拖拽绘制的页内 40px 标题条（macOS 早已用 `titleBarStyle: 'hiddenInset'` 折叠成一行）。用户把这三段读成三个互相竞争的头部。任何修法都必须保留原生最小化/最大化/关闭按钮（Windows 的 snap 布局挂在它们身上）、保留完整可用的应用菜单、保留拖拽条——同时不引入第二套标题栏实现，也不削弱 `upstream/` 不动的固定上游边界。

## Decision

Windows 窗口以 `titleBarStyle: 'hidden'` 加 `titleBarOverlay` 创建，并设 `autoHideMenuBar: true`，让菜单栏不再占一整行（Alt 仍可唤出原生菜单栏；`Menu.setApplicationMenu` 仍安装，快捷键继续生效）。overlay 的 `height` 取 `Math.ceil(DESKTOP_TITLEBAR_HEIGHT * DEFAULT_UI_ZOOM_FACTOR)`：overlay 以设备无关像素声明，而标题条在 1.12 缩放因子下度量 CSS 像素，向上取整保证任何缩放下标题按钮都落在条内。`DESKTOP_TITLEBAR_HEIGHT` 放在 `src/contracts.ts`，主进程与客户端共享一个数，而不是两个会漂移的常量。

应用菜单不依赖 Alt 也可达：客户端把菜单的顶层标签（经 bridge 从已构建的 `Menu` 读取）渲染成标题条左角的按钮，点击时在按钮处弹出对应的原生子菜单。跨进程边界的只有标签——条目、角色与快捷键仍由 `buildMenu()` 唯一持有。弹窗处理器把按钮的 CSS 像素位置经 webContents 缩放因子换算成客户区相对 DIP；Windows 上 `popup({x, y})` 的坐标是客户区相对的，加上窗口原点偏移会把菜单弹到窗口中间（第一版上线时的 bug，实机检查抓到）。

页内标题条不再假设自己的高度，而是跟随 overlay 几何：`body` 的 padding 与 `::before` 拖拽条改用 `env(titlebar-area-height, var(--oh-dsh-titlebar-height))`；`.oh-dsh-panel-toolbar`——sidebar 插件固定的面板按钮，原先锚定在距窗口边缘 14px 处、会压在标题按钮下面——用 `env(titlebar-area-x)`/`env(titlebar-area-width)` 随 overlay 左缘位移，保住 14px 间隙。菜单栏本身是拖拽条的同级元素、按钮为 `no-drag` 孤岛，填上 Windows 留空的左角（macOS 那里是红绿灯按钮）。`nativeTheme` 的 `updated` 处理器重调 `setTitleBarOverlay`，主题切换时 overlay 与窗口背景同步变色；非 overlay 窗口（splash/更新窗口）由现有的 catch 跳过。macOS 保持 `hiddenInset`；Linux 保持普通边框——合并成一行是仅属 win32 的窗口形态决策。

## Alternatives considered

### 为什么不用 `frame: false` 加完全自绘的标题按钮？

在条内自绘最小化/最大化/关闭会失去挂在原生最大化按钮上的 Windows snap 布局弹出层，并把 OS 按钮行为（双击最大化、aero snap、触控目标）永久揽到自己手里。Window Controls Overlay 让这些全部保持原生，我们只保留空间。

### 为什么不保留菜单栏、只隐藏标题栏？

只设 `titleBarStyle: 'hidden'` 而不设 `autoHideMenuBar`，菜单栏在 Windows 上仍占一整行；三段堆叠只是中间破了个洞活下来。用户的诉求是一行，菜单就得住进这一行里。

### 为什么不做完整的页内菜单（条目渲染进网页层）？

把菜单**条目**渲染进网页层会把菜单分叉成第二个 UI，主进程要经命令桥驱动它，跨 surface 复制 `Menu.setApplicationMenu` 已拥有的角色（`about`、`services`、`quit`），并要永远重新实现原生菜单行为（勾选框、快捷键、子菜单嵌套）。只渲染顶层**标签**、弹出原生子菜单保持唯一属主：网页层拥有像素，主进程拥有菜单。

### 为什么不在客户端读 overlay 高度，而要共享常量？

env() 变量只在 overlay 生效时存在；从第二个客户端高度常量推导回退值，正是共享 `DESKTOP_TITLEBAR_HEIGHT` 要防的漂移。客户端在 env() 存在时仍优先用它，因此即便 Windows 报告的高度不同，标题条也跟随真实 overlay。

## Consequences

收获：Windows 上与 macOS 同形的单行 chrome；原生标题按钮与 snap 布局完好；菜单直接显示在这一行里、子菜单为原生；跨进程边界只有一个高度常量。代价：标题条高度改为跟随 overlay（默认缩放下 45px 而非平面 40 CSS px——内容多让出 5px）；默认宽度窗口上工具条距右缘 137px 加间隙；菜单栏标签是网页层的纯文本——角色提供的助记符与原生菜单栏的悬停联动没有带过来（只能点击打开；需要时 Alt 唤出完整原生菜单栏）。`nativeTheme` 监听器有 win32 守卫并忽略非 overlay 窗口。

## Testing

`tests/desktop-titlebar.test.ts` 钉住 win32 窗口形态分支、macOS 保留 `hiddenInset`、共享常量、随缩放的 overlay 高度推导、标题条/工具条的 `env()` 几何，以及菜单栏契约：bridge 上的标签与弹窗、`buildMenu()` 唯一持有菜单、缩放因子坐标换算、仅 win32 主窗口挂载与 drag/no-drag 区域。在 Windows 上的实机验证（CDP 连接隔离 `OH_DSH_HOME` 下的 staged runtime）：`outerHeight - innerHeight = 8`（仅调整边框；菜单+标题两行已消失），`titlebar-area-height = 45` 等于标题条 45px 的 `padding-top`，面板工具条右缘与 overlay 左缘保持 14px 间隙；菜单栏在条内（y 0–45，按钮 no-drag）渲染全部六个顶层标签，修正为客户区相对坐标后 File 子菜单在按钮处弹出（用户在实机窗口确认）。本机 `pnpm test`/`typecheck`/`build` 全链通过，除 `tests/nix-collect-deps.test.ts`（需要 `python3`，本机缺失；未修改的 HEAD 同样失败）与 `scripts/smoke-runtime.mjs`（其 client-graph 轮询在未修改的 HEAD 上同样超时）。

## Related

本决策所依赖的拖拽条与对话框 z-index 分层由 `src/client.ts` 的桌面客户端 chrome 持有；面板工具条属于[工作区侧栏工具注册表](2026-08-11-workspace-sidebar-order-and-folding.md)。
