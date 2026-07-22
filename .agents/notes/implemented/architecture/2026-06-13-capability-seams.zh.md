# RFC: 能力 seam——接口／实现／消费方三分

Status: implemented

[English](2026-06-13-capability-seams.md) | 中文

## 问题

harness 具有可替换的能力：当前是 bash 执行，未来会有沙箱化／远程执行器和替代模型提供方。一项能力涉及三个关注点，它们以不同速率、因不同原因变化：*契约*（这项能力是什么）、*实现*（它如何运行）、*消费方接口*（模型和其他插件面向什么编程）。将三者捆绑在一个包（package）中会耦合这些变化速率——把本地执行器换成沙箱化执行器时，模型看到的工具 schema 也会被搅动，尽管面向模型的契约从未改变。

这与「谁在运行时提供、谁需要一项能力」是不同的问题，后者 Cordis 已通过 service + `inject` 解决（提供方注册 `ctx.bash`；消费方声明 `inject: ['bash']`，其 fiber 挂起直到服务存在）。该机制是必要的，但不决定包的边界；本 RFC 决定的是包的边界。

## 决策

一项可替换的能力由**三个包**构成：

1. **接口**——一个抽象服务加词汇类型，拥有 `ctx.<key>`，仅依赖 cordis（例如 `dsh-bash`：`BashExecutor`、`BashRunResult`、`BashTask`）。
2. **实现**——一个具体子类，以插件形式加载（例如 `dsh-bash-local`：子进程、进程组 kill、溢出文件截断）。沙箱化／远程后端是实现同一接口的兄弟包。
3. **消费方**——模型和插件看到的内容（例如 `dsh-tool-bash`：`bash`/`bash_output`/`bash_kill` 工具 schema）。消费方 `inject` 接口键，从不导入实现类型。

实现与消费方由此独立演进：沙箱化执行器替换 `dsh-bash-local` 时无需触碰任何工具 schema。

当各部分确实属于同一个关注点时，三分并非强制：LLM（大语言模型） seam 将接口 + 消费方合并为 `dsh-llm`（消费方是 agent loop（智能体循环）本身，而非可替换的 schema 表面），适配器作为实现包。不要预防性地拆分——如果一项能力只有一种可设想的实现和一个消费方，就保持为一个包，直到第二种出现。

## 曾考虑的替代方案

- **单一合并包**：否决。因为它重新耦合了三分设计本要分离的三种变化速率（这正是拆分的意义所在）。
- **`@cordisjs/plugin-capability`**：这是完全不同的维度。它是一个权限／能力*安全*服务（具名权限加继承，通过 `ctx.capability.test` 对会话进行检测），是延后的权限/沙箱工作（`tools/pre-execute` deny/ask seam）的候选方案，不是替换实现的机制。混淆这两个「能力」概念正是本 RFC 所指出的陷阱。

## 后果

每项能力需要更多包和更多样板代码（一组 `package.json`/`tsconfig`/README，加上 inject 接线）。换来的是：实现与消费方独立发布和版本管理，新后端永远不会波及面向模型的契约。该规则记录在 [AGENTS.md](../../../../AGENTS.md) § Conventions（"Capability seams are three packages"）和 [architecture.md](../../../architecture.md) § "Capability seams" 中；bash 三件套是参考模板。何时合并、何时拆分是一个判断问题，架构文档对此有详细说明——本 RFC 记录的是*为什么*默认选择拆分。
