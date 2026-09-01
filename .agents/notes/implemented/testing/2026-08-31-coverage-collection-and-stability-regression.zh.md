# Agent Note: 收集覆盖率并扩展稳定性回归测试

Status: implemented

[English](2026-08-31-coverage-collection-and-stability-regression.md) | 中文

## Problem

稳定性回归任务（分支 `chore/add-coverage-collection-and-expand-stability-regression`）必须先确定可测面。任务点名的行为大多位于 Electron DOM 代码（`src/update-dialog.ts`、`pinned-summary` 客户端、`src/main.ts` 菜单）中，未导出任何纯函数，而仓库的测试运行器是 `node:test`，没有 DOM 环境。

## Decision

本次扩展为稳定性关键路径落地了行为级测试：桌面更新状态机（cancel、retry、verify 失败、命令分发）、安装脚本（`install.sh` 通过真实子进程对打 mock GitHub release 服务器、mac bundle 的 `replaceMacBundle`）、插件市场事务管理器（保护动作拒绝、目录过滤）、`resolveProductVersion` 回退链。测试以依赖注入 fake（`FakeUpdater`、`MockGitHub`）驱动，运行在 `node:test` 上，生产代码保持原样；DOM 行为维持其源码正则断言。

CI 在 Linux job 上收集覆盖率到 `coverage/lcov.info`，分母排除 `tests/**`，原始报告作为 run artifact 上传，并转发给 Codecov 作为纯报告服务、不设门槛；`fail_ci_if_error: false` 保证 fork PR 缺少 `CODECOV_TOKEN` 时 CI 不变红。

## Alternatives considered

**引入 jsdom/happy-dom 测试 DOM 层。** 拒绝：新增测试依赖，且测试会追逐渲染细节而非契约。

**为可测性重构生产代码**（导出 `latestSummary`、向 `availableBackupPath` 注入时间戳、导出 `parseUpdateCommand`）。拒绝：最小连贯 diff 优先于扩大测试触达；DOM 行为维持源码正则断言，直到真实回归倒逼出现接缝。

**强制覆盖率门槛**（`--test-coverage-lines`）。拒绝：任务要求覆盖率纯报告；测试集还在增长，门槛会卡在不稳定的分母上。

## Consequences

更新管理器状态机、安装脚本失败与幂等路径、市场事务拒绝、版本回退链都由新行为测试钉住。DOM 行为（更新对话框按钮可见性、pinned-summary 渲染状态、About 面板装配）维持源码正则断言，这些区域补行为覆盖时从显式接缝入手而非扩展正则。mac 备份名耗尽测试并行播种宽窗口的候选路径，即使时间戳不可注入，慢速 CI 下依然正确。
