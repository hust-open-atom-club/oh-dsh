# Agent Note: dsh-hook-protocol——Claude Code / Codex 钩子协议格式共享核心库

Status: implemented

[English](2026-06-30-hook-protocol-lib.md) | 中文

## 问题

hooks 子系统提供两个桥接插件：一个运行用户既有的 Claude Code（CC）钩子，另一个运行 Codex 钩子。研究参考实现（`~/repos/refs/claude-code`、`~/repos/refs/codex`）后发现一个决定性事实：**Codex 有意重新实现了 CC 钩子协议的一个子集。** 它的引擎读取相同的 `hooks.json`，使用相同的 matcher-group 形状、相同的 exit-code/structured-stdout 输出契约，以及相同的 command-hook 执行模型。Codex 的源码甚至以 Claude 的引擎命名，并在注释中标注了「有意偏离」之处。因此，如果不做抽取，两个桥接插件将大量重复协议逻辑。

本 Agent Note 引入 `@deepseek-ai/dsh-hook-protocol`，一个**库**（不是插件——它不注册也不注入任何东西），持有两个桥接插件共同依赖的真正相同的原语。共享与方言专属之间的分界是本设计的重心。

## 决策

在 `packages/hooks/` 分组下新建 `hook-protocol` 作为纯库。它拥有四个原语族和 `hook/*` 会话事件；每个桥接插件（`dsh-hooks-claude`、`dsh-hooks-codex`）拥有真正不同的部分。

**共享（本库）：**
- **Matcher** — `matchesMatcher(pattern, query, mode)`。两种方言唯一不同的轴被收敛为 `mode` 参数：`claude` 将纯 `[A-Za-z0-9_|]+` 模式视为字面量（管道符 = 精确匹配的多选），其余视为正则；`codex` 始终是无锚定正则。缺省/`''`/`'*'` 匹配一切；无效正则匹配空集（绝不向 agent loop（智能体循环）抛异常）。
- **Execution** — `runHook(bash, hook, options)`。通过 `ctx.bash` seam 而非自建 `spawn` 运行 command hook：执行器已提供清洗但可覆盖的 env、进程组 kill 和超时，正是协议所需的能力；`dsh-bash` 的 `stdin`/`env` 字段（正是为此添加的）是进程内桥接插件被允许使用的受信插件接口。它将桥接插件构建的 payload 序列化到 stdin（CC 时追加尾部换行），遵守钩子的 `timeoutSec`（否则使用 `DEFAULT_HOOK_TIMEOUT_MS`，即两种方言共享的 10 分钟参考默认值），且从不抛异常（执行器拒绝变为 non-blocking-error 的 `HookOutput`）。
- **Decode** — `parseHookOutput(exit, stdout, stderr)`，exit-code + structured-stdout 编解码器，产出方言无关的 `HookOutput`。Exit `0` → 宽松 JSON 解析 stdout；exit `2` → blocking error，`stderr` 为原因（以 `decision: 'block'` 呈现，调用方无需单独处理 exit-code 分支）；其他 → non-blocking error。解析 CC structured-stdout 中在某条路径上有消费方的字段（`continue`/`stopReason`/`decision`/`hookSpecificOutput.{permissionDecision,additionalContext,updatedInput}`/`systemMessage`）；桥接插件只采纳对其方言有意义的子集。在任何路径上都没有消费方的字段不予解析（CC 的 `suppressOutput`——钩子 stdout 在此处从不进入 transcript（文本记录），因此无需抑制；见 [tighten-hook-protocol-contract Agent Note](../simplification/2026-07-04-tighten-hook-protocol-contract.md)）。
- **Merge** — `mergeHookOutputs(outputs)`，将多个匹配钩子的输出折叠为一个最严格的 `MergedHookOutcome`：权限优先级 **deny > ask > allow**，halt 在首个 `continue:false` 时粘滞，block reason 以 `\n\n` 拼接，context/system-messages 按序累积。
- **`hook/*` 会话事件** — `hook/invoked` / `hook/result`，declaration-merge 进 `SessionEventMap`（仅日志，如 `compact/*`——不是 `SurfaceEventType`），配有 `appendHookInvoked`/`appendHookResult` 辅助函数，确保 invoked/result 配对与 turn 包含关系在各桥接插件间保持一致。`appendHookResult` 还拥有持久化记录的语义：decision 字符串（钩子解析出的 decision，否则 `continue:false` 时为 `'stop'`，否则为 `'pass'`）和 500 字符的 `stderrSummary` 截断均从本库的 `HookOutput` 派生，而非各桥接插件各自实现。

**方言专属（桥接插件）：** 构建每个事件的 stdin payload（CC 的 base+per-event 字段集 vs Codex 的 snake_case 加 `turn_id`/`model` 额外字段）、方言的 env 与 `${CLAUDE_PLUGIN_ROOT}` 替换（CC）vs 无替换（Codex），以及将方言无关的 `HookOutput`/`MergedHookOutcome` 映射为 harness seam 专属的类型化 Decision（`PreToolDecision`、`PromptDecision`、`ContinuationDecision`、`PostToolDecision`）。

## 曾考虑的替代方案

**单一参数化引擎。** 否决，因为 payload 构建与 decision 映射在方言间确实不同。Matcher、编解码器、执行、合并规则和事件保持共享；每个桥接插件保留自己的 payload 和映射，使其协议格式行为在代码中可就地阅读。

## 后果

每个桥接插件解析配置、构建方言 payload、调用共享的 runner 与 merge 逻辑、映射 decision、追加 `hook/*`。协议测试覆盖每种 matcher 模式、exit-code 与编解码器字段、runner 管道、merge 优先级和审计辅助函数，逐文件 100% 覆盖率；桥接插件测试验证库的真实加载路径。`updatedInput` 已解析但仅记录日志并发出警告，直到 [input-rewrite 提案](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md)落地。
