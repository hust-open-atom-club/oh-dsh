# Agent Note: TUI skill slash command

Status: implemented

[English](2026-07-21-tui-skill-slash-command.md) | 中文

## Problem

[skill 系统](2026-07-05-skill-system.md)交付时只有模型发起加载这一条路径：`skill({ name })` 工具让模型把某个 skill 正文拉进一个轮次，但操作 TUI 的人无法按需加载 skill。其他编码 agent（智能体）正是为此提供了 `/skill:<name>` 斜杠命令——由用户而非模型判断某个任务与某个 skill 匹配，并注入其指令。skill 系统 note 把直接的用户发起调用列为待办工作，而交互式前门正是它该落地的地方。

## Decision

[`@deepseek-ai/dsh-tui`](../../../../packages/ui/tui/README.md) 前门拥有一条 `/skill:<name> [instructions]` 命令。提交时它加载指定的 skill，并投递一个文本块作为用户轮次——空闲时用 `agent.send()` 发送、运行中用 `agent.steer()` 中途引导，与普通编辑器输入遵循同一规则。该文本块由 `renderSkillInvocation(skill, instructions)` 生成：一个包裹 skill 正文的 `<skill name="…">` 元素，当提供方暴露资源基址时在其前加一行资源基址行，用户尾随的文本在空行之后追加。该命令是 TUI 独有的能力；它不新增任何面向模型的工具，也不改动任何 skill 系统包的契约。

TUI 通过 `ctx.get('skills')` 读取 skill 服务，而非声明式注入，因为 skill 是条件挂载的：没有注册表的部署仍保有可用的前门，此时 `/skill:` 会报告 skill 不可用，而不是挂载失败。`createTuiChat` 是同步的，而 `ctx.skills.list()` 是异步的，所以自动补全先立即种入静态斜杠命令，待目录解析完成后再用 `skill:<name>` 条目重建 provider（提供方）；在 dispose（资源释放）之后才到达的解析结果会被丢弃，而被拒绝的查找会保留基础命令。

自动补全只列出模型可调用的 skill——它基于 `list()` 构建，而 `list()` 会略去 `disableModelInvocation` 的 skill——手动提交则通过 `get()` 解析，skill 注册表将其记录为返回被禁用 skill 的可信调用方路径。因此用户可以通过键入 skill 的确切名称加载任意 skill，但补全菜单绝不会宣传一个本不该让模型看见的 skill。未知名称、前缀之后为空的名称、以及查找失败，都会各自呈现为 transcript（文本记录）中的一条通知，且不发送任何内容。

`renderSkillInvocation` 及资源基址行是 TUI 自有的，刻意不复用 `dsh-tool-skill` 的 `skill` 工具结果。该工具把正文包进 `<skill_content>`/`<skill_resources>`/`<skill_instructions>` 是为了一个*工具结果*；而手动调用是一个*用户轮次*，把两个渲染器耦合起来会迫使一种面向模型的形态同时服务两个界面。代价是两个都在格式化 skill 正文的渲染器；收益是各界面面向模型的文本可以独立演进，且各自在其产出处被固定。

## Alternatives considered

**新增 `user-invocable` frontmatter 字段并在注册表中强制执行。** 本次改动否决。skill 系统 note 把该字段列为待办，而手动调用并不需要它：TUI 是可信的本地调用方，`get()` 已经授权加载任意 skill，自动补全的可见性以既有的 `disableModelInvocation` 为准。新增一个逐 skill 字段会给注册表、本地提供方和工具都加上一条契约，而除了可见性之外没有任何现有消费方，可见性又已由 `disableModelInvocation` 覆盖。

**把 `skills` 声明为 TUI 注入。** 否决，因为 skill 是条件挂载的；声明式注入会使前门必须依赖注册表，缺少它就拒绝挂载，与本包可选服务的立场相悖。`ctx.get('skills')` 读取全局存储并容忍其缺失。

**复用 `dsh-tool-skill` 的渲染器。** 否决，因为它的输出是为模型的工具通道所写的工具结果形态（`<skill_content>` 及其同类），而斜杠调用是一条用户消息。共用它要么把工具结果词汇泄漏进用户轮次，要么按 `surface` 标志分叉共享渲染器——比两个小格式化器耦合更重。

**让提交经由模型的 `skill` 工具。** 否决，因为用户已经作出了判断；一次工具调用会花掉一个模型往返去取一份前门可以直接加载的正文，而且在 agent 处于轮次中途时也无法工作。

## Consequences

手动调用总是重新加载完整的 skill 正文：TUI 不会检测某个 skill 是否已在对话中出现，因此重复的 `/skill:` 会再次追加其指令——这可以接受，因为重新注入有时正是意图所在，且已在本包 README 的已知限制中说明。上文接受的双渲染器重复是一项长期维护成本。`<skill name="…">` 包裹是稳定的、模型可见的文本，并在单元测试中针对一个真实的 `SkillService` 逐字固定；帮助面板那一行由 `errors-and-help` 终端快照固定。自动补全的填充、dispose 后查找分支、以及查找失败分支，都由挂载真实注册表或可控服务的单元测试覆盖。端到端的投递由一项专门的真实组合测试证明：`examples/tui-agent` 的无密钥 PTY 冒烟测试（`tui-keyless-smoke.e2e.ts`）在真实伪终端下经由 loader 引导生产环境的 TUI/agent/skill 栈，仅对模型进行脚本化，把一个夹具 skill 放入 agents home 的 `skills/` 根下，以真实按键输入 `/skill:<name>`，并断言：只有当渲染出的 `<skill>` 文本块抵达时，脚本化适配器才会回显该夹具的正文标记——从而一并演练了 `ctx.get('skills')` 在发布树中的解析、客户端解析、本地 provider 的加载，以及用户回合抵达模型。该夹具的 frontmatter 描述避免出现 `: ` 冒号加空格，使其 YAML 保持为纯标量；frontmatter 无效的 skill 会在发现阶段被静默丢弃。
