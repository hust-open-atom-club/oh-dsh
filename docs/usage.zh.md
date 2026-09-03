# 安装、操作与排错

[English](usage.md) | 中文

## 选择发行形态

- 需要完整本地工作台：安装 **Oh-DSH Desktop**。
- 只需要浏览器交互：安装 **Oh-DSH Web**，不携带 Electron。
- 纯终端交互：安装 **Oh-DSH TUI**，不携带 Electron 或浏览器 UI。

Release 提供完整版、Web-only 与 TUI-only 三种形态；命令行安装器默认先安装
TUI，其他 surface 可以按需指定。

## 使用 install.sh 安装

仓库根目录的 `install.sh` 可以在不克隆仓库的情况下，在 macOS 与 Linux 安装
最新稳定 Release。它需要 `curl` 和 `tar`（macOS desktop 包还需要 `ditto` 或
`unzip`），web/tui 的用户级安装不需要 root。

```sh
curl -fsSL \
  https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.sh \
  | bash
```

Windows 使用对应的 `install.ps1`，安装相同的 surface（desktop 通过 NSIS
安装器的静默模式完成）。它需要 PowerShell 5.1+ 和 `tar`，两者都内置于
Windows 10 1803+：

```powershell
irm https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.ps1 | iex
```

两个脚本接受相同的选项；PowerShell 使用 `-Surface`、`-Version`、`-Dest`、
`-BinDir`、`-Force`、`-Uninstall` 参数，对应小写旗标。

Surface 矩阵与默认位置：

| Surface | macOS (arm64/x64) | Linux (x64) | Windows (x64) |
| --- | --- | --- | --- |
| desktop | `Oh-DSH Desktop.app` 安装到 `/Applications` 并刷新 Launch Services，同时在 `~/.local/bin` 注册 `ohdsh desktop` | AppImage 安装到 `~/.local/bin/oh-dsh-desktop`，同时在 `~/.local/bin` 注册 `ohdsh desktop` | 静默运行 NSIS 安装器（用户级），同时注册 `ohdsh desktop` |
| web | 载荷在 `~/.local/share/oh-dsh/web`，并在 `~/.local/bin` 创建调度式 `ohdsh` 启动器 | 同左 | 载荷在 `%LOCALAPPDATA%\oh-dsh\web`，并在 `%LOCALAPPDATA%\oh-dsh\bin` 创建 `ohdsh.cmd`（自动加入用户 PATH） |
| tui（默认） | 载荷在 `~/.local/share/oh-dsh/tui`，并在 `~/.local/bin` 创建调度式 `ohdsh` 启动器 | 同左 | 载荷在 `%LOCALAPPDATA%\oh-dsh\tui`，并在 `%LOCALAPPDATA%\oh-dsh\bin` 创建 `ohdsh.cmd`（自动加入用户 PATH） |

只有 desktop 会创建桌面应用入口；web 和 tui 不会注册 Launch Services，
也不会生成 `.app` 包；desktop 安装也会注册统一的 `ohdsh` dispatcher。

web 与 tui 的载荷各自只携带自己 surface 的依赖，因此两者可以并行安装：
共享的 `ohdsh` 启动器记录每个 surface 的载荷位置，把 `ohdsh web` 与
`ohdsh tui` 路由到对应的安装。卸载其中一个 surface 不影响另一个继续使用。

选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `--surface` | `tui` | `desktop`、`web` 或 `tui`，每个 surface 只安装自己的文件与启动器 |
| `--version` | 最新稳定版 | 固定 Release 标签，如 `v0.1.8`。预发布不会被自动选中，只有在显式固定时才会安装 |
| `--dest` | 见上表 | 目标目录 |
| `--bin-dir` | `~/.local/bin` | `ohdsh` 启动器目录 |
| `--repo` | `hust-open-atom-club/oh-dsh` | 从其他 fork 安装 |
| `--force` | 关闭 | 已安装相同版本时强制重装 |
| `--uninstall` | 关闭 | 卸载对应 surface |
| `--os`、`--arch` | 自动检测 | 覆盖目标选择（`darwin`/`linux`、`arm64`/`x64`） |

