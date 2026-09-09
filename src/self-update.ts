/** Startup self-update checks and installer-driven upgrades for Oh-DSH. */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gt, valid } from 'semver'

export const OFFICIAL_REPOSITORY = 'hust-open-atom-club/oh-dsh'
export const UPDATE_CHECK_DISABLE_ENV = 'OH_DSH_UPDATE_CHECK'
export const UPDATE_API_BASE_ENV = 'OH_DSH_UPDATE_API_BASE'
const UPDATE_CHECK_TIMEOUT_MS = 5_000
const STARTUP_NOTICE_BUDGET_MS = 1_500

export interface UpdateCheckResult {
  current: string
  latest: string
  updateAvailable: boolean
}

export type UpdateFetcher = typeof fetch

/** True unless the user opted out with OH_DSH_UPDATE_CHECK=0|false. */
export function updateCheckEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env[UPDATE_CHECK_DISABLE_ENV]
  if (value === undefined || value === '') return true
  return !(value === '0' || value.toLowerCase() === 'false')
}

export function latestReleaseApiUrl(
  env: NodeJS.ProcessEnv,
  repository: string = OFFICIAL_REPOSITORY,
): string {
  const base = env[UPDATE_API_BASE_ENV]?.replace(/\/+$/, '')
  if (base !== undefined && base !== '') {
    return `${base}/repos/${repository}/releases/latest`
  }
  return `https://api.github.com/repos/${repository}/releases/latest`
}

/**
 * Resolve the latest stable release version, or undefined when the check
 * fails, is disabled, or returns something that is not a stable tag. Updates
 * are release-based only: no commit-level or rolling channel is consulted.
 */
export async function fetchLatestVersion(
  env: NodeJS.ProcessEnv,
  fetchImpl: UpdateFetcher = fetch,
  repository: string = OFFICIAL_REPOSITORY,
): Promise<string | undefined> {
  if (!updateCheckEnabled(env)) return undefined
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'oh-dsh-update-check',
  }
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN
  const targetUrl = latestReleaseApiUrl(env, repository)
  // The token is a GitHub credential: it is only attached when the resolved
  // endpoint is the GitHub API itself, never to a mirror or test override.
  if (token !== undefined && token !== '' && targetUrl.startsWith('https://api.github.com/')) {
    headers.authorization = `Bearer ${token}`
  }
  try {
    const response = await fetchImpl(targetUrl, {
      headers,
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const release = await response.json() as { tag_name?: unknown }
    if (typeof release.tag_name !== 'string') return undefined
    const version = valid(release.tag_name.replace(/^v/, ''))
    return version ?? undefined
  } catch {
    return undefined
  }
}

/** Compare the running version with the latest stable release. */
export async function checkForUpdate(
  current: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: UpdateFetcher = fetch,
  repository: string = OFFICIAL_REPOSITORY,
): Promise<UpdateCheckResult | undefined> {
  const normalizedCurrent = valid(current) ?? undefined
  if (normalizedCurrent === undefined) return undefined
  const latest = await fetchLatestVersion(env, fetchImpl, repository)
  if (latest === undefined) return undefined
  return {
    current: normalizedCurrent,
    latest,
    updateAvailable: gt(latest, normalizedCurrent),
  }
}

/** One startup notice line, codex-TUI style. */
export function formatUpdateNotice(result: UpdateCheckResult): string {
  return `Oh-DSH ${result.current} -> ${result.latest} is available. Run "ohdsh update" to upgrade.\n`
}

/**
 * Await one startup check with a short budget so surfaces never wait on a
 * slow network: past the budget the check is abandoned silently.
 */
export async function startupUpdateNotice(
  current: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: UpdateFetcher = fetch,
  repository: string = OFFICIAL_REPOSITORY,
): Promise<string | undefined> {
  if (!updateCheckEnabled(env)) return undefined
  const check = checkForUpdate(current, env, fetchImpl, repository)
  const budget = new Promise<undefined>(resolve => {
    setTimeout(resolve, STARTUP_NOTICE_BUDGET_MS)
  })
  const result = await Promise.race([check, budget])
  if (result === undefined || !result.updateAvailable) return undefined
  return formatUpdateNotice(result)
}

/** Raw installer-script URL for the current platform. */
export function installScriptUrl(
  platform: NodeJS.Platform = process.platform,
  repository: string = OFFICIAL_REPOSITORY,
  env: NodeJS.ProcessEnv = {},
): string {
  const override = env.OH_DSH_INSTALL_SCRIPT_URL
  if (override !== undefined && override !== '') return override
  const script = platform === 'win32' ? 'install.ps1' : 'install.sh'
  return `https://raw.githubusercontent.com/${repository}/main/${script}`
}

/**
 * Installer bookkeeping root (launcher records, desktop markers): under the
 * shared Oh-DSH state root owned by src/data-root.ts, so one OH_DSH_HOME
 * override moves every record together with the app's shared state.
 */
export function installerRecordHome(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // OH_DSH_INSTALLER_HOME is the installers' own record-root override (the
  // -DataHome parameter); the dispatcher exports it so a payload launched
  // from a custom record root reads the same records as its installer.
  if (env.OH_DSH_INSTALLER_HOME !== undefined && env.OH_DSH_INSTALLER_HOME !== '') {
    return env.OH_DSH_INSTALLER_HOME
  }
  // install.ps1 derives the default state root from USERPROFILE; follow the
  // same variable so a HOME set by Git Bash cannot split the two roots.
  const userHome = platform === 'win32'
    ? env.USERPROFILE ?? homedir()
    : env.HOME ?? homedir()
  const stateRoot = env.OH_DSH_HOME !== undefined && env.OH_DSH_HOME !== ''
    ? env.OH_DSH_HOME
    : join(userHome, '.ohdsh')
  return join(stateRoot, 'installer')
}

/**
 * Default payload destinations the installers own (programs, not state):
 * XDG data home on Unix, %LOCALAPPDATA% on Windows.
 */
export function installerPayloadHome(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA
    if (localAppData !== undefined && localAppData !== '') {
      return join(localAppData, 'oh-dsh')
    }
    return join(env.USERPROFILE ?? homedir(), 'AppData', 'Local', 'oh-dsh')
  }
  const xdgDataHome = env.XDG_DATA_HOME
  if (xdgDataHome !== undefined && xdgDataHome !== '') {
    return join(xdgDataHome, 'oh-dsh')
  }
  // install.sh derives this from $HOME; honor the same override here.
  return join(env.HOME ?? homedir(), '.local', 'share', 'oh-dsh')
}

