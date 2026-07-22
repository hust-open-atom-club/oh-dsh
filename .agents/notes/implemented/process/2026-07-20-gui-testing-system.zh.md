# RFC: GUI 测试体系——三层结构

Status: implemented

> 路径更新（2026-07-22，插件体系重构）：本文三层理念与金路径方法仍为现行；家搬了——对象层 spec 现居 `packages/client/runtime/tests/`（原 web-runtime）、wire spec 现居 `packages/client/connection/tests/`，`web-ui` 覆盖豁免随包消亡（组件 spec 为各 `packages/client/*/tests/` 的 jsdom 套件）。测试体系现行权威：`missions/tasks/20260721-1520-web-plugin-rfc/architecture.md` §18。

[English](2026-07-20-gui-testing-system.md) | 中文

> 分工线：本篇只讲 GUI（`packages/{client,host}/*` + `apps/web`）特有的测试结构；全仓测试政策（分层原则、with-key 政策、真实体优先、REAL-composition）见 [docs/testing.md](../../../../docs/testing.md)，不在此复述。

## Problem

GUI 栈需要考虑多种应用形态，同应用形态内的不同运行环境（Node host、数据协议层、浏览器对象层、React/DOM），单一车道的测试给不了有效信号。需要对各环节都进行有效测试，并具备全链路测试的基础能力

## Decision（三层结构）

贴架构天然测试缝切三层，自底向上：

| 层 | 被测物 | 关键手段 | 文件落点 |
|---|---|---|---|
| 1 协议同构层 | `AbstractApiClient` + `toFetchHandler`（双向数据/rpcId/ZOD类型/SSE 流/合批/超时） | **同构点全链**：`InProcessApiClient(toFetchHandler(脚本化 impl))` 不过网络但真跑 wire 序列化——零浏览器、纯 node env | `packages/host/apiproxy/tests/client-handler.spec.ts` |
| 2 对象层编排 | `Session`/`SessionManager`/`ConnectionController`（状态机与时序：缝合/去重/翻页/乐观清稿/pendingBuffers/重连/退避） | **「事件序列进→快照出」黄金路径**：可编程假体 + deferred 控时序 + fake timers 控退避 | `packages/client/{runtime,connection}/tests/` |
| 3 组装呈现层 | 构建产物 × 真实 client loader 与插件组合 | 归应用所有的语义快照会在 jsdom 下启动全部 8 个已构建的 client 插件，以固定确定性的跨插件状态变化；独立使用 Playwright 裸库的冒烟测试负责验证真实浏览器/承载层边界，真 host 用例在无密钥时自行跳过 | `apps/web/tests/*.snapshot.ts`、`apps/web/tests/smoke-{fixture,real}.e2e.ts` |

层间纪律：**下层各测各的，上层不重测下层**：应用语义快照只固定组装后插件边界上的用户可见投影，Playwright 冒烟测试负责验证浏览器与承载层是否存活；wire 语义归 1 层，数据语义归 2 层。纯函数层（lineage/partial/notifier/fold-adapter）随 2 层同包 tests/ 零假体直测。

- **host 与 client 源码**均纳入全仓 per-file 100% 覆盖率门禁，仅排除 `vitest.config.ts` 中带注释的少量浏览器级例外；组件套件通过逐文件 jsdom pragma 和 Testing Library 运行，不会改变 Node 套件。
- **归应用所有的语义快照**读取已构建的 client bundle，通过真实 loader 执行它们，并且只驱动确定性的 fixture 钩子。它们负责固定侧边栏标签、面包屑和 `document.title` 等稳定可见状态，而不固定 CSS 像素或下层状态机细节。

## 车道地图

| 场景 | 命令 | 内容 | 何时跑 |
|---|---|---|---|
| 基础 | `pnpm run test:gui` | 1+2 层 vitest（`packages/client packages/host`），秒级、无浏览器无 server | 改 GUI 任意源码后随手跑 |
| 语义快照 | `DSH_EXAMPLE_MODE=lib pnpm run test:snapshot` | 无需密钥的组装应用语义，以及仓库按传输形态划分的预期输出 | 用户可见的 GUI 变更后；交付前 |
| 浏览器端到端 | `pnpm run test:web` | 先重建前端 dist，再跑 3 层双级 smoke（fixture 级 + 真 host 级 self-skip） | 改构建面/boot/承载后；交付前 |
| 门禁 | `pnpm run test:coverage` | 全仓 gate（host 侧 GUI 包在内，client 侧 excluded） | PR 窗口 |

**浏览器脚本与 vitest 的分工**：Playwright 负责浏览器/承载层黑盒回归和较长的连续用户操作流程；普通 vitest 负责引用稳定性、时序和 wire 结构等数据层语义；快照 vitest 通过构建后的组合负责稳定的应用层语义输出。这些车道彼此互补，而不重复断言。

## 防回归纪律

- **修一个 bug 钉一条断言**：浏览器可见的 bug 钉进所属 verify 脚本的回归节（一钉一行 report）；数据层 bug 钉进对应 spec（先例：res-close 误判钉在 webserver 桥 suite——纯 Node 秒级复现，不再需要 12s 浏览器哨兵作唯一防线）。
- **fixture 全绿不算完，真 host 也要过**：fixture 短路的恰是 wire 承载链（node:http 桥 close 语义、真网络时序），两次实证 bug 都藏在那里。改动触及连接/桥/handler/SSE 的，`verify-session-real` 必跑。
- 落盘代码即答案的对表工作流：行为改动落盘打红既有用例时，当场对表校准（改测试还是改代码以 RFC/契约为裁），不留悬红。

## Consequences

各车道各测各层：改动任意 GUI 源码后都能获得秒级 `test:gui` 反馈，wire/对象层语义在 Node 环境中进行毫秒级断言，基于构建后组合的快照固定确定性的用户可见投影，浏览器负责接线与承载层验收。接受的代价是层间纪律由评审而非机器门禁维持，而且每个新的应用快照都必须避开不稳定的布局或时钟输出。

## Alternatives considered

| 放弃项 | 一句话理由 |
|---|---|
| 单一 e2e （全走浏览器） | 浏览器起步秒级×N 倍慢+时序不可控；wire/对象层不变量在 node env 可毫秒级全断言 |
| verify 脚本迁 vitest | 有序剧本共享浏览器会话，拆 case 要么形式化（sequential+共享 page）要么重走前置×N；PASS/FAIL 流式输出正是 agent 定位接口 |
| 测试复用 FixtureApiClient | 演示脚本走真实时钟，测试需要 deferred 手控时序——用途正交，硬复用把测试绑死在演示节奏上 |
| GUI 包独立 vitest config（曾设计 vitest.gui.config.ts） | 包级 tests/ 本就被根 include 扫到，`vitest run packages/client packages/host` 路径过滤即窄循环——零新 config |
| hooks/组件层暂缓单测（原裁决） | 曾以「组件是耗材、等重做后再议」暂缓；2026-07-20 用户改判——**jsdom 主线进覆盖率**（CI 无浏览器基建是决定性理由，playwright 降级为本地增强），RTL 依赖入 devDeps、首个 spec 已落 |
