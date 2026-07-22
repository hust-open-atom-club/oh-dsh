# Agent Note: 配置热重载不得杀死或降级正在运行的应用

Status: implemented

[English](2026-07-20-config-hot-reload-resilience.md) | 中文

## Problem

各示例应用把 `@cordisjs/plugin-hmr` 挂载为叶子配置项，让运行中的 agent 能感知 `cordis.yml` 的编辑。一次错误的编辑就会杀死进程：`Include.refresh()` 把 YAML 解析错误原样抛出，HMR 的文件监听器在一个无人捕获的异步 chokidar 回调里 await `refresh()`，产生的未处理 rejection 触发 `dsh-app-boot` 的快速失败处理器——会话中途 `exit(1)`，正在运行的 TUI 就此丢失。另有两个相邻缺陷让*合法*的重载也出错：解析结果为 `undefined` 的文件（空文件或写入中途被截断的文件——编辑器和 `sed -i` 常态性地产生这类中间状态）会让配置项遍历直接崩溃，而不是被判定为无效文件；并且重新读取时从不重新应用 include 的 `config.patches`，因此对基于 overlay 的配置树（Code Mode、个人 overlay）做任何热重载，都会悄悄把打过补丁的配置项回退、并把插入的配置项移除。

## Decision

加固 vendor 的 `@cordisjs/plugin-include`（在 [vendor/README.md](../../../../vendor/README.md) 中记录为本地修改第 8 条），而不是修改调用方：

- `refresh()` await 整个「读取并更新」过程并捕获失败，记录一条警告，并保留上一份完好的配置树。热重载是尽力而为的；不变式是编辑器可能产生的任何文件状态都不得导致进程退出。
- `read()` 对非数组的解析结果抛出 `TypeError`，把 `undefined` 解析结果并入同一个「无效文件」信号，并且只在解析成功后才提交 `content`/`data`——因此把编辑撤销回与上一份完好内容完全一致时，会正确地判定为「无变化」。
- `refresh()` 与 `internal/update` 监听器在 `root.update()` 之前调用 `this.applyPatches(...)`，与 `[Service.init]` 保持一致。`applyPatches` 对缓存的解析结果做深拷贝（`structuredClone`）而不是就地修改，因此重复应用会收敛，移除补丁会回退到文件自身的值。监听器使用传入配置中的 `patches` 并自行持久化该配置：它否决 fiber 重启（子配置项就地更新），而 `Fiber.update` 只在 `next()` 之后才赋值 `this.config`，若不显式赋值，下一次重新读取会重新应用旧的 overlay。

启动期行为保持快速失败并获得更准确的诊断：`[Service.init]` 只在 `ENOENT` 时回退到 `initial`（或「config file not found」）；存在但无效的文件现在会以真实的解析错误失败，而不是被误标为文件缺失、或被 `initial` 静默覆盖。

## Alternatives considered

**在 HMR 监听回调里捕获，而不是在 `refresh()` 里。** 否决：这会让 `refresh()` 继续成为其他所有调用方的陷阱（`internal/update` 路径共享同一套树更新逻辑），而且无法修复 `undefined` 解析结果与补丁丢失这两个位于 include 内部的缺陷。

**在 `installFailLoud` 里过滤配置文件相关的 rejection。** 否决：快速失败处理器的存在意义就是让延迟出现的加载失败可见；教它按来源给异常分类会悄悄吞掉真正的启动失败，并且原样保留陈旧 `data` 导致的崩溃。

**用 PTY e2e 证明 TUI 能在错误编辑后存活。** 否决其作为主要门禁：PTY 冒烟测试读取仓库中已提交的 `cordis.yml`，就地破坏它对测试不安全，而临时副本无法解析该配置树的裸包说明符。单元测试直接驱动监听器所调用的 `refresh()` 入口；此外还对运行中的 TUI 做了人工验证（错误 YAML、空文件、恢复文件）。

## Consequences

- 现在错误的 `cordis.yml` 编辑会记录 `ignoring config reload at <file>`，agent 继续运行在上一份完好的配置树上；下一次合法编辑正常生效。TUI 示例没有挂载任何日志导出器，这条警告目前不会显示在屏幕上——在 TUI 中呈现 loader 警告的工作暂缓。
- overlay 配置树在基础文件重载后补丁保持完整，不再悄悄回退到未打补丁的基础配置。
- vendor 的 include 与上游进一步分叉；该分叉已记录在 vendor 的 manifest 里，下次同步时重新应用。
- 已知缺口，不在本次范围内：HMR 监听器只处理 chokidar 的 `change` 事件，因此通过重命名替换文件的编辑方式（BSD `sed -i`、`git checkout`）完全不会触发配置重载；应用配置项重载后也不会可见地重启运行中的 TUI（未修改的代码树上即已如此）。

## Testing

`packages/ui/app-boot/tests/config-reload.spec.ts` 用真实 Loader 树加载临时配置并固定以下行为：无效 YAML 编辑和空文件编辑都让 `refresh()` 正常 resolve 而不产生 rejection，并保留之前的配置项配置；随后的合法编辑正常生效；overlay 配置树在重新读取时重新应用配置项补丁和插入的配置项；对 include 配置项自身 `patches` 的热更新立即生效、在下一次文件重读后依然保持、并在补丁移除后干净地回退。这些断言在未打补丁的 vendor include 上会失败。
