import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CancellationToken, type ProgressInfo, type UpdateInfo, type UpdateFileInfo } from 'electron-updater'
import { gt, prerelease, valid } from 'semver'
import type {
  DesktopUpdatePlatform,
  DesktopUpdateState,
} from './contracts.ts'

const OFFICIAL_REPOSITORY = 'hust-open-atom-club/oh-dsh'
const OFFICIAL_RELEASES_URL = `https://github.com/${OFFICIAL_REPOSITORY}/releases`
const OFFICIAL_RELEASE_BASE = `https://github.com/${OFFICIAL_REPOSITORY}/releases/tag/`
/** GitHub release download mirror used as a fallback when GitHub is unreachable. */
const RELEASE_MIRROR_GENERIC_BASE = `https://gh-proxy.cn/https://github.com/${OFFICIAL_REPOSITORY}/releases/latest/download/`

/** The packaged GitHub feed, matching app-update.yml's publish configuration. */
const OFFICIAL_GITHUB_FEED = {
  provider: 'github',
  owner: OFFICIAL_REPOSITORY.split('/')[0]!,
  repo: OFFICIAL_REPOSITORY.split('/')[1]!,
}

export interface UpdateEventSource {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  disableDifferentialDownload: boolean
  /** Point the updater at a different feed (e.g. a release mirror). */
  setFeedURL?(options: unknown): void
  checkForUpdates(): Promise<{ isUpdateAvailable: boolean; updateInfo: UpdateInfo } | null>
  downloadUpdate(token?: CancellationToken): Promise<string[]>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener?(event: string, listener: (...args: any[]) => void): unknown
}

export interface UpdateManagerOptions {
  currentVersion: string
  platform?: NodeJS.Platform
  arch?: string
  appIsPackaged?: boolean
  resourcesPath?: string
  packageType?: 'appimage' | 'deb' | 'unsupported'
  updater?: UpdateEventSource
  syncProxy?: () => Promise<void>
  bypassProxy?: () => Promise<void>
  onOpenRelease?: (url: string) => Promise<void> | void
  onOpenInstaller?: (path: string) => Promise<void> | void
  onLog?: (message: string) => void
}

interface UpdateMetadata {
  currentVersion: string
  latestVersion: string
  releaseName: string | null
  releaseNotes: string
  size: number | null
  platform: DesktopUpdatePlatform
  releaseUrl: string
  installerPath: string | null
}

type Operation = 'check' | 'download' | 'verify' | 'install'

export function officialReleaseUrl(version: string): string {
  const normalized = valid(version)
  if (normalized === null) throw new Error(`invalid release version: ${version}`)
  return `${OFFICIAL_RELEASE_BASE}v${normalized}`
}

export function releaseNotesText(notes: UpdateInfo['releaseNotes']): string {
  if (typeof notes === 'string') return notes
  if (!Array.isArray(notes)) return ''
  return notes
    .map(note => `${note.version}\n${note.note ?? ''}`.trim())
    .filter(Boolean)
    .join('\n\n')
}

function normalizeFileName(file: UpdateFileInfo): string {
  const raw = file.url
  try {
    return decodeURIComponent(new URL(raw).pathname.split('/').pop() ?? raw)
  } catch {
    return raw.split('/').pop() ?? raw
  }
}

export function platformFor(options: Pick<UpdateManagerOptions, 'platform' | 'packageType' | 'appIsPackaged'> = {}): DesktopUpdatePlatform {
  if (options.appIsPackaged === false) return 'unsupported'
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'win'
  if (platform === 'linux') {
    if (options.packageType === 'deb') return 'deb'
    if (options.packageType === 'appimage' || process.env.APPIMAGE !== undefined) return 'appimage'
  }
  return 'unsupported'
}

