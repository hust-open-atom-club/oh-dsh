import type { PluginMarketplaceBridge } from '../plugins/plugin-marketplace/src/protocol.ts'

/** Height of the in-page desktop titlebar strip, in CSS pixels at zoom 1. */
export const DESKTOP_TITLEBAR_HEIGHT = 40

/** Commands sent from Electron's native chrome to the DSH client plugin. */
export type DesktopCommand =
  | { type: 'focus-composer' }
  | { type: 'new-session' }
  | { type: 'open-paths'; paths: string[] }
  | { type: 'show-settings' }
  | { type: 'show-about' }
  | { type: 'toggle-bottom-panel' }
  | { type: 'toggle-panel-maximized' }
  | { type: 'toggle-pinned-summary' }
  | { type: 'toggle-side-panel' }
  | { type: 'toggle-workspace-panel' }
  | { type: 'open-browser' }
  | { type: 'open-files' }
  | { type: 'open-review' }
  | { type: 'open-side-chat' }
  | { type: 'open-trajectory' }
  | { type: 'toggle-sidebar' }

/** Public facts exposed by the isolated Electron preload. */
export interface DesktopInfo {
  appDataPath: string
  dshHome: string
  platform: NodeJS.Platform
  preview: { pluginId: string; transactionId: string } | null
  profile: string
  version: string
}

/** Runtime diagnostics shown by the bundled bottom-panel plugin. */
export interface DesktopRuntimeSnapshot {
  bundledPlugins: string[]
  logTail: string[]
  profile: string
  runtimeUrl: string | null
  status: 'ready' | 'restarting' | 'stopped'
}

export type DesktopUpdatePlatform = 'mac' | 'win' | 'appimage' | 'deb' | 'unsupported'

export type DesktopUpdateState =
  | { status: 'idle'; currentVersion: string }
  | { status: 'checking'; currentVersion: string }
  | { status: 'not-available'; currentVersion: string; checkedVersion: string }
  | { status: 'available'; currentVersion: string; latestVersion: string; releaseName: string | null; releaseNotes: string; size: number | null; platform: DesktopUpdatePlatform; releaseUrl: string }
  | { status: 'downloading'; currentVersion: string; latestVersion: string; releaseName: string | null; releaseNotes: string; size: number | null; platform: DesktopUpdatePlatform; releaseUrl: string; percent: number; transferred: number; total: number; bytesPerSecond: number; etaSeconds: number | null }
  | { status: 'downloaded'; currentVersion: string; latestVersion: string; releaseName: string | null; releaseNotes: string; size: number | null; platform: DesktopUpdatePlatform; releaseUrl: string; installOnQuit: boolean }
  | { status: 'scheduled'; currentVersion: string; latestVersion: string; releaseName: string | null; releaseNotes: string; size: number | null; platform: DesktopUpdatePlatform; releaseUrl: string }
  | { status: 'cancelled'; currentVersion: string; latestVersion?: string }
  | { status: 'unsupported'; currentVersion: string; platform: DesktopUpdatePlatform; message: string; releaseUrl: string | null }
  | { status: 'error'; currentVersion: string; stage: 'check' | 'download' | 'verify' | 'install'; code: string; message: string; releaseUrl: string | null; retryable: boolean }

/**
 * The About page's inline update flow: check, download with progress, and
 * install, all driven from the About card. This deliberately mirrors the
 * update window's user-visible states; the window itself stays available
 * through `openUpdater` for the full presentation.
 */
export type AboutUpdateSnapshot =
  | { status: 'idle'; currentVersion: string }
  | { status: 'checking' }
  | { status: 'not-available'; latestVersion: string }
  | { status: 'available'; latestVersion: string }
  | { status: 'downloading'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { status: 'downloaded'; latestVersion: string }
  | { status: 'unsupported' }
  | { status: 'error' }

/** The only update commands the About page may drive. */
export type AboutUpdateCommand = 'check' | 'download' | 'install-now'

export type DesktopUpdateCommand =
  | { type: 'check' }
  | { type: 'download' }
  | { type: 'cancel' }
  | { type: 'retry' }
  | { type: 'install-now' }
  | { type: 'install-on-quit' }
  | { type: 'open-release' }

export interface DesktopUpdateBridge {
  brandIconDataUrl(): Promise<string | null>
  getState(): Promise<DesktopUpdateState>
  onState(listener: (state: DesktopUpdateState) => void): () => void
  command(command: DesktopUpdateCommand): Promise<DesktopUpdateState>
}

/** Current native window state delivered to the renderer. */
export interface DesktopWindowState {
  maximized: boolean
}

export interface DesktopBridge {
  platform: NodeJS.Platform
  closeWindow(): Promise<void>
  chooseWorkspace(): Promise<string[]>
  brandIconDataUrl(): Promise<string | null>
  getInfo(): Promise<DesktopInfo>
  getRuntimeSnapshot(): Promise<DesktopRuntimeSnapshot>
  minimizeWindow(): Promise<void>
  /** Top-level labels of the application menu, in menu order. */
  menuBarLabels(): Promise<string[]>
  /** Apply the renderer's active locale and return refreshed top-level labels. */
  setMenuLocale(locale: 'en' | 'zh'): Promise<string[]>
  /** Open the software update window (check/download/install entry). */
  openUpdater(): Promise<void>
  /**
   * Inline update flow for the About page: check, download with progress,
   * and install. Mirrors the update window's user-visible states; the
   * window itself stays available through `openUpdater`.
   */
  aboutUpdate: {
    getSnapshot(): Promise<AboutUpdateSnapshot>
    check(): Promise<AboutUpdateSnapshot>
    command(command: AboutUpdateCommand): Promise<AboutUpdateSnapshot>
    onState(listener: (snapshot: AboutUpdateSnapshot) => void): () => void
  }
  onCommand(listener: (command: DesktopCommand) => void): () => void
  /** Subscribe to native maximize and restore events. */
  onWindowState(listener: (state: DesktopWindowState) => void): () => void
  openExternal(url: string): Promise<void>
  pluginMarketplace: PluginMarketplaceBridge
  /**
   * Pop up the native submenu of top-level menu `index` with its top-left
   * corner at the given CSS-pixel position inside the main window.
   */
  popupMenuBarMenu(index: number, cssX: number, cssY: number): Promise<void>
  toggleMaximizeWindow(): Promise<boolean>
  isWindowMaximized(): Promise<boolean>
}

export type {
  RuntimeBundleCandidate,
  RuntimeUpdateCommand,
  RuntimeUpdateState,
} from './runtime-update.ts'
import type { RuntimeUpdateCommand, RuntimeUpdateState } from './runtime-update.ts'

export interface RuntimeUpdateBridge {
  getState(): Promise<RuntimeUpdateState>
  onState(listener: (state: RuntimeUpdateState) => void): () => void
  command(command: RuntimeUpdateCommand): Promise<RuntimeUpdateState>
}