等价的环境变量：`OH_DSH_SURFACE`、`OH_DSH_VERSION`、`OH_DSH_INSTALL_DIR`、
`OH_DSH_BIN_DIR`、`OH_DSH_REPO`、`OH_DSH_OS`、`OH_DSH_ARCH`；命令行选项
优先于环境变量。`GH_TOKEN`/`GITHUB_TOKEN` 用于 GitHub API 鉴权（在限流时
有用），`OH_DSH_API_BASE`/`OH_DSH_DOWNLOAD_BASE` 可为测试覆盖端点地址。

升级、校验与卸载行为：

- 安装器读取 GitHub 为每个 Release 资产发布的 SHA-256 摘要，并在改动旧
  安装之前完成校验。下载失败、摘要不匹配或解压中断都会保持原安装可用并
  报告错误；未完成的暂存文件会被清理。
- 重复执行且版本不变时为无操作，除非传入 `--force`。新版本会原子替换载荷
  并刷新 `ohdsh` 启动器。
- 升级采用原地替换：新安装验证通过后，旧的应用包、AppImage 或载荷会连同
  残留的暂存目录与升级前备份一起删除，每个 surface 只保留一份 Oh-DSH
  安装。
- 在 macOS 上，desktop 会刷新 Launch Services 并清退残留的
  `Oh-DSH-Desktop.app`，只显示一个应用入口。未公证构建仍可能需要下文的
  右键 **打开** 首次放行。
- 卸载使用 `sh install.sh --uninstall --surface <name>`（Windows 用
  `install.ps1 -Uninstall`），并沿用安装时的目标目录覆盖。

## 启动时自动更新检查

每个 surface 在每次启动时检查一次是否有更新的稳定 Release：

- **TUI** 在第一帧之前打印一行提示，例如
  `Oh-DSH 0.1.8 -> 0.2.0 is available. Run "ohdsh update" to upgrade.`
- **Web** 在监听地址之后打印同样的提示。
- **Desktop** 通过更新窗口检查，发现新版本时弹出系统通知，点击即可打开
  更新窗口。desktop 仍通过自带的校验更新器安装更新，而不是 shell 安装器。

`ohdsh update`（或 `ohdsh update web` / `ohdsh update tui`）在 macOS、
Linux 与 Windows 上升级已打包的 web/tui 发行版：它重新运行对应平台的
安装脚本，走与全新安装相同的校验与原子替换流程。安装来源采用 Codex
式的推断——依据运行路径、载荷内的安装标记以及 `launcher.env` 记录的
目标位置——绝不依赖构建时注入的标记，并会还原安装时的
`--dest`/`--bin-dir`，让更新落在当初安装的位置。位于安装器不认识的
路径上的安装会被拒绝并给出指引。在源码检出中执行时会提示改用 git。

更新只基于 Release：所有 surface 都用 semver 与已发布的稳定 GitHub
Release 比较；不存在 commit 级或滚动更新通道。

更新检查使用公开的 GitHub API，最多阻塞启动约 1.5 秒，离线时静默失败。
设置 `OH_DSH_UPDATE_CHECK=0` 可在所有 surface 上关闭检查。`ohdsh update`
优先使用打包在包内 `lib/oh-dsh/install.sh`（或 `install.ps1`）的安装
脚本，仅当包内没有时才通过 TLS 从仓库 `main` 分支下载；
`OH_DSH_INSTALL_SCRIPT_URL` 可将下载指向镜像或本地副本以便测试。在
Windows 上，更新会在当前进程退出后以分离方式执行，因为运行中的载荷
无法在执行时被替换。

## 安装完整版

### macOS

1. 从最新 Release 下载 DMG。
2. 将 **Oh-DSH Desktop** 拖入 Applications。
3. 未公证的测试构建首次运行时，在 Finder 中右键应用并选择“打开”。

