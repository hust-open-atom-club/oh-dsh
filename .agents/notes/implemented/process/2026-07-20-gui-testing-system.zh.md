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
| 2 对象层编排 | `Session`/`SessionManager`/`ConnectionController`（状态机与时序：缝合/去重/翻页/乐观清稿/pendingBuffers/重连/退避） | **「事件序列进→快照出」黄金路径**：可编程假体 + deferred 控时序 + fake timers 控退避 | `packages/client/web-runtime/tests/{session,manager,connection,…}.spec.ts` |
| 3 浏览器 smoke | 构建产物 × 真浏览器（页面起得来、一轮对话跑得通） | playwright 裸库（chromium headless，无 @playwright/test 框架）最简跑通；fixture 级 + 真 host 级（无 key self-skip） | `apps/web/tests/smoke-{fixture,real}.e2e.ts` |

层间纪律：**下层各测各的，上层不重测下层**——smoke 只证接线活着（fixture 级断零 `/api` 请求、零 pageerror），交互细节归 verify 脚本（见车道地图），wire 语义归 1 层，数据语义归 2 层。纯函数层（lineage/partial/notifier/fold-adapter）随 2 层同包 tests/ 零假体直测。

- **host 侧**（apiproxy/runtime/webserver）：进全仓 `test:coverage` 门禁，per-file 100%。
- **client 侧**：web-runtime **已进 per-file 100% 门禁**（12 处防御性不可达臂带理由 `/* v8 ignore */` 注释）；`vitest.config.ts` coverage.exclude 只剩 `packages/client/web-ui/src/**`（暂时——组件重做后随组件 specs 铺满逐步解除），测试照跑，只是不拉 web-ui src 进阈值。web-ui 走 **jsdom 路线（已落地）**：jsdom + @testing-library/react 入 root devDeps（dev-only），首个 spec `web-ui/tests/utils.spec.tsx`（utils 纯函数 + 组件 RTL render + hook uSES 探针）；环境用 per-file `// @vitest-environment jsdom` pragma，node env 的其他包零影响。
- 排除是**显式注释的裁决**不是静默豁免；解除路径=删 exclude 行 + 补 justified 排除或补测。

## 车道地图

| 场景 | 命令 | 内容 | 何时跑 |
|---|---|---|---|
| 基础 | `pnpm run test:gui` | 1+2 层 vitest（`packages/client packages/host`），秒级、无浏览器无 server | 改 GUI 任意源码后随手跑 |
| 浏览器端到端 | `pnpm run test:web` | 先重建前端 dist，再跑 3 层双级 smoke（fixture 级 + 真 host 级 self-skip） | 改构建面/boot/承载后；交付前 |
| 门禁 | `pnpm run test:coverage` | 全仓 gate（host 侧 GUI 包在内，client 侧 excluded） | PR 窗口 |

**verify 脚本与 vitest 的分工**：verify 管浏览器黑盒回归（顺序步骤=用户操作剧本，共享一次浏览器会话，PASS/FAIL 流式输出供 agent 定位断点），vitest 管数据层语义一等断言（引用稳定性 `toBe`、状态机时序、wire 形）。两车道互补不收编——脚本不迁 vitest（拆散有序剧本是负收益），转正时包一层 spawn 壳挂 e2e 车道即可，脚本本体不改写。

## 防回归纪律

- **修一个 bug 钉一条断言**：浏览器可见的 bug 钉进所属 verify 脚本的回归节（一钉一行 report）；数据层 bug 钉进对应 spec（先例：res-close 误判钉在 webserver 桥 suite——纯 Node 秒级复现，不再需要 12s 浏览器哨兵作唯一防线）。
- **fixture 全绿不算完，真 host 也要过**：fixture 短路的恰是 wire 承载链（node:http 桥 close 语义、真网络时序），两次实证 bug 都藏在那里。改动触及连接/桥/handler/SSE 的，`verify-session-real` 必跑。
- 落盘代码即答案的对表工作流：行为改动落盘打红既有用例时，当场对表校准（改测试还是改代码以 RFC/契约为裁），不留悬红。

## Consequences

各车道各测各层：改任意 GUI 源码有秒级 `test:gui` 反馈，wire/对象层语义在 node env 毫秒级断言，浏览器只承担接线存活冒烟。门禁面上 host 侧全量进 per-file 100%；client 侧 web-runtime 已进门，web-ui 暂留显式注释的 exclude 之后。接受的代价：层间纪律（上层不重测下层）靠 review 而非机器门禁维持；web-ui 的覆盖缺口持续到组件重做后组件 specs 铺满为止。

## Alternatives considered

| 放弃项 | 一句话理由 |
|---|---|
| 单一 e2e （全走浏览器） | 浏览器起步秒级×N 倍慢+时序不可控；wire/对象层不变量在 node env 可毫秒级全断言 |
| verify 脚本迁 vitest | 有序剧本共享浏览器会话，拆 case 要么形式化（sequential+共享 page）要么重走前置×N；PASS/FAIL 流式输出正是 agent 定位接口 |
| 测试复用 FixtureApiClient | 演示脚本走真实时钟，测试需要 deferred 手控时序——用途正交，硬复用把测试绑死在演示节奏上 |
| GUI 包独立 vitest config（曾设计 vitest.gui.config.ts） | 包级 tests/ 本就被根 include 扫到，`vitest run packages/client packages/host` 路径过滤即窄循环——零新 config |
| hooks/组件层暂缓单测（原裁决） | 曾以「组件是耗材、等重做后再议」暂缓；2026-07-20 用户改判——**jsdom 主线进覆盖率**（CI 无浏览器基建是决定性理由，playwright 降级为本地增强），RTL 依赖入 devDeps、首个 spec 已落 |
