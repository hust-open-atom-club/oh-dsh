# Agent Note: Skill 系统——面向 agent 的渐进式指令披露

Status: implemented

[English](2026-07-05-skill-system.md) | 中文

## 问题

Agent（智能体）产品已趋同于一种 skill（技能）模式：保持请求提示词精简，仅列出可用的指令包，当模型判定某任务匹配时再加载完整正文。Codex、Claude Code、OpenCode 与 Kimi Code 在细节上各有不同，但都将发现元数据与完整指令分离，使工作区能承载可复用的行为而无需在每个轮次支付全量提示词开销。

DeepSeek Harness 使用同一原语，使项目特定的评审、插件编写和工具使用指南存放在工作区或用户的 agent 配置旁，而非硬编码到 agent loop（智能体循环）中。

## 决策

`@deepseek-ai/dsh-skill` 是纯提供方注册表（`ctx.skills`），`@deepseek-ai/dsh-skill-local` 是随附的本地文件系统提供方，`@deepseek-ai/dsh-tool-skill` 负责会话前缀目录与面向模型的 loader 工具。`dsh-agent-spine-demo` 默认加载注册表、本地提供方和消费方，使 stdio 与 ACP（Agent Client Protocol）应用获得相同行为，同时嵌入式或远程提供方可在不修改注册表或消费方的前提下贡献 skill。其 `skills` 配置将 `registry`、`local` 和 `tool` 分支分别转发给对应的所有者。

提供方插件在 `apply()` 期间同步注册。提供方成员资格是由直接 effect 持有的状态：注册与 dispose（资源释放）同步地使已完成的目录失效，发现操作按需读取当前提供方映射而非监听注册表变更事件。提供方目录从等待的 `list()` 调用返回排序后的候选项，远程提供方在此过程中执行初始化、认证和发现，同时遵守查找的 abort 信号。注册表校验每个候选项，按排名、提供方注册顺序和提供方内部顺序以先到先得方式解决同名 skill 冲突，然后按 skill 名称排序摘要以保证消费方获得确定性结果。它仅缓存已完成的目录快照，并在发现过程中提供方/运行时修订版本发生变化时重试，因此卸载操作不会将一个陈旧且不可解析的 skill 冻结到会话前缀中。运行时 `ctx.skills.register(...)` 仍作为嵌入式进程内 skill 的便捷方式保留，使用 project 优先于 user 的优先级；`runtime` 保留为注册表拥有的提供方名称。

本地提供方按先到先得的排名顺序扫描 cwd 敏感的项目根目录、自定义根目录和用户根目录：项目 `.dsh`、项目 `.agents`、`customSkillDirs`、用户 `.dsh`，然后是用户 `.agents`。用户 `.dsh/skills` 扫描跳过 `.system`，以免系统拥有的目录被当作普通用户内容处理。DeepSeek Harness 不随附内置系统 skill；嵌入式或远程提供方在配置后提供额外 skill。

每个 skill 是 `<name>/SKILL.md` 或带 YAML frontmatter 的 `<name>.md`。`name` 和 `description` 为必填；`whenToUse`、`disableModelInvocation` 和 `metadata` 为可选。名称采用 kebab-case。YAML frontmatter 使用 `yaml` 包（package）解析，而非 `js-yaml` 或手写解析器：`yaml` 是本包有限 frontmatter 需求已声明的现代解析器，窄解析器要么拒绝用户预期可用的合法 YAML，要么膨胀为一个未经评审的 YAML 子集。

本地 skill 的文件系统 I/O 在加载了文件系统服务时通过 `ctx.fs` 进行：项目根目录查找使用 `resolve` 和 `stat` 探测 `.git`，根目录发现使用 `listDir`，skill 读取使用 `readText`。Node 文件系统作为后备，供在不挂载 fs seam 的最小上下文中加载 `dsh-skill-local` 时使用。缺失的根目录、不可读或格式错误的 skill 文件、以及提供方 `list()` 的瞬态失败均降级为警告并跳过，使一个坏源不会导致所有 agent 请求失败；格式错误的候选项仍然快速失败，因为它们违反了提供方契约。

