# RFC: 移除 bash 完整输出溢出文件

Status: rejected — full-output recovery is a real bash behavior. A future artifact/blob service may generalize it, but dropping spill files before that replacement would lose useful command output.

[English](2026-06-20-drop-bash-output-spill-files.md) | 中文

## 问题

`dsh-bash-local` 在内存中保留有界的输出，并将大体量的 stdout/stderr 流溢出到私有临时文件。这要求一个私有目录、仅所有者可写的随机文件创建、关闭失败处理、基于字节偏移的增量读取、有损读取报告、在面向模型的文本中渲染路径，以及清理纪律。当输出被截断时，该工具会告知模型去读取一个本地溢出路径。

这解决了一个真实问题，但方式狭隘且有泄漏。溢出路径是一个暴露在模型输出中的进程级文件系统产物，而非具有作用域访问控制、保留策略或 UI 支持的持久化 harness 产物。它还使后台任务的读取变得复杂，因为有损增量读取必须指向一个或两个溢出文件。

## 提案

保留尾部截断，移除完整输出溢出文件。bash 结果包含有界的尾部内容加一个明确的截断标记；不输出路径。如果用户需要恢复完整输出，则添加一个通用的产物/blob 服务（具有明确的所有权、清理和 UI 渲染），然后让 bash 将大体量输出附加到该服务。

本提案可以独立于[通用长时间运行工具运行时](../../proposed/architecture/2026-06-20-generic-long-running-tool-runtime.md)落地。如果后台任务保留，`bash_output` 仍应报告输出已被丢弃，但不再提供溢出路径。

## 验收标准

- `CollectedOutput` 不再携带溢出路径。
- `OutputCollector` 仅保留有界缓冲区，删除临时文件机制。
- `renderResult()` 报告截断时不包含文件系统路径。
- 测试覆盖尾部截断，不再断言完整输出文件的内容。
- [docs/defensive-patterns.md](../../../defensive-patterns.md) 中的安全指导不再将私有溢出文件视为面向模型的接口。

## 放弃的能力

模型或用户无法再从临时文件恢复大体量命令输出中被省略的前缀。在真正的产物服务出现之前，这是可以接受的。当前的溢出路径为一个生命周期和权限均未经设计的功能引入了过多的定制机制。

<!-- rfc-format: alternatives-not-recorded (pre-format RFC) -->
