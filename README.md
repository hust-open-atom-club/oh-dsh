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
  <a href="./docs/usage.md">使用文档</a>
  ·
  <a href="./docs/design.md">设计文档</a>
</p>

<p align="center">
  <img src="./assets/oh-dsh-desktop-showcase.png" alt="Oh-DSH Desktop 界面展示" width="100%">
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
      <p>浏览、分类、安装、启用、更新和卸载插件。所有变更先进入隔离预览，可在应用前检查风险，也可以撤销并回到上一状态。</p>
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

从 [GitHub Releases](https://github.com/hust-open-atom-club/oh-dsh/releases/latest)
选择需要的发行形态：

| 发行形态 | 包含内容 | 适合场景 |
| --- | --- | --- |
| 完整版 | **Oh-DSH Desktop**、Web、TUI、Node runtime 和内置插件 | 本地开发工作台 |
| Web-only | **Oh-DSH Web**、Node runtime 和内置 Web 插件，不含 Electron | 浏览器、服务器或轻量安装 |
| TUI-only | **Oh-DSH TUI**、Node runtime 和终端插件，不含 Electron | SSH 与纯终端环境 |

- **macOS：**打开 DMG，将 **Oh-DSH Desktop** 拖入 Applications。
- **Windows：**运行安装包，或解压便携版后启动。
- **Linux：**直接运行 AppImage，或使用 `apt` 安装 deb。

Web-only 与 TUI-only 包解压后即可运行：

```sh
# Web UI，默认监听 http://127.0.0.1:3080
./bin/ohdsh web

# Terminal UI
./bin/ohdsh tui
```

Windows 使用 `bin\ohdsh.cmd web` 或 `bin\ohdsh.cmd tui`。

### 安装统一命令

macOS 完整版可将应用内的启动器加入 `PATH`：

```sh
sudo ln -sf \
  "/Applications/Oh-DSH Desktop.app/Contents/Resources/bin/ohdsh" \
  /usr/local/bin/ohdsh
```

Web-only 与 TUI-only 包可直接运行 `./bin/ohdsh`，也可以把它加入 `PATH`。

## 使用

```sh
ohdsh desktop          # 启动 Oh-DSH Desktop
ohdsh web              # 启动 Oh-DSH Web
ohdsh web --port 3080  # 指定 Web 端口
ohdsh tui              # 启动 Oh-DSH TUI
```

三端默认共同使用 `~/.ohdsh` 存放缓存、配置、会话、凭据与插件状态。
设置 `OH_DSH_HOME` 可以统一更换数据目录；运行 `ohdsh web --help` 或
`ohdsh tui --help` 可以查看界面专属选项。

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

- [安装、操作与排错](./docs/usage.md)
- [架构设计与插件边界](./docs/design.md)

## 插件推荐

| 推荐项目 | 说明 |
| --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-harness/deepseek-harness) | DSH runtime、会话与插件加载器 |
| [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) | **Oh-DSH TUI 的直接上游插件**，提供终端渲染、交互和命令体系 |
| [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | Git Review、文件与 PTY Host 能力 |
| [dshfind](https://dshfind.com/) | DSH 插件超市与学习社区，提供插件、生态与 DeepSeek Harness 周边推荐 |

Oh-DSH 保留上游实现与署名，并在其上提供统一启动器、Profile、数据目录、
跨端皮肤、界面适配和发行打包。详细边界见[设计文档](./docs/design.md)。

## License

[MIT](./LICENSE)
