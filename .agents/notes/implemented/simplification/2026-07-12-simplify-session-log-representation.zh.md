# RFC: 简化会话日志表示

Status: proposed

[English](2026-07-12-simplify-session-log-representation.md) | 中文

## 问题

会话日志维护着两种表示，其机制复杂度超出了消费方的实际需求：一个伪链表 surface 和自定义的请求头增量。

`SurfaceManager` 用一个数组、一个 seq 映射和可变的 `prev`/`next` 链接存储相同的顺序。生产代码从不读取 `prev`；压缩（compaction）唯一的 `next` 读取是取数组位置的后继。替换操作已经使用 `indexOf`，因此链接并未让其主要操作达到常数时间。一个 seq 数组加线性替换查找具有相同的渐近替换开销，且只有一种表示需要验证。

请求头子系统实现了一套自定义的 system/tool 增量编解码器和传输决策层，尽管其契约声明增量只是编码优化，而非可重建性要求。在每个 agent loop（智能体循环）实例边界保留初始/恢复的完整快照，然后在该实例的组装头发生变化时写入一条规范的完整 `request/header`，即可保留回放能力，同时删除 `SystemDelta`、`ToolsDelta`、往返回退逻辑以及持久化的 `request/header-delta` 变体。编解码器专属的词汇随编解码器一起消失，并非因为其各分支本身无效。

本提案有意保留追加和替换的 `sourceEventSeqs`、崩溃恢复来源信息以及所有 `SessionStartSource` 变体：已实施的 RFC 赋予这些字段审计/拦截角色，零当前读者这一事实不足以推翻它们。

## 提案

将 `SurfaceManager.nodes` 改为事件序列号的 `readonly number[]`，移除公开的 `SurfaceNode` 形状。保留内部的替换代信号；更新 tool 配对平衡和压缩调用方，使其通过数组值/索引获取前驱、后继和替换范围，移除节点链接和 seq-to-node 映射。用规范的完整变更头快照替代锚点后的头增量，移除增量编解码器/事件/测试；初始和恢复锚点即使折叠后的头未变也仍为完整快照。

修订 session-surface 和 reconstructable-request RFC 中描述已移除编码的部分。更新事件类型/不变式、请求日志/回放、持久化 fixture（测试前置数据）、生成的 catalog、包文档和快照。将编解码器专属的 `fallback` 原因替换为锚点后完整快照的显式 `change` 原因，使其与保留的 `initial` 和 `resume` 锚点区分开来。

`SESSION_FORMAT_VERSION` 有意保持在 `0`，因此一份包含 `request/header-delta` 的旧 v0 日志在增量折叠被删除后，本会通过版本检查并静默丢失头变更。seed/load 校验必须在格式边界处拒绝该遗留事件并显式报错；不添加兼容性折叠或迁移。

## 曾考虑的替代方案

**保留链表节点和紧凑增量以备未来扩展。** 链接可能有助于未来的游标 API，增量在大型工具 schema 仅有少量变化时可以缩减日志。但没有已发布的游标使用这些链接，而完整快照以磁盘空间换取了显著更简单的正确性。如果头部体积确实成为问题，可以基于真实 trace 设计压缩方案或经过度量的规范增量方案。

## 验收标准

- `SurfaceManager.nodes` 是一个有序 seq 数组，没有 `SurfaceNode`、链接字段或 seq-to-node 映射；增量追加处理和内部替换代信号保留。
- 回放完整变更头快照能重建出完全相同的请求；不再存在任何 header-delta 事件/类型/编解码器。
- 包含遗留 `request/header-delta` 的 v0 seed 或持久化日志在回放前被拒绝，JSONL 和 SQLite 加载路径均有覆盖率。
- 新形状的 v0 JSONL/SQLite 回放、来源信息、崩溃恢复、压缩、快照、不变式、类型检查、覆盖率、doc-sync 和 hygiene 全部通过。

## 风险

完整头会增加日志体积，线性替换查找在非常大的 surface 上可能更慢。替换操作已经是线性的，因为实现调用了 `indexOf`；只有当真实 trace 表明更简单的数组成为瓶颈时才应添加基准测试。由于格式版本保持为 `0`，如果遗漏了对遗留事件的显式拒绝，后果将是静默数据损坏而非类型错误；因此显式报错的加载测试是本提案的组成部分，而非可选的清理工作。