export interface LauncherRecord {
  webDest?: string
  tuiDest?: string
  binDir?: string
  /** Per-surface fork provenance: repositories each payload came from. */
  webRepo?: string
  tuiRepo?: string
  desktopDest?: string
  desktopRepo?: string
  desktopExe?: string
}

function readTextAt(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Read the launcher destinations the installers record, codex-style: the
 * records plus the running path decide how a self-update must run. Parsing
 * is inert line matching; the file is never evaluated.
 */
export function readLauncherRecord(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  readFile: (path: string) => string | undefined = readTextAt,
): LauncherRecord {
  const content = readFile(join(installerRecordHome(platform, env), 'launcher.env'))
  if (content === undefined) return {}
  const record: LauncherRecord = {}
  // Line values tolerate CRLF and a UTF-8 BOM: install.ps1 writes Windows
  // line endings and PowerShell 5.1 UTF-8 output starts with a BOM.
  const normalized = content.startsWith('\uFEFF') ? content.slice(1) : content
  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.startsWith('WEB_DEST=')) record.webDest = line.slice('WEB_DEST='.length)
    else if (line.startsWith('TUI_DEST=')) record.tuiDest = line.slice('TUI_DEST='.length)
    else if (line.startsWith('BIN_DIR=')) record.binDir = line.slice('BIN_DIR='.length)
    else if (line.startsWith('WEB_REPO=')) record.webRepo = line.slice('WEB_REPO='.length)
    else if (line.startsWith('TUI_REPO=')) record.tuiRepo = line.slice('TUI_REPO='.length)
    else if (line.startsWith('DESKTOP_DEST=')) record.desktopDest = line.slice('DESKTOP_DEST='.length)
    else if (line.startsWith('DESKTOP_REPO=')) record.desktopRepo = line.slice('DESKTOP_REPO='.length)
    else if (line.startsWith('DESKTOP_EXE=')) record.desktopExe = line.slice('DESKTOP_EXE='.length)
  }
  return record
}

