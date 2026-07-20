# Agent Note: steering 消息投影为普通用户内容

Status: implemented

[English](2026-07-20-unwrap-steering-message-projection.md) | 中文

## 问题

`Session.deriveEventMessage` 曾把 `steering/message` 包在 `<steering source="…">…</steering>` 封套里渲染，与 `context/message` 的框架保持一致。但这两类事件性质不同：上下文注入是环境性的、非对话性的材料（文件变更通知、工作区指令），封套告诉模型「这不是用户在说话」；而 steering（中途引导）恰恰**是**用户（或代表用户的插件）在轮次中途发言——「再回复 SECOND」「专注于测试」。把这种指令包进 XML 标签会让模型把本应作为一等用户消息对待的指令当成第三方元数据；已录制的 transcript（文本记录）显示，模型会推理是否要服从「那条 steering 输入」，仿佛它是旁观者的附注。

## 决策

`steering/message` 投影为普通的 user 角色消息，逐字携带其内容块——与 `user/message` 的投影完全相同。`context/message` 上的 `<context>` 封套（及其 `raw` 退出选项）保持不变。`packages/core/session/src/index.ts` 中原来的 `renderTagged` 辅助函数现在是只服务于 context 的 `renderContextEnvelope`，不再接受标签参数。压缩（compaction）渲染器的 `[Steering: …]` 标注不受影响：那是摘要输入格式，不是模型可见的历史。

封套曾携带的 `source` 归属并未丢失——它仍保留在持久的 `steering/message` 事件上；只是不再渲染进模型 transcript。

## 备选方案

- **仅对插件来源的 steering 保留封套** —— 会按 `source.kind` 把一条投影拆成两条，却没有观察到任何收益；插件引导 agent（智能体）时（钩子桥接器的轮次续行原因）同样希望指令被遵从，而不是被归因。
- **把去封套的逻辑移入适配器** —— 规范投影就是模型可见契约（「模型可见 ⟺ 已记录」）；让各适配器在框架上各行其是，会使派生的 transcript 依赖于适配器。

## 影响

- 中途引导以与普通用户提示相同的权重到达模型。
- transcript 不再区分 steering 注入与用户消息；需要这一区分的消费方读取持久事件日志，其中 `steering/message` 及其 `source` 完整保留。
- [内容块词汇表 Agent Note](../architecture/2026-06-11-content-block-vocabulary.md) 中关于带标签封套的条款现在只覆盖 `context/message`，并已修订为指向本文。
