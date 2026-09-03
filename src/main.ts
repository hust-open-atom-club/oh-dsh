import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  screen,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type NativeImage,
} from 'electron'
import { autoUpdater } from 'electron-updater'
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, type WriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginMarketplaceManager } from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'
import { updateCheckEnabled } from './self-update.ts'
import {
  MARKETPLACE_AGENT_TOKEN_ENV,
  MARKETPLACE_AGENT_URL_ENV,
  startMarketplaceAgentGateway,
  type MarketplaceAgentGateway,
} from '../plugins/plugin-marketplace/src/host/agent-gateway.ts'
import {
  findGitHubCli,
  previewRuntimeLauncher,
  ProductionMarketplacePlatform,
  withGitHubCredentials,
} from '../plugins/plugin-marketplace/src/host/platform.ts'
import { parseMarketplaceCommand } from '../plugins/plugin-marketplace/src/protocol.ts'
import {
  type DesktopCommand,
  type DesktopInfo,
  type DesktopRuntimeSnapshot,
  type DesktopUpdateCommand,
  type DesktopWindowState,
  type DesktopUpdateState,
  type AboutUpdateCommand,
  type AboutUpdateSnapshot,
} from './contracts.ts'
import type { OhDshLocale } from '../plugins/shared/i18n.ts'
import {
  desktopElectronDataRoot,
  migrateLegacyDesktopState,
  resolveOhDshHome,
} from './data-root.ts'
import { retireStaleMacBundles } from './mac-bundle-migration.ts'
import { allowsRuntimeClipboardWrite, originOf } from './permissions.ts'
import { BUNDLED_DESKTOP_PLUGINS, DESKTOP_PROFILE, ensureDesktopProfile } from './profile.ts'
import { tryAcquireRuntimeLock, type RuntimeLock } from './runtime-lock.ts'
import { DshRuntimeSupervisor, runDshCommand, type DshRuntimeOptions, type RuntimeExit } from './runtime.ts'
import {
  bundledRuntimePaths,
  resolveRuntimeResourcesRoot,
  runtimeSearchPath,
  type BundledRuntimePaths,
} from './runtime-paths.ts'
import { resolveProductVersion } from './version.ts'
import { resolveLandlockLauncher } from './landlock-launcher.ts'
import {
  RuntimeUpdateManager,
  resolveStagedRuntimeRoot,
  type RuntimeUpdateCommand,
  type RuntimeUpdateState,
} from './runtime-update.ts'
import { DesktopUpdateManager, detectPackageType } from './update-manager.ts'
import { scheduleImmediateUpdateInstall, singleFlight } from './update-lifecycle.ts'

const PRODUCT_NAME = 'Oh-DSH Desktop'
const DEFAULT_UI_ZOOM_FACTOR = 1.12
const currentDir = dirname(fileURLToPath(import.meta.url))
const PRODUCT_VERSION = resolveProductVersion(join(currentDir, '..'))
const splashPath = join(currentDir, 'splash.html')
const preloadPath = join(currentDir, 'preload.cjs')
const updateHtmlPath = join(currentDir, 'update.html')
const updatePreloadPath = join(currentDir, 'update-preload.cjs')

let mainWindow: BrowserWindow | undefined
let runtime: DshRuntimeSupervisor | undefined
let runtimeUrl: URL | undefined
let runtimeOrigin: string | undefined
let runtimeLock: RuntimeLock | undefined
let desktopReadOnly = false
let previewRuntime: DshRuntimeSupervisor | undefined
let previewWindow: BrowserWindow | undefined
let previewUrl: URL | undefined
let previewOrigin: string | undefined
let previewIdentity: { pluginId: string; transactionId: string } | undefined
let marketplace: PluginMarketplaceManager | undefined
let marketplaceAgentGateway: MarketplaceAgentGateway | undefined
let logStream: WriteStream | undefined
let updateWindow: BrowserWindow | undefined
let updateManager: DesktopUpdateManager | undefined
let runtimeUpdateManager: RuntimeUpdateManager | undefined
let tray: Tray | undefined
let trayHideNoticeShown = false
let quittingForUpdate = false
let quitting = false
let transitioning = false
let queuedPaths: string[] = []
const logTail: string[] = []

function appendLog(stream: 'desktop' | 'stderr' | 'stdout', line: string): void {
  const rendered = `${new Date().toISOString()} [${stream}] ${line}`
  logStream?.write(rendered + '\n')
  logTail.push(rendered)
  if (logTail.length > 200) logTail.splice(0, logTail.length - 200)
}

function resourcesRoot(): string {
  return resolveRuntimeResourcesRoot(
    process.resourcesPath,
    join(currentDir, '..', '.stage'),
    app.isPackaged,
  )
}

function runningMacBundlePath(): string | undefined {
  if (process.platform !== 'darwin' || !app.isPackaged) return undefined
  // process.execPath is <bundle>/Contents/MacOS/<executable>.
  const bundlePath = resolve(dirname(process.execPath), '..', '..')
  // Only migrate when launched from the standard install location; a launch
  // straight from the mounted DMG must never touch /Applications.
  return bundlePath.startsWith('/Applications/') ? bundlePath : undefined
}

