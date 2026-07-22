# Agent Note: ACP 快照测试——一次录制 / 确定性回放

Status: implemented

[English](2026-06-19-acp-snapshot-tests.md) | 中文

## 问题

单元测试不会覆盖完整的 ACP（Agent Client Protocol）子进程 transcript（文本记录），而真实 API 测试不具确定性且受密钥门控。因此，即使单元覆盖率为绿色，面向编辑器的 `session/update` 输出仍可能回归，[默认导出事后分析](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md)已经证明了这一点。

全 transcript 测试的阻塞因素在于模型：agent（智能体）的输出由非确定性的 LLM（大语言模型）驱动，而每次运行都命中真实 API 的密钥门控测试既不确定也无法在 CI 中运行。我们需要真实运行的保真度与 fixture（测试前置数据）的确定性兼得。

本 Agent Note（agent 决策记录）记下了新增第三层测试——**快照测试**——的决策，以及让它具备确定性、在 CI 中无需密钥、且维护成本低廉的设计选择。

## 决策

快照测试会启动真实 ACP 示例，通过确定性脚本驱动其 stdio 协议，并将规范化输出与已提交的预期输出比较。从真实 API 一次记录的 session log 为后续所有模型流提供数据。fixture 就是产品普通的持久化 JSONL。

### fixture 即持久化的会话 JSONL

每个场景的 `session.jsonl` 都从真实运行中采集。`assistant/chunk` 事件复现模型流；工具、消息和边界事件捕获 harness 行为。因此，一份普通 session 产物同时充当重放来源和行为预期输出。

当场景固定另一种物理存储布局时，其 fixture 会从真实的未打包对应项机械派生。场景测试要求包含每一种预期存储行类型，并在解码后逐事件精确相等；随后，普通重放与日志比较才会证明组合后的进程能够消费并复现该布局。

### 回放从日志推导模型脚本

`llm-replay` 短路了提供方无关的 `llm/stream` waterfall（瀑布式事件）。`deriveReplayScript()` 按 `(turn, step)` 对已录制的 chunk 分组，每次模型调用服务一组。agent loop（智能体循环）每个 step 发起一次流调用，因此分组精确对应，错误结束 chunk 也无需特殊处理。

### 内存中的回放条目遵守完整的 LLM 契约

`deriveReplayScript` 产出一组 `ReplayEntry`，即回放监听器按位置服务的内存单元：

```
{ kind: 'chunks', chunks: StreamChunk[] }
| { kind: 'throw', chunks: StreamChunk[], message: string, code: string }
| { kind: 'hang' }
```

日志推导出 chunk 条目。流开始前的抛出和挂起没有可重建的 chunk 表示，因此这些场景提供 `replay.override.json`。throw 条目可以包含前缀 chunk 以模拟流中途失败。显式覆盖避免了从有损的轮次结束原因推断适配器行为。

### 位置式回放，单个在途流

回放是位置式的，因此每个场景只允许一个在途模型流。并发会话快照需要按请求键索引的条目。调用顺序变更需要重新录制，fixture 缺失或耗尽时立即报错。

### 录制采集日志；无密钥回放需要无提供方的配置

记录模式使用真实 `llm-deepseek` adapter 和配置为 `persistenceCompression: 'none'` 的 JSONL 持久化后端运行场景，再把生成的 `.jsonl` 复制到场景目录。显式 raw 模式让已提交重放 fixture 保持逐行可读，而普通部署使用后端的压缩默认值。逐事件追加具有持久性，但 harness 会在采集前优雅关闭子进程（关闭 stdin → `await ctx.dispose()`），以确保最终事件已刷出。`llm-replay` 本身不执行记录——它只负责重放。

重放使用 `cordis.snapshot.yml` overlay，以 `llm-replay` 替换真实 adapter，同时保留实时组合。记录使用普通配置和由 harness 提供的持久化根目录。重放模式跳过 `.env` 加载，因此意外存在的 API 密钥不会触发实时调用。参见[单一来源配置 Agent Note](2026-07-04-single-source-acp-replay-config.md)。

### 两个表面：归一化后比对

快照运行断言**两个**归一化后的表面，因为 harness 的外部表面是不同的：

