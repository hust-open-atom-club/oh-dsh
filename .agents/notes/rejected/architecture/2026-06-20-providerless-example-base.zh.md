# Agent Note: 使共享示例基础配置与提供方无关

Status: rejected — 已由[将示例应用提取到 packages 中](../../implemented/architecture/2026-06-20-extract-example-app-packages.md)取代；后者把 spine 移入 `dsh-agent-spine-demo` bundle 并删除 `base*.yml` 文件，因此已不存在可重命名的共享基础 YAML。

[English](2026-06-20-providerless-example-base.md) | 中文

## 问题

示例曾有两个共享基础文件：`examples/base-core.yml` 与提供方无关，而 `examples/base.yml` 在该核心基础上加入了真实的 `llm-deepseek` 适配器。快照回放需要与提供方无关的核心配合 `llm-replay` 使用，因为在没有密钥的情况下加载真实适配器会抛出异常。常规演示则需要真实适配器。结果是命名与实际含义倒挂：名为 `base.yml` 的文件并非所有示例可复用的基础，而真正的基础反倒是 `base-core.yml`。

这种拆分可以理解，但它让每次解释配置都变得更冗长。它还导致了别扭的测试搭建方式，例如无密钥冒烟测试不得不携带一个虚拟 API key，仅仅为了让适配器能启动——尽管模型根本不会被调用。

## 提案

将与提供方无关的核心重命名为 `examples/base.yml`，让适配器选择在每个具体示例中显式声明。编码和 ACP 真实配置添加一小段 `llm-deepseek` include 或本地块；快照配置添加 `llm-replay`。删除 `examples/base-core.yml`。

共享基础应仅包含提供方无关的服务与工具：`llm`、会话、系统提示词、工具、agent、不变式、bash 执行器和 bash 工具 schema。任何涉及模型提供方选择的内容都应放在叶子配置中。

## 验收标准

- `examples/base.yml` 与提供方无关。
- `examples/base-core.yml` 已删除。
- 真实演示配置显式添加 DeepSeek 适配器。
- 快照回放配置 include 同一个与提供方无关的基础，并加入其回放适配器。
- [examples README](../../../../examples/README.md)、各示例 README 及 Agent Note 引用不再解释「base = base-core 加适配器」。

## 放弃了什么

真实演示失去了一层便利：每个演示都必须显式引入适配器。对于示例而言这是正确的默认行为，因为适配器选择是可变部分，而与提供方无关的接线才是共享的产品核心。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
