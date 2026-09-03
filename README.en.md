<p align="center">
  <a href="./README.md">简体中文</a> ·
  <strong>English</strong>
</p>

<div align="center">
  <img src="./assets/dsh-whale.png" width="128" alt="Oh-DSH whale">
  <h1>Oh-DSH</h1>
  <p><strong>One DSH runtime. Desktop, Web, and TUI development experiences.</strong></p>
  <p>Bring AI agents, workspaces, local tools, and the plugin ecosystem to the interface you prefer.</p>
</div>

<p align="center">
  <a href="https://github.com/hust-open-atom-club/oh-dsh/releases/latest"><img alt="GitHub release" src="https://img.shields.io/github/v/release/hust-open-atom-club/oh-dsh?display_name=tag&amp;sort=semver&amp;style=flat-square&amp;color=2f81f7"></a>
  <a href="https://github.com/hust-open-atom-club/oh-dsh/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/hust-open-atom-club/oh-dsh?style=flat-square&amp;color=f5a623"></a>
  <img alt="Desktop, Web and TUI" src="https://img.shields.io/badge/Desktop%20%7C%20Web%20%7C%20TUI-3b82f6?style=flat-square">
  <img alt="macOS, Linux and Windows" src="https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-111827?style=flat-square">
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-34a853?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://github.com/hust-open-atom-club/oh-dsh/releases/latest"><strong>Download</strong></a>
  ·
  <a href="./docs/usage.md">Usage guide</a>
  ·
  <a href="./docs/design.md">Design guide</a>
</p>

<p align="center">
  <img src="./assets/oh-dsh-desktop-readme.png" alt="Oh-DSH Desktop interface" width="100%">
</p>

Oh-DSH packages DeepSeek Harness, Node.js, local development tools, and bundled
plugins as installable Desktop, Web, and TUI distributions. Model services can
still run in the cloud; the local workbench organizes workspaces, terminals,
Git review, browser, files, sessions, and plugin state.

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🖥️ Three interaction surfaces</h3>
      <p>Use the same <code>ohdsh</code> command to start Desktop, Web, or TUI. All surfaces share sessions, credentials, skins, and plugin caches while keeping separate Profiles.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🧰 Local development workbench</h3>
      <p>Workspace, PTY terminal, browser, file explorer, side chat, and trajectory are built in. Panels can collapse, pin, split, or expand over the workspace.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🔍 Git review</h3>
      <p>Inspect workspace changes and commit diffs, add review comments to code lines, and manage branches, commits, and pushes from the same side panel.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🧩 Plugin marketplace</h3>
      <p>Desktop, Web, and TUI can all search, preview, and install plugins through one shared transaction and recovery state. The catalog labels where a plugin actually takes effect: installation may succeed on every surface, but some plugins only work on Web or Desktop — not in TUI — and that distinction is shown explicitly.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🎨 Cross-surface skins</h3>
      <p><code>@oh-dsh/skins</code> provides shared themes for Desktop, Web, and TUI, with layout and readability adaptations for each surface.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📦 Split distributions</h3>
      <p>Install the full, Web-only, or TUI-only distribution. Each includes pinned DSH and Node runtimes, so no separate runtime installation is required.</p>
    </td>
  </tr>
</table>

## Download and install

### Preferred: command-line installation

Use the repository's root-level `install.sh` on Linux and macOS to install the
latest stable release. It installs TUI by default and registers `ohdsh` under
`~/.local/bin`; open a new terminal and run:

```sh
curl -fsSL \
  https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.sh \
  | bash
```

Choose Web or Desktop explicitly when needed:

```sh
curl -fsSL \
  https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.sh \
  | bash -s -- --surface web

curl -fsSL \
  https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.sh \
  | bash -s -- --surface desktop
```

On Windows, use the root-level `install.ps1`; it also installs TUI by default:

```powershell
irm https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.ps1 | iex
```

After installation, use the unified command for any installed surface:

```sh
# Terminal UI
ohdsh tui

# Web UI
ohdsh web

# Desktop application
ohdsh desktop
```

`ohdsh` starts only surfaces that have been installed; the direct
`oh-dsh-desktop` entry point remains available. On Linux/macOS, open a new
terminal if the current shell has not loaded the new PATH; on Windows, use a
new terminal.