1. **stdout transcript**——编辑器看到的、经过 framing 的 `session/update` JSON-RPC。用于捕获 ACP bridge 中事件→更新转换（`streamSessionEventUpdate`）的回归。与已提交的 `stdout.expected.jsonl` 比较。
2. **重新持久化的 session JSONL**，经过规范化后与 `session.jsonl` 比较。同一 fixture 同时作为重放来源和预期日志。Prompt 文本会被清理；按照[请求头固定 Agent Note](2026-07-06-pin-request-header-content-in-one-scenario.md)所述，每种请求头类别由一个场景固定可读 prompt 与工具内容。Override 场景仅从其 sidecar 派生模型行为。

两个表面互补：stdout 覆盖 bridge 投影，JSONL 覆盖投影所省略的 loop、tool 和 boundary 结构。

规范化会替换 session、cwd、协议 id、时间戳、路径和进程易变值，同时保留确定性序号。场景把真实 bash 使用限制在稳定命令上。stdout 预期输出仍是线协议形状的 JSONL，每个原始行都必须可解析为 JSON。Vitest 只更新 stdout 预期输出；规范化 session 相等性检查从不覆盖重放 fixture。

### 隔离：当前靠归一化，后续可加沙箱

工具确定性来自生成的 cwd、清理后的环境、全新的非登录 shell、受限命令和规范化。cwd 默认为平台临时目录；当临时目录是始终可写的策略根，而行为需要独立项目位置时，场景可以改为提供其父目录。并发重放运行各自拥有独立 cwd、持久化目录和由定长场景键区分的 spill 根目录，因此一个场景的拆除无法删除另一个场景仍在进行的完整输出恢复，同时真实路径预览预算保持稳定。该层不声称提供 OS 级隔离。如果需要更强层级，sandbox executor 可以通过现有[能力接缝](../architecture/2026-06-13-capability-seams.md)替换本地后端。

### 回放插件是独立的包

`@deepseek-ai/dsh-llm-replay` 是一个支撑包（package），而非示例本地的胶水代码。它通过用从 JSONL 重建的流短路 `llm/stream` 来替换真实适配器，其包级放置使回放逻辑处于正常覆盖率门禁之下。

### 两个子命令，回放在默认门禁中

`pnpm run test:snapshot` 无需密钥即可重放已提交 fixture；`test:snapshot:record` 使用真实 API，并重写采集的 session log 与 stdout 预期输出。缺少 fixture 时会响亮失败。每个场景都包含 `input.json`、`stdout.expected.jsonl` 和 `session.jsonl`；不调用模型的情况使用仅有请求头的日志。只有标记为 `overridden` 的场景才需要 `replay.override.json`，因为它一旦存在就会取代派生重放。Fixture 守卫会拒绝缺失、不匹配和孤立文件。两个命令都接受场景过滤器。

## 曾考虑的替代方案

- **手工编写包含模型 chunk 的 `llm.json`**——早期草案；复用真实 session log，使 fixture 成为系统的真实产物而非手工构建的 mock，并让它同时充当行为预期输出。
- **字节级 HTTP 录制库（Polly/nock/MSW）**：否决。与适配器耦合，处理流式 SSE（Server-Sent Events）时笨拙，且层级低于被测对象。
- **从 `turn/end {kind:'error'|'aborted'}` 合成 throw/cancel 条目**：否决。这会将 `llm-replay` 耦合到 loop 内部的轮次关闭语义，且 `turn/end` 原因是有损的（无法区分抛出的 401 与 finish-error）；显式的 `replay.override.json` 伴随文件是更清晰的 seam。

## 后果

新测试层为每个场景增加经过评审的输入、session、stdout、可选 override 和可选 workspace fixture。记录与重放都会把 workspace seed 复制到生成的 cwd。作为回报，该层通过真实 Loader 和工具组合提供确定性的无密钥 transcript 覆盖。子进程、输入、workspace、规范化和重放 harness 也可以支持 ACP 之外的示例。

本 Agent Note 与[拟议的确定性 Agent Note](../../proposed/testing/2026-06-11-deterministic-and-stress-testing.md)相关，但不取代它：该提案的“通用重放 fixture”在每次测试后重新派生 session *消息历史*（内部一致性不变量），而快照测试固定*外部协议输出*。两者相互补充——一个守护事件溯源不变量，另一个守护面向编辑器的契约。
