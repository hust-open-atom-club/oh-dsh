# Agent Note: 皮肤自有的 TUI markdown 代码块语法令牌

Status: implemented

[English](2026-09-11-tui-skin-syntax-tokens.md) | 中文

## 问题

用户反馈已安装的 `ohdsh tui`（0.2.1，dsh-TUI beta.4）渲染 markdown 时
颜色太浅。针对安装构建的排查：活动皮肤解析正确（`theme.json` →
`oh-dsh-skin-deep-current`，经注册的静态 resolver），标题与行内代码也带
皮肤主色。发暗的是围栏代码块：dsh-TUI 的 markdown 渲染器把 highlight.js
的 token 类映射到主题键 `syntaxKeyword/String/Comment/Number/Function/
Type/Variable/Operator/Punctuation/Constant`，而 Oh-DSH 的皮肤色板一个都
没定义。所有代码块因此继承终端内置 `dark` 色板的固定灰——注释
rgb(116,128,141)、标点 rgb(122,134,148)、操作符 rgb(147,161,176)——在深色
背景上对比度接近 3:1。dsh-TUI v0.10.0 的内置值相同，仅升级 runtime
解决不了。

## 决策

`plugins/skins/src/skins.ts` 的 `tuiColors()` 现在从每个皮肤的共享 token
输出全部十个语法令牌：keyword=brand-primary、string=success、
comment=label-tertiary、number=warn、function=brand-hover、type=皮肤的
merged 辅助色（对应上游"类型用紫色"的惯例）、variable=label-primary、
operator/punctuation=label-secondary、constant=error。浏览器侧皮肤的代码
块本来就取自同一组 token 族，因此终端与浏览器的代码块在每个皮肤下保持
一致。浅色皮肤（Porcelain）通过同一映射在浅色底上得到深色语法色。

## 后果

- 纯文本与围栏代码块跟随皮肤：variable/标识符文本按皮肤主标签色渲
  染，不再使用内置固定灰；注释从内置 rgb(116,128,141) 提升到皮肤的
  三级标签色。
- 已安装的 0.2.1 仍保留旧主题文件：它的 skins 插件每次启动都会重写
  `~/.ohdsh/tui/themes/*.json`，因此改进随携带此变更的版本发布（手动改
  主题文件会在下次启动时被覆盖回去）。
- 已用新主题 JSON 对安装版 beta.4 渲染器做过端到端验证：纯文本块输出
  皮肤主标签色、`const` 输出皮肤主色、注释输出皮肤三级色。

## 考虑过的替代方案

- **在上游修内置色板对比度。** 本轮否决：固定源码不许在下游修改，且
  v0.10.0 内置值未变，皮肤层才是 Oh-DSH 现在自己拥有的抓手。
- **只覆盖 `subtle`/`inactive`。** 否决：这些键不在代码块渲染路径上；
  围栏行本就是皮肤三级色，报告针对的是 markdown 内容对比度。

## 测试

`tests/skins.test.ts`、`tests/model-catalog.test.ts`、`tests/tui.test.ts`
通过；完整测试 402 个、0 失败；任务审计目录下的回放工具用再生的主题
JSON 驱动安装版 beta.4 渲染器，输出 ANSI 中可见新令牌颜色。