如确认文件来自项目 Release，但仍被 quarantine 阻止，可对实际下载文件执行：

```sh
xattr -d com.apple.quarantine ~/Downloads/Oh-DSH-Desktop-*.dmg
```

安装统一命令：

```sh
sudo ln -sf \
  "/Applications/Oh-DSH Desktop.app/Contents/Resources/bin/ohdsh" \
  /usr/local/bin/ohdsh
```

### Linux

AppImage：

```sh
chmod +x Oh-DSH-Desktop-*.AppImage
./Oh-DSH-Desktop-*.AppImage
```

deb：

```sh
sudo apt install ./Oh-DSH-Desktop-*.deb
```

### Windows

运行 Release 中的 Windows 安装器并启动 **Oh-DSH Desktop**。统一 CLI 位于应用
资源目录的 `bin\ohdsh.cmd`，可以将该目录加入 `PATH`。

未签名安装器可能触发 Windows SmartScreen。确认文件来自项目 Release 后，选择
“更多信息”再选择“仍要运行”；安装过程可能请求管理员授权。

窗口标题栏、菜单栏与工具条合并为一行；点击该行左角的菜单名即可打开应用菜单。

关闭窗口会将 Oh-DSH Desktop 最小化到系统托盘而不是退出：点击托盘图标可恢复
窗口，通过托盘（或应用）菜单中的 **退出 Oh-DSH Desktop** 退出应用。macOS 与
Linux 保持原有的关闭行为。

### Desktop 在线更新

在应用菜单中选择 **Oh-DSH Desktop -> 检查更新…**。更新窗口只检查
`hust-open-atom-club/oh-dsh` 的 stable GitHub Release，不需要 GitHub 登录或
token。

- macOS、Windows 和 Linux AppImage 在下载并校验后可选择立即重启安装，或在
  下次退出时安装。
- `.deb` 会下载并打开系统的软件包安装器，不会绕过系统权限执行 `sudo`、`apt`
  或 `dpkg`。
- 更新器会使用系统代理设置；当配置的代理无法连接时，更新器会绕过代理直连
  重试一次，并在本次会话内保持直连。离线、代理认证、404、磁盘不足、校验失败、
  取消和重试都会在窗口中显示可恢复状态。校验失败时不会替换现有安装。
- 更新只替换应用程序，现有 DSH 数据、工作区设置、会话、已安装插件和 marketplace
  receipts 保留在原有数据目录中。

仅限签名的打包 Desktop 可自动更新。首次带更新器的 Release 之前安装的版本仍需
手动安装一次；本地开发构建和缺少当前平台安装包的 Release 会提供官方 Release
页面作为回退。

### DSH 运行时更新（与应用更新解耦）

同一个更新窗口还会列出 DSH 运行时版本。运行时更新以独立的
`oh-dsh-runtime-<dshVersion>-<platform>-<arch>.tar.gz` Release 资产发布，
因此新的 DSH 版本无需重装 Oh-DSH Desktop 即可应用。

- **Check Runtime** 查找为本平台发布的最新运行时包；**Update Runtime**
  下载后先校验发布的 SHA-256，暂存到 `~/.ohdsh/runtimes/<version>/`，
  并在激活前用 `dsh --version` 做冒烟检查。
- 激活会写入指针 `~/.ohdsh/runtimes/current.json` 并只重启 Harness 进程，
  应用本身保持运行。
- **Use Bundled Runtime** 删除指针并让 Harness 回到随应用内置的运行时。
  任何校验失败都不会改变当前生效的运行时。

## 安装 Web-only

```sh
tar -xzf oh-dsh-web-*.tar.gz
cd oh-dsh-web-*/
./bin/ohdsh web
```

Windows：

```bat
bin\ohdsh.cmd web
```

