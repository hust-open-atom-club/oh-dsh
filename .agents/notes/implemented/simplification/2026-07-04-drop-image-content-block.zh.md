# RFC: 移除 `image` 内容块，直到有路径能真正处理它

Status: implemented

[English](2026-07-04-drop-image-content-block.md) | 中文

## 问题

`ImageBlock`（`packages/llm/llm/src/types.ts`）没有任何生产环境的生产者，而每条路径上的每个消费方都将其丢弃：deepseek 适配器的序列化器跳过 image 块（这是文档中注明的 MVP 限制）；pi-ai 转换器因无法表示而跳过；ACP 编解码器既不宣告 image prompt 能力、也不向外转发 image 块，并且会拒绝入站的 image prompt 内容；压缩（compaction）估算器对其收取一个固定 token 常量并渲染为 `[image]`。此时构造的 `ImageBlock` 会在协议格式（wire format）上静默消失——词汇宣告了一种没有任何路径兑现的能力，这正是 AGENTS.md 防御性模式所警告的静默数据丢失形态。唯一的构造调用出现在测试中，用于覆盖 skip/drop/estimate 分支。

## 决策

移除 `ImageBlock`、其 map 条目，以及适配器、ACP 渲染和压缩中的 image 专用分支。在同一个变更中更新所属的词汇文档与生成的引用。未知扩展块仍然覆盖默认分支，ACP 继续独立于 harness 词汇拒绝入站的 image prompt 内容。

## 曾考虑的替代方案

### 为什么不保留？

当适配器、ACP 和压缩全部支持 image 时，`ContentBlockMap` 可以重新引入。保留一个唯一实现就是拒绝的核心类型，等于宣告一个不可用的对外服务接口；移除后，生产者会立即得到编译期错误。

评审中记录的回退方案（假如评审决定保留该槽位）：保留 `ImageBlock`，但将所有静默跳过替换为显式拒绝，并在词汇文档中记录该策略——静默丢弃是唯一没有辩护者的状态。评审最终决定移除；此回退方案作为文档化的替代方案保留，以备该槽位在完整功能就绪之前回归。

## 验证

RFC 记录之外没有任何地方构造 harness 的 `ImageBlock`。ACP 独立的入站 image 拒绝仍有测试覆盖，适配器、编解码器和压缩的默认分支则通过插件定义的块类型来覆盖。

## 后果

日后重新添加核心词汇类型需要同时改动多个包（package）——但这种协调变更本就是真正的多模态功能所需的形态（适配器映射、ACP 能力宣告、压缩定价），而当前并不存在需要保留的实现。
