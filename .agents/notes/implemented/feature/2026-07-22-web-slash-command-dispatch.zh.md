# Agent Note: Web 斜杠命令分发

Status: implemented

[English](2026-07-22-web-slash-command-dispatch.md) | 中文

## 问题

[面向人类的 `/goal` 命令](2026-07-19-human-goal-command.md)交付时有两个分发点：TUI 与 ACP 适配器拦截以 `/` 开头的提示词，通过命令注册表执行而不消耗模型轮次。Web UI 的整条路径——输入框、客户端运行时、RPC 与宿主——都没有任何拦截，因此 `/goal fix the flaky test` 会作为普通用户消息到达模型。该命令消耗一次模型轮次、不产生确定性的状态改变、还可能被重新解释，而 Web 宿主组合甚至没有挂载命令注册表和 `/goal` 生产方。

## 决策

Web 宿主在自己的适配器边界分发斜杠命令，与 ACP 对称：在 `packages/host/runtime/src/api-proxy.ts` 的 api-proxy `sessions.prompt` 处理器内、`agent.send`/`agent.steer` 之前。`bootHost` 在目标栈之后紧接着挂载 `CommandService` 与 `command-goal`，使注册表与生产方共享宿主组合的生命周期。

内容恰好是一个以 `/` 开头的文本块的提示词才是命令候选。Web 输入框只会发送这种形态，多块内容绝不会被拍平成命令行。分发与模式无关：命令不消耗轮次，因此 queue 与 steer 的执行完全一致，且都不会到达 agent。

执行结果映射到输入框编排逻辑已经理解的 RPC 结果上。命令成功时返回 ok，携带 `{ accepted: true, command: { kind: 'success', text? } }`——草稿保持已清空状态。用法或状态错误（单独的 `/goal edit`、多余的 `/goal pause`）返回新错误码 `command-error` 的 RPC 错误，未识别的名称返回 `unknown-command`；两者都会让客户端恢复输入框草稿并在错误条上显示消息，这正是畸形命令应有的 UX。这两个错误码是 `RpcErrorDetailsMap` 中的新行，并配有对应的错误 schema 分支；`session.prompt` 的响应值在签名层与 zod schema 中都增加了可选的 command 槽位。

成功文本会在线路上传输，但 Web UI 暂时不渲染它；状态改变——目标栏出现、已暂停目标恢复——就是反馈。处理器缺陷仍会传播出 `commands.execute` 并成为承载层 500，这符合 api-proxy 的规则：实现绝不抛出业务错误。

## 测试

`packages/host/runtime/tests/api-proxy-command.spec.ts` 针对一个记录了 `send`/`steer` 调用的结构性空闲 agent，挂载真实的命令注册表、agent 注册表、目标服务与 `/goal` 生产方。它覆盖：`/goal <objective>` 创建目标、携带 command 槽位且不经过模型轮次；`steer` 下与模式无关的分发；`unknown-command`（带与不带尾随输入）与 `command-error` RPC 错误；成功但不带文本的已注册命令；非命令提示词原样到达 `agent.send`；退化形态——多块内容、空数组、单个非文本块——绝不会被当作命令。现有的 `rpc-schemas.spec.ts` 对扩展后的线路形态进行门禁。

## 考虑过的替代方案

- **在浏览器客户端拦截**——不予采纳，因为命令注册表与目标领域位于宿主进程；客户端没有插件运行时，在客户端复制命令所有权会与宿主的组合发生偏差。
- **把命令输出渲染为合成的助手消息**——不予采纳，因为凭空制造模型可见事件会违反“模型可见 ⟺ 已记录”规则，并引入第二份审计记录；线路上携带文本，留待未来的专用表面渲染。
- **仅在 queue 模式下分发**——不予采纳，因为命令不消耗轮次，模式对它们没有意义；ACP 同样在其提示词轮次机制之外执行命令。
- **像 ACP 那样把多块内容拍平成命令行**——不予采纳，因为 Web 输入框恰好只发送一个文本块；有损的拍平路径不会有调用方。

## 后果

- `/goal` 以及未来注册的任何命令都可以在 Web 输入框中使用且不消耗模型轮次；未知或畸形命令会恢复草稿并报错，而不是到达模型。
- RPC 错误词汇表新增 `command-error` 与 `unknown-command`，`session.prompt` 响应可以携带 command 槽位。
- 命令成功文本已在线路上但尚未在 Web UI 渲染；专用输出表面仍然延期。
- 多块提示词绝不会成为命令候选，因此更丰富的输入框内容不会意外触发分发。
- Web 宿主分发的命令运行在一个新建的、永远不会被中止的 AbortController 下：异步命令（注册表允许异步命令）无法从 UI 取消，`session.cancel` 也触及不到它（ACP 正是为此把 controller 保存在会话记录上）。
- 单块判定意味着任何以 `/` 开头但不是已注册命令的单独文本块（如 `/etc/hosts`、`/Goal`）都会以 `unknown-command` 被拒绝，而不会到达模型——这是有意为之，与 ACP 对称，并由草稿恢复机制缓解。
