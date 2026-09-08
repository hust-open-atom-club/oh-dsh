# Agent Note: 默认模型目录中的 DeepSeek-V4.1-Flash——surface patch 组合行

Status: implemented

[English](2026-09-08-deepseek-v41-flash-catalog.md) | 中文

## 问题

DeepSeek 上线了新的 `DeepSeek-V4.1-Flash` 模型(id 为
`deepseek-v4.1-flash-expires-on-0910`,文本+图像输入,2026-09-10 之后下线)。
它必须默认出现在每个 Oh-DSH surface 的模型选择器里,不需要用户做任何配置。

默认 advisory 目录编译在钉版运行时插件
`@deepseek-ai/dsh-llm-deepseek@0.1.2-alpha.3` 内部(`DEFAULT_MODELS`:
deepseek-v4-flash、deepseek-v4-pro、deepseek-v4-flash-vision-exp)。运行时以
npm tarball 形式由 `dsh-source.json` 钉版;更新的运行时版本(已核对至
0.1.3-alpha.2)仍然是同样的三个条目,而且 `upstream/` 是不可修改的钉版源码。
所以额外的模型只能来自本仓库自己的组合层。

## 决策

在三个 surface bundle patch——根目录 `cordis.patch.yml`(Desktop)、
`web/cordis.patch.yml`(Web)、`plugins/tui/cordis.patch.yml`(TUI)——中为
dsh-base 的 `llm-deepseek` 行写入条目 config,把 `config.models` 设为运行时
已有的三个模型加上新的 `deepseek-v4.1-flash-expires-on-0910` 条目
(contextWindow 1000000,text+image,imagePixelBudget 640000,imageMaxBytes
1048576——即运行时自己的 vision 模型图像限额)。

这沿用了 dsh-base 自己声明的分层规则:后置 bundle patch 按 id 定位该行并
整体替换其 `config`;插件再把条目 config 垫在可选的 `llm-deepseek:` 用户
设置节之下。设置解析顺序是 schema 默认值 → 条目 base → 用户节(数组整体
替换),因此条目列表成为本发行版的默认目录;用户自己的
`llm-deepseek.models` 仍然无需重启即可覆盖它;该节其余字段继续回落到 schema
默认值。目录仍然是 advisory——[目录发现](../architecture/2026-07-15-llm-model-catalog-and-acp-selection.md)
从不校验请求,未列出的模型 id 继续原样透传。

已有三个条目逐字复述运行时的 id。需求中的 `deepseek-v4-flash-exp`
(text+image)被解读为运行时的 vision 条目 `deepseek-v4-flash-vision-exp`——
即端点实际服务的 id——而不是引入第二个近乎重复的 id。默认 agent 模型选择
(`agent-default-model` → `deepseek-v4-flash`)不变:本变更加的是选择器选项,
不是新的默认值。

`tests/model-catalog.test.ts` 把三个 patch 层钉在完全相同的目录上,并断言
V4.1 条目的事实,使这份有意的 3× 重复(与既有的每-surface 插件行惯例一致)
不会悄悄漂移。

## 备选方案

- **修改钉版运行时或 `upstream/` 来扩展 `DEFAULT_MODELS`。** 否决:
  `upstream/` 是钉版源码,运行时以 npm tarball 发布;Oh-DSH 在自己的组合层
  适配行为。
- **把钉版运行时升级到包含该模型的版本。** 否决:已发布的运行时版本(截至
  0.1.3-alpha.2)都不包含 V4.1 条目,而运行时升级是一次更大的、与本题无关
  的钉版变更。
- **首次运行时向用户的 settings.yaml 播种 `llm-deepseek:` 节。** 否决:
  设置文档是用户自有状态,由 web Models 页面读写;预先写入一节会与该属主
  冲突,并在发行版目录变化后留下陈旧条目。
- **构建期把单一共享 patch 片段生成进三个层。** 否决:patch 文件是人与运行
  时加载器共同阅读的手维护源码;为每 surface 约 25 行引入隐藏生成步骤得不
  偿失,漂移风险已由契约测试覆盖。

## 后果

- 三个 surface 默认列出 DeepSeek-V4.1-Flash;模型 id 内嵌下线日期,因此
  2026-09-10 之后应一次性从三个层(及契约测试)删除该条目——无论如何该 id
  都会继续向端点透传。
- 条目列表遮蔽钉版运行时的 `DEFAULT_MODELS`:未来运行时新增或调整自己的
  默认值时,不会在这里自动出现,直到三个行被更新。这是发行版自有目录的
  代价;契约测试至少保证三个 surface 完全一致。
- 用户已保存的 `llm-deepseek.models` 节(若存在)仍然优先于发行版默认值,
  包括隐藏新条目;本变更不触碰任何用户状态。

## 测试

`tests/model-catalog.test.ts` 解析全部三个 patch 层(TUI 文件的 `!!js`
表达式标量按原始字符串保留),断言各 surface 目录一致、精确的四条目 id
顺序、适配器强制执行的目录不变量(id 唯一;图像限额只在支持图像的模型上),
以及 V4.1 条目的名称、上下文窗口、模态与图像限额。
