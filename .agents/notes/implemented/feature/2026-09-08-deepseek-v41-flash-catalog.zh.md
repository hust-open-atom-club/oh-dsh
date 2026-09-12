# Agent Note: 默认模型目录中的 DeepSeek-V4.1-Flash——surface patch 组合行

Status: implemented

[English](2026-09-08-deepseek-v41-flash-catalog.md) | 中文

## 问题

DeepSeek 以官方 id `deepseek-flash` 提供 `DeepSeek-V4.1-Flash` 模型
（文本+图像输入，2026-09-10 发布）。它必须默认出现在每个 Oh-DSH surface
的模型选择器里，不需要用户做任何配置。

默认 advisory 目录编译在钉版运行时插件
`@deepseek-ai/dsh-llm-deepseek@0.1.2-rc.1` 内部（`DEFAULT_MODELS`:
deepseek-v4-flash、deepseek-v4-pro、deepseek-v4-flash-vision-exp）。运行
时以 npm tarball 形式由 `dsh-source.json` 钉版；更新的运行时版本（已核对
至 0.1.5-rc.1）要从 0.1.5-rc.1 起才列出 `deepseek-flash`，而该线没有任何
已发布 dsh-TUI 支持，且 `upstream/` 是不可修改的钉版源码。所以本发行版的
目录只能来自仓库自己的组合层。

## 决策

在三个 surface bundle patch——根目录 `cordis.patch.yml`（Desktop）、
`web/cordis.patch.yml`（Web）、`plugins/tui/cordis.patch.yml`（TUI）——中为
dsh-base 的 `llm-deepseek` 行写入条目 config，把 `config.models` 设为运行
时已有的三个模型加上 `deepseek-flash`（排在首位，名称
`DeepSeek-V4.1-Flash`，contextWindow 1000000，text+image，
imagePixelBudget 640000，imageMaxBytes 1048576——即运行时自己的 vision 模
型图像限额；0.1.5-rc.1 适配器原生条目携带同样事实）。已退役的
`deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` id 仍列出，因为钉版
运行时还在发行它们，端点也只是临时路由。TUI 层的行在 `models` 之外重述
TUI bundle 自己设的键（`apiKeyEnv`、`baseURL`、`thinking`、
`reasoningEffort`）：补丁行会整体替换该行 config，而 schema 对
thinking/effort 没有默认值。

这沿用了 dsh-base 自己声明的分层规则：后置 bundle patch 按 id 定位该行并
整体替换其 `config`；插件再把条目 config 垫在可选的 `llm-deepseek:` 用户
设置节之下。设置解析顺序是 schema 默认值 → 条目 base → 用户节（数组整体
替换），因此条目列表成为本发行版的默认目录；用户自己的
`llm-deepseek.models` 仍然无需重启即可覆盖它；该节其余字段继续回落到
schema 默认值。目录仍然是 advisory——[目录发现](../architecture/2026-07-15-llm-model-catalog-and-acp-selection.md)
从不校验请求，未列出的模型 id 继续原样透传。

条目逐字复述运行时的 id。默认 agent 模型选择不变：本变更加的是选择器
选项，不是新的默认值。

`tests/model-catalog.test.ts` 把三个 patch 层钉在完全相同的目录上，断言
条目事实与精确的四条目 id 顺序（`deepseek-flash` 在首位），并固定 TUI 层
重述的键，使这份有意的 3× 重复（与既有的每-surface 插件行惯例一致）不会
悄悄漂移。

## 备选方案

- **修改钉版运行时或 `upstream/` 来扩展 `DEFAULT_MODELS`。** 否决：
  `upstream/` 是钉版源码，运行时以 npm tarball 发布；Oh-DSH 在自己的组合
  层适配行为。
- **把钉版运行时升级到包含该模型的版本。** 暂否决：目录里第一个列出
  `deepseek-flash` 的版本是 0.1.5-rc.1，而没有任何已发布 dsh-TUI 声明该
  线（peer 上限 `0.1.2-rc.1`）；见
  [2026-09-11-dsh-0.1.2-rc.1-upgrade](../process/2026-09-11-dsh-0.1.2-rc.1-upgrade.md)。
- **首次运行时向用户的 settings.yaml 播种 `llm-deepseek:` 节。** 否决：
  设置文档是用户自有状态，由 web Models 页面读写；预先写入一节会与该属主
  冲突，并在发行版目录变化后留下陈旧条目。
- **构建期把单一共享 patch 片段生成进三个层。** 否决：patch 文件是人与运
  行时加载器共同阅读的手维护源码；为每 surface 约 25 行引入隐藏生成步骤
  得不偿失，漂移风险已由契约测试覆盖。

## 后果

- 三个 surface 默认以官方 id 列出 DeepSeek-V4.1-Flash。最初的临时方案
  （2026-09-08）因官方名称尚未发布而使用临时 id
  `deepseek-v4.1-flash-expires-on-0910`；2026-09-11 钉版运行时移到
  0.1.2-rc.1 时替换为 `deepseek-flash`。
- 条目列表遮蔽钉版运行时的 `DEFAULT_MODELS`：未来运行时新增或调整自己的
  默认值时，不会在这里自动出现，直到三个行被更新。这是发行版自有目录的
  代价；契约测试至少保证三个 surface 完全一致。待原生内置
  `deepseek-flash` 的运行时（0.1.5-rc.1）可达时，这些层——连同契约测试
  ——一起整体删除。
- DeepSeek 目前把退役的 `deepseek-v4-flash` /
  `deepseek-v4-flash-vision-exp` 临时路由到 V4.1 Flash，并将在
  2026-09-14 12:00（北京时间）后同样路由 `deepseek-v4-pro`，因此旧条目
  在删除前只是展示用途。
- 用户已保存的 `llm-deepseek.models` 节（若存在）仍然优先于发行版默认
  值，包括隐藏新条目；本变更不触碰任何用户状态。

## 测试

`tests/model-catalog.test.ts` 解析全部三个 patch 层（TUI 文件的 `!!js`
表达式标量按原始字符串保留），断言各 surface 目录一致、精确的四条目 id
顺序（`deepseek-flash` 在首位）、适配器强制执行的目录不变量（id 唯一；
图像限额只在支持图像的模型上）、条目的名称、上下文窗口、模态与图像限
额，以及 TUI 层重述的 thinking/effort 键。