常用选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `--host` | `127.0.0.1` | 监听地址 |
| `--port` | `3080` | 监听端口；`0` 使用随机端口 |
| `--data` | `~/.ohdsh` | 三端共享的 Oh-DSH 数据根目录 |
| `--no-open` | 关闭 | 不自动打开浏览器 |
| `--trusted-host` | 无 | 增加可信 authority，可重复 |

等价环境变量包括 `DSH_OH_WEB_HOST`、`DSH_OH_WEB_PORT`、
`DSH_OH_WEB_HOME` 和 `DSH_OH_WEB_OPEN`。`OH_DSH_HOME` 可以统一覆盖
Desktop、Web 和 TUI 的数据根目录。按 `Ctrl+C` 优雅退出。

不要在未配置访问边界时直接监听 `0.0.0.0`。对局域网开放时，应同时配置
`--trusted-host`，并由可信反向代理提供鉴权和 TLS。

## 安装 TUI-only

```sh
tar -xzf oh-dsh-tui-*.tar.gz
cd oh-dsh-tui-*/
./bin/ohdsh tui
```

Windows 使用 `bin\ohdsh.cmd tui`。TUI 需要真实交互终端；默认从当前终端位置
inline 启动，与 Codex 风格一致；需要 alternate screen 时显式传入
`--fullscreen`。

## 统一启动命令

```sh
ohdsh desktop
ohdsh gui
ohdsh web
ohdsh tui
```

- `desktop` 启动已安装应用；源码仓库中回退到 Electron 开发入口。
- `gui` 是 `desktop` 的启动别名。
- `web` 启动 HTTP 服务并打印访问地址。
- `tui` 初始化独立 Profile，并在当前终端中附着运行上游 renderer。

TUI 常用选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `--cwd` | 当前目录 | Workspace |
| `--data` | `~/.ohdsh` | 三端共享的 Oh-DSH 数据根目录 |
| `--resume` | 新会话 | 恢复指定 Session id |
| `--lang` | 上游设置 | `zh` 或 `en` |
| `--preset` | `standard` | 初始 Agent preset |
| `--inline` | 开启 | 保留终端 scrollback，不使用 alternate screen |

### Agent preset

Desktop、Web 和 TUI 使用同一份 Agent preset 名册。随发行版提供的
`liangshen`（梁神模式）会让主 Agent 与子 Agent 首轮都保持 Minimal 双工具，
首次工具调用后开放完整工具目录，压缩后重新锚定。Web/Desktop 在设置页的
Agent preset 中选择；TUI 可以在空白会话中输入：

```text
/preset liangshen
```

也可以在启动时指定 TUI preset：`ohdsh tui --preset liangshen`。已经产生对话的
会话遵循 blank-only 规则，选择会保存为下一次新会话的默认值。

## 图片识别

Desktop、Web 和 TUI 都会加载内置的 `@oh-dsh/vision`。图片粘贴、缩略图、附件保存
和提交全部使用 DSH 原生 attachment rail。DeepSeek V4 的模型元数据在 DSH 中仍标记
为 text-only，插件只在 Host 的最终图片能力校验处为 V4 放行，不接管输入栏，也不
创建第二套图片气泡或引用协议。Host 会先用配置的视觉后端描述这些原生图片附件，再
交给固定的 text-only 适配器序列化同一轮请求。`view_image` 仍可对明确给出的 Workspace
图片路径、HTTP(S) URL 或 image data URL 做 OCR、图表读取、物体计数、截图排错与布局分析。

在 Desktop 或 Web UI 中，复制一张 PNG、JPEG、WebP 或 GIF，把焦点放到消息输入框并
按 `⌘V`（macOS）或 `Ctrl+V`（Windows/Linux）。当前 DSH 输入栏会在输入框内部显示
原生缩略图，并负责删除、拖放、大小限制和提交；插件不会拦截这条流程。TUI 没有图形
化缩略图，直接在消息中提供 Workspace 内的图片路径或 HTTP(S) URL，即可调用同一个
`view_image` 工具。

