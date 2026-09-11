# Agent Note: 回环 auth cookie 累积拖垮客户端图

状态：已实现

[English](2026-09-11-dsh-auth-cookie-accumulation.md) | 中文

## 问题

运行时启动约六十次后，desktop 外壳启动只剩空白页。渲染进程日志为
`failed to import loader entry (@deepseek-ai/dsh-client-hmr):
client-modules: bundle script /plugins/??… failed to load`，Resource
Timing 显示合并客户端 bundle 请求以 HTTP 431 失败，而同一 URL 用
curl 却能成功。

根因链：运行时服务器每次启动在 127.0.0.1 上种一个
`dsh-auth-<random>` 会话 cookie（约 225 字节）；Chromium 的 cookie
存储跨端口共享，并在 Electron 默认 session 里跨启动持久化；cookie
有效期 30 天，失效令牌不断滚动累积（受影响机器上有 63 个 /
14,173 字节）。0.1.5 客户端图的初始 bundle URL 列出全部插件条目
——请求行约 4.6KB——与累积的 Cookie 头相加越过 Node 的 16KB
`maxHeaderSize`，服务器在任何路由执行前就回 431。故障表象像渲染
bug，且只在启动历史足够长的机器上出现，所以很晚才以“客户端图
不再挂载”的形式浮出。

## 决策

三层，按影响范围各管一段：

1. `src/main.ts` 在每次表面加载前（主窗口与预览窗口）清理默认
   session 中该运行时 origin 的全部 `dsh-auth-*` cookie；引导流程
   会立即补种有效的那一个。对其他 cookie 无破坏。
2. `scripts/smoke-client.cjs` 改用一次性非持久 partition
   （`oh-dsh-smoke`），冒烟运行不再喂大 cookie 罐，且不受机器
   历史影响、结果确定。
3. 任务诊断工具同样处理（`ohdsh-diag`），这也是取证期间能稳定
   复现的前提。

## 否决的备选

- 拆分 bundle URL 或分批加载：属于 pin 住的上游运行时代码；累积
  本身仍会无界增长。
- 调大服务器 `maxHeaderSize`：运行时服务器引导未暴露该配置，而且
  只是推迟悬崖。
- 清空整个 cookie 罐：为一个 cookie 家族的问题毁掉无关的用户状态。

## 后果

- 升级后的下一次启动即自愈；用户无需操作。
- 其他驱动运行时的 Electron 工具（自定义 harness）仍共享默认
  session 的 cookie 罐，应改用独立 partition 或同样的清理。
- 运行时本身仍会每次启动种 cookie；若上游将来复用或使它们过期，
  清理逻辑将变冗余但无害。
- 已知残留：浏览器访问回环 origin 的 Web 表面会在浏览器 cookie 罐
  里累积同样的 cookie；浏览器侧清理超出 desktop 应用能力，未处理。