export function selectUpdateFile(
  info: UpdateInfo,
  platform: DesktopUpdatePlatform,
  arch: string = process.arch,
): UpdateFileInfo {
  const files = info.files.filter(file => {
    const name = normalizeFileName(file).toLowerCase()
    if (platform === 'mac') return name.endsWith('.zip') && name.includes(arch.toLowerCase())
    if (platform === 'win') return name.endsWith('.exe') && name.includes(arch.toLowerCase())
    if (platform === 'appimage') return name.endsWith('.appimage') && (name.includes('x86_64') || name.includes('amd64') || name.includes(arch.toLowerCase()))
    if (platform === 'deb') return name.endsWith('.deb') && (name.includes('amd64') || name.includes('x86_64') || name.includes(arch.toLowerCase()))
    return false
  })
  if (files.length !== 1) {
    throw Object.assign(
      new Error(files.length === 0 ? `no installable update asset for ${platform}/${arch}` : `multiple installable update assets for ${platform}/${arch}`),
      { code: files.length === 0 ? 'UPDATE_ASSET_MISSING' : 'UPDATE_ASSET_AMBIGUOUS' },
    )
  }
  return files[0]!
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && error.code.trim() !== '') return error.code
  const networkCode = errorMessage(error).match(/\b(?:net::)?(ERR_[A-Z0-9_]+)\b/i)?.[1]
  if (networkCode !== undefined) return networkCode.toUpperCase()
  return 'UPDATE_FAILED'
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/authorization:\s*[^\s]+/gi, 'authorization: <redacted>')
    .replace(/([?&](?:token|access_token|password|passwd|secret))=[^&\s]*/gi, '$1=<redacted>')
    .slice(0, 1_000)
}

function userFacingErrorMessage(error: unknown, code: string): string {
  switch (code) {
    case 'ERR_PROXY_CONNECTION_FAILED':
      return 'Could not connect to the configured proxy. Check your system proxy settings, then try again.'
    case 'PROXY_AUTH_REQUIRED':
      return 'The configured network proxy requires authentication. Sign in to the proxy, then try again.'
    case 'ERR_INTERNET_DISCONNECTED':
      return 'No internet connection is available. Reconnect to the internet, then try again.'
    case 'ERR_NAME_NOT_RESOLVED':
      return 'Could not find the update server. Check your internet and DNS settings, then try again.'
    case 'ERR_CONNECTION_TIMED_OUT':
    case 'ETIMEDOUT':
      return 'The update server took too long to respond. Check your network connection, then try again.'
    case 'ERR_CONNECTION_REFUSED':
      return 'The update server refused the connection. Check your network or proxy settings, then try again.'
    case 'ENOSPC':
      return 'Not enough disk space to download the update.'
    default:
      return errorMessage(error)
  }
}

function isVerificationFailure(error: unknown): boolean {
  const code = errorCode(error).toLowerCase()
  const message = errorMessage(error).toLowerCase()
  return code.includes('signature') || code.includes('checksum') || message.includes('checksum') || message.includes('signature')
}

const PROXY_FAILURE_CODES = new Set(['ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED', 'ERR_PROXY_AUTH_UNSUPPORTED'])

function isProxyFailure(code: string): boolean {
  return PROXY_FAILURE_CODES.has(code)
}

/** Chromium-style network failures worth retrying against the release mirror. */
const CHROMIUM_NETWORK_CODES = /^ERR_(?!UPDATER_)/

/**
 * Node-style network failures surfaced by electron-updater's net stack.
 * Deliberately excludes local-environment codes like ENOSPC (disk full),
 * which a mirror cannot fix.
 */
const NODE_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
])

/** Network-level failures worth retrying against the release mirror. */
function isNetworkError(error: unknown): boolean {
  const code = errorCode(error)
  return CHROMIUM_NETWORK_CODES.test(code) || NODE_NETWORK_CODES.has(code)
}

function isRetryable(error: unknown, stage: Operation): boolean {
  if (stage === 'verify' || stage === 'install') return false
  const code = errorCode(error)
  if (code === 'UPDATE_ASSET_MISSING' || code === 'UPDATE_ASSET_AMBIGUOUS' || code === 'ENOSPC') return false
  if (code.includes('INVALID_SIGNATURE') || code.includes('CHECKSUM')) return false
  return true
}

