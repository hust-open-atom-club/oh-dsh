# 下游 Agent 预设

每个子目录都是一个由 Oh-DSH 发行的 Agent preset，与固定版本 DSH runtime
提供的预设并列存在。

一个预设目录包含：

- `preset.yml`：DSH 展示元数据。
- `agent.cordis.yml`：原生 DSH Agent composition。
- `manifest.yml`：Oh-DSH 构建元数据；staging 前会校验，但不会复制到 staged
  DSH preset。

`manifest.yml` 声明稳定目录 ID、支持的 surface，以及该预设拥有的本地包。包角色
可以是 `agent`、`host` 或 `client`；未单独声明 package surface 时，默认继承预设
支持的全部 surface。

新增预设：

1. 创建 `agent-presets/<id>/` 并加入三个必需文件。
2. 将本地能力包放在 `plugins/`，并在 manifest 中声明。
3. 确保 `agent.cordis.yml` 引用的每个本地 Agent 插件都有对应的 `agent` 包条目。
4. 运行 `pnpm run check:agent-presets`。

ID 必须匹配 `[a-z0-9][a-z0-9-]*`。固定 DSH runtime 的 `standard`、`code`、
`minimal` 和 `cordis` 是保留 ID，下游不能覆盖。
