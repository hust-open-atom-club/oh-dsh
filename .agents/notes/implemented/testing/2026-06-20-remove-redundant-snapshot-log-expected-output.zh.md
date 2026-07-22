# RFC: 使用 `session.jsonl` 作为唯一的快照会话日志产物

Status: implemented

[English](2026-06-20-remove-redundant-snapshot-log-goldens.md) | 中文

## 问题

模型驱动的 ACP（Agent Client Protocol）快照场景同时包含 `session.jsonl` 和 `session.golden.jsonl`。对于普通录制场景，`session.jsonl` 是从真实运行中采集的回放 fixture（测试前置数据），回放测试对新持久化的日志做归一化后与 `session.golden.jsonl` 比较。在当前 fixture 中，普通录制场景的归一化录制日志与归一化 golden 完全一致。

手工编写的覆盖场景（`error-finish`、`cancel`）目前使用 `replay.override.json` 驱动模型行为，并保留 `session.jsonl` 作为最小占位 fixture，而 `session.golden.jsonl` 存放预期的持久化日志。覆盖文件是一个 `ReplayEntry` 对象的 JSON 数组：`{ "kind": "chunks", "chunks": StreamChunk[] }`、`{ "kind": "throw", "chunks": StreamChunk[], "message": string, "code": string, "status"?: number }` 或 `{ "kind": "hang" }`。这种拆分同样是多余的：当覆盖 sidecar 存在时，`llm-replay` 会替换派生脚本，不需要从 `session.jsonl` 获取模型分片，因此 `session.jsonl` 仍可作为该场景的预期会话日志产物。

## 决策

彻底移除 `session.golden.jsonl` 概念。每个场景最多只有一个提交到仓库的会话日志产物，即 `session.jsonl`：

- 对于录制场景，`session.jsonl` 仍是原始采集的日志。回放仍从中派生模型分片，快照测试将回放运行归一化后的持久化日志与归一化后的 `session.jsonl` 进行比较。
- 对于手工编写的覆盖场景，`replay.override.json` 驱动模型行为，`session.jsonl` 存放预期产出的会话日志。当覆盖文件存在时，回放适配器不从 fixture 获取模型分片，因此同一个文件既可作为预期日志，又不影响回放行为。
- 对于无模型场景，`session.jsonl` 可保留为引导 `llm-replay` 所需的最小 fixture；除非场景创建了持久化会话，否则无需进行会话日志比较。

stdout golden 保持不变；它们是面向编辑器的投影，与会话 fixture 不构成冗余。

## 曾考虑的替代方案

**对两侧基于共享的（回放运行）上下文做归一化**：否决。`normalizeSessionLog` 通过精确字符串匹配擦除 cwd，因此 fixture 中录制的 cwd 不会被擦除，每次比较都会失败。两侧各自基于自身 header 派生的上下文做归一化——下方的实现说明描述了具体机制。

## 验证

`session.golden.jsonl` 在快照 harness、fixture、遗留文件守卫和文档中均不再出现；快照测试对每个模型场景都从 `session.jsonl` 派生预期会话日志；手工编写的 sidecar 场景将预期产出的日志作为 `session.jsonl` 提交，并以 `replay.override.json` 作为模型行为覆盖；遗留 fixture 守卫知道每种场景类型需要哪些文件。[ACP 快照测试 RFC](../../implemented/testing/2026-06-19-acp-snapshot-tests.md) 描述了精简后的 fixture 集合。

## 后果

评审者失去了一个让预期持久化日志在视觉上与回放 fixture 分离的产物名称。stdout golden 仍保护编辑器 transcript（文本记录），将回放输出与 `session.jsonl` 比较则在不重复文件的前提下保留了循环/持久化的回归检查。

## 实现说明

两侧各自基于自身 header 值做归一化，因为录制与回放具有不同的 id、路径和时间戳。`fixtureContext()` 从 fixture 的 header 派生上下文，使已归一化的 fixture 具有幂等性。会话日志使用普通相等比较而非文件快照更新，因此比较过程不会改写 fixture。
