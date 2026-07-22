# RFC: 在单个快照场景中固定请求头内容

Status: implemented

[English](2026-07-06-pin-request-header-content-in-one-scenario.md) | 中文

## 问题

一个 ACP（Agent Client Protocol）快照测试套件需要证明每个 `request/header` 中实际发送的组合系统提示词与工具 schema 列表，但如果在每个 `session.jsonl` 中重复这些内容，一次提示词或 schema 编辑就会改写数十条巨大的单行 JSON 记录。保留一份原始 header 可以避免重复，但提示词的评审体验仍然很差：行文被 JSON 转义到一行中，与数千字符的工具 schema 混在一起。

## 决策

每个 header 组合类别恰好有一个场景被标记为 `pinsHeader`。其目录按评审格式拆分固定内容：`system-prompt.golden.md` 以普通 Markdown 存放归一化后的组合提示词，`tool-schemas.golden.json` 以结构化 JSON 存放完整的初始 schema 及后续 schema 变更，而 `session.jsonl` 保留 config、reason 及任何模型可见的前缀，同时将 `header.system` 和 `header.tools` 存为 `"{{system}}"` / `"{{tools}}"`。其余所有 JSONL 使用相同的提示词和工具 token，并同样对会话前缀内容做 token 化处理。固定机制实现在 [`dsh-acp-snapshot`](../../../../packages/support/acp-snapshot/README.md) 中，其套件工厂强制每个类别只有一个固定场景。

纯粹的 `scrubSystemPrompts` 和 `scrubToolSchemas` 归一化器应用于每个存储的会话 fixture（测试前置数据），独立地对初始 header 内容和 header-delta 批量内容做 token 化。`scrubRequestHeaders` 还为非固定场景的会话前缀内容做 token 化，同时保留结构性事实：system-delta 的位置与数量、新增/移除/变更的工具名称、前缀消息数量、字段存在性、config 和 reason。record 与 refresh 的回写操作在写入 JSONL 前应用相应的 scrub，并从归一化后的实时 header 和 delta 重新生成两个 sidecar 文件，因此两条路径都不会把提示词/schema 批量内容重新引入 JSONL，也不会让评审产物变陈旧。

守卫机制使这一拆分自我强制。在磁盘上：每个 `session*.jsonl` 都是提示词和 schema 两个 scrubber 的不动点；只有非固定 fixture 还必须是完整 header scrub 的不动点；两个 sidecar 文件恰好存在于固定 fixture 旁边，采用规范的换行终止格式；每个类别有且仅有一个固定场景。在运行时：由 parent、spawn 子会话、fork 子会话、初始请求或 resume 产生的每个 `request/header`，在经过易变值归一化后必须与重建的固定内容匹配；固定运行的提示词和 schema delta 也必须与其 sidecar 匹配。如果 header 没有字符串类型的 prompt、没有数组类型的工具列表，或包含未声明的 `request/header-delta`，则立即失败并报错。

一个固定场景覆盖整个套件，因为每个会话（parent、spawn 子会话、fork 子会话）组合出的工具列表完全相同、提示词除 cwd 外完全相同，而一致性守卫会在这一前提不再成立时立即使套件失败。如果 header 组合将来在设计上变为会话相关的（例如受限的 subagent 工具集），那么分歧的形态将获得自己的固定场景。

## 曾考虑的替代方案

- **每次变更重新录制或手动编辑所有 fixture**：保留了精确的 header，但行为差异被重复的提示词和 schema 内容淹没。
- **仅在比较时 scrub，fixture 保持原始内容**：比较能通过，但已提交的 fixture 保留着陈旧的重复内容，下次录制时会整体重写。存储 token 诚实地表明每个 JSONL 没有固定什么。
- **全部 scrub，不做任何固定**：丢失了组合 header 实际发送内容（提示词组装、已注册工具顺序、完整 schema）的唯一端到端记录。生成的工具目录只孤立地记录每个工具；只有真实 fixture 才能固定组合后的完整集合。
- **将完整固定内容全部保留在 JSONL 中**：消除了套件范围的重复，但提示词和 schema 变更仍然是一行转义文本。Markdown 和结构化 JSON 为每种内容提供其自然的评审格式，同时不削弱重建 header 的断言。
- **精简会话日志本身（记录内容摘要，将 header 存放在别处）**：违反可重建性契约：产品日志必须逐位重现每个请求（[可重建请求 RFC](../architecture/2026-07-05-reconstructable-requests.md)）。header 体积是测试产物的问题，在测试归一化中解决；线上日志不受影响。

## 验证

套件针对拆分后的固定内容回放每个场景。单元测试覆盖率涵盖独立 scrubber 和完整 scrubber、两种 sidecar 格式、record/refresh 重新生成、归一化提示词/schema 提取、不动点强制、必需文件对称性、重建 header 一致性以及 delta 拒绝。

## 后果

系统提示词变更在每个受影响的组合类别中产生一个面向行的 Markdown diff；工具描述变更在每个类别中产生一个结构化 JSON diff；普通行为 fixture 不受影响。会话 fixture 对省略的内容显示 token，运行时一致性守卫使每个拆分固定场景对其类别内的所有会话具有权威性。每个固定场景携带两个生成的、换行规范化的 sidecar 文件。