async function retireDuplicateMacBundles(): Promise<void> {
  const runningBundlePath = runningMacBundlePath()
  if (runningBundlePath === undefined) return
  try {
    const result = await retireStaleMacBundles({
      runningBundlePath,
      runningVersion: PRODUCT_VERSION,
    })
    for (const retired of result.retired) {
      appendLog(
        'desktop',
        `retired stale macOS bundle ${retired.path} (v${retired.version}) → ${retired.trashPath}`,
      )
    }
    for (const failure of result.failures) {
      appendLog('desktop', `could not retire stale macOS bundle: ${failure}`)
    }
  } catch (error) {
    appendLog('desktop', `macOS bundle retirement skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const ohDshRuntimeContract: number = JSON.parse(
  readFileSync(join(currentDir, '..', 'package.json'), 'utf8'),
).ohDshRuntimeContract

function runtimePaths(): BundledRuntimePaths {
  // An explicitly overridden resources root wins; otherwise a validated
  // staged runtime from an in-app DSH update takes precedence over the
  // runtime bundled with this application build.
  const explicitRoot = process.env.OH_DSH_RESOURCES_ROOT ?? process.env.DSH_OH_WEB_ROOT
  const staged = explicitRoot === undefined || explicitRoot === ''
    ? resolveStagedRuntimeRoot(resolveOhDshHome(process.env), { runtimeContract: ohDshRuntimeContract })
    : null
  return bundledRuntimePaths(resourcesRoot(), process.platform, staged ?? undefined)
}

function dshRuntimeVersionOf(runtimeRoot: string): string {
  try {
    const manifest = JSON.parse(readFileSync(join(runtimeRoot, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function desktopInfo(preview: DesktopInfo['preview'] = null): DesktopInfo {
  const appDataPath = resolveOhDshHome(process.env)
  return {
    appDataPath,
    dshHome: appDataPath,
    platform: process.platform,
    preview,
    profile: DESKTOP_PROFILE,
    version: PRODUCT_VERSION,
  }
}

function desktopRuntimeSnapshot(): DesktopRuntimeSnapshot {
  return {
    bundledPlugins: [...BUNDLED_DESKTOP_PLUGINS],
    logTail: logTail.slice(-100),
    profile: DESKTOP_PROFILE,
    runtimeUrl: runtimeUrl?.href ?? null,
    status: transitioning ? 'restarting' : runtimeUrl === undefined ? 'stopped' : 'ready',
  }
}

function runtimeEnvironment(
  paths: ReturnType<typeof runtimePaths>,
  overrides: { appDataPath?: string; dshHome?: string; preview?: { pluginId: string; transactionId: string } } = {},
): NodeJS.ProcessEnv {
  const info = desktopInfo(overrides.preview ?? null)
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_DESKTOP: '1',
    DSH_DESKTOP_APP_DATA: overrides.appDataPath ?? info.appDataPath,
    DSH_DESKTOP_PROFILE: info.profile,
    DSH_DESKTOP_VERSION: info.version,
    DSH_HOME: overrides.dshHome ?? info.dshHome,
    OH_DSH_HOME: overrides.dshHome ?? info.dshHome,
    OH_DSH_READ_ONLY: desktopReadOnly ? '1' : '0',
    NODE_USE_ENV_PROXY: '1',
    PATH: runtimeSearchPath(paths),
  }
  if (overrides.preview !== undefined) {
    environment.DSH_DESKTOP_PREVIEW = '1'
    environment.DSH_DESKTOP_PREVIEW_PLUGIN = overrides.preview.pluginId
    environment.DSH_DESKTOP_PREVIEW_TRANSACTION = overrides.preview.transactionId
  } else if (marketplaceAgentGateway !== undefined) {
    environment[MARKETPLACE_AGENT_URL_ENV] = marketplaceAgentGateway.url
    environment[MARKETPLACE_AGENT_TOKEN_ENV] = marketplaceAgentGateway.token
  }
  return withGitHubCredentials(environment, findGitHubCli(environment))
}

function runtimeOptions(): DshRuntimeOptions {
  const paths = runtimePaths()
  const workspaceRoot = join(homedir(), 'DSH Workspaces')
  mkdirSync(workspaceRoot, { recursive: true })
  if (!existsSync(paths.nodeBinary)) {
    throw new Error(`packaged Node runtime is missing: ${paths.nodeBinary}`)
  }
  if (!existsSync(paths.cliEntry)) {
    throw new Error(`packaged DSH CLI is missing: ${paths.cliEntry}`)
  }
  return {
    args: ['--profile', DESKTOP_PROFILE],
    cliEntry: paths.cliEntry,
    cwd: workspaceRoot,
    env: runtimeEnvironment(paths),
    nodeBinary: paths.nodeBinary,
    onLog: (stream, line) => { appendLog(stream, line) },
    readyTimeoutMs: 60_000,
  }
}

function previewRuntimeOptions(input: {
  dshHome: string
  pluginId: string
  sandboxRoot: string
  sandboxed: boolean
  transactionId: string
}): DshRuntimeOptions {
  const paths = runtimePaths()
  const workspaceRoot = join(input.sandboxRoot, 'workspace')
  const temporary = join(input.sandboxRoot, '.tmp')
  mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 })
  mkdirSync(temporary, { recursive: true, mode: 0o700 })
  if (!existsSync(paths.nodeBinary)) throw new Error(`packaged Node runtime is missing: ${paths.nodeBinary}`)
  if (!existsSync(paths.cliEntry)) throw new Error(`packaged DSH CLI is missing: ${paths.cliEntry}`)
  const preview = { pluginId: input.pluginId, transactionId: input.transactionId }
  const launcher = input.sandboxed
    ? previewRuntimeLauncher({
      root: input.sandboxRoot,
      sandbox: resolveLandlockLauncher(paths.runtimeRoot),
    })
    : undefined
  return {
    args: ['--profile', DESKTOP_PROFILE],
    cliEntry: paths.cliEntry,
    cwd: workspaceRoot,
    env: {
      ...runtimeEnvironment(paths, {
        appDataPath: input.sandboxRoot,
        dshHome: input.dshHome,
        preview,
      }),
      TMPDIR: temporary,
    },
    ...(launcher === undefined ? {} : { launcher }),
    nodeBinary: paths.nodeBinary,
    onLog: (stream, line) => { appendLog(stream, `[preview:${input.pluginId}] ${line}`) },
    readyTimeoutMs: 90_000,
  }
}

function isAllowedRuntimeNavigation(target: string, allowedOrigin: string | undefined): boolean {
  if (target.startsWith('file:')) return true
  if (allowedOrigin === undefined) return false
  try {
    return new URL(target).origin === allowedOrigin
  } catch {
    return false
  }
}

function isAllowedBrowserNavigation(target: string): boolean {
  if (target === 'about:blank') return true
  try {
    const url = new URL(target)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    return url.origin !== runtimeOrigin && url.origin !== previewOrigin
  } catch {
    return false
  }
}

function windowIconPath(): string | undefined {
  // Packaged builds carry the icon beside resources/; dev falls back to the
  // rendered set so the window shows the app icon instead of Electron's.
  const packaged = join(process.resourcesPath, 'oh-dsh-desktop.png')
  if (existsSync(packaged)) return packaged
  const development = join(currentDir, '..', 'assets', 'icons', '512x512.png')
  return existsSync(development) ? development : undefined
}

function brandIconDataUrl(): string | null {
  const packaged = join(process.resourcesPath, 'dsh-whale.png')
  const development = join(currentDir, '..', 'assets', 'dsh-whale.png')
  const path = existsSync(packaged) ? packaged : development
  if (!existsSync(path)) return null
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`
}

function trayIconImage(): NativeImage | undefined {
  // Packaged builds carry only the 512px window icon beside resources/;
  // development has the rendered 16px set. The tray needs a small bitmap
  // sized for the primary display, or Windows scales it blurry.
  const packaged = join(process.resourcesPath, 'oh-dsh-desktop.png')
  const development = join(currentDir, '..', 'assets', 'icons', '16x16.png')
  const path = existsSync(packaged) ? packaged : existsSync(development) ? development : undefined
  if (path === undefined) return undefined
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) return undefined
  const size = Math.max(16, Math.round(16 * screen.getPrimaryDisplay().scaleFactor))
  const resized = image.resize({ height: size, width: size })
  return resized.isEmpty() ? undefined : resized
}

function createWindow(options: { preview?: boolean; title?: string } = {}): BrowserWindow {
  const icon = windowIconPath()
  const window = new BrowserWindow({
    width: options.preview === true ? 1160 : 1280,
    height: options.preview === true ? 760 : 840,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: options.title ?? PRODUCT_NAME,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 } }
      : process.platform === 'win32'
        ? { autoHideMenuBar: true, frame: false }
        : {}),
    ...(icon === undefined ? {} : { icon }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f7f7f5',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webviewTag: true,
    },
  })
  window.webContents.setZoomFactor(DEFAULT_UI_ZOOM_FACTOR)
  window.once('ready-to-show', () => { window.show() })
  const sendWindowState = (): void => {
    window.webContents.send('desktop:window-state', { maximized: window.isMaximized() } satisfies DesktopWindowState)
  }
  window.on('maximize', sendWindowState)
  window.on('unmaximize', sendWindowState)
  window.on('close', (event) => {
    // With a tray alive, closing the main window hides it instead of
    // quitting; preview windows and an already-running quit pass through.
    // The tray only exists on win32, so macOS and Linux close unchanged.
    if (options.preview === true || tray === undefined || quitting || quittingForUpdate) return
    event.preventDefault()
    window.hide()
    if (!trayHideNoticeShown) {
      trayHideNoticeShown = true
      tray.displayBalloon({ iconType: 'info', title: PRODUCT_NAME, content: labels(menuLocale).trayNotice })
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
    if (previewWindow === window) {
      previewWindow = undefined
      previewUrl = undefined
      previewOrigin = undefined
      previewIdentity = undefined
      const supervisor = previewRuntime
      previewRuntime = undefined
      void supervisor?.stop().catch((error: unknown) => {
        appendLog('desktop', `failed to stop closed preview runtime: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isAllowedBrowserNavigation(params.src ?? 'about:blank')) {
      event.preventDefault()
      return
    }
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
  })
  window.webContents.on('did-attach-webview', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (isAllowedBrowserNavigation(url)) return
      event.preventDefault()
    })
  })
  window.webContents.on('will-navigate', (event, url) => {
    const allowedOrigin = options.preview === true ? previewOrigin : runtimeOrigin
    if (isAllowedRuntimeNavigation(url, allowedOrigin)) return
    event.preventDefault()
    if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url)
  })
  return window
}

async function showSplash(options: { detail?: string; error?: boolean; message?: string } = {}): Promise<void> {
  if (mainWindow === undefined || mainWindow.isDestroyed()) mainWindow = createWindow()
  const query: Record<string, string> = {}
  if (options.error === true) query.state = 'error'
  if (options.message !== undefined) query.message = options.message
  if (options.detail !== undefined) query.detail = options.detail.slice(0, 4_000)
  await mainWindow.loadFile(splashPath, { query })
}

function sendCommand(command: DesktopCommand): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('desktop:command', command)
}

function sendUpdateState(state: DesktopUpdateState): void {
  if (updateWindow === undefined || updateWindow.isDestroyed()) return
  updateWindow.webContents.send('desktop:update:state', state)
}

/** Mirror a narrow projection of update state changes to the main window. */
function sendAboutUpdateState(state: DesktopUpdateState): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('desktop:about-update:state', aboutUpdateSnapshot(state))
}

let updaterProxyBypassed = false

function updaterSession() {
  return session.fromPartition('electron-updater', { cache: false })
}

async function syncUpdaterProxy(): Promise<void> {
  // Once the configured proxy proved unreachable, keep the updater direct:
  // re-copying the OS proxy rules would reintroduce the broken proxy.
  if (updaterProxyBypassed) {
    await updaterSession().setProxy({ mode: 'direct' })
    return
  }
  const proxyRules = await session.defaultSession.resolveProxy('https://github.com')
  await updaterSession().setProxy({ proxyRules })
}

async function bypassUpdaterProxy(): Promise<void> {
  updaterProxyBypassed = true
  const target = updaterSession()
  await target.setProxy({ mode: 'direct' })
  // Sockets pooled through the dead proxy survive the proxy change and would
  // keep failing; close them so the retry goes direct.
  await target.closeAllConnections()
}

async function getUpdateManager(): Promise<DesktopUpdateManager> {
  if (updateManager !== undefined) return updateManager
  const packageType = app.isPackaged
    ? await detectPackageType(process.resourcesPath)
    : 'unsupported'
  const manager = new DesktopUpdateManager({
    currentVersion: app.getVersion(),
    appIsPackaged: app.isPackaged,
    packageType,
    ...(app.isPackaged ? { updater: autoUpdater } : {}),
    syncProxy: syncUpdaterProxy,
    bypassProxy: bypassUpdaterProxy,
    onOpenRelease: async url => { await shell.openExternal(url) },
    onOpenInstaller: async path => {
      const error = await shell.openPath(path)
      if (error !== '') throw new Error(error)
    },
    onLog: message => { appendLog('desktop', message) },
  })
  updateManager = manager
  manager.subscribe(sendUpdateState)
  manager.subscribe(sendAboutUpdateState)
  manager.subscribe(notifyAvailableUpdate)
  return manager
}

let startupUpdateNotified = false

/** Announce an available update once per session after the startup check. */
function notifyAvailableUpdate(state: DesktopUpdateState): void {
  if (state.status !== 'available' || startupUpdateNotified) return
  startupUpdateNotified = true
  appendLog('desktop', `update available: ${state.latestVersion}`)
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: 'Oh-DSH update available',
    body: `Version ${state.latestVersion} is available. Click to review and install.`,
  })
  notification.on('click', () => { void openUpdateWindow() })
  notification.show()
}

/** Check once per launch, without downloading anything. */
function scheduleStartupUpdateCheck(): void {
  if (updateManager === undefined) return
  if (!app.isPackaged || !updateCheckEnabled(process.env)) return
  updateManager.check().catch(() => {
    // A failed startup check only means no notice this session.
  })
}

function sendRuntimeUpdateState(state: RuntimeUpdateState): void {
  if (updateWindow === undefined || updateWindow.isDestroyed()) return
  updateWindow.webContents.send('desktop:runtime-update:state', state)
}

function getRuntimeUpdateManager(): RuntimeUpdateManager {
  if (runtimeUpdateManager !== undefined) return runtimeUpdateManager
  const paths = bundledRuntimePaths(resourcesRoot())
  const dataRoot = resolveOhDshHome(process.env)
  const manager = new RuntimeUpdateManager({
    // Chromium's network stack honors the OS-configured proxy, matching
    // the application updater's proxy behavior.
    fetchImpl: (input, init) => net.fetch(String(input), init),
    runtimeContract: ohDshRuntimeContract,
    bundledVersion: dshRuntimeVersionOf(paths.runtimeRoot),
    currentVersion: dshRuntimeVersionOf(
      resolveStagedRuntimeRoot(dataRoot, { runtimeContract: ohDshRuntimeContract }) ?? paths.runtimeRoot,
    ),
    dataRoot,
    nodeBinary: paths.nodeBinary,
    onLog: message => { appendLog('desktop', `[runtime-update] ${message}`) },
    onState: sendRuntimeUpdateState,
    onRuntimeChanged: () => { void restartRuntime('正在切换 DSH 运行时…') },
  })
  runtimeUpdateManager = manager
  manager.command({ type: 'check' }).catch((error: unknown) => {
    appendLog('desktop', `[runtime-update] initial check failed: ${error instanceof Error ? error.message : String(error)}`)
  })
  return manager
}

function parseRuntimeUpdateCommand(raw: unknown): RuntimeUpdateCommand {
  if (typeof raw !== 'object' || raw === null || !('type' in raw) || typeof raw.type !== 'string') {
    throw new Error('invalid runtime update command')
  }
  const type = raw.type
  if (type !== 'check' && type !== 'install' && type !== 'rollback') {
    throw new Error(`unsupported runtime update command: ${type}`)
  }
  return { type } as RuntimeUpdateCommand
}

function assertUpdateWindowSender(event: { sender: Electron.WebContents }): void {
  if (updateWindow === undefined || updateWindow.isDestroyed() || event.sender !== updateWindow.webContents) {
    throw new Error('update IPC is only available to the local update window')
  }
}

/** Project the full update state down to the About page's inline flow. */
function aboutUpdateSnapshot(state: DesktopUpdateState): AboutUpdateSnapshot {
  switch (state.status) {
    case 'idle': return { status: 'idle', currentVersion: state.currentVersion }
    case 'checking': return { status: 'checking' }
    case 'not-available': return { status: 'not-available', latestVersion: state.checkedVersion }
    case 'available': return { status: 'available', latestVersion: state.latestVersion }
    case 'downloading': return {
      status: 'downloading',
      percent: state.percent,
      transferred: state.transferred,
      total: state.total,
      bytesPerSecond: state.bytesPerSecond,
    }
    case 'downloaded': return { status: 'downloaded', latestVersion: state.latestVersion }
    case 'scheduled': return { status: 'downloaded', latestVersion: state.latestVersion }
    case 'cancelled': return { status: 'idle', currentVersion: state.currentVersion }
    case 'unsupported': return { status: 'unsupported' }
    case 'error': return state.retryable === true && state.stage === 'check'
      ? { status: 'error' }
      : { status: 'idle', currentVersion: state.currentVersion }
  }
}

/** Parse an About-page update command. Only the inline flow's commands. */
function parseAboutUpdateCommand(raw: unknown): AboutUpdateCommand {
  if (typeof raw !== 'string' || !(['check', 'download', 'install-now'] as const).includes(raw as AboutUpdateCommand)) {
    throw new Error('invalid about-update command')
  }
  return raw as AboutUpdateCommand
}

function parseUpdateCommand(raw: unknown): DesktopUpdateCommand {
  if (typeof raw !== 'object' || raw === null || !('type' in raw) || typeof raw.type !== 'string') {
    throw new Error('invalid update command')
  }
  const type = raw.type
  if (!['check', 'download', 'cancel', 'retry', 'install-now', 'install-on-quit', 'open-release'].includes(type)) {
    throw new Error(`unsupported update command: ${type}`)
  }
  return { type } as DesktopUpdateCommand
}

async function openUpdateWindow(): Promise<void> {
  const manager = await getUpdateManager()
  if (updateWindow !== undefined && !updateWindow.isDestroyed()) {
    updateWindow.show()
    updateWindow.focus()
    void manager.check()
    return
  }
  const window = new BrowserWindow({
    width: 720,
    height: 620,
    minWidth: 560,
    minHeight: 480,
    ...(mainWindow !== undefined && !mainWindow.isDestroyed() ? { parent: mainWindow } : {}),
    modal: false,
    // Keep this child window out of macOS fullscreen spaces: closing it while the
    // parent is fullscreen can trigger an AppKit crash (#119).
    fullscreenable: false,
    show: false,
    title: 'Software updates',
    webPreferences: {
      preload: updatePreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  updateWindow = window
  window.setMenuBarVisibility(false)
  window.once('ready-to-show', () => { window.show() })
  window.on('closed', () => {
    if (updateWindow === window) updateWindow = undefined
  })
  window.webContents.on('will-navigate', event => { event.preventDefault() })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  await window.loadFile(updateHtmlPath)
  void manager.check()
  sendRuntimeUpdateState(getRuntimeUpdateManager().getState())
}

const stopForApplicationQuit = singleFlight(async (): Promise<void> => {
  await Promise.allSettled([
    runtime?.stop() ?? Promise.resolve(),
    stopPreviewSurface(),
    marketplaceAgentGateway?.close() ?? Promise.resolve(),
  ]).then(results => {
    for (const result of results) {
      if (result.status === 'rejected') {
        appendLog('desktop', result.reason instanceof Error ? result.reason.message : String(result.reason))
      }
    }
  })
  runtime = undefined
  runtimeUrl = undefined
  runtimeOrigin = undefined
  marketplaceAgentGateway = undefined
  if (updateWindow !== undefined && !updateWindow.isDestroyed()) updateWindow.close()
})

function normalizeWorkspacePaths(paths: readonly string[]): string[] {
  const normalized: string[] = []
  for (const candidate of paths) {
    if (!existsSync(candidate)) continue
    const absolute = resolve(candidate)
    const target = statSync(absolute).isDirectory() ? absolute : dirname(absolute)
    if (!normalized.includes(target)) normalized.push(target)
  }
  return normalized
}

function flushQueuedPaths(): void {
  const paths = normalizeWorkspacePaths(queuedPaths)
  queuedPaths = []
  if (paths.length > 0) sendCommand({ type: 'open-paths', paths })
}

function handleRuntimeExit(exit: RuntimeExit): void {
  appendLog('desktop', `DSH runtime exited: code=${String(exit.code)} signal=${String(exit.signal)}`)
  runtimeUrl = undefined
  runtimeOrigin = undefined
  if (quitting || transitioning) return
  void showSplash({
    error: true,
    message: 'DeepSeek Harness 已停止。可从“DSH”菜单重新启动。',
    detail: logTail.slice(-12).join('\n'),
  })
}

async function startRuntime(): Promise<void> {
  const info = desktopInfo()
  if (desktopReadOnly === false || !existsSync(join(info.dshHome, 'profiles', DESKTOP_PROFILE))) {
    ensureDesktopProfile(info.dshHome)
  }
  const supervisor = new DshRuntimeSupervisor(runtimeOptions())
  runtime = supervisor
  supervisor.on('exit', handleRuntimeExit)
  supervisor.on('spawn', (pid: number) => { runtimeLock?.setChildPids([pid]) })
  const url = await supervisor.start()
  const childPid = supervisor.pid
  if (childPid !== undefined) runtimeLock?.setChildPids([childPid])
  runtimeUrl = url
  runtimeOrigin = url.origin
  if (mainWindow === undefined || mainWindow.isDestroyed()) mainWindow = createWindow()
  await mainWindow.loadURL(url.href)
  flushQueuedPaths()
}

async function stopPreviewSurface(): Promise<void> {
  const window = previewWindow
  const supervisor = previewRuntime
  previewWindow = undefined
  previewRuntime = undefined
  previewUrl = undefined
  previewOrigin = undefined
  previewIdentity = undefined
  if (window !== undefined && !window.isDestroyed()) window.destroy()
  await supervisor?.stop()
}

async function startPreviewSurface(input: {
  dshHome: string
  pluginId: string
  sandboxRoot: string
  sandboxed: boolean
  transactionId: string
}): Promise<{ url?: string }> {
  await stopPreviewSurface()
  const identity = { pluginId: input.pluginId, transactionId: input.transactionId }
  const supervisor = new DshRuntimeSupervisor(previewRuntimeOptions(input))
  previewRuntime = supervisor
  previewIdentity = identity
  supervisor.on('exit', (exit: RuntimeExit) => {
    if (previewRuntime !== supervisor) return
    appendLog('desktop', `preview runtime exited: code=${String(exit.code)} signal=${String(exit.signal)}`)
    const window = previewWindow
    previewRuntime = undefined
    previewWindow = undefined
    previewUrl = undefined
    previewOrigin = undefined
    previewIdentity = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  })
  try {
    const url = await supervisor.start()
    if (previewRuntime !== supervisor) throw new Error('plugin preview was stopped before it became ready')
    previewUrl = url
    previewOrigin = url.origin
    const window = createWindow({
      preview: true,
      title: `Preview ${input.pluginId} — ${PRODUCT_NAME}`,
    })
    previewWindow = window
    await window.loadURL(url.href)
    return {}
  } catch (error) {
    await stopPreviewSurface().catch(() => {})
    throw error
  }
}

async function stopLiveForMarketplace(): Promise<void> {
  transitioning = true
  await showSplash({ message: '正在应用插件 Profile…' })
  await runtime?.stop()
  runtime = undefined
  runtimeUrl = undefined
  runtimeOrigin = undefined
}

async function startLiveForMarketplace(): Promise<void> {
  try {
    await startRuntime()
  } finally {
    transitioning = false
  }
}

let queuedRuntimeRestart = false

async function restartRuntime(message = '正在重新启动 DeepSeek Harness…'): Promise<void> {
  if (transitioning) {
    // A runtime update may land while a marketplace apply or another
    // restart owns the transition; queue this one instead of dropping
    // it — the pointer already switched the active runtime.
    queuedRuntimeRestart = true
    return
  }
  transitioning = true
  try {
    await showSplash({ message })
    await runtime?.stop()
    runtime = undefined
    runtimeUrl = undefined
    runtimeOrigin = undefined
    await startRuntime()
  } catch (error) {
    appendLog('desktop', error instanceof Error ? error.stack ?? error.message : String(error))
    await showSplash({
      error: true,
      message: 'Oh-DSH Desktop 启动失败。',
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    transitioning = false
    if (queuedRuntimeRestart) {
      queuedRuntimeRestart = false
      void restartRuntime(message)
    }
  }
}

async function selectWorkspacePaths(): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    title: '打开 DSH 工作区',
    properties: ['openDirectory', 'createDirectory'],
  }
  const parent = mainWindow
  const result = parent === undefined || parent.isDestroyed()
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(parent, options)
  return result.canceled ? [] : normalizeWorkspacePaths(result.filePaths)
}

async function chooseWorkspace(): Promise<void> {
  const paths = await selectWorkspacePaths()
  if (paths.length > 0) sendCommand({ type: 'open-paths', paths })
}

async function installLocalPlugin(): Promise<void> {
  const options: Electron.OpenDialogOptions = {
    title: '选择 DSH 插件目录',
    buttonLabel: '安装插件',
    properties: ['openDirectory'],
  }
  const parent = mainWindow
  const choice = parent === undefined || parent.isDestroyed()
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(parent, options)
  const pluginPath = choice.filePaths[0]
  if (choice.canceled || pluginPath === undefined) return
  transitioning = true
  try {
    await showSplash({ message: '正在安装 DSH 插件…' })
    await runtime?.stop()
    runtime = undefined
    const options = runtimeOptions()
    await runDshCommand(options, ['plugin', '--profile', DESKTOP_PROFILE, 'add', pluginPath])
    await startRuntime()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    appendLog('desktop', detail)
    await showSplash({ error: true, message: '插件安装失败。', detail })
    const errorOptions: Electron.MessageBoxOptions = { type: 'error', message: '插件安装失败', detail }
    const errorParent = mainWindow
    if (errorParent === undefined || errorParent.isDestroyed()) await dialog.showMessageBox(errorOptions)
    else await dialog.showMessageBox(errorParent, errorOptions)
  } finally {
    transitioning = false
  }
}

function createPluginMarketplace(): PluginMarketplaceManager {
  const info = desktopInfo()
  if (!desktopReadOnly) ensureDesktopProfile(info.dshHome)
  const paths = runtimePaths()
  const workingDirectory = join(info.appDataPath, 'plugin-marketplace')
  if (!desktopReadOnly) mkdirSync(workingDirectory, { recursive: true, mode: 0o700 })
  const environment = runtimeEnvironment(paths)
  return new PluginMarketplaceManager({
    appDataPath: info.appDataPath,
    dshHome: info.dshHome,
    ...(desktopReadOnly ? { readOnly: true } : {}),
    onWarn: line => { appendLog('desktop', `[marketplace] ${line}`) },
    platform: new ProductionMarketplacePlatform({
      appDataPath: info.appDataPath,
      cliEntry: paths.cliEntry,
      ...(desktopReadOnly ? { cacheReadOnly: true } : { cwd: workingDirectory }),
      env: environment,
      nodeBinary: paths.nodeBinary,
      pnpmEntry: paths.pnpmEntry,
      sandboxLauncher: resolveLandlockLauncher(paths.runtimeRoot),
      onLog: line => { appendLog('desktop', `[marketplace] ${line}`) },
    }),
    profile: DESKTOP_PROFILE,
    runtime: {
      startLive: startLiveForMarketplace,
      startPreview: startPreviewSurface,
      stopLive: stopLiveForMarketplace,
      stopPreview: stopPreviewSurface,
    },
  })
}

function systemLocale(): OhDshLocale {
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

let menuLocale: OhDshLocale = 'en'

function labels(locale: OhDshLocale) {
  const zh = locale === 'zh'
  return zh ? {
    about: '关于 Oh-DSH Desktop',
    checkUpdates: '检查更新…',
    close: '关闭窗口',
    copy: '复制',
    copyDiagnostics: '复制诊断信息',
    dsh: 'DSH',
    edit: '编辑',
    file: '文件',
    focus: '聚焦输入框',
    forceReload: '强制重新加载',
    installPlugin: '从文件夹安装插件…',
    maximize: '最大化',
    minimize: '最小化',
    newChat: '新建会话',
    openData: '打开 DSH 数据目录',
    openLogs: '打开日志目录',
    openPluginProfile: '打开插件配置目录',
    openWorkspace: '打开工作区…',
    restart: '重新启动 DSH Runtime',
    redo: '重做',
    reload: '重新加载',
    resetZoom: '重置缩放',
    settings: '设置…',
    selectAll: '全选',
    show: '显示主窗口',
    trayNotice: 'Oh-DSH 仍在系统托盘中运行，点击托盘图标可恢复窗口。要退出请使用托盘菜单中的“退出 Oh-DSH Desktop”。',
    toggleBottomPanel: '切换底部面板',
    toggleDevTools: '切换开发者工具',
    toggleFullscreen: '切换全屏',
    togglePanelMaximized: '展开或还原工具侧栏',
    togglePinnedSummary: '切换置顶摘要',
    toggleSidePanel: '切换工具侧栏',
    toggleWorkspacePanel: '切换工作区面板',
    toggleSidebar: '切换侧栏',
    undo: '撤销',
    view: '视图',
    window: '窗口',
    zoomIn: '放大',
    zoomOut: '缩小',
    paste: '粘贴',
    pasteAndMatchStyle: '粘贴并匹配样式',
    cut: '剪切',
    quit: '退出 Oh-DSH Desktop',
    browser: '浏览器',
    files: '文件',
    review: '审查',
    sideChat: '侧边会话',
    trajectory: '轨迹',
  } : {
    about: 'About Oh-DSH Desktop',
    checkUpdates: 'Check for Updates...',
    close: 'Close Window',
    copy: 'Copy',
    copyDiagnostics: 'Copy Diagnostics',
    dsh: 'DSH',
    edit: 'Edit',
    file: 'File',
    focus: 'Focus Composer',
    forceReload: 'Force Reload',
    installPlugin: 'Install Plugin from Folder…',
    maximize: 'Maximize',
    minimize: 'Minimize',
    newChat: 'New Chat',
    openData: 'Open DSH Data Folder',
    openLogs: 'Open Logs Folder',
    openPluginProfile: 'Open Plugin Profile Folder',
    openWorkspace: 'Open Workspace…',
    restart: 'Restart DSH Runtime',
    redo: 'Redo',
    reload: 'Reload',
    resetZoom: 'Reset Zoom',
    settings: 'Settings…',
    selectAll: 'Select All',
    show: 'Show Main Window',
    trayNotice: 'Oh-DSH keeps running in the system tray. Click the tray icon to restore the window; use Quit in the tray menu to exit.',
    toggleBottomPanel: 'Toggle Bottom Panel',
    toggleDevTools: 'Toggle Developer Tools',
    toggleFullscreen: 'Toggle Full Screen',
    togglePanelMaximized: 'Expand or Restore Side Panel',
    togglePinnedSummary: 'Toggle Pinned Summary',
    toggleSidePanel: 'Toggle Side Panel',
    toggleWorkspacePanel: 'Toggle Workspace Panel',
    toggleSidebar: 'Toggle Sidebar',
    undo: 'Undo',
    view: 'View',
    window: 'Window',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    paste: 'Paste',
    pasteAndMatchStyle: 'Paste and Match Style',
    cut: 'Cut',
    quit: 'Quit Oh-DSH Desktop',
    browser: 'Browser',
    files: 'Files',
    review: 'Review',
    sideChat: 'Side Chat',
    trajectory: 'Trajectory',
  }
}

function revealMainWindow(): void {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }
  mainWindow = createWindow()
  if (runtimeUrl !== undefined) void mainWindow.loadURL(runtimeUrl.href).then(flushQueuedPaths)
  else void showSplash({ error: true, message: 'DeepSeek Harness 未运行，请从“DSH”菜单重新启动。' })
}

function buildTrayMenu(): Menu {
  const text = labels(menuLocale)
  return Menu.buildFromTemplate([
    { label: text.show, click: () => { revealMainWindow() } },
    { type: 'separator' },
    { label: text.quit, click: () => { app.quit() } },
  ])
}

function createTray(): Tray | undefined {
  // Close-to-tray is a Windows affordance; macOS and Linux keep their dock
  // and close-quits behavior. A missing icon leaves the close behavior
  // exactly as before instead of trapping a window with no tray.
  if (process.platform !== 'win32') return undefined
  const icon = trayIconImage()
  if (icon === undefined) return undefined
  const trayInstance = new Tray(icon)
  trayInstance.setToolTip(PRODUCT_NAME)
  trayInstance.setContextMenu(buildTrayMenu())
  trayInstance.on('click', () => { revealMainWindow() })
  return trayInstance
}

function buildMenu(locale: OhDshLocale = menuLocale): void {
  menuLocale = locale
  const text = labels(locale)
  const info = desktopInfo()
  const profile = desktopReadOnly === false || !existsSync(join(info.dshHome, 'profiles', DESKTOP_PROFILE))
    ? ensureDesktopProfile(info.dshHome)
    : { dshHome: info.dshHome, profileDir: join(info.dshHome, 'profiles', DESKTOP_PROFILE) }
  const template: MenuItemConstructorOptions[] = [
    {
      label: PRODUCT_NAME,
      submenu: [
        { label: text.about, click: () => { sendCommand({ type: 'show-about' }) } },
        { type: 'separator' },
        { label: text.checkUpdates, click: () => { void openUpdateWindow() } },
        { type: 'separator' },
        { label: text.settings, accelerator: 'CmdOrCtrl+,', click: () => { sendCommand({ type: 'show-settings' }) } },
        ...(process.platform === 'darwin'
          ? [
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
          ]
          : []),
        { type: 'separator' },
        { role: 'quit', label: text.quit },
      ],
    },
    {
      label: text.file,
      submenu: [
        { label: text.newChat, accelerator: 'CmdOrCtrl+N', click: () => { sendCommand({ type: 'new-session' }) } },
        { label: text.openWorkspace, accelerator: 'CmdOrCtrl+O', click: () => { void chooseWorkspace() } },
        { type: 'separator' },
        { role: 'close', label: text.close },
      ],
    },
    {
      label: text.edit,
      submenu: [
        { role: 'undo', label: text.undo },
        { role: 'redo', label: text.redo },
        { type: 'separator' },
        { role: 'cut', label: text.cut },
        { role: 'copy', label: text.copy },
        { role: 'paste', label: text.paste },
        { role: 'pasteAndMatchStyle', label: text.pasteAndMatchStyle },
        { type: 'separator' },
        { role: 'selectAll', label: text.selectAll },
      ],
    },
    {
      label: text.view,
      submenu: [
        { label: text.toggleSidebar, accelerator: 'CmdOrCtrl+B', click: () => { sendCommand({ type: 'toggle-sidebar' }) } },
        { label: text.togglePanelMaximized, click: () => { sendCommand({ type: 'toggle-panel-maximized' }) } },
        { label: text.toggleBottomPanel, accelerator: 'CmdOrCtrl+J', click: () => { sendCommand({ type: 'toggle-bottom-panel' }) } },
        { label: text.togglePinnedSummary, click: () => { sendCommand({ type: 'toggle-pinned-summary' }) } },
        { label: text.toggleSidePanel, accelerator: 'Alt+CmdOrCtrl+B', click: () => { sendCommand({ type: 'toggle-side-panel' }) } },
        { type: 'separator' },
        { label: text.review, accelerator: 'Ctrl+Shift+G', click: () => { sendCommand({ type: 'open-review' }) } },
        { label: text.browser, accelerator: 'CmdOrCtrl+T', click: () => { sendCommand({ type: 'open-browser' }) } },
        { label: text.files, accelerator: 'CmdOrCtrl+P', click: () => { sendCommand({ type: 'open-files' }) } },
        { label: text.sideChat, accelerator: 'Alt+CmdOrCtrl+S', click: () => { sendCommand({ type: 'open-side-chat' }) } },
        { label: text.trajectory, click: () => { sendCommand({ type: 'open-trajectory' }) } },
        { label: text.toggleWorkspacePanel, click: () => { sendCommand({ type: 'toggle-workspace-panel' }) } },
        { type: 'separator' },
        { label: text.focus, accelerator: 'CmdOrCtrl+L', click: () => { sendCommand({ type: 'focus-composer' }) } },
        { type: 'separator' },
        { role: 'reload', label: text.reload },
        { role: 'forceReload', label: text.forceReload },
        { role: 'toggleDevTools', label: text.toggleDevTools },
        { type: 'separator' },
        { role: 'resetZoom', label: text.resetZoom },
        { role: 'zoomIn', label: text.zoomIn },
        { role: 'zoomOut', label: text.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: text.toggleFullscreen },
      ],
    },
    {
      label: text.dsh,
      submenu: [
        { label: text.restart, accelerator: 'CmdOrCtrl+Shift+R', click: () => { void restartRuntime() } },
        { type: 'separator' },
        { label: text.installPlugin, click: () => { void installLocalPlugin() } },
        { label: text.openPluginProfile, click: () => { void shell.openPath(profile.profileDir) } },
        { type: 'separator' },
        { label: text.openData, click: () => { void shell.openPath(info.dshHome) } },
        { label: text.openLogs, click: () => { void shell.openPath(join(info.appDataPath, 'logs')) } },
        { type: 'separator' },
        {
          label: text.copyDiagnostics,
          click: () => {
            clipboard.writeText([
              `${PRODUCT_NAME} ${info.version}`,
              `platform=${process.platform} ${process.arch}`,
              `profile=${info.profile}`,
              `runtime=${runtimeUrl?.href ?? 'stopped'}`,
              '',
              ...logTail.slice(-80),
            ].join('\n'))
          },
        },
      ],
    },
    { role: 'windowMenu', label: text.window },
  ]
  applicationMenu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(applicationMenu)
  tray?.setContextMenu(buildTrayMenu())
}

/** The native application menu, popped up by the in-page Windows menu bar. */
let applicationMenu: Menu | undefined

function windowForSender(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  if (mainWindow?.webContents === event.sender) return mainWindow
  if (previewWindow?.webContents === event.sender) return previewWindow
  return undefined
}

function installIpc(): void {
  ipcMain.handle('desktop:choose-workspace', async () => await selectWorkspacePaths())
  ipcMain.handle('desktop:brand-icon', () => brandIconDataUrl())
  ipcMain.handle('desktop:window-close', event => {
    windowForSender(event)?.close()
  })
  ipcMain.handle('desktop:window-minimize', event => {
    windowForSender(event)?.minimize()
  })
  ipcMain.handle('desktop:window-is-maximized', event => {
    return windowForSender(event)?.isMaximized() ?? false
  })
  ipcMain.handle('desktop:window-toggle-maximize', event => {
    const window = windowForSender(event)
    if (window === undefined) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle('desktop:menu-bar-labels', event => {
    if (event.sender !== mainWindow?.webContents) return []
    return applicationMenu?.items.map(item => item.label) ?? []
  })
  ipcMain.handle('desktop:set-menu-locale', (event, raw: unknown) => {
    if (event.sender !== mainWindow?.webContents) return []
    if (raw !== 'en' && raw !== 'zh') throw new Error('desktop menu locale must be en or zh')
    buildMenu(raw)
    return applicationMenu?.items.map(item => item.label) ?? []
  })
  ipcMain.handle('desktop:menu-bar-popup', (event, index: unknown, cssX: unknown, cssY: unknown) => {
    if (event.sender !== mainWindow?.webContents || applicationMenu === undefined) return
    if (typeof index !== 'number' || typeof cssX !== 'number' || typeof cssY !== 'number') {
      throw new Error('menu bar popup arguments must be numbers')
    }
    const submenu = applicationMenu.items[index]?.submenu
    const window = mainWindow
    if (submenu === undefined || window === undefined || window.isDestroyed()) return
    // The client reports CSS pixels; popup()'s x/y are client-relative DIPs on
    // Windows, and the webContents zoom factor is exactly how many DIPs one
    // CSS pixel occupies.
    const scale = window.webContents.getZoomFactor()
    submenu.popup({
      window,
      x: Math.round(cssX * scale),
      y: Math.round(cssY * scale),
    })
  })
  ipcMain.handle('desktop:update:get-state', async event => {
    assertUpdateWindowSender(event)
    return (await getUpdateManager()).getState()
  })
  ipcMain.handle('desktop:update:command', async (event, raw: unknown) => {
    assertUpdateWindowSender(event)
    const command = parseUpdateCommand(raw)
    const manager = await getUpdateManager()
    const current = manager.getState()
    const installNow = command.type === 'install-now'
      && current.status === 'downloaded'
      && current.platform !== 'deb'
    if (installNow) {
      return await scheduleImmediateUpdateInstall(manager, () => {
        quittingForUpdate = true
        app.quit()
      })
    }
    return await manager.command(command)
  })
  ipcMain.handle('desktop:runtime-update:get-state', event => {
    assertUpdateWindowSender(event)
    return getRuntimeUpdateManager().getState()
  })
  ipcMain.handle('desktop:runtime-update:command', async (event, raw: unknown) => {
    assertUpdateWindowSender(event)
    const command = parseRuntimeUpdateCommand(raw)
    // While another surface owns the runtime lock this Desktop is a
    // read-only viewer: only checks are allowed, never pointer mutations.
    if (desktopReadOnly && command.type !== 'check') {
      throw new Error('runtime updates are unavailable while another surface owns the runtime lock')
    }
    return await getRuntimeUpdateManager().command(command)
  })
  ipcMain.handle('desktop:get-info', event => {
    const preview = previewWindow?.webContents.id === event.sender.id ? previewIdentity ?? null : null
    return desktopInfo(preview)
  })
  ipcMain.handle('desktop:get-runtime-snapshot', () => desktopRuntimeSnapshot())
  // The About settings page drives the inline update flow: check, download
  // with progress, and install. The update window keeps its own full gated
  // channels; About's command set is limited to the three inline steps.
  ipcMain.handle('desktop:open-updater', event => {
    if (event.sender !== mainWindow?.webContents) throw new Error('untrusted updater sender')
    void openUpdateWindow()
  })
  ipcMain.handle('desktop:about-update:get-state', async event => {
    if (event.sender !== mainWindow?.webContents) throw new Error('untrusted about-update sender')
    return aboutUpdateSnapshot((await getUpdateManager()).getState())
  })
  ipcMain.handle('desktop:about-update:check', async event => {
    if (event.sender !== mainWindow?.webContents) throw new Error('untrusted about-update sender')
    return aboutUpdateSnapshot(await (await getUpdateManager()).check())
  })
  ipcMain.handle('desktop:about-update:command', async (event, raw: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('untrusted about-update sender')
    const command = parseAboutUpdateCommand(raw)
    const manager = await getUpdateManager()
    if (command === 'install-now') {
      const current = manager.getState()
      if (current.status !== 'downloaded') throw new Error('no downloaded update to install')
      if (current.platform === 'deb') throw new Error('deb installers finish in the system package manager')
      return aboutUpdateSnapshot(await scheduleImmediateUpdateInstall(manager, () => {
        quittingForUpdate = true
        app.quit()
      }))
    }
    return aboutUpdateSnapshot(await manager.command({ type: command }))
  })
  ipcMain.handle('desktop:plugin-marketplace-snapshot', (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('untrusted marketplace sender')
    if (marketplace === undefined) throw new Error('plugin marketplace is not initialized')
    return marketplace.getSnapshot()
  })
  ipcMain.handle('desktop:plugin-marketplace-dispatch', async (event, raw: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('untrusted marketplace sender')
    if (marketplace === undefined) throw new Error('plugin marketplace is not initialized')
    return await marketplace.dispatch(parseMarketplaceCommand(raw), 'human-ui')
  })
  ipcMain.handle('desktop:open-external', async (_event, raw: unknown) => {
    if (typeof raw !== 'string') throw new Error('external URL must be a string')
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`unsupported external URL protocol: ${url.protocol}`)
    }
    await shell.openExternal(url.href)
  })
}

async function bootstrap(): Promise<void> {
  app.setName(PRODUCT_NAME)
  const ohDshHome = resolveOhDshHome(process.env)
  const electronDataRoot = desktopElectronDataRoot(ohDshHome)
  mkdirSync(electronDataRoot, { recursive: true, mode: 0o700 })
  app.setPath('userData', electronDataRoot)
  app.setAboutPanelOptions({
    applicationName: PRODUCT_NAME,
    applicationVersion: PRODUCT_VERSION,
    version: `DeepSeek Harness plugin distribution ${PRODUCT_VERSION}`,
  })
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }
  const lockResult = tryAcquireRuntimeLock(ohDshHome, 'desktop')
  const acquiredLock = lockResult.lock
  runtimeLock = acquiredLock
  desktopReadOnly = lockResult.readOnly
  if (acquiredLock !== undefined) {
    process.once('exit', () => { acquiredLock.release() })
  }
  if (desktopReadOnly === false) {
    const migration = migrateLegacyDesktopState({
      appDataRoot: app.getPath('appData'),
      env: process.env,
      ohDshHome,
    })
    if (!migration.complete) {
      throw new Error(
        `legacy Desktop state migration under ${ohDshHome} is incomplete; `
        + 'restore unavailable link targets and restart',
      )
    }
  }
  app.on('second-instance', (_event, argv) => {
    queuedPaths.push(...argv.slice(1).filter(argument => !argument.startsWith('-')))
    if (mainWindow === undefined || mainWindow.isDestroyed()) {
      mainWindow = createWindow()
      if (runtimeUrl !== undefined) void mainWindow.loadURL(runtimeUrl.href).then(flushQueuedPaths)
    } else {
      mainWindow.show()
      mainWindow.focus()
      flushQueuedPaths()
    }
  })
  app.on('open-file', (event, path) => {
    event.preventDefault()
    queuedPaths.push(path)
    if (app.isReady()) flushQueuedPaths()
  })
  await app.whenReady()

  const info = desktopInfo()
  const logsDir = join(info.appDataPath, 'logs')
  mkdirSync(logsDir, { recursive: true })
  logStream = createWriteStream(join(logsDir, 'desktop.log'), { flags: 'a', mode: 0o600 })
  appendLog('desktop', `${PRODUCT_NAME} ${info.version} starting (${process.arch})`)
  await retireDuplicateMacBundles()
  await getUpdateManager()
  scheduleStartupUpdateCheck()
  marketplace = createPluginMarketplace()
  marketplaceAgentGateway = marketplace === undefined
    ? undefined
    : await startMarketplaceAgentGateway(marketplace, {
        onError: error => { appendLog('desktop', `[marketplace-agent] ${String(error)}`) },
      })
  installIpc()
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(allowsRuntimeClipboardWrite({
      isMainFrame: details.isMainFrame,
      permission,
      requestingOrigin: details.requestingUrl === undefined
        ? originOf(webContents.getURL())
        : originOf(details.requestingUrl),
      ...(details.requestingUrl === undefined ? {} : { requestingUrl: details.requestingUrl }),
      runtimeOrigin,
      webContentsIsMainWindow: webContents === mainWindow?.webContents,
    }))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return allowsRuntimeClipboardWrite({
      isMainFrame: details.isMainFrame,
      permission,
      requestingOrigin,
      ...(details.requestingUrl === undefined ? {} : { requestingUrl: details.requestingUrl }),
      runtimeOrigin,
      webContentsIsMainWindow: webContents === mainWindow?.webContents,
    })
  })
  const browserSession = session.fromPartition('persist:oh-dsh-browser')
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
  browserSession.setPermissionCheckHandler(() => false)
  buildMenu(systemLocale())
  tray = createTray()
  mainWindow = createWindow()
  await showSplash()
  const initialArguments = process.argv.slice(app.isPackaged ? 1 : 2)
  queuedPaths.push(...initialArguments.filter(argument => !argument.startsWith('-')))
  await restartRuntime()

  app.on('activate', () => { revealMainWindow() })
  app.on('window-all-closed', () => {
    // While the tray owns the hidden main window the app stays alive; a
    // quit already in progress finishes on its own without re-entering.
    if (process.platform === 'win32' && tray !== undefined && !quitting) return
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('will-quit', () => {
    tray?.destroy()
    tray = undefined
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    if (updateManager?.shouldInstallOnQuit() === true) {
      event.preventDefault()
      quitting = true
      quittingForUpdate = true
      void (async () => {
        await stopForApplicationQuit()
        const result = await updateManager?.command({ type: 'install-now' })
        if (result?.status === 'error') {
          quitting = false
          quittingForUpdate = false
          await restartRuntime()
          await openUpdateWindow()
        }
      })().catch(async (error: unknown) => {
        quitting = false
        quittingForUpdate = false
        appendLog('desktop', `failed to install update on quit: ${error instanceof Error ? error.message : String(error)}`)
        await showSplash({ error: true, message: '更新安装失败。', detail: logTail.slice(-12).join('\n') })
      })
      return
    }
    event.preventDefault()
    quitting = true
    appendLog('desktop', quittingForUpdate ? 'quitting to install desktop update' : 'quitting application')
    void stopForApplicationQuit().finally(() => {
      logStream?.end()
      app.quit()
    })
  })
}

void bootstrap().catch(async (error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  appendLog('desktop', detail)
  if (app.isReady()) await showSplash({ error: true, message: 'Oh-DSH Desktop 启动失败。', detail })
  else {
    await app.whenReady()
    await showSplash({ error: true, message: 'Oh-DSH Desktop 启动失败。', detail })
  }
  app.quit()
})
