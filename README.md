<p align="center">
  <strong>简体中文</strong> ·
  <a href="./README.en.md">English</a>
</p>

<div align="center">
  <img src="./assets/dsh-whale.png" width="128" alt="Oh-DSH whale">
  <h1>Oh-DSH</h1>
  <p><strong>一套 DSH runtime，Desktop、Web 与 TUI 三种开发体验。</strong></p>
  <p>把 AI Agent、Workspace、本地工具与插件生态带到你习惯的界面。</p>
</div>

<p align="center">
  <a href="https://github.com/hust-open-atom-club/oh-dsh/releases/latest"><img alt="GitHub release" src="https://img.shields.io/github/v/release/hust-open-atom-club/oh-dsh?display_name=tag&amp;sort=semver&amp;style=flat-square&amp;color=2f81f7"></a>
  <a href="https://github.com/hust-open-atom-club/oh-dsh/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/hust-open-atom-club/oh-dsh?style=flat-square&amp;color=f5a623"></a>
  <img alt="Desktop, Web and TUI" src="https://img.shields.io/badge/Desktop%20%7C%20Web%20%7C%20TUI-3b82f6?style=flat-square">
  <img alt="macOS, Linux and Windows" src="https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-111827?style=flat-square">
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-34a853?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://github.com/hust-open-atom-club/oh-dsh/releases/latest"><strong>下载最新版</strong></a>
  ·
  <a href="./docs/usage.zh.md">使用文档</a>
  ·
  <a href="./docs/design.zh.md">设计文档</a>
</p>

<p align="center">
  <img src="./assets/oh-dsh-desktop-readme.png" alt="Oh-DSH Desktop 界面展示" width="100%">
</p>

Oh-DSH 将 DeepSeek Harness、Node.js、本地开发工具和内置插件打包为可安装的
Desktop、Web 与 TUI 发行版。模型服务仍可按需运行在云端；Workspace、终端、
Git Review、浏览器、文件、会话与插件状态由本地工作台统一组织。

## 主要能力

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🖥️ 三种交互界面</h3>
      <p>使用同一个 <code>ohdsh</code> 命令启动 Desktop、Web 或 TUI。三端共享会话、凭据、皮肤与插件缓存，同时保留独立 Profile。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🧰 本地开发工作台</h3>
      <p>内置 Workspace、PTY 终端、浏览器、文件浏览、Side chat 与 Trajectory；面板可以折叠、固定、分屏或全屏展开。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🔍 Git Review</h3>
      <p>查看工作区改动与 commit diff，在代码行上添加 review comment，并在同一个侧边栏完成分支、提交和推送操作。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🧩 插件市场</h3>
      <p>Desktop、Web 与 TUI 都能检索、预览和安装插件，并共享同一套交易与恢复状态。目录会标明插件实际生效的界面：安装可能在所有终端都成功，但某些插件只在 Web 或 Desktop 生效、在 TUI 不生效，界面上会明确区分。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🎨 跨端皮肤</h3>
      <p><code>@oh-dsh/skins</code> 为 Desktop、Web 与 TUI 提供统一主题，并针对各界面的布局和可读性分别适配。</p>
    </td>
    <td width="50%" valign="top">
      <h3>📦 可拆分发行</h3>
      <p>按需安装完整版、Web-only 或 TUI-only。每种发行都自带固定版本的 DSH 与 Node runtime，不要求单独安装运行环境。</p>
    </td>
  </tr>
</table>

## 下载与安装

### 首选：命令行安装

Linux 与 macOS 使用仓库根目录的 `install.sh` 安装最新稳定版。默认安装
TUI，并将 `ohdsh` 注册到 `~/.local/bin`；新开一个终端后即可使用：

```sh
curl -fsSL \
  https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.sh \
  | bash
```

需要 Web 或 Desktop 时显式选择发行形态：

```sh
curl -fsSL \
  https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.sh \
  | bash -s -- --surface web

curl -fsSL \
  https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.sh \
  | bash -s -- --surface desktop
```

Windows 使用仓库根目录的 `install.ps1`；不带参数时同样默认安装 TUI：

```powershell
irm https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.ps1 | iex
```

安装完成后，通过统一命令启动已安装的界面：

```sh
# 终端界面
ohdsh tui

# Web 界面
ohdsh web

# Desktop 应用
ohdsh desktop
```

`ohdsh` 只会启动已经安装的 surface；Desktop 的直接入口
`oh-dsh-desktop` 仍然保留。Linux/macOS 如果当前终端还没有加载新的 PATH，
请重新打开终端；Windows 请使用新终端。

