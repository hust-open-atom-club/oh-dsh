# Agent Note: `ohdsh update` 升级所有已安装 surface,desktop 亦包含在内

Status: implemented

[English](2026-09-09-ohdsh-update-upgrades-all-installed-surfaces.md) | 中文

## 问题

一台机器通常同时装着多个 Oh-DSH surface——`/Applications` 里的桌面应用,
以及 XDG 数据目录下的 web/tui 载荷——但 `ohdsh update` 只升级启动器载荷
所属的那一个 surface。用户自然把"update"理解为"更新这台机器":跑完之后
desktop 和 web 还停在旧版本,而 TUI 已经悄悄升级,`ohdsh update desktop`
也只是打印一条指向应用更新窗口的提示。这个按 surface 拆分的行为在启动器
的 update 命令(`runUpdateCommand`)里,不在安装器里——安装器本来就支持
每个 surface。

## 决策

`ohdsh update` 现在以机器而不是运行中的载荷为依据解析目标:不带 surface
参数时,通过 `surfaceIsInstalled` 探测 desktop、web、tui,并按该顺序升级
找到的每个安装;带显式 surface 时只升级那一个,desktop 也不例外。desktop
的探测先看 `DESKTOP_EXE` 启动器记录,再看记录的
`DESKTOP_DEST`/`desktop.env` 目标位置加平台应用镜像名,与
`install.sh`/`install.ps1` 的探测一致。`selfUpdatePlan` 增加了 desktop
分支,像 web/tui 分支一样还原 `DESKTOP_DEST`、`DESKTOP_REPO` 和
`BIN_DIR`,因此 desktop 升级落在安装器当初放应用的位置,并保留 fork
来源。

`runSelfUpdate` 委托给新的 `runSelfUpdates`:每个 surface 运行一个安装器,
启动前播报一次,失败后继续(各 surface 是独立载荷,部分升级仍是进展;第一
个非零安装器退出码成为命令的退出码)。在 Windows 上,分离助手把每个
surface 的安装器串在一条 PowerShell 命令里顺序执行——若每个 surface 各起
一个助手,它们都会在进程退出后醒来,并发安装器会互相踩踏 `launcher.env`
和启动器写入——持久化的下载脚本也从固定的 `update-install.ps1` 改为按
surface 命名的 `update-install-<surface>.ps1`,因为来自不同 fork 的 surface
可能需要不同脚本。

旧的特例被移除:`ohdsh update desktop` 不再打印指针(运行中的桌面会话里,
应用内更新窗口仍是引导路径);`installerOwnsRoot` 被删除——隐式路径原先
用它强制"运行中的载荷"必须被安装器持有,这个守卫现在由按 surface 的探测
直接表达。源码检出中的拒绝行为不变。

## 备选方案

- **保留指针,只升级 web/tui。** 否决:这正是本变更要消除的困惑——一次
  看起来像失败的机器级半升级。
- **一次安装器调用带多 surface 标志。** 否决:`install.sh`/`install.ps1`
  刻意保持一次运行一个 surface(资产选择、暂存与记录均按 surface);循环
  调用保持安装器简单,失败也相互隔离。
- **Windows 上每个 surface 各起一个分离助手。** 否决:它们都会在进程退出
  后醒来并竞争同一批记录与启动器文件;单一链式助手让 Windows 与 Unix 语义
  一致。
- **首个失败即中止后续 surface。** 否决:desktop 因权限受阻不应把 web/tui
  困在旧版本;顺序尽力而为加非零汇总退出码既报告失败又不丢掉其余升级。

## 后果

- 通过安装器升级 desktop 会退出并替换应用包(安装器既有行为);在桌面应用
  开着时跑 `ohdsh update` 的用户会在下次启动时进入新版本,而不是由更新
  自己重启应用。
- 探测信任安装器记录。陈旧记录——例如指向已删除目录的 `BIN_DIR`——会被
  原样重放进 `--bin-dir`,安装器随后在启动器写入处大声失败;修复记录的
  办法是为任一 surface 重跑安装器。本次会话恰好在被探针污染的机器上踩到
  这一点,这也是三个更新测试现在钉住隔离的 `HOME`/`USERPROFILE` 根、不再
  继承开发者真实记录的原因。
- 运行中启动器自身的载荷不再守卫隐式更新:手动解压的启动器会愉快地升级
  每个*已记录的*安装,而自己保持陈旧。分发器——正常入口——总是路由到已
  记录的载荷,所以这只影响手工放置的启动器。
- 观察 `update.log` 的 Windows 用户现在看到按 surface 的起止行,而不是
  一条无名运行。

## 测试

`tests/cli.test.ts` 用注入的更新器覆盖命令契约:无参数时升级全部三个已
记录的 desktop+web+tui(否则只升级已安装子集),显式 surface 要求该
surface 已安装,未知 surface / 空机器 / 源码根以指引拒绝。
`tests/self-update.test.ts` 覆盖 desktop 计划(目标、fork、bin-dir 还原)、
desktop 探测(`DESKTOP_EXE`,以及各平台下记录/标记目标位置),和
`runSelfUpdates` 的顺序、失败后继续与首个非零退出码;另有三个旧测试与
真实用户记录隔离,此前它们依赖开发者机器上的记录。
