# Agent Note: Desktop Marketplace 保留只读查看器

Status: implemented

[English](2026-08-26-desktop-marketplace-read-only.md) | 中文

## 问题

Desktop 与 Web 或 TUI 共享 `~/.ohdsh`。当其他 surface 持有运行时锁时，Desktop
进入只读查看器模式。renderer 仍然暴露 Marketplace 入口，但 Desktop 之前没有
创建事务管理器，因此 Marketplace IPC 报告 `plugin marketplace is not initialized`，
而不是提供 catalog 查看器。

## 决定

Desktop 与 Web、TUI 一样创建只读模式的 `PluginMarketplaceManager`。管理器可以
加载和刷新公开 catalog，也可以读取共享 profile，但不会创建 preview 或 rollback
目录，不会写入 catalog cache，并会对所有修改命令返回只读错误。只有在 Desktop
持有运行时锁时，才创建 Marketplace 工作目录并确保 profile 存在。

## 曾考虑的替代方案

**只读时继续禁用 Desktop Marketplace**：不采纳，因为 renderer bridge 仍然存在，
UI 要么提供可用的只读查看器，要么隐藏入口。保留共享查看器契约可以让锁竞争行为
在各 surface 之间一致，也能避免 IPC 初始化错误。

**没有运行时锁时允许 Desktop 修改共享 profile**：不采纳，因为这会违反单写入者运行时
契约，并可能在其他 surface 活跃时破坏 session 或 profile 状态。

## 影响

当 Web 或 TUI 持有共享数据目录时启动 Desktop，Desktop 仍可浏览 Marketplace；安装、
更新、启用、禁用、preview、apply、discard 和 undo 等修改操作会收到明确的只读响应。
Catalog 刷新仍受现有网络和只读缓存行为约束。Desktop 持有锁时，原有可写
Marketplace 配置不变。
