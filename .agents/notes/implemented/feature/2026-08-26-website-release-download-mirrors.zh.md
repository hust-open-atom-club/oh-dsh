# Agent Note: 显式选择 Release 下载镜像

Status: implemented

[English](2026-08-26-website-release-download-mirrors.md) | 中文

## Problem

网站原本只从 GitHub 解析与平台匹配的 Release 产物。GitHub 在部分中国大陆网络中
可能较慢或无法访问，而同一批 Release 产物会被复制到 AtomGit。直接替换现有下载
入口，或根据推断的所在地自动分流，都会移除一个可用路径，或者隐藏二进制实际来自
哪个托管平台。

## Decision

下载对话框显式提供三个操作：前往 GitHub 为仓库点亮 Star 并继续 GitHub 下载、
不经过 Star 直接从 GitHub 下载，或者从 AtomGit 镜像下载。两个 GitHub 操作共享
从 GitHub 最新 Release 响应中选出的产物。AtomGit 操作从 AtomGit 最新 Release
响应中独立解析匹配的平台和架构，并在失败时回退到 AtomGit Releases 页面。

页面不推断访问者所在国家，也不自动切换提供方。AtomGit 仅作为镜像：选择它不会
打开 GitHub，也不会请求 Star。安装脚本和应用内更新流量不受这个网站选项影响。

## Alternatives considered

**按 IP 地址自动分流。** 不采用：VPN、代理、旅行和地理定位误差都会让国家信息
变得不可靠，而且自动分流会向访问者隐藏所选产物的实际托管平台。

**用 AtomGit 替换直接 GitHub 下载。** 不采用：原有的无 Star GitHub 路径仍然
有用；镜像是额外的恢复路径，而不是新的真源。

**让 AtomGit 下载也触发 Star 提示。** 不采用：AtomGit 只镜像 GitHub Release，
不应附带推广仓库的副作用。

## Consequences

访问者可以根据网络情况选择托管平台，同时保留两种 GitHub 流程。各提供方可能独立
失败或出现同步延迟，因此对话框可能暂时解析出不同的最新版本；此时各平台专属的回退
链接仍然可用。网站会分别请求两个提供方的最新 Release，并对两份响应复用相同的平台
和架构匹配逻辑。

## Testing

JavaScript 语法、类型检查、Pages 构建、提供方选择器检查、Agent Note 格式与分类，
以及双语配对门禁共同覆盖已发布的对话框及其决策记录。
