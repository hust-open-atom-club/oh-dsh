# Agent Note: npm/npx 启动器转发到内置 pnpm

Status: implemented

[English](2026-09-07-npm-pnpm-forwarding-shims.md) | 中文

## 问题

安装生命周期脚本调用 npm 的第三方市场插件（`prepack: "npm run build"`）时失败，报
`Cannot find module '...\node-runtime\node_modules\npm\bin\npm-prefix.js'` 和
`...\npm-cli.js`。暂存的 node 运行时有意只带 pnpm：`pruneNodeRuntime` 删除
`node_modules/npm`，`ensureNodeRuntime` 把工作区 pnpm 暂存到旁边。但 Windows 的
Node 官方 zip 把 `npm`/`npx`/`corepack` 启动器放在发行包**根目录**（`node.exe`
旁边），不像 POSIX 在 `bin/` 里——而 prune 只清理了 `bin/`，于是原生的
`npm.cmd` shim 活了下来，指向已被删除的 npm 包。

宿主进程让这个 shim 成为 PATH 上的第一个 `npm`：`runtimeSearchPath` 在市场构建
时把 node-runtime 目录排在最前，所以插件的 `npm run build` 解析到悬空 shim，
既不能干净失败、也找不到系统 npm。没有装 Node 的终端用户机器则完全没有回退。

## 决策

内置运行时增加转发到暂存 pnpm 的 npm 兼容启动器，"默认都用 pnpm" 成立——插件
作者无需修改自己的 npm 脚本。

- `scripts/stage-runtime-lib.mjs` 新增 `stageNpmForwardingShims()` 与
  `stage-npm-shims` CLI 子命令（`nix/oh-dsh.nix` 消费）。它在暂存 pnpm 旁边写入
  自包含的 `npm-forward.mjs`，并安装 `npm`/`npx` 启动器：Windows 在运行时根目录
  写 `.cmd` + `.ps1`，POSIX 在 `bin/` 写 shell 启动器。转发器通过
  `Function.toString()` 逐字嵌入库里的 `translateNpmInvocation` 源码，被测的
  转换就是发布的转换——该函数必须保持不引用模块作用域。
- `translateNpmInvocation` 只映射有忠实 pnpm 写法的调用：
  `run`/`install`/`test`/`exec`/`publish` 等原样透传，`ci` 变为
  `install --frozen-lockfile`，`i`/`t`/`uninstall`/`rm`/`run-script` 展开为
  长形式，`npx ...` 变为 `pnpm exec ...`（丢弃 npm 专属的 `-y`），`--prefix`
  变为 `--dir`。其余调用以 1 退出并提示改为直接调用 pnpm。
- `scripts/stage-dsh.mjs` 的 `pruneNodeRuntime` 现在也删除 Windows 根目录的
  `npm`/`npx`/`corepack` 启动器（`''`/`.cmd`/`.ps1` 变体加
  `install_tools.bat`）以及各平台的 `corepack` 模块目录，随后调用
  `stageNpmForwardingShims()`，让转发启动器在 prune 之后替换原生启动器。

## 备选方案

**干净删掉 npm，要求插件作者写 pnpm。** 否决：生态里生命周期构建脚本几乎都按
npm 写；没有转发器，每个 `prepack: "npm run build"` 的插件在没有系统 Node 的
机器上都会失败，市场目录也无法约束第三方脚本。

**在 pnpm 旁边暂存真正的 npm 发行版。** 否决：打包体积翻倍，需要独立的更新与
安全节奏，还向一个设计上只钉一个包管理器的运行时重新引入第二个包管理器。

**在市场宿主（`platform.ts`）内通过改写 PATH 做 shim。** 否决：该失败并非市场
专属——任何被 spawn 的生命周期脚本都通过 node-runtime 的 PATH 条目解析 `npm`；
在暂存阶段修复一次即可覆盖所有消费方（Desktop、Web、TUI、Nix）。

## 后果

打包后的 Oh-DSH 运行时上，`npm`/`npx` 现在的含义是"带 npm 调用翻译的 pnpm"。
透传表刻意保持小：npm 专属子命令（`config`、`dist-tag`……）会带着可操作的提示
失败，而不是悄悄偏离语义，撞上它们的插件作者会被明确告知改用 pnpm，而不是去
调试行为漂移。被翻译子命令不支持的 npm 语义（`--prefix` 之外的 flag 差异）原样
透传，可能以 pnpm 报错的形式暴露。转发器内嵌的转换函数是一个结构性契约：后续
任何修改都必须保持它自包含，`tests/npm-forward.test.ts` 与转换表、两种布局的
启动器内容、悬空 `npm.cmd` 的替换一起守护这一点。

## 测试

`tests/npm-forward.test.ts` 覆盖转换表（透传、`ci`、别名、`npx`、子命令前后
位置的 `--prefix`、未知子命令报错）、Windows 与 POSIX 两种布局下暂存的启动器
文件与内容，以及内嵌转发器与导出函数一致且无模块作用域引用。端到端验证：一个
`prepack: "npm run build"` 的夹具包，在 node-runtime 目录排在 PATH 最前（即市
场构建的解析顺序）时，通过暂存运行时成功完成构建。