默认后端使用智谱 `glm-4.6v-flash`。在原生的“设置 → 插件 → 插件配置 → Vision”卡片中，
先确认云端接口地址，再点击“获取智谱 Key”打开智谱控制台；复制回来的 Key 会以密码
输入框显示，并保存到共享数据根目录的凭据文件（默认 `~/.ohdsh/.credentials.yaml`）：

```yaml
ZHIPUAI_API_KEY: your-api-key
```

凭据文件应保持仅当前用户可读，例如在 macOS/Linux 上执行
`chmod 600 ~/.ohdsh/.credentials.yaml`。也可以在启动前 `export ZHIPUAI_API_KEY=...`。
旧版本使用的 `VISION_API_KEY` 仍会作为迁移回退读取。

后端和模型可在共享的 `~/.ohdsh/settings.yaml` 中覆盖：

```yaml
oh-dsh-vision:
  baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
  model: qwen3-vl-flash
  apiKeyEnv: DASHSCOPE_API_KEY
  maxTokens: 2048
  timeoutMs: 60000
maxImageBytes: 10485760
```

卡片只显示云端接口地址、云端模型和一个隐藏的智谱 Key 输入框；Key 不会回显到设置快照。
重试、备用模型、超时、图片大小和本地 OCR/VLM 选项仍可由 Agent 或 `settings.yaml` 高级配置，
不要求用户重复填写多个 Key。Claude/Anthropic Key 属于对应模型提供方，不会被当作智谱 Vision
Key 使用。

使用本地 Ollama 时不要求密钥：

```yaml
oh-dsh-vision:
  baseURL: http://localhost:11434/v1
  model: qwen3-vl:4b
```

插件始终优先使用云端凭据，并对云端备用模型进行有上限的重试。如果云端被限流、不可用
或返回不兼容结果，会尝试配置的本地 OCR/VLM 模型；本地也失败后还会进行一次最终云端
恢复，再提示你检查 Vision 卡片、换一把云端 Key 或安装本地模型。`localModel` 就是用户
从本机 Ollama/LM Studio 兼容安装中选择的模型 ID；为空表示关闭本地回退。非本机端点才
需要配置 `localApiKeyEnv`。

```yaml
oh-dsh-vision:
  apiKeyEnv: ZHIPUAI_API_KEY
  retryAttempts: 3
  retryBackoffMs: 1000
  localBaseURL: http://localhost:11434/v1
  localModel: glm-ocr
  localFallbackModels:
    - qwen2.5-vl:7b
```

每个后端都会进行有上限的指数退避重试。两个后端都失败时，错误消息会提示用户检查
云端 Key，或安装/配置本地 OpenAI-compatible OCR/VLM 模型。插件不会在仓库中内置或
联网获取共享云端密钥；用户自己的授权凭据仍通过 DSH credentials 或配置的环境变量
提供。

本地图片路径只能位于当前 Session 的 Workspace 内，解析软链接后仍会检查边界；
远程 URL 或本地图片内容只会在调用 `view_image` 时发送给所配置的视觉端点。浏览器
附件按钮、粘贴和拖放都属于 DSH 原生图片输入；DeepSeek V4 的最终 admission check
由插件放行，其他模型仍遵循各自的 image-input 元数据。

## 上下文洞察