function markerSurface(root: string): 'web' | 'tui' | undefined {
  const raw = readTextAt(join(root, '.oh-dsh-install.env'))
  if (raw === undefined) return undefined
  const content = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  for (const rawLine of content.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line.startsWith('OH_DSH_INSTALL_SURFACE=')) continue
    const value = line.slice('OH_DSH_INSTALL_SURFACE='.length)
    return value === 'web' || value === 'tui' ? value : undefined
  }
  return undefined
}

/**
 * Decide which distribution the launcher is running from. Like codex, infer
 * from the install records and the path itself; no build flag marks the
 * source. Order: the payload's own install marker, the desktop bundle path,
 * the source-root contract, the installer's default payload paths, the
 * launcher destination records, then the payload layout for manually
 * extracted archives.
 */
export function detectDistributionSurface(
  root: string,
  env: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): 'desktop' | 'web' | 'tui' | 'source' {
  const target = resolve(root)

  const marked = markerSurface(target)
  if (marked !== undefined) return marked

  if (platform === 'darwin'
    && target.split(/[\\/]/).join('/').includes('.app/Contents/Resources')) {
    return 'desktop'
  }
  if (env.OH_DSH_DESKTOP_APP !== undefined && env.OH_DSH_DESKTOP_APP !== '') return 'desktop'

  const sourceRoot = env.OH_DSH_SOURCE_ROOT
  const packaged = (env.DSH_OH_TUI_ROOT !== undefined && env.DSH_OH_TUI_ROOT !== '')
    || (env.DSH_OH_WEB_ROOT !== undefined && env.DSH_OH_WEB_ROOT !== '')
  if (sourceRoot !== undefined && sourceRoot !== '' && !packaged) return 'source'

  const payloadHome = installerPayloadHome(platform, env)
  if (target === resolve(join(payloadHome, 'web'))) return 'web'
  if (target === resolve(join(payloadHome, 'tui'))) return 'tui'

  const record = readLauncherRecord(env, platform)
  if (record.webDest !== undefined && record.webDest !== '' && target === resolve(record.webDest)) {
    return 'web'
  }
  if (record.tuiDest !== undefined && record.tuiDest !== '' && target === resolve(record.tuiDest)) {
    return 'tui'
  }

  if (pathExists(join(target, 'lib', 'oh-dsh-web', 'main.js'))) return 'web'
  if (pathExists(join(target, 'lib', 'oh-dsh', 'cli.js'))) return 'tui'
  return 'source'
}

/** Every distribution the launcher can upgrade through the installers. */
export type SelfUpdateSurface = 'desktop' | 'web' | 'tui'

/** The command line that upgrades one surface with the platform installer. */
export interface SelfUpdatePlan {
  scriptUrl: string
  command: string
  args: string[]
  /** Destination overrides reconstructed from the installer records. */
  dest?: string
  binDir?: string
}

export function selfUpdatePlan(
  surface: SelfUpdateSurface,
  platform: NodeJS.Platform = process.platform,
  repository: string = OFFICIAL_REPOSITORY,
  env: NodeJS.ProcessEnv = {},
): SelfUpdatePlan {
  const record = readLauncherRecord(env, platform)
  // Fork installs keep their provenance per surface: the record decides
  // which repository both the script download and the release resolution
  // target, so side-by-side installs from different forks stay separate.
  const recordRepo = surface === 'web'
    ? record.webRepo
    : surface === 'tui' ? record.tuiRepo : record.desktopRepo
  const effectiveRepo = recordRepo !== undefined && recordRepo !== ''
    ? recordRepo
    : repository
  const scriptUrl = installScriptUrl(platform, effectiveRepo, env)
  const dest = surface === 'web'
    ? record.webDest
    : surface === 'tui' ? record.tuiDest : record.desktopDest
  const repoArgs = recordRepo !== undefined && recordRepo !== '' && recordRepo !== repository
    ? platform === 'win32' ? ['-Repo', recordRepo] : ['--repo', recordRepo]
    : []
  if (platform === 'win32') {
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', '<script>', '-Surface', surface,
    ]
    if (dest !== undefined && dest !== '') args.push('-Dest', dest)
    if (record.binDir !== undefined && record.binDir !== '') {
      args.push('-BinDir', record.binDir)
    }
    args.push(...repoArgs)
    return { scriptUrl, command: 'powershell', args }
  }
  const args = ['<script>', '--surface', surface]
  if (dest !== undefined && dest !== '') args.push('--dest', dest)
  if (record.binDir !== undefined && record.binDir !== '') {
    args.push('--bin-dir', record.binDir)
  }
  args.push(...repoArgs)
  return { scriptUrl, command: 'sh', args }
}

