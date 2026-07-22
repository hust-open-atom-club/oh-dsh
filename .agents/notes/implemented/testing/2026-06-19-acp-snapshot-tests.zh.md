# RFC: ACP 快照测试——一次录制 / 确定性回放

Status: implemented

[English](2026-06-19-acp-snapshot-tests.md) | 中文

## 问题

单元测试无法覆盖完整的 ACP（Agent Client Protocol）子进程 transcript（文本记录），而真实 API 测试既不确定又需要密钥。因此，面向编辑器的 `session/update` 输出可能在单元覆盖率全绿的情况下发生回归，正如 [default-export 事后分析](../../../postmortem/0001-acp-default-export-drops-inject.md)所揭示的那样。

全 transcript 测试的阻塞因素在于模型：agent 的输出由非确定性的 LLM（大语言模型）驱动，而每次运行都命中真实 API 的密钥门控测试既不确定也无法在 CI 中运行。我们需要真实运行的保真度与 fixture（测试前置数据）的确定性兼得。

本 RFC 记录了新增第三层测试——**快照测试**——的决策，以及使其具备确定性、CI 中无需密钥、维护成本低的设计选择。

## 决策

快照测试启动真实的 ACP 示例，通过确定性脚本驱动其 stdio 协议，并将归一化后的输出与已提交的 golden 文件比对。一次从真实 API 录制的会话日志为后续所有模型流提供数据。fixture 就是产品正常持久化的 JSONL。

### fixture 即持久化的会话 JSONL

每个场景的 `session.jsonl` 从一次真实运行中采集。`assistant/chunk` 事件重现模型流；tool、message 和 boundary 事件捕获 harness 行为。一份普通的会话产物因此同时充当回放源和行为 golden。

### 回放从日志推导模型脚本

`llm-replay` 短路了提供方无关的 `llm/stream` waterfall（瀑布式事件）。`deriveReplayScript()` 按 `(turn, step)` 对已录制的 chunk 分组，每次模型调用服务一组。agent loop（智能体循环）每个 step 发起一次流调用，因此分组精确对应，错误结束 chunk 也无需特殊处理。

### 内存中的回放条目遵守完整的 LLM 契约

`deriveReplayScript` 产出一组 `ReplayEntry`，即回放监听器按位置服务的内存单元：

```
{ kind: 'chunks', chunks: StreamChunk[] }
| { kind: 'throw', chunks: StreamChunk[], message: string, code: string, status?: number }
| { kind: 'hang' }
```

日志推导出 chunk 条目。流开始前的抛出和挂起没有可重建的 chunk 表示，因此这些场景提供 `replay.override.json`。throw 条目可以包含前缀 chunk 以模拟流中途失败。显式覆盖避免了从有损的轮次结束原因推断适配器行为。

### 位置式回放，单个在途流

回放是位置式的，因此每个场景只允许一个在途模型流。并发会话快照需要按请求键索引的条目。调用顺序变更需要重新录制，fixture 缺失或耗尽时立即报错。

### 录制采集日志；无密钥回放需要无提供方的配置

录制使用真实的 `llm-deepseek` 适配器和 JSONL 持久化后端运行场景，然后将产出的 `.jsonl` 复制到场景目录。逐事件追加是持久的，但 harness 在采集前会优雅关闭子进程（关闭 stdin → `await ctx.dispose()`），确保最终事件已刷盘。`llm-replay` 本身不做录制，它只负责回放。

回放使用 `cordis.snapshot.yml` 覆盖配置，将真实适配器替换为 `llm-replay`，同时保留活跃的组合。录制使用普通配置和 harness 提供的持久化根目录。回放模式跳过 `.env` 加载，因此一个意外存在的 API key 不会触发真实调用。见[单源配置 RFC](2026-07-04-single-source-acp-replay-config.md)。

### 两个表面：归一化后比对

快照运行断言**两个**归一化后的表面，因为 harness 的外部表面是不同的：

