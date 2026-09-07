# Agent Note: 市场插件构建固定 pnpm hoisted 布局

Status: implemented

[English](2026-09-07-marketplace-bundle-hoisted-layout.md) | 中文

## 问题

在 Windows 上从市场安装插件 `dsh-web-tools` 时报
`DSH runtime exited before readiness (code=1, signal=null)`。预览运行时日志里有真正的错误:
插件入口从它的托管源码目录 import `linkedom` 时,Node 抛出
`ERR_MODULE_NOT_FOUND`。依赖明明在几分钟前刚由市场 bundle 构建装好,
却没能活过从构建目录到已应用 profile 的那次搬迁。

市场事务的流程是:在一次性 `bundle-builds/` 目录里构建带脚本的插件
checkout(先 `pnpm install`,再只跑已审查的生命周期脚本),然后用
`renameSync` 把成品树挪进 profile 的 `.oh-dsh/sources/`。在 Windows 上,
pnpm 默认的 isolated 布局用指向 checkout 自己 `node_modules/.pnpm` 的
**绝对 junction** 链接每个安装包。目录改名会改写树自身的路径,
却不会改写树内部的 junction 目标——搬完之后所有链接全部悬空,
插件一启动就找不到依赖。

更隐蔽的是,只在 install 命令上加 `--config.node-linker=hoisted`
并不够:pnpm 的 hoisted install 确实落盘真实目录,但随后的
`pnpm run prepack` 会重新读取 `.modules.yaml`,发现没有 linker 覆盖,
又把顶层条目重建为绝对 junction——在 rename 前一刻把故障请回来。

## 决策

`ProductionMarketplacePlatform.buildBundle` 里的每一条 pnpm 命令——
`install` 和每条已审查的生命周期 `run`——现在都带
`--config.node-linker=hoisted`。hoisted 布局在 checkout 内写的是普通
目录,在所有平台上都能随树一起通过 rename。这与 dsh profile
(`pnpm-workspace.yaml` 的 `nodeLinker: hoisted`)和 Windows 包暂存
(`installWindowsPackageDependencies`)已经采用的布局一致,
第三方 bundle 落地的依赖拓扑与其余运行时预期相同。

## 已否决的替代方案

**用 copy 代替 rename。** `cpSync` 会把 Windows junction 解引用成真实
目录,探针里 copy 之后解析正常。否决:每次安装的 I/O 翻倍,而且静默
依赖各平台不一致的拷贝语义(`dereference` 并非处处默认开启)——
linker 旗标修的是因,拷贝只是遮症状。

**搬家之后重写 junction 目标。** 否决:修补 `.modules.yaml` 和每条
链接等于在市场宿主里重新实现一遍 pnpm 的布局逻辑,还要处理各平台的
symlink 规则,而包管理器本身就有现成的规避方式。

**要求插件作者自带 `pnpm-workspace.yaml`。** 否决:市场目录管不了
第三方仓库的布局,而且这是我们的过错——rename 是 Oh-DSH 自己的
事务步骤。

## 后果

带脚本的 bundle 安装在磁盘上略大(真实目录而非 store 链接),
也失去了 checkout 内部 pnpm 跨项目 store 硬链接的节省;不过事务局部的
`.pnpm-store` 反正把下载缓存留在事务目录里。如果插件自己的构建脚本
不带旗标地运行 `pnpm install`(或 `npm ci`),仍可能把 `node_modules`
重建成 rename 后悬空的布局;这如今属于插件侧的问题而非市场默认行为,
回归测试守住的是市场侧的契约。`tests/plugin-marketplace.test.ts`
端到端钉死了该行为:构建一个带依赖的 fixture、跑一次生命周期脚本、
rename 整棵树、然后要求依赖仍然可解析。

## 测试

`pnpm test` 在所有平台运行新回归;在 Windows 上它踩的正是过去出错的
junction 语义。已用真实插件验证:从 Desktop 市场预览并应用
`dsh-web-tools`,预览运行时正常启动(出现 `dsh web:` 就绪行),
应用后的 profile 源码树能解析 `linkedom`。