安装器在校验发布的 SHA-256 摘要之前不会触碰旧安装，下载失败、摘要不匹配
或解压中断都保持原安装可用；重复执行同一命令即为原地升级，
`--uninstall` 按 surface 卸载。完整选项、环境变量与 surface 矩阵见
[安装说明](./docs/usage.zh.md#使用-installsh-安装)。

### 从 GitHub Release 手动安装

从 [GitHub Releases](https://github.com/hust-open-atom-club/oh-dsh/releases/latest)
选择需要的发行形态：

| 发行形态 | 包含内容 | 适合场景 |
| --- | --- | --- |
| 完整版 | **Oh-DSH Desktop**、Web、TUI、Node runtime 和内置插件 | 本地开发工作台 |
| Web-only | **Oh-DSH Web**、Node runtime 和内置 Web 插件，不含 Electron | 浏览器、服务器或轻量安装 |
| TUI-only | **Oh-DSH TUI**、Node runtime 和终端插件，不含 Electron | SSH 与纯终端环境 |

- **macOS**：打开 DMG，将 **Oh-DSH Desktop** 拖入 Applications。
- **Windows**：运行安装包，或解压便携版后启动。
- **Linux**：直接运行 AppImage，或使用 `apt` 安装 deb。

安装脚本是推荐入口；Release 资产适合需要手动选择包或离线分发的场景。

## 使用

```sh
ohdsh desktop          # 启动 Oh-DSH Desktop
ohdsh gui              # Desktop 的启动别名
ohdsh web              # 启动 Oh-DSH Web
ohdsh web --port 3080  # 指定 Web 端口
ohdsh tui              # 启动 Oh-DSH TUI
```

三端默认共同使用 `~/.ohdsh` 存放缓存、配置、会话、凭据与插件状态。
设置 `OH_DSH_HOME` 可以统一更换数据目录；运行 `ohdsh web --help` 或
`ohdsh tui --help` 可以查看界面专属选项。

内置的 `@oh-dsh/vision` 为三端提供同一个 `view_image` 工具，让用户对 Workspace
内的本地图片、HTTP(S) 图片或 image data URL 做 OCR、读图与界面诊断。图片复制、
粘贴、缩略图和提交继续由 DSH 原生 attachment rail 负责；插件在 Host 的最终图片
能力校验处放行 DeepSeek V4，并在固定的 text-only 适配器序列化同一轮请求前，通过
配置的视觉后端描述原生附件。不另加输入栏气泡或引用协议。TUI 通过 Workspace
图片路径或 URL 使用同一能力。
凭据与后端配置见[图片识别使用说明](./docs/usage.zh.md#图片识别)；云端/本地 Key 与 Vision
设置也可以在原生“设置 → 插件 → 插件配置 → Vision”卡片中修改。

<details>
<summary><strong>从源码运行</strong></summary>

需要 Node.js、pnpm 和平台构建工具：

```sh
git submodule update --init --recursive
pnpm install
pnpm run build:dsh
pnpm run build
pnpm run stage:dsh
export PATH="$PWD/bin:$PATH"

ohdsh desktop
ohdsh web
ohdsh tui
```

本地开发时，也可以用仓库根目录的 Makefile 快速启动指定交互端：

```sh
make build
make tui ARGS="--lang zh"       # 只暂存并启动 TUI
make web ARGS="--port 3080"     # 只暂存并启动 Web
make desktop                     # 只暂存并启动 Desktop
```

`make tui` 默认使用 inline 模式，从当前终端光标位置继续渲染；需要
alternate screen 时传入 `ARGS="--fullscreen"`。每个 Make 目标只会暂存
对应交互端的 Oh-DSH package，不会把其它交互端一起带入开发 runtime。Make
默认使用 `~/.ohdsh`，也可以覆盖：`OH_DSH_HOME=/tmp/ohdsh make tui`。

Desktop、Web 和 TUI 共享同一组 Agent preset；其中 `liangshen`（梁神模式）会在
首轮保持 Minimal 双工具，首次工具调用后开放完整工具目录，压缩后重新锚定。
Web/Desktop 可在设置页的 Agent preset 中选择，TUI 可输入 `/preset liangshen`。

打包完整版使用对应平台的 `dist:mac`、`dist:linux` 或 `dist:win`；只打包
Web 使用 `pnpm run dist:web`；只打包 TUI 使用 `pnpm run dist:tui`。

</details>

<details>
<summary><strong>更多界面</strong></summary>

### 插件市场

![Oh-DSH 插件市场](./assets/oh-dsh-plugin-marketplace.png)

### Oh-DSH 皮肤

![Oh-DSH 跨界面皮肤](./assets/oh-dsh-desktop-skins.png)

</details>

## 文档

- [安装、操作与排错](./docs/usage.zh.md)
- [架构设计与插件边界](./docs/design.zh.md)

## 插件推荐

| 推荐项目 | 说明 |
| --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | DSH runtime、会话与插件加载器 |
| [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) | **Oh-DSH TUI 的直接上游插件**，提供终端渲染、交互和命令体系 |
| [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | Git Review、文件与 PTY Host 能力 |
| [dsh-vision](https://github.com/william-jin-cmu/dsh-vision) | 跨 Desktop、Web 与 TUI 的 `view_image` 视觉工具参考实现 |
| [dshfind](https://dshfind.com/) | DSH 插件超市与学习社区，提供插件、生态与 DeepSeek Harness 周边推荐 |

Oh-DSH 保留上游实现与署名，并在其上提供统一启动器、Profile、数据目录、
跨端皮肤、界面适配和发行打包。详细边界见[设计文档](./docs/design.zh.md)。

## License

[MIT](./LICENSE)
