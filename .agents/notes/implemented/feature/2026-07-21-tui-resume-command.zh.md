# Agent Note: Resume command hint and `/resume`

Status: implemented

[English](2026-07-21-tui-resume-command.md) | 中文

## Problem

TUI 本就能通过启动参数恢复会话（`RESUME_SESSION_ID=<id> dsh` 喂给 `dsh-tui-demo` 的 `resumeSessionId`），但没有任何地方告诉用户这条命令。退出时会话 id 只残留在会话日志和 `./.sessions` 文件名里——[移除启动横幅 Agent Note](2026-07-21-tui-no-banner.md) 移除了它最后一处显示位置——因此恢复意味着先翻出 id 再拼回调用命令。也没有任何会话内的方式查看当前 workspace 里哪些会话可恢复。

## Decision

`dsh-tui` 上一个可选的 `resumeCommand` 配置字段同时管辖两处出口：一个 shell 命令模板，其中每一处 `{session}` 都会被替换为当前会话 id（例如 `dsh --resume {session}`）。未设置时两处都不出现。

- **退出提示。** 以退出进程方式关闭时，在 `ui.stop()` 之后、`runtime.exit` 之前，经由 `runtime.terminal.write` 打印 `To resume this session: <command>`（弱化的标签）。仅当会话已持久化时才打印：`currentResumeCommand()` 在会话列表中查找当前 id，若不存在则返回 `undefined`，因此在首次刷盘前就被放弃的会话不会宣传一条注定加载失败的命令。
- **`/resume`。** 按最新在前列出当前 workspace 里已持久化的会话，每条附带其恢复命令，并给当前会话标注 `(current)`。当 `resumeCommand` 未配置或未挂载持久化后端时给出告警，尚无任何会话被持久化时给出提示。列出是异步的，因此提交后文本记录会在下一个 tick 更新。
- **列出逻辑。** `listWorkspaceSessions()` 读取可选的 `sessionPersistence` 服务的 `list()`，保留 `cwd === agent.session.header.cwd` 的头部，并按 `createdAt` 降序排序。`list()` 拒绝时吞掉为 `[]`——持久化失败绝不能阻塞终端退出或让 `/resume` 崩溃。

`sessionPersistence` 是一个通过 `ctx.get('sessionPersistence')`（而非 `inject`）获取的可选注入服务，声明为可选的对等依赖（peer dependency）。没有后端时该字段仍能解析；退出提示与 `/resume` 分别退化为不做任何事、以及给出未配置/无后端告警。`dsh-tui-demo` 将 `resumeCommand` 转发给 `dsh-tui`，可运行的 `examples/tui-agent` 叶子配置设为 `dsh --resume {session}`。`dsh` CLI（`apps/cli`）通过 [`dsh-app-boot`](../../../../packages/ui/app-boot/README.md) 中的 `parseResumeArg` 解析该 `--resume <id>` 标志，在启动前设置 `RESUME_SESSION_ID`，因此打印出的命令会重新走回配置中既有的 `resumeSessionId` 入口；拼写错误或重复的标志会直接报错退出，而非悄悄开启一个新会话。

## Alternatives considered

**硬编码或自动探测恢复调用命令。** 否决：启动命令与部署强相关——环境变量名、可执行文件、参数都各不相同——因此一个 `DEFAULT_*` 常量只会是固定的可调项，而非可配置项。由叶子拥有的模板把这个选择留在部署所在之处，而 `{session}` 是 TUI 唯一需要知道的替换。

**两个配置字段，每处出口一个。** 否决：两处渲染的是完全相同的命令，因此单个字段让它们保持对称、不会漂移；不存在只想要提示而不想要列表的部署。

**无条件打印退出提示。** 否决：恢复一个从未刷盘的会话 id 会加载失败，宣传它就是一条错误指令。以 id 是否出现在 `list()` 中为条件仅需一次扫描，且只会抑制一条注定失败的命令。

**从 `/resume` 就地恢复（重启或重连）。** 否决：TUI 不拥有 agent 生命周期或进程创建（[全屏 TUI 门面 Agent Note](2026-07-17-dedicated-full-screen-tui-front-door.md)）。打印一条可复制的命令尊重这条边界，也契合需求所引用的 `pi --resume` 用法。

**把 `sessionPersistence` 设为必需的 `inject`。** 否决：TUI 必须能在无持久化时运行（fixture（测试前置数据）、临时运行）。一个会优雅退化的可选服务保住了这一点，也与 [`session-query`](../../../../packages/session-query/session-query/package.json) 对同一可选对等依赖的先例一致。

## Consequences

- `dsh-tui` 新增对 `@deepseek-ai/dsh-session-persistence` 的可选对等依赖（`peerDependenciesMeta.optional`），与 `session-query` 一致；未挂载后端时该包仍能加载并通过其覆盖率门禁。
- 帮助行和自动补全新增 `/resume`；两个既有快照因帮助行变宽而重新录制，新增的 `resume-sessions` 检查点固定渲染出的列表。
- `dsh-tui-demo` 及两个 `examples/tui-agent` 叶子配置都带上 `resumeCommand`，因此真实的 TUI 运行现在退出时会打印自己的恢复命令，且 `dsh` CLI 接受打印出的 `--resume <id>` 标志来运行它。

## Testing

`packages/ui/tui/tests/tui.spec.ts` 固定这七种行为：退出提示仅在当前会话已持久化时打印，未持久化时以及 `list()` 拒绝时都不打印；`/resume` 按最新在前列出 workspace 会话并带 `(current)` 标注与 cwd 过滤、未配置时告警、无后端时告警、尚无持久化时给出提示。`resume-sessions` 快照验证完整渲染帧。测试脚手架通过 `ctx.provide` 提供一个假的 `sessionPersistence`。对于 `--resume` 标志，`packages/ui/app-boot/tests/app-boot.spec.ts` 固定 `parseResumeArg`（空格形式与内联形式、位置无关性，以及在标志缺值、为空或重复时直接报错退出），`examples/tui-agent/tests/tui-keyless-smoke.e2e.ts` 用 `--resume <missing-id>` 启动 `apps/cli` 并断言配置恢复直接报错退出——证明该标志抵达了 `resumeSessionId` 入口。
