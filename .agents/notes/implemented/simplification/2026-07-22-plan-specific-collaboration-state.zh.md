# Agent Note: 将具名会话模式收敛为 plan mode

Status: implemented

[English](2026-07-22-plan-specific-collaboration-state.md) | 中文

## 问题

产品只交付了 `plan`，首个 plan mode 实现却引入了通用的具名模式注册表。`ModeConfig.modes`、定义名称校验、`ctx.modes.list()`、已退役定义的回退逻辑，以及测试中合成的 `review` 模式，都只为支持假想中的未来协作模式而存在。plan 引导、`/plan` 和 `exit_plan_mode` 这些生产专用行为仍位于同一个包（package）内，因此通用 API 并未将可复用机制与 plan 策略隔离开来。

「mode」一词还横跨互不相关的领域。沙箱模式是由 `ctx.sandboxPolicy` 拥有、以 `sandbox/mode` 记录日志的强制执行策略；plan mode 则是一种协作方式，会贡献引导内容和经评审的退出路径。若把两者都视为同一个具名模式抽象的实例，就会掩盖二者各自独立的归属关系。ACP（Agent Client Protocol）协议恰好暴露了通用模式选择器，但这只是适配器词汇，并不能证明 harness 需要通用模式领域。

## 决策

Plan mode 拥有一个 plan 专用产品包：位于 `packages/plan/plan-mode/` 的 `@deepseek-ai/dsh-plan-mode`。持久化事实为 `plan/mode: { active: boolean }`，由 `foldPlanMode(events)` 折叠，空日志值为 `false`。`ctx.planMode.get(agent)` 返回 `{ active, pending? }`，`set(agent, active)` 则记录在边界生效的选择。现有的提示词提交、continuation、重试、追加失败和 dispose（资源释放）栅栏在语义上保持不变。

配置严格为 `{ section: string }`。该包自行注册固定的 `plan:policy` 段、`/plan [message]` 和 `exit_plan_mode`。不带参数的 `/plan` 选择该状态；非空参数则先选择该状态，再通过 `agent.steer()` 发送去除首尾空白后的文本，使该文本在受影响的步骤中成为一条记录到日志的普通用户消息。即使 plan mode 未激活，退出工具仍保持注册，以确保请求工具目录稳定。

ACP 保留协议层的 `default` 和 `plan` id。桥接层把这两个 id 映射到布尔服务，只公布这组固定选项，在适配器边界拒绝其他所有 id，并把已提交的 `plan/mode` 事件映射回 `current_mode_update`。协议仍保持通用性，但不会迫使产品领域也采用通用抽象。

沙箱模式与审批策略仍是彼此独立的强制约束轴。Plan mode 既不读取也不写入二者；此次简化也没有为这些概念引入共享基类型、注册表或预设抽象。

## 删除的接口

- 任意定义映射、模式名正则表达式、保留名称规则以及逐定义命令循环。
- `ModeDefinition`、解析后的定义映射、`ctx.modes.list()`、字符串值的 get/set 状态，以及未知或已退役模式处理。
- 仅用于测试的 `review` 模式用例，以及可通过配置添加其他模式的表述。
- 通用的 `mode/set` 与 `mode:policy` 名称；plan 包拥有 `plan/mode` 与 `plan:policy`。

## 考虑过的替代方案

**保留私有的通用注册表，目前只暴露 plan。** 不予采纳，因为没有第二个生产消费方时，仍需维护和测试未使用的名称与配置机制。未来若出现另一种协作状态，可以从两个具体案例出发建立合适的共享 seam。

**将沙箱模式折叠进同一服务。** 不予采纳，因为协作引导与执行约束有不同的归属方、生命周期语义和消费方。二者的英文名称都含「mode」，不代表存在领域关系。

**让 ACP 拥有 plan 状态。** 不予采纳，因为 TUI、恢复、fork、提示词组装和退出工具都需要在 ACP 之外独立使用同一项已记录事实。ACP 只拥有协议投影。

## 验证

- 包测试通过布尔服务继续覆盖边界顺序、重试、追加失败、HMR（热模块替换）资源释放、提示词组装、稳定的原生 schema 与 Code Mode schema、评审结果和不变式。
- 命令测试覆盖不带参数的 `/plan`、`/plan <message>`、不存在 `/mode` 和 `/review`，以及随 effect 作用域移除。
- ACP 测试覆盖固定模式列表公布、两个 id、未知 id 拒绝、乐观更新、已提交退出和加载回放。
- 无密钥 TUI 场景通过 `/plan <message>` 进入，证明 `plan/mode` 先于首个请求头，且消息在 plan 引导下记录到日志。

## 后果

该实现只用一套词汇描述一项已交付功能。若要添加另一种协作方式，必须显式作出设计决策，而不能只增加配置项；ACP 客户端仍可看到标准模式选择器。根据仓库的预发布格式策略，本次迁移有意拒绝旧的 `mode/set` 日志与 `modes.plan.section` 配置。
