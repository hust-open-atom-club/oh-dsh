# RFC: 从 fs seam 中移除只写字段与一个无效的路由旋钮

Status: implemented

[English](2026-07-04-prune-write-only-fs-surface.md) | 中文

## 问题

[fs seam 拆分](2026-06-26-fsspec-style-fs-seam.md)将读取路由与策略从后端移至 `dsh-tool-fs` 和 `dsh-fs-policy`。有四处接口保留了拆分前的形态——每次调用都填充，却无人读取：

1. **`dsh-fs-local` 中的 `STREAM_MIN_SIZE` + `FsIoInternals.streamMinSize`**——*在本次变更之前已被「禁止硬编码可调参数」审计移除，该审计将路由阈值改为 `dsh-tool-fs` 的 `readStreamMinSize` 配置；此处记录是为了完整呈现整次清理。* 原始位置（`packages/fs/fs-local/src/fsio.ts`，从 `packages/fs/fs-local/src/index.ts` 重导出）：包括 fs-local 自身源码和测试在内，全仓库零读取者。后端没有读取路由——`readWholeText`/`streamWholeText` 是调用方自行选择的两个独立原语——真正的路由常量位于消费方（`packages/fs/tool-fs/src/read.ts`，与 `info.size` 比较）。同一个 10 MiB 事实的两份镜像；后端那份是死代码，且该旋钮的 JSDoc 声称提供一个实际不存在的「read routing」覆盖。
2. **`FsTarget.inputPath`**（`packages/fs/fs/src/types.ts`）：每个后端和每个测试 mock 都必须为这个「仅供诊断」的字段编造一个值，而生产环境零读取者——策略插件和所有错误消息使用的是 `targetKey`/`displayPath`。`listDir` 的生产者暴露了语义上的摇摆：目录子项得到的是裸条目名，这不是任何人的「input」。
3. **`FsEditOutcome.replacements` + `.replaceAll`**（`packages/fs/fs/src/types.ts`）：`replacements` 生产环境零读取者（单匹配策略本身保留——它由后端内部 `FS_AMBIGUOUS_EDIT`/`FS_EDIT_NOT_FOUND` 抛出来强制执行，错误消息保留了内部计数）；`replaceAll` 仅被 `packages/fs/tool-fs/src/edit.ts` 中的 `formatEditOutput` 读取——作为工具本身已持有的 `replace_all` 参数的回声。精简后，`FsEditOutcome` 变为 `{ version, before, after }`，与 `FsWriteOutcome` 中真正由后端发现的字段对齐。
4. **`FileReadOutcome.limit` + `.version`**（`packages/fs/tool-fs/src/read-render.ts`）：由读取工具填充，但 `formatReadOutput` 只渲染 `offset`/`lines`/`totalLines`/`truncatedByBytes`，且 `fs/observed` 事件发射直接使用 `info.version` 而非 outcome 的副本。

## 决策

删除 fs-local 的常量及其重导出，以及 `streamMinSize` 旋钮（`FsIoInternals` 中剩余的旋钮确实被原子写入测试使用）；从 `FsTarget` 中移除 `inputPath`；将 `FsEditOutcome` 精简为 `{ version, before, after }`，并将 `replaceAll` 从解析后的参数传入 `formatEditOutput`；从 `FileReadOutcome` 中移除 `limit`/`version`。[filesystem.md](../../../core-data-structures/filesystem.md) 中的粘贴内容、`packages/fs/fs/README.md`，以及那些不得不为已移除字段编造值的测试 mock，都随类型一起缩减。

## 曾考虑的替代方案

### 为什么不保留？

未来的权限/隔离层可能需要解析前的路径来生成错误文本——但它需要的是*请求*，每个调用点仍然持有请求。「替换了 N 处」可能成为面向模型的文本——这是一个需要时再设计的行为变更，且后端内部的计数为其错误消息而保留。读取页脚可能展示 `limit`——但页脚展示的一切已经可以从 `lines`/`totalLines` 推导。与此同时，每个现有和未来的后端（远程、原生）都必须编造无人消费的协议字段，每个测试 mock 都必须满足它们。

## 验证

被移除的接口已消失——`dsh-fs-local` 中的 `STREAM_MIN_SIZE`/`streamMinSize`、`FsTarget.inputPath`、`FsEditOutcome.replacements`/`.replaceAll`，以及 `FileReadOutcome.limit`/`.version`——而请求侧的 `replaceAll`（`FsEditRequest`）和其他 outcome 类型上的 version 字段未受影响；测试 mock 随类型一起缩减。`formatEditOutput` 在 `replace_all` 两个分支下输出的文本不变，因此没有快照黄金文件被搅动。

## 后果

后端不增加新义务，反而卸下了四个无人消费的字段。fs 发现功能（glob/grep 工具）涉及相同的 `dsh-fs` 类型文件——这是文本层面而非设计层面的重叠，可以机械地合并解决。
