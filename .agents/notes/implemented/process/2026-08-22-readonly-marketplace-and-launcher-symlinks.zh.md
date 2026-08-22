# Agent Note：只读市场桥接与解析符号链接的启动器

Status: implemented

[English](2026-08-22-readonly-marketplace-and-launcher-symlinks.md) | 中文

## Problem

打包的 0.1.7 版本上报了两个回归（#115、#116）：

1. Desktop 持有 `~/.ohdsh` 运行时锁时执行 `ohdsh tui`，整个 TUI
   直接崩溃：启动器以 `OH_DSH_READ_ONLY=1` 启动只读表面，
   `@oh-dsh/plugin-marketplace` 提前返回、不 provide
   `pluginMarketplace` 服务，而 `@oh-dsh/tui-marketplace` 注入该
   服务，激活失败并拖垮整个插件树。
2. macOS 安装文档建议用 `sudo ln -sf` 把 `bin/ohdsh` 软链接到
   `/usr/local/bin`，但启动器用 `$0` 计算根目录时不解析符号链接，
   于是从 `/usr/local` 报出误导性的 "Oh-DSH is not built"。

## Decision

- 只读 viewer 模式下照常 provide `pluginMarketplace`。事务管理器新增
  `readOnly` 选项：构造时不再重建 previews 与 rollbacks 目录；除
  `refresh` 外的所有 dispatch 一律拒绝并在快照层返回错误。`refresh`
  保持可用，因为它只刷新目录缓存，viewer 仍能浏览目录与已装列表。
- `bin/ohdsh` 在计算根目录前用 POSIX 的 `while [ -L ]` 循环解析
  `$0` 的符号链接链（macOS 的 `readlink` 没有 `-f`），使
  `/usr/local/bin` 里的链接能找到安装的应用布局。

## Consequences

- 只读 TUI 与 Web 表面可以激活完整插件树并浏览市场；所有变更类
  事务返回只读快照错误，不会改动被锁定的数据根。
- 启动器在 macOS/Linux 上可从任意相对或绝对符号链接链启动；
  Windows 对应的 `ohdsh.cmd` 不受影响（cmd 自行解析脚本路径）。
- 两个回归均有测试覆盖：只读管理器拒绝事务且不写盘
  （tests/plugin-marketplace.test.ts）；启动器经由软链接找到暂存
  运行时布局（tests/launcher-symlink.test.ts，Windows 跳过）。

## Alternatives considered

- 让 `tui-marketplace` 容忍缺失的 `pluginMarketplace` 服务：viewer
  将看不到市场，且给下一个消费者留下同样的陷阱；改用降级服务。
- 更新 macOS 文档去掉 `ln -sf`：网络上的既有指引仍会踩坑；循环
  只有六行；否决。