`dsh-tool-skill` 通过 [`agent/session-prefix`](2026-07-07-session-prefix.md) 贡献一个 user-role `<system-reminder>` 目录。该目录仅包含排序后的 skill 名称与描述；不包含正文、路径、来源、提供方和路由提示。描述经过空白规范化、XML 转义，并受 `catalogDescriptionMaxLength` 上限约束，其默认值为 `500`，最小值为 `3`。session-prefix seam 将仅用于请求的目录按 loop 实例冻结，并记录在请求头中，在不将其加入持久化历史的前提下保持可重建性。完整的 skill 正文从不包含在目录中。

`skill({ name })` 工具为当前 agent cwd 加载一个完整 skill，返回包含 `<skill_content name="...">`、`<skill_resources>` 和 `<skill_instructions>` 的工具结果。`resourceBase` 提供一个目录、URL 或不透明的提供方管理的基路径，用于显式引用的脚本、参考资料和资产；资源仅按需加载，不进行目录枚举。无法解析的名称报告该 skill 未知或不再可用；无效名称和标记了 `disableModelInvocation` 的 skill 保留不同的工具错误。工具结果是面向模型的可见披露路径。

数据结构与目录/工具契约记录在 [skills.md](../../../../docs/core-data-structures/skills.md) 中，服务签名见生成的[服务目录](../../../../docs/cordis-catalog/services.md)。

## 曾考虑的替代方案

**将完整 skill 正文注入每条系统提示词。** 否决，因为这破坏了渐进式披露，使每个请求都为可能不适用的指令付出代价。

**仅以斜杠命令暴露 skill。** 否决，因为模型主动加载是核心能力；斜杠/ACP 命令广播不改变发现机制。

**将本地文件系统扫描直接放入 `ctx.skills`。** 否决，因为编码 agent、Web agent 和未来的插件生态需要不同的 skill 来源。提供方注册表与 subagent seam 镜像：注册表拥有冲突解决和消费方，实现拥有加载。

**使用系统提示词段落。** 否决，因为渲染后的系统提示词是单一字符串，而目录是一条具有仅请求生命周期要求的 user-role `<system-reminder>` 消息。[`agent/session-prefix`](2026-07-07-session-prefix.md) 是选定的机制：它将目录置于派生历史之前，并将组合后的消息记录在请求头中。

**在 `~/.dsh/skills/.system` 下物化内置 DSH 编写 skill。** 否决，因为打包的 skill 不应在启动时写入用户主目录，嵌入式或远程提供方在配置后提供 skill。

**递归发现嵌套的 `**/SKILL.md`。** 否决。扁平文件和一级目录包覆盖了配置的根目录，同时使重复处理和目录顺序易于推理。

**手写 frontmatter 解析器。** 否决，因为已接受的 schema 包含一个开放的 `metadata` 对象。窄解析器要么拒绝用户预期可用的合法 YAML，要么膨胀为一个未经评审的 YAML 子集。

## 后果

agent-core 主干包含一个 session-prefix 贡献者、一个本地提供方和一个面向模型的工具。Skill 发现是 cwd 敏感的，因此以不同会话 cwd 值创建 agent 的调用方可以按设计观察到不同的项目 skill 覆盖。

目录对于固定的根目录集合和运行时注册修订版本是确定性的，但不监视磁盘变化；发现结果被缓存，直到运行时注册使缓存失效或进程重启。

## 延后

Fork 的 skill 上下文（`context: fork`）、参数声明与提示（`arguments` 和 `argument-hint`）、以及逐 skill 的工具约束（`allowed-tools` 和 `disallowed-tools`）不在已交付的契约范围内。注册表、本地提供方和面向模型的工具不解析、不广播、也不执行这些字段，`user-invocable` frontmatter 字段同样不会被解析。直接用户调用本身则作为消费方层面的能力交付：TUI 前门基于注册表现有的 `list()` 与 `get()` 方法提供手动 `/skill:<name>` 命令，无需变更注册表、提供方或工具契约——见 [TUI skill 斜杠命令](2026-07-21-tui-skill-slash-command.md)。