export async function detectPackageType(resourcesPath: string): Promise<'appimage' | 'deb' | 'unsupported'> {
  if (process.env.APPIMAGE !== undefined) return 'appimage'
  try {
    const packageType = (await readFile(join(resourcesPath, 'package-type'), 'utf8')).trim()
    return packageType === 'deb' ? 'deb' : 'unsupported'
  } catch {
    return 'unsupported'
  }
}

export class DesktopUpdateManager {
  readonly platform: DesktopUpdatePlatform
  private readonly currentVersion: string
  private readonly arch: string
  private readonly updater: UpdateEventSource | undefined
  private readonly syncProxy: (() => Promise<void>) | undefined
  private readonly bypassProxy: (() => Promise<void>) | undefined
  private readonly onOpenRelease: ((url: string) => Promise<void> | void) | undefined
  private readonly onOpenInstaller: ((path: string) => Promise<void> | void) | undefined
  private readonly onLog: ((message: string) => void) | undefined
  private state: DesktopUpdateState
  private metadata: UpdateMetadata | undefined
  private token: CancellationToken | undefined
  private operation: Operation = 'check'
  private lastCheck: Promise<DesktopUpdateState> | undefined
  private proxyBypassed = false
  private mirrorTried = false
  private mirrorActive = false
  private installOnQuitRequested = false
  private readonly listeners = new Set<(state: DesktopUpdateState) => void>()
  private readonly eventListeners: Array<[string, (...args: any[]) => void]> = []

  constructor(options: UpdateManagerOptions) {
    this.currentVersion = options.currentVersion
    this.arch = options.arch ?? process.arch
    this.platform = platformFor(options)
    this.updater = options.updater
    this.syncProxy = options.syncProxy
    this.bypassProxy = options.bypassProxy
    this.onOpenRelease = options.onOpenRelease
    this.onOpenInstaller = options.onOpenInstaller
    this.onLog = options.onLog
    this.state = { status: 'idle', currentVersion: this.currentVersion }
    if (this.updater !== undefined) {
      this.updater.autoDownload = false
      this.updater.autoInstallOnAppQuit = false
      this.updater.allowPrerelease = false
      this.updater.allowDowngrade = false
      this.updater.disableDifferentialDownload = false
      this.bindUpdaterEvents()
    }
  }

  getState(): DesktopUpdateState { return this.state }

  shouldInstallOnQuit(): boolean { return this.installOnQuitRequested }