/** The desktop app image names the installers place under a destination. */
function desktopImagePaths(dest: string, platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') return [join(dest, 'Oh-DSH Desktop.app')]
  if (platform === 'win32') {
    // install.ps1 probes both published executable names.
    return [join(dest, 'Oh-DSH Desktop.exe'), join(dest, 'oh-dsh-desktop.exe')]
  }
  return [join(dest, 'oh-dsh-desktop')]
}

/** The destination the desktop installer marker last recorded, if any. */
function desktopRecordDest(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | undefined {
  const raw = readTextAt(join(installerRecordHome(platform, env), 'desktop.env'))
  if (raw === undefined) return undefined
  const content = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  for (const rawLine of content.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line.startsWith('OH_DSH_INSTALL_DEST=')) continue
    const value = line.slice('OH_DSH_INSTALL_DEST='.length)
    return value === '' ? undefined : value
  }
  return undefined
}

function desktopIsInstalled(
  record: LauncherRecord,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  pathExists: (path: string) => boolean,
): boolean {
  if (record.desktopExe !== undefined && record.desktopExe !== '') {
    return pathExists(record.desktopExe)
  }
  const dest = record.desktopDest !== undefined && record.desktopDest !== ''
    ? record.desktopDest
    : desktopRecordDest(env, platform)
  if (dest === undefined) return false
  return desktopImagePaths(dest, platform).some(pathExists)
}

/** Whether an installer-owned installation of one surface exists anywhere. */
export function surfaceIsInstalled(
  surface: SelfUpdateSurface,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  pathExists: (path: string) => boolean = existsSync,
): boolean {
  const record = readLauncherRecord(env, platform)
  if (surface === 'desktop') {
    return desktopIsInstalled(record, env, platform, pathExists)
  }
  const launcher = join('bin', platform === 'win32' ? 'ohdsh.cmd' : 'ohdsh')
  const recorded = surface === 'web' ? record.webDest : record.tuiDest
  if (recorded !== undefined && recorded !== '') {
    return pathExists(join(recorded, launcher))
  }
  return pathExists(join(installerPayloadHome(platform, env), surface, launcher))
}

/**
 * The install script bundled into web/tui packages at lib/oh-dsh/. `ohdsh
 * update` prefers it over a download, so the upgrade runs the script that
 * matches the installed version and works without raw.githubusercontent.
 */
export function bundledInstallScript(
  root: string,
  platform: NodeJS.Platform = process.platform,
  pathExists: (path: string) => boolean = existsSync,
): string | undefined {
  const script = join(
    root,
    'lib',
    'oh-dsh',
    platform === 'win32' ? 'install.ps1' : 'install.sh',
  )
  return pathExists(script) ? script : undefined
}

function windowsQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/** One Windows installer invocation: which script upgrades which surface. */
interface WindowsUpdateEntry {
  surface: SelfUpdateSurface
  scriptPath: string
  plan: SelfUpdatePlan
}

