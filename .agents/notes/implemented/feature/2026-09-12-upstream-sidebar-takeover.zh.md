# Agent Note: 上游侧栏接管

状态：已实现

[English](2026-09-12-upstream-sidebar-takeover.md) | 中文

## 问题

Oh-DSH 维护着一套平行的 workspace 工具栈：自己的文件浏览、文件查看器、
git review 面板和浏览器视图住在私有面板系统里，与运行时的原生右侧栏
dock 并存——两套面板系统并排。而 pin 住的上游 DSH-better-sidebar v0.19
早已完成与 DSH 0.1.5 的对齐（它的 tab 注册为原生右侧栏 tab 类型，
只保留底部工作台自持），我们却只打包它的宿主半边、另做了一套简化
客户端。

## 决策

整包搭载上游插件，退役我们的平行视图；Oh-DSH 保留主题与 UI 质感，
功能面归上游。

- `upstream/DSH-better-sidebar` 加入 pnpm workspace；`scripts/build.mjs`
  调用它自己的 tsdown 构建（宿主 ESM、浏览器客户端、懒加载 chunk
  脚本），暂存整包复制其 `lib/`，与 dsh-context 完全同模式。原
  host-only 的 `@oh-dsh/better-sidebar-runtime` 包删除——一个 npm 名
  （`dsh-better-sidebar`）同时承载两个半边，伺服 chunk 的
  `/sidebar/bundle` 路由重新在宿主模块旁找到脚本。
- 暂存规格持有 pinned 清单无法声明的宿主闭包（node-pty/schemastery/
  ws 从源码树解析；@deepseek-ai/dsh-settings/dsh-tools 同侪从暂存
  runtime 解析）。
- 我们的 `@oh-dsh/sidebar` 退役 review/files/file/browser tab 注册与
  全部四个简版查看器；`openReview/openBrowser/openBrowserUrl/openFile/
  openFiles` 改走原生 `sidebarRight` 控制器（`openTab('changes'/
  'browser'/'files')`、`openResource(dsh-resource://file/…)`），并遵循
  与上游 surface 相同的待开队列契约。
- 顺带修出两个真实的 0.1.5 契约问题：会话启动在 `uiWorkspace` 服务上
  （裸 `workspaces` 控制器没有 `startSession`）；`layout.
  beginNavigation()` 必须返回真正的 `AbortSignal`（uiWorkspace 与上游
  fork 里的 `AbortSignal.any`）。

## 备选方案

- 把我们的组件注册为原生 tab 类型（原计划）：等于永远自己维护
  review/files/browser 的实现。
- 用我们的 esbuild 管线打包上游客户端：要复刻其 module-loader 横幅、
  CSS modules 与 chunk 工厂约定——正是接管要消除的维护量。
- 维持 host-only 拆分并另暂存一个纯客户端包：宿主 include 遍历器会
  import 每个 runtime 依赖的 `main`，无 main 的客户端包无法搭车；
  整包才是运行时加载器真正支持的布局。

## 后果

- CodeMirror 编辑器、富 git 视图、子代理/任务视图、side chat、内嵌
  浏览器白得且由上游维护；文档预览（pdf.js）来自原生运行时包。
- 我们的提交评审评论功能随 review 面板失去 UI（服务一并移除）；若
  再需要，以原生 tab 形式回归，而非私有面板。
- workspace 锁文件长出了上游构建的依赖闭包（codemirror、mermaid、
  xterm……）；按记录流程刷落了新的 fetchPnpmDeps 哈希，nix bundle
  source 也会与其他发布版覆盖层并列暂存该插件的清单、构建产物 lib/
  与 node_modules 链接——两个 pinned 构建均已验证通过。
- 上游底部工作台开关现在出现在会话头部、与原生展开控件并列，
  Oh-DSH 的浮动面板工具条也随之退役：角落归原生控件，固定摘要、
  侧面板与底部面板经由应用菜单项和快捷键保持可达。退役我们自己的
  底部终端抽屉是剩余的后续事项，待 dock 在日常使用中验证。