  subscribe(listener: (state: DesktopUpdateState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => { this.listeners.delete(listener) }
  }

  async command(command: { type: string }): Promise<DesktopUpdateState> {
    switch (command.type) {
      case 'check': return await this.check()
      case 'download': return await this.download()
      case 'cancel': return this.cancel()
      case 'retry': return await this.retry()
      case 'install-now': return await this.installNow()
      case 'install-on-quit': return this.installOnQuit()
      case 'open-release': return await this.openRelease()
      default: throw new Error(`unsupported update command: ${command.type}`)
    }
  }

  async check(): Promise<DesktopUpdateState> {
    if (this.lastCheck !== undefined) return await this.lastCheck
    this.lastCheck = this.performCheck().finally(() => { this.lastCheck = undefined })
    return await this.lastCheck
  }

  /**
   * An unreachable configured proxy is not a verdict on the update feed: the
   * OS proxy often points at a local client that has since stopped. Retry the
   * operation once with the updater's proxy bypassed before surfacing an
   * error, and remember the bypass so later operations stay direct.
   */
  private async runWithProxyFallback<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (this.proxyBypassed || this.bypassProxy === undefined || !isProxyFailure(errorCode(error))) throw error
      this.proxyBypassed = true
      this.onLog?.('configured proxy unreachable; retrying update without the proxy')
      await this.bypassProxy()
      return await operation()
    }
  }

  /**
   * The release mirror is a detour, not a destination: the next check puts
   * the updater back on GitHub so a transient outage cannot pin the client
   * to the third-party mirror for its whole lifetime. Restoring at the start
   * of a check — not right after one — keeps "mirror check, then mirror
   * download" intact within the same update cycle.
   */
  private restoreOfficialFeed(): void {
    const updater = this.updater
    if (!this.mirrorActive || updater === undefined) return
    this.mirrorActive = false
    this.onLog?.('release mirror cycle complete; restoring the GitHub feed')
    updater.setFeedURL?.(OFFICIAL_GITHUB_FEED)
  }

  private async performCheck(): Promise<DesktopUpdateState> {
    const updater = this.updater
    if (this.platform === 'unsupported' || updater === undefined) {
      return this.publish({
        status: 'unsupported',
        currentVersion: this.currentVersion,
        platform: this.platform,
        message: 'This installation does not support automatic updates. Download the matching package from the official Release.',
        releaseUrl: null,
      })
    }
    this.operation = 'check'
    this.restoreOfficialFeed()
    this.publish({ status: 'checking', currentVersion: this.currentVersion })
    try {
      await this.syncProxy?.()
      const result = await this.runWithProxyFallback(() => updater.checkForUpdates())
      if (result === null) {
        return this.publish({
          status: 'unsupported',
          currentVersion: this.currentVersion,
          platform: this.platform,
          message: 'Automatic updates are only available in a packaged, signed desktop installation.',
          releaseUrl: null,
        })
      }
      if (!result.isUpdateAvailable) {
        return this.publish({ status: 'not-available', currentVersion: this.currentVersion, checkedVersion: result.updateInfo.version })
      }
      return this.prepareAvailable(result.updateInfo)
    } catch (error) {
      // GitHub unreachable (common behind hostile networks): fall back once to
      // the release download mirror before surfacing the network error. The
      // mirror stays active for the rest of this update cycle (check through
      // download) and is restored on the next check.
      if (!this.mirrorTried && updater.setFeedURL !== undefined && isNetworkError(error)) {
        this.mirrorTried = true
        this.mirrorActive = true
        this.onLog?.('github update feed unreachable; retrying via release mirror')
        updater.setFeedURL({ provider: 'generic', url: RELEASE_MIRROR_GENERIC_BASE })
        try {
          const mirrored = await this.runWithProxyFallback(() => updater.checkForUpdates())
          if (mirrored !== null) {
            if (!mirrored.isUpdateAvailable) {
              return this.publish({ status: 'not-available', currentVersion: this.currentVersion, checkedVersion: mirrored.updateInfo.version })
            }
            return this.prepareAvailable(mirrored.updateInfo)
          }
        } catch (mirrorError) {
          this.onLog?.(`release mirror check also failed: ${errorMessage(mirrorError)}`)
        }
      }
      return this.fail(error, 'check')
    }
  }

  private prepareAvailable(info: UpdateInfo): DesktopUpdateState {
    const normalized = valid(info.version)
    if (normalized === null || prerelease(normalized) !== null || !gt(normalized, this.currentVersion)) {
      return this.publish({ status: 'not-available', currentVersion: this.currentVersion, checkedVersion: info.version })
    }
    if (this.state.status === 'available' && this.state.latestVersion === normalized) return this.state
    try {
      const file = selectUpdateFile(info, this.platform, this.arch)
      this.metadata = {
        currentVersion: this.currentVersion,
        latestVersion: normalized,
        releaseName: info.releaseName ?? null,
        releaseNotes: releaseNotesText(info.releaseNotes),
        size: file.size ?? null,
        platform: this.platform,
        releaseUrl: officialReleaseUrl(normalized),
        installerPath: null,
      }
      return this.publish({
        status: 'available',
        currentVersion: this.currentVersion,
        latestVersion: normalized,
        releaseName: info.releaseName ?? null,
        releaseNotes: releaseNotesText(info.releaseNotes),
        size: file.size ?? null,
        platform: this.platform,
        releaseUrl: officialReleaseUrl(normalized),
      })
    } catch (error) {
      const code = errorCode(error)
      if (code === 'UPDATE_ASSET_MISSING' || code === 'UPDATE_ASSET_AMBIGUOUS') {
        return this.publish({
          status: 'unsupported',
          currentVersion: this.currentVersion,
          platform: this.platform,
          message: 'The latest Release does not contain one verified installer for this platform and architecture.',
          releaseUrl: officialReleaseUrl(normalized),
        })
      }
      return this.fail(error, 'check')
    }
  }

  async download(): Promise<DesktopUpdateState> {
    const updater = this.updater
    if (this.metadata === undefined || updater === undefined) return this.state
    this.operation = 'download'
    this.token = new CancellationToken()
    const token = this.token
    try {
      await this.syncProxy?.()
      const paths = await this.runWithProxyFallback(() => updater.downloadUpdate(token))
      if (this.metadata.installerPath === null) this.metadata.installerPath = paths[0] ?? null
      if (this.state.status !== 'downloaded') this.publishDownloaded()
      return this.state
    } catch (error) {
      if (this.token.cancelled) return this.publish({ status: 'cancelled', currentVersion: this.currentVersion, latestVersion: this.metadata.latestVersion })
      return this.fail(error, isVerificationFailure(error) ? 'verify' : 'download')
    } finally {
      this.token = undefined
    }
  }

  cancel(): DesktopUpdateState {
    this.token?.cancel()
    if (this.metadata !== undefined && (this.state.status === 'downloading' || this.state.status === 'available')) {
      return this.publish({ status: 'cancelled', currentVersion: this.currentVersion, latestVersion: this.metadata.latestVersion })
    }
    return this.state
  }

  async retry(): Promise<DesktopUpdateState> {
    if (this.state.status === 'error' && this.state.stage === 'download' && this.metadata !== undefined) return await this.download()
    return await this.check()
  }

  async installNow(): Promise<DesktopUpdateState> {
    const scheduledInstall = this.state.status === 'scheduled' && this.installOnQuitRequested
    if (this.metadata === undefined || (this.state.status !== 'downloaded' && !scheduledInstall)) return this.state
    this.operation = 'install'
    this.installOnQuitRequested = false
    try {
      if (this.metadata.platform === 'deb') {
        if (this.metadata.installerPath === null || this.onOpenInstaller === undefined) throw Object.assign(new Error('the downloaded .deb installer is unavailable'), { code: 'UPDATE_INSTALLER_MISSING' })
        await this.onOpenInstaller(this.metadata.installerPath)
        return this.publishScheduled()
      }
      this.updater?.quitAndInstall(false, true)
      if (this.state.status === 'error') return this.state
      return this.publishScheduled()
    } catch (error) {
      return this.fail(error, 'install')
    }
  }

  installOnQuit(): DesktopUpdateState {
    if (this.metadata === undefined || this.state.status !== 'downloaded' || this.metadata.platform === 'deb') return this.state
    this.installOnQuitRequested = true
    if (this.updater !== undefined) this.updater.autoInstallOnAppQuit = true
    return this.publishScheduled()
  }

  async openRelease(): Promise<DesktopUpdateState> {
    const stateReleaseUrl = 'releaseUrl' in this.state ? this.state.releaseUrl : null
    const url = this.metadata?.releaseUrl ?? stateReleaseUrl
    if (url !== null) await this.onOpenRelease?.(url)
    return this.state
  }

  private publishDownloaded(): void {
    if (this.metadata === undefined) return
    const { installerPath: _installerPath, ...publicMetadata } = this.metadata
    this.publish({
      status: 'downloaded',
      ...publicMetadata,
      installOnQuit: false,
    })
  }

  private publishScheduled(): DesktopUpdateState {
    if (this.metadata === undefined) return this.state
    return this.publish({
      status: 'scheduled',
      currentVersion: this.metadata.currentVersion,
      latestVersion: this.metadata.latestVersion,
      releaseName: this.metadata.releaseName,
      releaseNotes: this.metadata.releaseNotes,
      size: this.metadata.size,
      platform: this.metadata.platform,
      releaseUrl: this.metadata.releaseUrl,
    })
  }

  private bindUpdaterEvents(): void {
    const bind = (event: string, listener: (...args: any[]) => void): void => {
      this.updater?.on(event, listener)
      this.eventListeners.push([event, listener])
    }
    bind('checking-for-update', () => {
      if (this.state.status !== 'checking' && this.state.status !== 'downloading') this.publish({ status: 'checking', currentVersion: this.currentVersion })
    })
    bind('update-available', (info: UpdateInfo) => { this.prepareAvailable(info) })
    bind('update-not-available', (info: UpdateInfo) => {
      this.publish({ status: 'not-available', currentVersion: this.currentVersion, checkedVersion: info.version })
    })
    bind('download-progress', (progress: ProgressInfo) => {
      if (this.metadata === undefined) return
      const total = progress.total || this.metadata.size || 0
      const transferred = progress.transferred || 0
      const bytesPerSecond = progress.bytesPerSecond || 0
      this.publish({
        status: 'downloading',
        currentVersion: this.metadata.currentVersion,
        latestVersion: this.metadata.latestVersion,
        releaseName: this.metadata.releaseName,
        releaseNotes: this.metadata.releaseNotes,
        size: this.metadata.size,
        platform: this.metadata.platform,
        releaseUrl: this.metadata.releaseUrl,
        percent: progress.percent || 0,
        transferred,
        total,
        bytesPerSecond,
        etaSeconds: bytesPerSecond > 0 && total > transferred ? Math.ceil((total - transferred) / bytesPerSecond) : null,
      })
    })
    bind('update-downloaded', (event: { downloadedFile?: string }) => {
      if (this.metadata === undefined) return
      if (event.downloadedFile !== undefined) this.metadata.installerPath = event.downloadedFile
      this.publishDownloaded()
    })
    bind('update-cancelled', () => {
      if (this.metadata !== undefined) this.publish({ status: 'cancelled', currentVersion: this.currentVersion, latestVersion: this.metadata.latestVersion })
    })
    bind('login', (_authInfo: unknown, callback: (username: string, password: string) => void) => {
      callback('', '')
      this.fail(Object.assign(new Error('The configured network proxy requires authentication.'), { code: 'PROXY_AUTH_REQUIRED' }), this.operation)
    })
    bind('error', (error: unknown) => {
      if (this.token?.cancelled) return
      // A proxy failure is retried without the proxy by the awaiting
      // operation; publishing here would flash a dead-end error first.
      if (!this.proxyBypassed && this.bypassProxy !== undefined && isProxyFailure(errorCode(error))) return
      this.fail(error, isVerificationFailure(error) ? 'verify' : this.operation)
    })
  }

  private fail(error: unknown, stage: Operation): DesktopUpdateState {
    const code = errorCode(error)
    const diagnosticMessage = errorMessage(error)
    this.onLog?.(`update ${stage} failed (${code}): ${diagnosticMessage}`)
    return this.publish({
      status: 'error',
      currentVersion: this.currentVersion,
      stage,
      code,
      message: userFacingErrorMessage(error, code),
      releaseUrl: this.metadata?.releaseUrl ?? OFFICIAL_RELEASES_URL,
      retryable: isRetryable(error, stage),
    })
  }

  private publish(state: DesktopUpdateState): DesktopUpdateState {
    this.state = state
    for (const listener of this.listeners) listener(state)
    return state
  }

  dispose(): void {
    for (const [event, listener] of this.eventListeners) this.updater?.removeListener?.(event, listener)
    this.eventListeners.length = 0
    this.listeners.clear()
  }
}