async function downloadInstallerScript(
  url: string,
  fetchImpl: UpdateFetcher,
): Promise<string> {
  try {
    const response = await fetchImpl(url)
    if (!response.ok) {
      throw new Error(`unexpected status ${String(response.status)}`)
    }
    return await response.text()
  } catch (error) {
    throw new Error(
      `failed to download the installer from ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

/**
 * On Windows the packaged CLI runs from the payload being replaced, and a
 * mapped node.exe cannot be moved while this process lives. Hand the work to
 * a detached helper that waits for this process to exit, then runs every
 * surface's installer sequentially in one helper — concurrent installers
 * would race each other's launcher and record writes.
 */
function spawnDetachedWindowsUpdate(
  entries: readonly WindowsUpdateEntry[],
  env: NodeJS.ProcessEnv,
): number {
  // The helper is detached with silent stdio, so its diagnostics and exit
  // status are persisted for the user instead of vanishing with the console.
  const logPath = join(installerRecordHome('win32', env), 'update.log')
  const escapedLog = windowsQuoted(logPath)
  const steps = entries.flatMap(entry => {
    const flags = entry.plan.args
      .filter(arg => arg !== '-NoProfile' && arg !== '-ExecutionPolicy'
        && arg !== 'Bypass' && arg !== '-File' && arg !== '<script>')
      .map(arg => (arg.startsWith('-') ? arg : windowsQuoted(arg)))
      .join(' ')
    return [
      `Add-Content -LiteralPath ${escapedLog} -Value ([string](Get-Date) + ': updating ${entry.surface}')`,
      `& ${windowsQuoted(entry.scriptPath)} ${flags} *>> ${escapedLog}`,
      `Add-Content -LiteralPath ${escapedLog} -Value ([string](Get-Date) + ': ${entry.surface} update exited with ' + $LASTEXITCODE)`,
    ]
  }).join('; ')
  const waitAndRun = [
    `while (Get-Process -Id ${String(process.pid)} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }`,
    steps,
  ].join('; ')
  const child = spawn(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', waitAndRun],
    { detached: true, stdio: 'ignore', env, windowsHide: true },
  )
  child.unref()
  process.stdout.write(
    `Oh-DSH: the upgrade continues in the background after this process exits.\n` +
    `Progress and failures are logged at ${logPath}\n`,
  )
  return 0
}

/**
 * Run the installer for one surface. The script bundled with the running
 * package is preferred; otherwise it is downloaded over TLS. On Windows the
 * installer runs detached after this process exits (see above).
 */
export async function runSelfUpdate(
  surface: SelfUpdateSurface,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  fetchImpl: UpdateFetcher = fetch,
  root: string = '',
): Promise<number> {
  return await runSelfUpdates([surface], env, platform, fetchImpl, root)
}

/**
 * Run the installer for every requested surface, in order, announcing each
 * one before its upgrade starts. A failing surface does not stop the rest:
 * each is an independent payload, and a partial upgrade is still progress.
 * The return code is the first nonzero installer exit, or 0 when all pass.
 */
export async function runSelfUpdates(
  surfaces: readonly SelfUpdateSurface[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  fetchImpl: UpdateFetcher = fetch,
  root: string = '',
  announce: (surface: SelfUpdateSurface) => void = () => {},
): Promise<number> {
  if (surfaces.length === 0) return 2
  if (platform === 'win32') {
    const bundled = root !== '' ? bundledInstallScript(root, platform) : undefined
    const entries: WindowsUpdateEntry[] = []
    const persisted = new Map<string, string>()
    for (const surface of surfaces) {
      const plan = selfUpdatePlan(surface, platform, OFFICIAL_REPOSITORY, env)
      let scriptPath = bundled
      if (scriptPath === undefined) {
        const cached = persisted.get(plan.scriptUrl)
        if (cached === undefined) {
          const script = await downloadInstallerScript(plan.scriptUrl, fetchImpl)
          mkdirSync(installerRecordHome(platform, env), { recursive: true })
          scriptPath = join(installerRecordHome(platform, env), `update-install-${surface}.ps1`)
          writeFileSync(scriptPath, script, { mode: 0o755 })
          persisted.set(plan.scriptUrl, scriptPath)
        } else {
          scriptPath = cached
        }
      }
      entries.push({ surface, scriptPath, plan })
    }
    return spawnDetachedWindowsUpdate(entries, env)
  }
  let failure: number | undefined
  for (const surface of surfaces) {
    announce(surface)
    const plan = selfUpdatePlan(surface, platform, OFFICIAL_REPOSITORY, env)
    const bundled = root !== '' ? bundledInstallScript(root, platform) : undefined
    let scriptPath = bundled
    let workdir = ''
    if (scriptPath === undefined) {
      const script = await downloadInstallerScript(plan.scriptUrl, fetchImpl)
      workdir = mkdtempSync(join(tmpdir(), 'oh-dsh-self-update-'))
      scriptPath = join(workdir, 'install.sh')
      writeFileSync(scriptPath, script, { mode: 0o755 })
    }
    try {
      const args = plan.args.map(arg => (arg === '<script>' ? scriptPath : arg))
      const code = await new Promise<number>((resolve, reject) => {
        const child = spawn(plan.command, args, {
          env,
          stdio: 'inherit',
        })
        child.once('error', reject)
        child.once('exit', code => {
          resolve(code ?? 1)
        })
      })
      if (code !== 0 && failure === undefined) failure = code
    } finally {
      if (workdir !== '') rmSync(workdir, { force: true, recursive: true })
    }
  }
  return failure ?? 0
}
