# Agent Note：已完成 assistant 回复的「保存为图片」

Status: implemented

[English](2026-09-02-save-as-image-action.md) | 中文

## 问题

Issue #181 要求为单条回复提供「保存为图片」操作，让一条已完成的回答能以图片形式离开应用——这正是人们把 AI 回答贴进聊天、工单或幻灯片的实际方式。转录界面已经把图片所需的一切都渲染出来了（Markdown、代码块、表格、内联图片），但没有任何东西能把这棵渲染后的子树变成文件：DSH 没有客户端侧的截图能力，Host 协议里也没有导出动词。

这个控件的天然落点已经存在。`ui-conversation` 声明了 `conversation.chat.assistant-actions` 这个 list 槽位，通过 `TurnTailNodeView` 渲染并传入 `MessageIconActions`，当 assistant 节点不携带 `messageId` 时整体跳过该槽位——这正是消息反馈包[已经在用的接缝](2026-08-11-message-feedback-web-surface.md)。还没人做过的是：把这个槽位指向远程调用以外的东西，并且拿到的是与控件自身所在节点**不同**的另一个 DOM 节点的像素级副本。

## 决策

新增一个仅浏览器侧的插件 `@oh-dsh/save-as-image`，向 `conversation.chat.assistant-actions` 贡献一个条目（id `save-as-image`，order 20，排在反馈之后），并从应用已经画好的 DOM 里捕获这条回复。

**捕获目标靠结构定位，而不是靠过滤。** 每个聊天节点都是会话列表下并列的 `<div class="flowItem" data-chat-anchor-key=… data-chat-flow-kind=…>`，而操作条位于另一个兄弟节点里，其根节点带 `data-turn-tail`。控件从自己的按钮向上找到这行 turn-tail，再沿 `previousElementSibling`（上限十跳）走到最近的 `data-chat-flow-kind="assistant-step"` 元素。由于操作条是独立的兄弟节点，被捕获的子树**在结构上**就不包含操作控件——不需要 `filter` 回调，不需要埋隐藏标记，也不需要与操作条自身标记保持同步。DOM 里并没有可用来定位的 `data-message-id` 属性，而要求上游补一个就意味着改动被钉死的源码。

**渲染用 `html-to-image`，直接打进 client bundle。** `toBlob` 以 `pixelRatio: 2` 产出 PNG；对高到撑爆画布预算的回复，同一调用会以 `pixelRatio: 1` 重试一次，第二次仍失败则向上冒泡为该行的失败反馈，而不是被吞掉。字体先用 `getFontEmbedCSS` 预解析并以 `fontEmbedCSS` 传入渲染；若预解析抛错，渲染降级为 `skipFonts: true`——issue 明确要求字体嵌入失败损失的是保真度，而不是导出本身。该包是普通 npm 依赖、由 esbuild 打包，而 `@deepseek-ai/*` 保持 external、运行时经宿主 ModuleLoader 解析，与反馈包对 primitives 的依赖方式完全一致。

**结果永不离开本机。** blob 通过对象 URL 以 `dsh-response-<净化后的消息 id>.png` 触发下载。该插件不声明任何 Host Remote、不注册工具、不加端点：manifest 的 `dsh.client.inject` 就是反馈包的清单去掉 `api-remotes`。一条源码级契约测试把这一点钉死：断言插件源码中既无 `fetch(` 也无 `XMLHttpRequest`。

**反馈状态与共享操作条保持一致。** 控件是宿主 primitives 包 `Tooltip` 内的 28px 图标按钮（`IconDownloadOutline16`，保存成功后换成 `IconCheckOutline16` 约 1.5 秒），渲染期间禁用并把文案切换为 `status.capturing`，失败时用与反馈相同的 `role="status"` 内联文案。它的词典放在 `oh-dsh.save-as-image` locale 命名空间里，zh 是键集的事实来源，两个 surface 因此都能拿到双语文案。

把这个插件接进来，触及的是 Oh-DSH 的整条注册面，比初次贡献者预期的要长：`scripts/build.mjs`（构建产物与 `clientExternal`）、根 `cordis.patch.yml` 与 `web/cordis.patch.yml` 两份组装、`src/profile.ts` 的内置 client 插件名单、`web/package.json` 的 client inject 列表、`scripts/stage-runtime-lib.mjs` 的 staged 包文件清单，以及 `scripts/stage-dsh.mjs` 的必备产物门禁。其中任何一处缺失都会在下游某个环节响亮失败（构建、名单类测试、staging 或 runtime smoke），漏配不可能静默上线。

## 考虑过的替代方案

**Host 侧无头渲染。** 在 Host（或内置无头浏览器）里渲染消息 Markdown 并返回 PNG。否决：它把一次网络往返和一个浏览器二进制重新引入到一个两者都不需要的插件里；为了与用户所见保持像素一致，还得复刻客户端渲染器整套样式；并且把一个纯本地的便利功能变成了一个产出图片的、与安全相关的端点。

**把 Markdown 重渲染到游离节点再捕获。** 否决：宿主渲染器用自带样式表处理代码高亮、表格、KaTeX 与内联图片；一个平行的「干净」渲染器会在上游每次改样式时漂移，用户导出的将不是他们读到的那个东西。

**给上游 `ui-conversation` 增加截图能力。** 否决：`upstream/` 是被钉死的源码，Oh-DSH 在 `plugins/` 中适配上游行为。加 `data-message-id` 属性加内置按钮，等于让上游为一个今天单个插件就能满足的需求承担永久 API 承诺。

**捕获整个会话列表再过滤掉操作条。** 否决：基于标记属性的 `filter` 回调把导出与操作条内部标记耦合在一起，过滤器漏掉什么就静默带上什么。兄弟节点遍历免费获得排除性，并且在预期形状缺失时响亮失败。

## 结果

导出的稳定性取决于宿主的 DOM 契约：`data-chat-flow-kind="assistant-step"` 与 `data-turn-tail` 根节点都是上游渲染细节，改名会让捕获在点击时失效。失败路径刻意响亮——该行显示「图片导出失败」——但在用户真正点下去之前，没有任何机制能提前发现这种破坏，也没有测试去跑一次真实捕获（那需要活的浏览器 surface）。

捕获保真度继承 `html-to-image` 的局限。渲染器画在捕获子树样式表之外的内容、或无法内联的资源，在 PNG 里可能不一样；超长回复会耗掉那次重试，两种像素比都失败回复就是导不出。由于图片在本地内联，不会上传任何东西——但内联也意味着渲染过程可能去取页面本身已加载过的同文档资源（图片、字体）。

控件只出现在运行时渲染该槽位的地方，因此被中断的 Turn 没有可保存的东西——与反馈遵循的同一套「已完成」规则。插件同时进入 Desktop 与 Web 组装，不出现在 TUI 中，后者没有可承载它的 assistant-actions 条。