1. **stdout transcript**——编辑器看到的带帧 `session/update` JSON-RPC。捕获 ACP bridge 事件→update 转换（`streamSessionEventUpdate`）中的回归。与已提交的 `stdout.golden.jsonl` 比对。
2. **重新持久化的会话 JSONL**，归一化后与 `session.jsonl` 比对。同一份 fixture 既是回放源也是预期日志。提示词文本被擦除；每个 header 类别一个场景固定可读的 prompt 和 tool 内容，见 [header-pinning RFC](2026-07-06-pin-request-header-content-in-one-scenario.md)。覆盖场景的模型行为完全来自其伴随文件。

两个表面互补：stdout 覆盖 bridge 投影，JSONL 覆盖投影所省略的 loop、tool 和 boundary 结构。

归一化替换 session、cwd、protocol-id、时间戳、路径和进程相关的易变值，同时保留确定性序列号。场景将真实 bash 使用限制在稳定命令范围内。stdout golden 保持协议格式（wire format）的 JSONL，每一行原始数据必须可解析为 JSON。Vitest 只更新 stdout golden；归一化后的会话相等性检查从不覆盖回放 fixture。

### 隔离：当前靠归一化，后续可加沙箱

工具的确定性来自临时 cwd、擦除的环境变量、全新的非登录 shell、受限命令和归一化。它不声称具备操作系统级隔离。如果需要更强的隔离层级，可通过既有的[能力 seam](../architecture/2026-06-13-capability-seams.md) 将沙箱执行器替换本地后端。

### 回放插件是独立的包

`@deepseek-ai/dsh-llm-replay` 是一个支撑包（package），而非示例本地的胶水代码。它通过用从 JSONL 重建的流短路 `llm/stream` 来替换真实适配器，其包级放置使回放逻辑处于正常覆盖率门禁之下。

### 两个子命令，回放在默认门禁中

`pnpm run test:snapshot` 无需密钥地回放已提交的 fixture；`test:snapshot:record` 使用真实 API 并重写采集到的会话日志和 stdout golden。fixture 缺失时立即报错。每个场景携带 `input.json`、`stdout.golden.jsonl` 和 `session.jsonl`；无模型场景使用仅含 header 的日志。`replay.override.json` 仅在标记为 `overridden` 的场景中必需，因为它的存在会替换推导出的回放。fixture 守卫拒绝缺失、不匹配和遗留的文件。两个命令均接受场景过滤器。

## 曾考虑的替代方案

- **手工编写的模型 chunk `llm.json`**：早期草案的做法。复用真实会话日志使 fixture 成为系统的真实产物而非手工构建的 mock，并兼作行为 golden。
- **字节级 HTTP 录制库（Polly/nock/MSW）**：否决。与适配器耦合，处理流式 SSE（Server-Sent Events）时笨拙，且层级低于被测对象。
- **从 `turn/end {kind:'error'|'aborted'}` 合成 throw/cancel 条目**：否决。这会将 `llm-replay` 耦合到 loop 内部的轮次关闭语义，且 `turn/end` 原因是有损的（无法区分抛出的 401 与 finish-error）；显式的 `replay.override.json` 伴随文件是更清晰的 seam。

## 后果

新测试层为每个场景增加了经评审的 input、session、stdout、可选 override 和可选 workspace fixture。workspace 种子在录制和回放时都会被复制到临时 cwd。作为回报，该层通过真实的 Loader 和 tool 组合提供确定性的无密钥 transcript 覆盖。子进程、input、workspace、归一化和回放 harness 可以支持 ACP 之外的示例。

本 RFC 与[拟议的确定性 RFC](../../proposed/testing/2026-06-11-deterministic-and-stress-testing.md) 相关但不取代它：该提案的「通用回放 fixture」在每次测试后重新推导会话的*消息历史*（一项内部一致性不变式），而快照测试固定的是*外部协议输出*。二者互补：一个守护事件溯源不变式，另一个守护面向编辑器的契约。