The installers verify the published SHA-256 digest before touching the
previous installation, so a failed download, checksum mismatch, or interrupted
extraction keeps the old install usable. Re-running the command upgrades in
place, and `--uninstall` removes a surface. Options, environment overrides,
and the surface matrix are documented in the
[installation guide](./docs/usage.md#install-with-installsh).

### Manual installation from a GitHub Release

Choose a distribution from the
[latest GitHub Release](https://github.com/hust-open-atom-club/oh-dsh/releases/latest):

| Distribution | Includes | Best for |
| --- | --- | --- |
| Full | **Oh-DSH Desktop**, Web, TUI, Node runtime, and bundled plugins | Local development workbench |
| Web-only | **Oh-DSH Web**, Node runtime, and bundled Web plugins; no Electron | Browser, server, or small installs |
| TUI-only | **Oh-DSH TUI**, Node runtime, and terminal plugins; no Electron | SSH and terminal-only environments |

- **macOS:** open the DMG and drag **Oh-DSH Desktop** into Applications.
- **Windows:** run the installer, or extract and launch the portable package.
- **Linux:** run the AppImage, or install the deb with `apt`.

The installer is the recommended entry point; Release assets are useful when
you need to choose a package manually or distribute it offline.

## Usage

```sh
ohdsh desktop          # Start Oh-DSH Desktop
ohdsh gui              # Alias for Oh-DSH Desktop
ohdsh web              # Start Oh-DSH Web
ohdsh web --port 3080  # Choose the Web port
ohdsh tui              # Start Oh-DSH TUI
```

All three surfaces use `~/.ohdsh` for caches, configuration, sessions,
credentials, and plugin state by default. Set `OH_DSH_HOME` to move the shared
data root. Run `ohdsh web --help` or `ohdsh tui --help` for surface-specific
options.

The bundled `@oh-dsh/vision` plugin exposes one `view_image` tool on every
surface, allowing users to perform OCR, image inspection, and UI diagnosis on
workspace-local files, HTTP(S) images, or image data URLs. DSH's native
attachment rail continues to own image copy, paste, thumbnails, and submission;
the plugin admits DeepSeek V4 at the Host's final image-capability check and
describes its native attachments through the configured vision backend before
the pinned text-only adapter serializes the same turn. It does not add a second
composer bubble or reference protocol. TUI uses the same capability through
workspace image paths or URLs. See the
[image recognition guide](./docs/usage.md#image-recognition) for credentials
and backend configuration. The cloud/local keys and Vision settings are also
available in the native Settings → Plugins → Plugin configuration → Vision
card.

<details>
<summary><strong>Run from source</strong></summary>

Node.js, pnpm, and the platform build tools are required:

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

For local source development, use the repository Makefile to start one
surface quickly:

```sh
make build
make tui ARGS="--lang en"       # stage and start TUI only
make web ARGS="--port 3080"     # stage and start Web only
make desktop                     # stage and start Desktop only
```

`make tui` uses inline mode by default and renders from the current terminal
cursor position; pass `ARGS="--fullscreen"` to use the alternate screen.
Each Make target stages only its own Oh-DSH surface packages, so unrelated
interaction surfaces are not added to the development runtime. Make uses
`~/.ohdsh` by default; override it with `OH_DSH_HOME=/tmp/ohdsh make tui`.

Desktop, Web, and TUI share the same Agent preset roster. The bundled
`liangshen` preset keeps the root and delegated agents on Minimal's two-tool
surface for the first request, promotes to the full catalog after the first
tool call, and re-anchors after compaction. Select it from the Agent preset
settings in Web/Desktop, or run `/preset liangshen` in TUI.

Build the full distribution with the platform-specific `dist:mac`,
`dist:linux`, or `dist:win` script. Build only Web with `pnpm run dist:web`,
or only TUI with `pnpm run dist:tui`.

</details>

<details>
<summary><strong>More interfaces</strong></summary>

### Plugin marketplace

![Oh-DSH plugin marketplace](./assets/oh-dsh-plugin-marketplace.png)

### Oh-DSH skins

![Oh-DSH cross-surface skins](./assets/oh-dsh-desktop-skins.png)

</details>

## Documentation

- [Installation, operations, and troubleshooting](./docs/usage.md)
- [Architecture, design, and plugin boundaries](./docs/design.md)

## Plugin recommendations

| Recommended project | Description |
| --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | DSH runtime, sessions, and plugin loader |
| [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) | **Direct upstream plugin for Oh-DSH TUI**, providing terminal rendering, interaction, and commands |
| [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | Git review, files, and PTY host capabilities |
| [dsh-vision](https://github.com/william-jin-cmu/dsh-vision) | Reference for the cross-surface `view_image` vision tool |
| [dshfind](https://dshfind.com/) | DSH plugin marketplace and learning community with plugin, ecosystem, and DeepSeek Harness peripheral recommendations |

Oh-DSH preserves upstream implementations and attribution, then provides the
unified launcher, Profiles, data root, cross-surface skins, interface
adaptations, and distribution packaging. See the [design guide](./docs/design.md)
for the exact boundaries.

## License

[MIT](./LICENSE)
