# RFC: 以机械质量门禁取代行文约定

Status: implemented

[English](2026-06-11-quality-gates.md) | 中文

## 问题

本代码库主要由 coding agent（智能体）开发。相比行文约定，agent 遵守强制门禁的可靠性远高得多；而当劳动由 agent 承担时，「工作量大」不构成成本论据。早期证据：未通过类型检查的测试被提交（vitest 不做类型检查），仅在评审中才被发现。

## 决策

AGENTS.md 中的每一条承诺都对应一个以非零退出码表示失败的命令，通过 git 钩子和 CI 调用同一套 package.json 脚本来执行：

- 最严格的 TypeScript 配置（`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 等）；示例、测试和脚本通过根目录的 no-emit `tsconfig.json` 在 CI 中进行类型检查，而 package/vendor 代码保持在各自 project-reference 边界之后。
- ESLint strict-type-checked + @stylistic（作为强制执行的统一代码风格），包括文件内重复逻辑检查；vendor 代码排除在外。
- jscpd 检测 package 生产 TypeScript 与仓库脚本中的跨文件克隆；窄范围的源码区间例外用于记录有意为之的并行实现。
- `packages/*/*/src` 下按文件 100% 覆盖率（v8）；不可达的防御性守卫使用 `/* v8 ignore */ ` 并注明理由，而非删除。
- knip（死代码/依赖）、publint（包（package）正确性）、workspace 约束（workspace 规则：private、cordis peer+dev、统一版本、ESM），以及对构建出的包声明文件进行 NodeNext 消费方类型检查。
- lefthook pre-commit（lint 暂存文件、类型检查、vendor manifest（元数据清单）守卫）和 pre-push（测试、hygiene）；CI 在 Node 22.19/24/26 上运行完整矩阵，外加一个驱动 echo-agent 端到端的演示冒烟测试。

## 后果

- 约定在 agent 更替中得以存续；违规在本地快速失败。
- 门禁本身也是需要维护的代码；配置变更与其他变更一样需要评审。
- 100% 覆盖率的压力可能催生无断言的测试——变异测试是计划中的对策（见[变异测试提案](../../proposed/testing/2026-06-11-mutation-testing.md)）。

<!-- rfc-format: alternatives-not-recorded (pre-format RFC) -->
