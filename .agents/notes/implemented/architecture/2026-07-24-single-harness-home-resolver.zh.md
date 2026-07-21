# Agent Note：单一 harness home 解析器

Status: implemented

[English](2026-07-24-single-harness-home-resolver.md) | 中文

## 问题

对于"DeepSeek Harness 用户数据存放在哪里"，harness 里存在三套互不一致的约定：

- `@deepseek-ai/dsh-home` 按 `configured ?? $DSH_HOME ?? ~/.dsh` 解析。
- `@deepseek-ai/dsh-paths` 又提供了**第二个** `resolveDshHome`，优先级相同但额外做了波浪号展开——它几乎是 `dsh-home` 的重复实现，却没有任何门禁发现，因为两者分属不同的包，而且早已漂移（只有一个会展开波浪号）。
- `@deepseek-ai/dsh-telemetry` 的 `globalConfigDir` 采用了*完全不同*的策略：`DSH_CONFIG_HOME > $XDG_CONFIG_HOME/deepseek-harness > %APPDATA%/deepseek-harness > ~/.config/deepseek-harness`。

于是产品的大部分内容都停放在同一个 `~/.dsh` 根目录下，唯独 telemetry 把匿名 id 存到别处，落在一个 `deepseek-harness` 命名空间里，这与全仓库通行的 `dsh` 简写（`DSH_HOME`、`@deepseek-ai/dsh-*`、`~/.dsh`）相冲突。两个解析器再加上一个各行其是的第三套策略，意味着不存在单一的 home 事实。

## 决策

由一个解析器统一掌管 harness home，落在 `@deepseek-ai/dsh-paths`，采用单一根目录：

```
explicit configured path  >  $DSH_HOME  >  ~/.dsh
```

空或仅含空白的 `$DSH_HOME` 被当作未设置处理，这与 telemetry 旧解析器所带的保护一致：若无此保护，`resolve('')` 会悄悄把 home 落在当前工作目录。harness 把所有用户数据都放在同一个根目录下；不存在 XDG 的 config/data/cache 拆分。`dshHomeDisplay()` 为面向用户的路径以符号形式命名已解析的根目录——默认 home 显示为 `~/.dsh`，任何已配置的 home 显示为 `$DSH_HOME`——这样面向用户全局的 `AGENTS.md` 标签就绝不会泄露机器上的绝对路径。它取代了 workspace-context 中自定义的"默认值 vs `$DSH_HOME`"判断。

`@deepseek-ai/dsh-home` 被删除。它的三个引用方（`dsh-tool-bash`、`dsh-skill-local`、`dsh-agent-spine-demo`）现在从 `dsh-paths` 导入 `resolveDshHome`。`dsh-telemetry` 的 `globalConfigDir` 转而委托给 `resolveDshHome`，去掉了它的第二个解析器、`DSH_CONFIG_HOME` 覆盖项、XDG/`%APPDATA%` 分支以及 `deepseek-harness` 命名空间；匿名 id 现在直接存放在 harness home 之下。

## 备选方案

**保留两份 `resolveDshHome` 副本。** 它们早已漂移（一个展开波浪号，一个不展开），并把同一条横切事实编码了两遍。`util/` 层的意义正是在于合并，重复的解析器是一个潜在的分歧 bug。

**采用 XDG（遵从 `$XDG_CONFIG_HOME`，或把 config/data/cache 拆分到各自的目录树）。** 经过考虑后放弃，转而采用一个显而易见的根目录。单一的 `$DSH_HOME || ~/.dsh` 基准事实与 `~/.claude` / `~/.aws` 一致，无需对每个 `~/.dsh` 消费方按类别重新归类，也不留下任何需要协调的解析器不对称。telemetry 对齐到同一根目录——而不是保留自己的 XDG 路径——正是本决策所要消除的那种分歧。

**保留 telemetry 自己的 config 目录。** 它的 `deepseek-harness` 命名空间和独立的 XDG 策略是唯一违背 `dsh`/`~/.dsh` 约定的例外。把它折叠到共享解析器上，才让"单一 home 事实"成真。代价是匿名 id 的作用域从机器变成了 `$DSH_HOME`：若某个项目把 `DSH_HOME` 指向仓库本地路径（或某条命令在 telemetry 之前加载了项目的 `.env`），得到的就是 home 本地的 id，因此该 id 统计的是 harness home，而非机器。这被接受为单一根目录的应有含义——重定位 `$DSH_HOME` 会移动*全部* harness 状态，telemetry 身份也在其中——模块契约据此表述为 per-harness-home 而非 per-machine。一个忽略 `$DSH_HOME` 的机器级全局身份，恰恰会重新引入本 Note 所要消除的那第二套 home 策略。

## 影响

- 单一 home 事实，单一解析器。`dsh-paths` 是唯一归属方；`util/` 组失去了 `home` 包。
- telemetry 的匿名 id 从 `~/.config/deepseek-harness/telemetry.json` 移到 harness home（默认为 `~/.dsh/telemetry.json`）。在预发布的"后端拒绝旧格式"立场下，这无需迁移：一个遗留的旧 id 只会重新生成一次，而且该 id 本就是匿名构造的。
- telemetry 去掉了 Windows `%APPDATA%` 处理。`resolveDshHome` 使用 `os.homedir()`，这在 Windows 上是正确的；harness 不会为它的单一根目录对 `%APPDATA%` 做特殊处理。