Desktop 和 Web 内置
[dsh-context](https://github.com/bowenliang123/dsh-context)（固定版本
`v0.31.1`）插件。它提供 Context 面板，展示上下文容量、余量、组成、历史、事件与
消息统计，并提供 `/context` 命令在会话内快速查看当前上下文组成。该插件只做只读
洞察：通过 DSH 自身驱动的 projection 观察会话，不会改动对话内容。

面板与 composer 原生的 context ring 并存，两者展示同一份容量事实。TUI 不内置该
插件——它围绕交互式面板构建，上游维护者也不面向 TUI 适配。

Oh-DSH 通过子模块固定版本，随自身发行节奏升级，不会自动跟随 npm latest。

## 订阅账号 OAuth 登录

Desktop 和 Web 内置上游 [dsh-auth](https://github.com/ccch1mneyyy/dsh-auth)
host 插件（固定在 dsh-TUI 子模块内；TUI 通过其 renderer 加载同一包）。它注册
订阅账号 LLM 路由——ChatGPT/Codex、Claude Pro/Max 与 SuperGrok——并提供
`/auth` 命令完成登录、查看状态与退出。交互式登录流程走各面已有的问答 UI；
在没有交互面的环境中，命令会给出指引并拒绝，而不是假定存在浏览器。凭据保存
在既有的 Oh-DSH 数据目录中。

## Desktop 操作

### 对话输入历史

焦点位于主对话输入框时，在第一行开头按 `ArrowUp` 可取回上一条已提交消息；在
最后一行末尾按 `ArrowDown` 可向后浏览，并最终恢复开始浏览前的草稿。多行输入中，
未处于这两个边界的方向键仍保持原有的光标移动行为。

历史按当前会话隔离，只包含已确认的用户文本消息，仅在本次应用运行期间保存在内存
中。输入框最多保留最近 100 条记录；在容量允许时，浏览到最早记录会按需加载更早的
会话消息。

| 操作 | macOS 快捷键 |
| --- | --- |
| 切换左侧栏 | `⌘B` |
| 切换底部 Terminal | `⌘J` |
| 切换右侧栏 | `⌥⌘B` |
| 打开 Review | `⌃⇧G` |
| 打开 Browser | `⌘T` |
| 打开 Files | `⌘P` |
| 新建 Side chat | `⌥⌘S` |
| 退出侧栏专注模式 | `Esc` |

设置页支持中英文、模型、权限、Agent preset、插件配置和 Oh-DSH 皮肤。
设置弹窗会覆盖并虚化所有工作区和侧栏内容。“关于”分区列出当前构建的版本
信息：Oh-DSH 本身、固定的上游 DeepSeek Harness 运行时、内置插件和关键依赖。
Desktop 端在同一分区即可完成整个更新流程——检查更新、带实时进度的下载和
安装，无需离开页面；检查时若无法访问 GitHub，更新器会通过发布镜像重试
一次。Web 端只展示版本信息，不显示更新卡片。

Web 与 Desktop 可在设置页选择皮肤。TUI 输入 `/theme` 可选择相同的 Deep
Current、Jade Circuit、Porcelain 和 Ember Dusk；选择立即生效并在重启后保留。
皮肤激活期间，外观设置只更新“原始外观”使用的回退值；如需退出皮肤，请在
皮肤列表中选择“原始外观”。

## 插件市场

Desktop、Web 与 TUI 共用同一个插件市场：三端都能检索插件、准备
candidate、隔离预览、应用、启用、更新和卸载。Desktop 与 Web 使用侧栏
市场界面；TUI 在聊天中输入 `/plugins` 打开终端市场（也可按 `Ctrl+M`）。

插件目录会标注每个插件的生效界面。安装本身在所需预览沙箱可用时才会成功；
如果插件声明只支持 Web / Desktop，在 TUI 中安装后不会在 TUI 生效，卡片和
详情会明确显示这一点。Linux x64 的构建脚本使用随运行时提供的 Landlock
启动器。如果没有写入受限的进程沙箱，用户可以单独、明确地接受不安全构建；
Agent 无法授权这种模式。

推荐流程：

1. 在未安装分类中选择插件。
2. 检查来源、commit、权限和风险等级。
3. 创建 candidate 并在隔离 Profile 中预览。
4. 效果不合适时选择放弃，当前桌面不发生变化。
5. 确认后应用；需要时再单独启用。
6. 更新失败时恢复 previous。

Agent 可以通过对话发起同样的安装操作，但仍需要经过预览、风险确认和应用，
不会直接修改当前 Profile。

## 从源码启动与打包

```sh
git submodule update --init --recursive
pnpm install
pnpm run build:dsh
pnpm run build
pnpm run stage:dsh
export PATH="$PWD/bin:$PATH"

ohdsh desktop
ohdsh web --port 3080
ohdsh tui
```

开发阶段也可以使用仓库根目录的 Makefile；它只会为当前界面暂存所需的包，
因此比完整 staging 更快：

```sh
make build
make tui ARGS="--inline --lang en"
make web ARGS="--port 3080"
make desktop
```

`make tui` 和 `make web` 不会暂存 Desktop 或其它交互形态的包；Oh-DSH 也会禁用
上游 TUI 的后台自动更新检查，pinned runtime 由 Oh-DSH 发布流程统一更新；面向
完整共享 runtime 的发布流程仍使用 `pnpm run stage:dsh`。Make 默认使用
`~/.ohdsh`，也可以通过 `OH_DSH_HOME` 覆盖以运行隔离实例。

打包命令：

```sh
pnpm run dist:mac       # macOS full distribution
pnpm run dist:linux     # Linux full distribution
pnpm run dist:win       # Windows full distribution
pnpm run dist:web       # Web-only lightweight distribution
pnpm run dist:tui       # TUI-only terminal distribution
```

发布工作流在 GitHub Actions 的 macOS 签名/公证凭据和 Windows Authenticode
凭据齐全时生成正式签名包。缺少任一组凭据时，工作流会明确警告并降级生成 macOS
ad-hoc 签名包或 Windows 未签名安装器，而不会阻止 Web、TUI 和 Desktop 打包。
降级产物仅支持上文所述的手动安装，不能视为支持自动更新。启用正式签名需要配置
`MACOS_CSC_LINK`、`MACOS_CSC_KEY_PASSWORD`、`APPLE_ID`、
`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`、`WINDOWS_CSC_LINK` 和
`WINDOWS_CSC_KEY_PASSWORD`。安装包、内嵌或外置 blockmap、`latest*.yml` 元数据
仍会被严格校验，缺失时停止发布。可从 Actions 手动运行 Release workflow 做四平台
打包检查；手动运行只上传 workflow artifacts，不创建 GitHub Release。

## 数据与排错

Desktop、Web 和 TUI 默认共同使用 `~/.ohdsh`，且不会加载 `~/.dsh` 中的
全局插件配置。三端分别使用 `profiles/desktop`、`profiles/web` 和
`profiles/tui`，但共享会话、凭据、皮肤和插件缓存；Electron 自身的数据
位于 `~/.ohdsh/desktop`。可用 `OH_DSH_HOME` 全局覆盖，也可用 Web/TUI 的
`--data` 临时隔离。DeepSeek API key 可以在 Models 设置中配置，或写入
`~/.ohdsh/.env`。

首次使用共享目录时，Desktop 会从系统应用数据目录中的旧
`Oh-DSH-Desktop` 状态导入会话、凭据、插件与界面设置；Web 会导入旧
`~/.oh-dsh-web/dsh`、根级皮肤与侧栏偏好，以及当前数据目录下的 `dsh/`。
迁移只复制共享目录中缺失的数据，并保留旧目录用于回滚；已存在的新状态
不会被覆盖。

同一时间只有一个 Oh-DSH 前端持有共享数据根的写入权。其他前端可以以
只读模式启动并查看历史，但不能在持有者运行期间写入活跃会话。

排查顺序：

1. 运行 `ohdsh --help` 确认 CLI 来源。
2. 运行 `ohdsh web --help` 检查参数。
3. 运行 `ohdsh tui --help`，再用 `ohdsh tui --inline` 排除终端全屏兼容问题。
4. 使用随机端口验证：`ohdsh web --port 0 --no-open`。
5. 检查 Profile 是否同时安装并启用了所需插件。
6. Desktop 启动失败时，从终端运行应用内 `bin/ohdsh desktop` 获取日志。

架构与上游关系见[设计与插件边界](./design.md)。
