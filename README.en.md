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
  <a href="./docs/usage.en.md">Usage guide</a>
  ·
  <a href="./docs/design.en.md">Design guide</a>
</p>

<p align="center">
  <img src="./assets/oh-dsh-desktop-showcase.png" alt="Oh-DSH Desktop interface" width="100%">
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
      <p>Browse, classify, install, enable, update, and uninstall plugins. Every change enters an isolated preview first, so you can inspect risk, apply it, or roll back safely.</p>
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

Web-only and TUI-only packages are ready after extraction:

```sh
# Web UI, listening on http://127.0.0.1:3080 by default
./bin/ohdsh web

# Terminal UI
./bin/ohdsh tui
```

On Windows, use `bin\ohdsh.cmd web` or `bin\ohdsh.cmd tui`.

### Install the unified command

The macOS full distribution contains a launcher that can be added to `PATH`:

```sh
sudo ln -sf \
  "/Applications/Oh-DSH Desktop.app/Contents/Resources/bin/ohdsh" \
  /usr/local/bin/ohdsh
```

Run `./bin/ohdsh` from Web-only and TUI-only packages, or add it to `PATH`.

## Usage

```sh
ohdsh desktop          # Start Oh-DSH Desktop
ohdsh web              # Start Oh-DSH Web
ohdsh web --port 3080  # Choose the Web port
ohdsh tui              # Start Oh-DSH TUI
```

All three surfaces use `~/.ohdsh` for caches, configuration, sessions,
credentials, and plugin state by default. Set `OH_DSH_HOME` to move the shared
data root. Run `ohdsh web --help` or `ohdsh tui --help` for surface-specific
options.

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

- [Installation, operations, and troubleshooting](./docs/usage.en.md)
- [Architecture, design, and plugin boundaries](./docs/design.en.md)

## Plugin recommendations

| Recommended project | Description |
| --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-harness/deepseek-harness) | DSH runtime, sessions, and plugin loader |
| [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) | **Direct upstream plugin for Oh-DSH TUI**, providing terminal rendering, interaction, and commands |
| [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | Git review, files, and PTY host capabilities |
| [dshfind](https://dshfind.com/) | DSH plugin marketplace and learning community with plugin, ecosystem, and DeepSeek Harness peripheral recommendations |

Oh-DSH preserves upstream implementations and attribution, then provides the
unified launcher, Profiles, data root, cross-surface skins, interface
adaptations, and distribution packaging. See the [design guide](./docs/design.en.md)
for the exact boundaries.

## License

[MIT](./LICENSE)
