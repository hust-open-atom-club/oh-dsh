# Installation, operations, and troubleshooting

English | [中文](usage.zh.md)

## Choose a distribution

- Install **Oh-DSH Desktop** for the complete local workbench.
- Install **Oh-DSH Web** for browser-only use without Electron.
- Install **Oh-DSH TUI** for terminal-only use without Electron or browser UI.

Releases provide Full, Web-only, and TUI-only distributions. The command-line
installer installs TUI by default; choose another surface explicitly when
needed.

## Install with install.sh

`install.sh`, at the repository root, installs the latest stable Release
without cloning the repository on macOS and Linux. It needs `curl` and `tar`
(`ditto` or `unzip` for the macOS desktop package), and it never requires
root for user-local web/tui installs.

```sh
curl -fsSL \
  https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.sh \
  | bash
```

On Windows, `install.ps1` is the counterpart and installs the same surfaces
(the desktop through the NSIS installer's silent mode). It needs PowerShell
5.1+ and `tar`, both bundled with Windows 10 1803+:

```powershell
irm https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.ps1 | iex
```

Both scripts accept the same options; PowerShell uses `-Surface`, `-Version`,
`-Dest`, `-BinDir`, `-Force`, and `-Uninstall` parameters instead of the
lower-case flags.

Surface matrix and default locations:

| Surface | macOS (arm64/x64) | Linux (x64) | Windows (x64) |
| --- | --- | --- | --- |
| desktop | `Oh-DSH Desktop.app` into `/Applications` with a Launch Services refresh; registers `ohdsh desktop` in `~/.local/bin` | AppImage into `~/.local/bin/oh-dsh-desktop`; registers `ohdsh desktop` in `~/.local/bin` | NSIS installer run silently (per-user); registers `ohdsh desktop` |
| web | payload in `~/.local/share/oh-dsh/web` plus a dispatching `ohdsh` launcher in `~/.local/bin` | same | payload in `%LOCALAPPDATA%\oh-dsh\web` plus an `ohdsh.cmd` shim in `%LOCALAPPDATA%\oh-dsh\bin` (added to the user PATH) |
| tui (default) | payload in `~/.local/share/oh-dsh/tui` plus a dispatching `ohdsh` launcher in `~/.local/bin` | same | payload in `%LOCALAPPDATA%\oh-dsh\tui` plus an `ohdsh.cmd` shim in `%LOCALAPPDATA%\oh-dsh\bin` (added to the user PATH) |

Only the desktop surface creates a desktop application entry. web and tui
never register with Launch Services or create `.app` bundles. Desktop also
registers the unified `ohdsh` dispatcher.

The web and tui payloads each carry only their own surface's dependencies,
so both can be installed side by side: the shared `ohdsh` launcher records
each surface's payload and routes `ohdsh web` and `ohdsh tui` to the
installation that provides them. Uninstalling one surface keeps the other
usable through the same launcher.

Options:

| Option | Default | Description |
| --- | --- | --- |
| `--surface` | `tui` | `desktop`, `web`, or `tui`; each installs only its own files and launcher |
| `--version` | latest stable | Pin a release tag such as `v0.1.8`. Prereleases are never selected implicitly; they install only when pinned explicitly |
| `--dest` | see matrix above | Destination directory |
| `--bin-dir` | `~/.local/bin` | Directory for the `ohdsh` launcher |
| `--repo` | `hust-open-atom-club/oh-dsh` | Install from another fork |
| `--force` | off | Reinstall when the same version is already present |
| `--uninstall` | off | Remove the installed surface |
| `--os`, `--arch` | detected | Override target selection (`darwin`/`linux`, `arm64`/`x64`) |

Equivalent environment variables: `OH_DSH_SURFACE`, `OH_DSH_VERSION`,
`OH_DSH_INSTALL_DIR`, `OH_DSH_BIN_DIR`, `OH_DSH_REPO`, `OH_DSH_OS`, and
`OH_DSH_ARCH`; options win over the environment. `GH_TOKEN`/`GITHUB_TOKEN`
authenticate the GitHub API request (useful behind rate limits), and
`OH_DSH_API_BASE`/`OH_DSH_DOWNLOAD_BASE` override the endpoint bases for
testing.

Upgrade, verification, and uninstall behavior:

- The installer reads the SHA-256 digest GitHub publishes for each Release
  asset and verifies the download before touching the previous
  installation. A failed download, checksum mismatch, or interrupted
  extraction leaves the previous install usable and reports the failure;
  partially staged files are cleaned up.
- Re-running the installer with the same version is a no-op unless `--force`
  is passed. A newer version replaces the payload and refreshes the `ohdsh`
  launcher atomically.
- Upgrades are replace-in-place: once the new installation is validated, the
  previous app bundle, AppImage, or payload is deleted along with any stale
  staging directories and pre-upgrade backups, so exactly one Oh-DSH
  installation remains per surface.
- On macOS the desktop surface refreshes Launch Services and retires a
  stale `Oh-DSH-Desktop.app` bundle, so a single application entry shows.
  An unnotarized build may still need the right-click **Open** approval
  described below.
- Uninstall with `sh install.sh --uninstall --surface <name>` (or
  `install.ps1 -Uninstall` on Windows), honoring the same destination
  overrides used at install time.

## Automatic update checks

Every surface checks for a newer stable Release once per launch:

- **TUI** prints one notice line before the first frame, for example
  `Oh-DSH 0.1.8 -> 0.2.0 is available. Run "ohdsh update" to upgrade.`
- **Web** prints the same notice after the listening URL.
- **Desktop** checks through its update window and shows a system
  notification when a new version is found; clicking it opens the update
  window. The desktop still installs updates through its own verified
  updater, not the shell installer.

`ohdsh update` (or `ohdsh update web` / `ohdsh update tui`) upgrades a
packaged web/tui distribution on macOS, Linux, and Windows by re-running
the matching installer script with the same verification and atomic
replacement as a fresh install. The installation source is inferred the
way Codex does it — from the running path, the payload's install marker,
and the destinations recorded in `launcher.env` — never from a flag baked
into the build, and the recorded `--dest`/`--bin-dir` are reconstructed so
an update lands exactly where the install did. An installation at a
location the installers do not own is refused with guidance. From a source
checkout it asks you to use git instead.

Updates are release-based only: every surface compares against published
stable GitHub Releases with semver; there is no commit-level or rolling
update channel.

The checks use the public GitHub API, never block startup for more than
about a second and a half, and fail silently offline. Set
`OH_DSH_UPDATE_CHECK=0` to disable them everywhere. `ohdsh update`
prefers the installer script bundled inside the package at
`lib/oh-dsh/install.sh` (or `install.ps1`) and only downloads it from the
repository's `main` branch over TLS when the bundle is absent;
`OH_DSH_INSTALL_SCRIPT_URL` can point the download at a mirror or a local
copy for testing. On Windows the update runs detached after the current
process exits, because the running payload cannot be replaced while it
executes.

## Install the full distribution

### macOS

1. Download the DMG from the latest Release.
2. Drag **Oh-DSH Desktop** into Applications.
3. For an unnotarized test build, right-click the app in Finder and choose
   **Open** on first launch.

If a verified Release download remains quarantined, apply this to the actual
downloaded file:

```sh
xattr -d com.apple.quarantine ~/Downloads/Oh-DSH-Desktop-*.dmg
```

Install the unified command:

```sh
sudo ln -sf \
  "/Applications/Oh-DSH Desktop.app/Contents/Resources/bin/ohdsh" \
  /usr/local/bin/ohdsh
```

### Linux

AppImage:

```sh
chmod +x Oh-DSH-Desktop-*.AppImage
./Oh-DSH-Desktop-*.AppImage
```

deb:

```sh
sudo apt install ./Oh-DSH-Desktop-*.deb
```

### Windows

Run the Windows installer from the Release and start **Oh-DSH Desktop**. The unified CLI is
`bin\ohdsh.cmd` under the application resources directory; add that directory
to `PATH` if desired.

An unsigned installer may trigger Windows SmartScreen. After verifying that it
came from the project Release, choose **More info**, then **Run anyway**. The
installer may request administrator approval.

The window title bar, menu bar, and tool strip are merged into a single row;
open the application menu from the labels in the row's left corner.

Closing the window minimizes Oh-DSH Desktop to the system tray instead of
quitting: click the tray icon to restore the window, and use **Quit Oh-DSH
Desktop** in the tray (or application) menu to exit. macOS and Linux keep
their usual close behavior.

### Desktop online updates

Choose **Oh-DSH Desktop -> Check for Updates...** from the application menu.
The updater checks only stable GitHub Releases from
`hust-open-atom-club/oh-dsh`; it does not need a GitHub login or token.

- macOS, Windows, and Linux AppImage can restart and install after a verified
  download, or install on the next application quit.
- `.deb` downloads and opens the system package installer. It never runs
  `sudo`, `apt`, or `dpkg` around the system permission boundary.
- The updater uses the system proxy configuration. When the configured proxy
  cannot be reached, the updater retries once without any proxy and keeps the
  direct connection for the rest of the session. Offline, proxy-auth, 404,
  insufficient-space, verification, cancellation, and retry states are shown
  in the update window. A verification failure never replaces the current app.
- An update replaces only the application. DSH data, workspace settings,
  sessions, installed plugins, and marketplace receipts remain in the existing
  data directory.

Automatic updates require a signed packaged Desktop build. Versions installed
before the first updater-enabled Release need one manual install; local
development builds and Releases without a matching platform package fall back
to the official Release page.

### DSH runtime updates (decoupled from the application)

The same update window also lists the DSH runtime version. Runtime updates
ship as independent `oh-dsh-runtime-<dshVersion>-<platform>-<arch>.tar.gz`
Release assets, so a new DSH release can be applied without reinstalling
Oh-DSH Desktop.

- **Check Runtime** looks for the newest runtime bundle published for this
  platform. **Update Runtime** downloads it, verifies the published SHA-256
  checksum, stages it under `~/.ohdsh/runtimes/<version>/`, and smoke-checks
  `dsh --version` before activating anything.
- Activation writes the pointer `~/.ohdsh/runtimes/current.json` and restarts
  only the Harness process; the application keeps running.
- **Use Bundled Runtime** removes the pointer and restarts the Harness on the
  runtime bundled with the application build. A failed verification never
  changes the active runtime.

## Install Web-only

```sh
tar -xzf oh-dsh-web-*.tar.gz
cd oh-dsh-web-*/
./bin/ohdsh web
```

Windows:

```bat
bin\ohdsh.cmd web
```

Common options:

| Option | Default | Description |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Bind address |
| `--port` | `3080` | Listen port; `0` selects a random port |
| `--data` | `~/.ohdsh` | Shared Oh-DSH data root for all surfaces |
| `--no-open` | off | Do not open the browser automatically |
| `--trusted-host` | none | Add a trusted authority; repeatable |

Equivalent environment variables include `DSH_OH_WEB_HOST`,
`DSH_OH_WEB_PORT`, `DSH_OH_WEB_HOME`, and `DSH_OH_WEB_OPEN`. `OH_DSH_HOME`
overrides the data root for Desktop, Web, and TUI together. Press `Ctrl+C` for
a graceful shutdown.

Do not bind to `0.0.0.0` without an access boundary. For LAN exposure, add
`--trusted-host` and put authentication and TLS in a trusted reverse proxy.

## Install TUI-only

```sh
tar -xzf oh-dsh-tui-*.tar.gz
cd oh-dsh-tui-*/
./bin/ohdsh tui
```

Use `bin\ohdsh.cmd tui` on Windows. TUI requires a real interactive terminal.
It keeps the current terminal position by default, matching the Codex-style
inline startup; pass `--fullscreen` to use the alternate screen.

## Unified commands

```sh
ohdsh desktop
ohdsh gui
ohdsh web
ohdsh tui
```

- `desktop` opens the installed app and falls back to the Electron development
  entry when run from a source checkout.
- `gui` is an alias for `desktop`.
- `web` starts the HTTP service and prints its URL.
- `tui` initializes its Profile and attaches the upstream renderer to the
  current terminal.

Common TUI options:

| Option | Default | Description |
| --- | --- | --- |
| `--cwd` | Current directory | Workspace |
| `--data` | `~/.ohdsh` | Shared Oh-DSH data root for all surfaces |
| `--resume` | New session | Resume a Session id |
| `--lang` | Upstream preference | `zh` or `en` |
| `--preset` | `standard` | Initial Agent preset |
| `--inline` | On | Preserve terminal scrollback instead of alternate screen |

### Agent presets

Desktop, Web, and TUI use the same Agent preset roster. The distribution ships
`liangshen`, which keeps the root and delegated agents on Minimal's two-tool
surface for the first request, promotes to the full catalog after the first
tool call, and re-anchors after compaction. Choose it from the Agent preset
settings in Web/Desktop; in TUI, enter:

```text
/preset liangshen
```

You can also select it at TUI startup with `ohdsh tui --preset liangshen`.
The blank-only rule applies after a conversation has started; that choice is
saved as the default for the next new session.

## Image recognition

Desktop, Web, and TUI all load the bundled `@oh-dsh/vision` plugin. DSH owns
image paste, thumbnails, attachment storage, and submission through its native
attachment rail. DeepSeek V4 is still described as text-only by the pinned DSH
metadata; the plugin only admits V4 at the Host's final image-capability check.
The Host then describes each native image attachment through the configured
vision backend before the pinned text-only adapter serializes the same turn. It
does not intercept the composer or create a second thumbnail/reference path.
The `view_image` tool remains available for explicit workspace-local paths,
HTTP(S) URLs, and image data URLs.

In Desktop or Web UI, copy a PNG, JPEG, WebP, or GIF, focus the message
composer, and press `⌘V` on macOS or `Ctrl+V` on Windows/Linux. DSH's native
composer displays the thumbnail inside the input card and owns remove, drag/drop,
size limits, and submission. The plugin does not intercept this flow. TUI has
no graphical thumbnail; provide a workspace-local image path or HTTP(S) URL in
the prompt to use the same `view_image` tool.

The default backend uses Zhipu `glm-4.6v-flash`. In the native
`Settings → Plugins → Plugin configuration → Vision` card, confirm the cloud
endpoint first, then click `Get a Zhipu key` to open the Zhipu console. Paste
the returned key into the password-style field; it is stored in the shared data
root's credential file (`~/.ohdsh/.credentials.yaml` by default):

```yaml
ZHIPUAI_API_KEY: your-api-key
```

Keep the credential file owner-readable only, for example with
`chmod 600 ~/.ohdsh/.credentials.yaml` on macOS/Linux. Exporting
`ZHIPUAI_API_KEY` before launch is also supported. The legacy
`VISION_API_KEY` name remains a migration fallback.

Override the backend and model in the shared `~/.ohdsh/settings.yaml`:

```yaml
oh-dsh-vision:
  baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
  model: qwen3-vl-flash
  apiKeyEnv: DASHSCOPE_API_KEY
  maxTokens: 2048
  timeoutMs: 60000
maxImageBytes: 10485760
```

The card intentionally shows only the cloud endpoint, cloud model, and one
masked Zhipu key field. The key is write-only through the DSH credential store
and is never returned in a settings snapshot. Retry, fallback, timeout, image
size, and local OCR/VLM options remain available to the Agent or through
advanced `settings.yaml` configuration, so users do not have to enter several
keys. Claude/Anthropic keys belong to their model provider and are not treated
as the Zhipu Vision key.

A local Ollama endpoint needs no key:

```yaml
oh-dsh-vision:
  baseURL: http://localhost:11434/v1
  model: qwen3-vl:4b
```

Cloud credentials are attempted first with bounded retries and configured cloud
fallback models. If the cloud request is rate-limited, unavailable, or returns
an incompatible response, a configured local OCR/VLM model is tried. If that
path also fails, one final cloud recovery is attempted before the error points
you to the Vision card, a new cloud key, or a local model. `localModel` is the
model ID you choose from your local Ollama/LM Studio-compatible installation;
an empty value disables the local fallback. `localApiKeyEnv` is only needed for
a non-local endpoint.

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

Each backend has a bounded exponential retry. When both backends fail, the
error tells the user to check the cloud key or install/configure a local
OpenAI-compatible OCR/VLM model. The plugin does not embed or fetch a shared
cloud secret; the user's authorized key remains in DSH credentials or the
configured environment variable.

Local image paths must remain inside the active Session workspace, including
after symlink resolution. Remote URLs or local image bytes are sent to the
configured vision endpoint only when `view_image` is called. The browser's
attachment button, paste, and drag-and-drop remain native DSH image input;
DeepSeek V4 is admitted by the plugin's final check, while other models keep
their declared image-input behavior.

## Context insight

Desktop and Web bundle
[dsh-context](https://github.com/bowenliang123/dsh-context) (pinned release
`v0.31.1`) as a built-in plugin. It contributes a Context panel with capacity,
remaining, composition, history, event, and message statistics, and a
`/context` command that summarizes the current context composition inside the
conversation. The plugin is read-only insight: it observes the session through
the same projections DSH drives and never mutates the conversation.

The panel coexists with the composer's native context ring; both present the
same capacity facts. The TUI surface does not bundle the plugin — it is built
around interactive panels, and the upstream maintainer does not target TUI.

Oh-DSH upgrades the pin deliberately through the submodule revision with each
release; it does not follow npm latest automatically.

## Subscription OAuth sign-in

Desktop and Web bundle the upstream
[dsh-auth](https://github.com/ccch1mneyyy/dsh-auth) host plugin (pinned
inside the dsh-TUI submodule; the TUI loads the same package through its
renderer). It registers subscription-account LLM routes — ChatGPT/Codex,
Claude Pro/Max, and SuperGrok — and contributes the `/auth` command for
sign-in, status, and sign-out. The interactive login flow runs through the
same question UI each surface already uses; when no interactive surface is
present, the command refuses with guidance instead of assuming a browser.
Credentials stay in the existing Oh-DSH data directory.

## Desktop operations

### Conversation input history

With the main conversation composer focused, `ArrowUp` at the start of the
first line recalls the preceding submitted message. `ArrowDown` at the end of
the last line moves forward and eventually restores the draft that was present
before browsing. In a multi-line draft, arrows away from those boundaries keep
their normal caret movement.

History is scoped to the current session, contains only confirmed text user
messages, and remains in memory only for the current application run. The
composer keeps the most recent 100 entries and loads older session messages on
demand while that window has capacity.

| Action | macOS shortcut |
| --- | --- |
| Toggle the left sidebar | `⌘B` |
| Toggle the bottom Terminal | `⌘J` |
| Toggle the right sidebar | `⌥⌘B` |
| Open Review | `⌃⇧G` |
| Open Browser | `⌘T` |
| Open Files | `⌘P` |
| Start a Side chat | `⌥⌘S` |
| Leave sidebar focus mode | `Esc` |

Settings covers language, models, permissions, Agent presets, plugin config,
and Oh-DSH skins. Its modal covers and blurs every workspace and sidebar. The
About section lists this build's versions: Oh-DSH itself, the pinned upstream
DeepSeek Harness runtime, bundled plugins, and key dependencies. On Desktop
the same section also runs the full update flow — check for updates, download
with live progress, and install — without leaving the page; if GitHub cannot
be reached during a check, the updater retries once through a release mirror.
Web shows the version inventory without the update card.

Choose a skin from Settings on Web or Desktop. In TUI, run `/theme` to select
the same Deep Current, Jade Circuit, Porcelain, or Ember Dusk palette. The
choice applies immediately and survives restarts. While a skin is active,
Appearance changes update the fallback used by **Original**; choose
**Original** in the skin gallery to leave the skin.

## Plugin marketplace

Desktop, Web, and TUI share one plugin marketplace: all three surfaces can
search plugins, prepare candidates, preview, apply, enable, update, and
uninstall. Desktop and Web use the sidebar marketplace; in TUI run `/plugins`
(or press `Ctrl+M`) to open the terminal marketplace.

The catalog labels the surfaces where each plugin is expected to take effect.
Installation itself succeeds on all three surfaces when the required preview
sandbox is available; if a plugin declares Web or Desktop support only, it will
not take effect in TUI after installation, and the cards and details call that
out explicitly. Linux x64 uses the staged Landlock launcher for scripted builds.
If no write-restricted sandbox is available, a direct human can separately
accept an explicitly labelled unsafe build; Agents cannot authorize that mode.

Recommended flow:

1. Choose a plugin from Not installed.
2. Inspect its source, commit, permissions, and risk level.
3. Prepare a candidate and preview it in an isolated Profile.
4. Discard it if the result is unsuitable; the current Desktop is unchanged.
5. Apply it explicitly, then enable it separately when needed.
6. Recover the previous state if an update fails.

An Agent can initiate the same operation through chat, but still passes
through preview, risk approval, and apply. It cannot directly mutate the
current Profile.

## Run and package from source

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

For faster surface-local development, the repository Makefile stages only the
packages required by the selected interface:

```sh
make build
make tui ARGS="--inline --lang en"
make web ARGS="--port 3080"
make desktop
```

`make tui` and `make web` do not stage Desktop or other surface packages.
Oh-DSH also disables the upstream TUI background update check; pinned runtime
updates are handled by the Oh-DSH release flow. Make uses `~/.ohdsh` by
default and accepts an `OH_DSH_HOME` override for isolated runs.
`pnpm run stage:dsh` remains the full shared stage used by release-oriented
workflows.

Packaging commands:

```sh
pnpm run dist:mac       # macOS full distribution
pnpm run dist:linux     # Linux full distribution
pnpm run dist:win       # Windows full distribution
pnpm run dist:web       # Web-only lightweight distribution
pnpm run dist:tui       # TUI-only terminal distribution
```

The release workflow produces formally signed packages when all GitHub Actions
secrets for macOS signing/notarization and Windows Authenticode signing are
available. If either credential set is incomplete, the workflow emits an
explicit warning and falls back to an ad-hoc-signed macOS package or an
unsigned Windows installer without blocking Web, TUI, and Desktop packaging.
Fallback artifacts support only the manual installation described above and
must not be treated as supporting automatic updates. Formal signing requires
`MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WINDOWS_CSC_LINK`, and
`WINDOWS_CSC_KEY_PASSWORD`. Installers, embedded or external blockmaps, and
`latest*.yml` metadata remain strictly validated and stop the release when
missing. Run the Release workflow manually from Actions for a four-platform
packaging check; manual runs upload workflow artifacts without creating a
GitHub Release.

## Data and troubleshooting

Desktop, Web, and TUI share `~/.ohdsh` by default and do not load global plugin
configuration from `~/.dsh`. They keep separate `profiles/desktop`,
`profiles/web`, and `profiles/tui` compositions while sharing sessions,
credentials, skins, and plugin caches. Electron-specific data lives under
`~/.ohdsh/desktop`. Override all surfaces with `OH_DSH_HOME`, or isolate one
Web or TUI process with `--data`. Configure the DeepSeek API key in Models
settings or in `~/.ohdsh/.env`.

On first use of the shared root, Desktop imports sessions, credentials, plugins,
and UI preferences from the old system `Oh-DSH-Desktop` application-data
directory. Web imports the former `~/.oh-dsh-web/dsh` root and a nested `dsh/`
inside the selected data directory, plus root-level skin and sidebar
preferences. Migration copies only missing data and leaves legacy directories
in place for rollback; existing shared state is not replaced.

Only one Oh-DSH surface owns the shared data root at a time. Other surfaces
can start in read-only mode to view history, but cannot write to active
sessions while the owner is running.

Troubleshooting order:

1. Run `ohdsh --help` to confirm the CLI source.
2. Run `ohdsh web --help` to inspect options.
3. Run `ohdsh tui --help`, then use `ohdsh tui --inline` to isolate
   alternate-screen terminal compatibility.
4. Test a random port with `ohdsh web --port 0 --no-open`.
5. Confirm that required plugins are both installed and enabled in the Profile.
6. If Desktop does not start, run its bundled `bin/ohdsh desktop` in a terminal
   to capture logs.

See [design and plugin boundaries](./design.md) for architecture and
upstream relationships.
