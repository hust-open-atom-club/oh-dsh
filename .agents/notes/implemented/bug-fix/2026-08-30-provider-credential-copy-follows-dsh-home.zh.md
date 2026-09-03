# Agent Note: 让 provider 凭据文案遵循 DSH_HOME

Status: implemented

[English](2026-08-30-provider-credential-copy-follows-dsh-home.md) | 中文

## Problem

pinned dsh-TUI 的 `/provider` 向导在 API key 提示、成功摘要、回滚诊断和模块注释中显示 `~/.dsh/.credentials.yaml`。Oh-DSH 启动渲染器时将共享数据根目录设为 `DSH_HOME`，其默认值是 `~/.ohdsh`，Harness 凭据服务则遵循这个有效根目录。因此，向导显示了错误的文件；当启动环境中的同名变量遮蔽凭据并使写入被跳过时，向导仍承诺会写入文件。

## Decision

受保护的编译后渲染器适配器改写复制产物中的 provider 文案，不修改 pinned 子模块。API key 提示说明密钥由 Harness 凭据服务管理且不会进入 transcript，但不承诺写入文件。成功摘要、回滚诊断和模块注释使用 `$DSH_HOME/.credentials.yaml`；现有的环境变量遮蔽摘要继续说明已跳过写入。

适配器使用精确且幂等的替换。上游文案或文件布局发生变化时，适配过程会失败，不会悄悄恢复固定路径。这项决定延续 pinned [dsh-TUI 升级](../feature/2026-08-26-upstream-tui-0.9.2-upgrade.md)确立的编译后渲染器所有权。

## Alternatives considered

**显示 `~/.ohdsh/.credentials.yaml`。** 否决，因为 `OH_DSH_HOME` 和 `DSH_HOME` 可以选择其他共享根目录；另一个固定路径仍会让自定义安装遇到同一缺陷。

**显示解析后的绝对路径。** 否决，因为 `$DSH_HOME` 无需暴露机器特定的主目录路径就能表达存储约定，并对所有受支持的覆盖方式保持准确。

**编辑或 fork 上游渲染器。** 否决，因为这段文案属于 Oh-DSH 集成问题，pinned 源码应保持原样。现有编译后渲染器适配器是项目拥有的兼容边界。

**保留写入文件的承诺，只替换路径。** 否决，因为进程环境中已经存在凭据时，系统会按设计跳过凭据文档写入。

## Consequences

- 默认和自定义数据根目录都会显示准确的中英文 provider 指引。
- 输入提示不再声称文件权限为 `0600`，因为该步骤不一定写入文件；使用文件存储时，成功和回滚文案仍会指出受管理的文档。
- TUI 适配器回归测试会复制 pinned 编译后渲染器，运行两次真实适配器，并拒绝固定的旧路径和无条件承诺写入的中文文案。
- 未来升级上游渲染器时，必须保留或有意调整这个适配器 seam。
