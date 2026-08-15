<p align="center">
  <a href="./usage.md">简体中文</a> ·
  <strong>English</strong> ·
  <a href="../README.en.md">Back to README</a>
</p>

# Installation, operations, and troubleshooting

## Choose a distribution

- Install **Oh-DSH Desktop** for the complete local workbench.
- Install **Oh-DSH Web** for browser-only use without Electron.
- Install **Oh-DSH TUI** for terminal-only use without Electron or browser UI.

The full distribution includes all three surfaces, so one installation
supports `desktop`, `web`, and `tui`.

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

### Desktop online updates

Choose **Oh-DSH Desktop -> Check for Updates...** from the application menu.
The updater checks only stable GitHub Releases from
`hust-open-atom-club/oh-dsh`; it does not need a GitHub login or token.

- macOS, Windows, and Linux AppImage can restart and install after a verified
  download, or install on the next application quit.
- `.deb` downloads and opens the system package installer. It never runs
  `sudo`, `apt`, or `dpkg` around the system permission boundary.
- The updater uses the system proxy configuration. Offline, proxy-auth, 404,
  insufficient-space, verification, cancellation, and retry states are shown
  in the update window. A verification failure never replaces the current app.
- An update replaces only the application. DSH data, workspace settings,
  sessions, installed plugins, and marketplace receipts remain in the existing
  data directory.

Automatic updates require a signed packaged Desktop build. Versions installed
before the first updater-enabled Release need one manual install; local
development builds and Releases without a matching platform package fall back
to the official Release page.

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
It uses the alternate screen by default; upstream `dsh-TUI` owns fullscreen
selection, scrolling, and copy behavior.

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
| `--inline` | Off | Preserve terminal scrollback instead of alternate screen |

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
and Oh-DSH skins. Its modal covers and blurs every workspace and sidebar.

Choose a skin from Settings on Web or Desktop. In TUI, run `/theme` to select
the same Deep Current, Jade Circuit, Porcelain, or Ember Dusk palette. The
choice applies immediately and survives restarts.

## Routing mode and guarded injection

`router-standard` is an optional, system-trusted Agent preset installed with
Oh-DSH. It is available in Desktop, Web, and TUI, and never replaces the
existing `standard` preset. Choose it for a new session when its task-aware
routing is useful; copy it to a user preset before making custom changes.

Router Standard classifies only the first real user message. Once the session
has made a durable tool call, it restores the complete Standard tool catalog
and stops routing scans. Older sessions without user-source metadata retain a
compatible first-message fallback.

Desktop and Web also include the guarded `routing-injector-host`, which owns the
Loader, restore, and approval boundary. Only the Routing mode mounts the
model-facing injector tools. TUI includes Router Standard but deliberately does
not load those tools. Injector commands that change local packages, loader
state, or profile configuration require DSH approval; a rejected request,
cancellation, or an unavailable approval path does not make a change. Status
commands are read-only.

Approved injections are recorded only under the active `OH_DSH_HOME`. On a
later start, an entry is restored only when its canonical package path and
build fingerprint still match. The injector performs no background watching
or automatic reload; an explicit reload needs approval again.

## Plugin marketplace

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

Troubleshooting order:

1. Run `ohdsh --help` to confirm the CLI source.
2. Run `ohdsh web --help` to inspect options.
3. Run `ohdsh tui --help`, then use `ohdsh tui --inline` to isolate
   alternate-screen terminal compatibility.
4. Test a random port with `ohdsh web --port 0 --no-open`.
5. Confirm that required plugins are both installed and enabled in the Profile.
6. If Desktop does not start, run its bundled `bin/ohdsh desktop` in a terminal
   to capture logs.

See [design and plugin boundaries](./design.en.md) for architecture and
upstream relationships.
