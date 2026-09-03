import { spawn } from 'node:child_process'
import {
  constants,
  accessSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path'
import { parseMarketplaceCatalog } from '../catalog.ts'
import type { MarketplaceAuthStatus, MarketplaceRepositoryStats } from '../protocol.ts'
import {
  MARKETPLACE_CATALOG_PATH,
  MARKETPLACE_CATALOG_REPOSITORY,
} from '../protocol.ts'

export interface MarketplaceAuthResult {
  detail: string
  status: MarketplaceAuthStatus
}

export interface DshCommandInput {
  args: string[]
  dshHome: string
  sandboxRoot: string
  /**
   * Set to `false` to run without the write-restricted seatbelt. Used to
   * re-home the live profile's node_modules against the persistent home
   * store after a preview is applied; sandboxed runs keep their store inside
   * the preview root, which is deleted with the preview.
   */
  sandboxed?: boolean
}

export interface BundleBuildInput {
  checkout: string
  sandboxRoot: string
  scripts: string[]
  /** Explicitly opt out of process confinement; never the default. */
  sandboxed?: boolean
}

/** Privileged operations consumed by the marketplace transaction module. */
export interface MarketplacePlatform {
  /** Whether lifecycle scripts can run under a write-restricted launcher. */
  readonly scriptSandboxAvailable?: boolean
  authStatus(): Promise<MarketplaceAuthResult>
  buildBundle(input: BundleBuildInput): Promise<void>
  cloneRepository(repository: string, commit: string, target: string): Promise<void>
  loadCatalog(options?: LoadCatalogOptions): Promise<unknown>
  loadRepositoryStats(repository: string): Promise<MarketplaceRepositoryStats | null>
  readRepositoryFile(repository: string, path: string, commit: string): Promise<string | null>
  resolveCommit(repository: string): Promise<string>
  runDsh(input: DshCommandInput): Promise<void>
}

export interface LoadCatalogOptions {
  force?: boolean
}

export interface ProductionMarketplacePlatformOptions {
  /** Surface-owned app-data root for cache and credential helpers. */
  appDataPath?: string
  /** Read-only viewers read the catalog cache but never write it. */
  cacheReadOnly?: boolean
  cliEntry: string
  /** Working directory for spawned commands; omitted in read-only viewers. */
  cwd?: string
  env: NodeJS.ProcessEnv
  fetch?: typeof globalThis.fetch
  nodeBinary: string
  now?: () => number
  pnpmEntry: string
  /** Packaged Linux launcher; absent means scripted previews fail closed. */
  sandboxLauncher?: string | undefined
  onLog?: (message: string) => void
}

interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

export const MARKETPLACE_CATALOG_CACHE_TTL_MS = 2 * 60 * 60 * 1000

export const MARKETPLACE_REPOSITORY_STATS_CACHE_TTL_MS = 6 * 60 * 60 * 1000

const CATALOG_CACHE_VERSION = 1

interface CatalogCache {
  document: unknown
  etag: string | null
  fetchedAt: number
  locator: string
  version: 1
}

interface RepositoryStatsCache {
  etag: string | null
  fetchedAt: number
  repository: string
  stats: MarketplaceRepositoryStats
  version: 1
}

function parseGitHubRepositoryStats(value: unknown): MarketplaceRepositoryStats | null {
  if (!isRecord(value)) return null
  const values = [value.forks_count, value.open_issues_count, value.stargazers_count]
  if (values.some(entry => !Number.isSafeInteger(entry) || (entry as number) < 0)) return null
  return {
    forks: value.forks_count as number,
    language: typeof value.language === 'string' && value.language !== '' ? value.language : null,
    license: isRecord(value.license) && typeof value.license.name === 'string'
      && value.license.name !== '' ? value.license.name : null,
    openIssues: value.open_issues_count as number,
    stars: value.stargazers_count as number,
    updatedAt: typeof value.updated_at === 'string' && Number.isFinite(Date.parse(value.updated_at))
      ? value.updated_at
      : null,
  }
}

function readRepositoryStatsCache(path: string | null, repository: string): RepositoryStatsCache | null {
  if (path === null) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isRecord(value) || value.version !== 1 || value.repository !== repository
      || typeof value.fetchedAt !== 'number' || !Number.isFinite(value.fetchedAt) || value.fetchedAt < 0
      || (value.etag !== null && typeof value.etag !== 'string')) return null
    const stats = isRecord(value.stats) ? {
      forks_count: value.stats.forks,
      language: value.stats.language,
      license: value.stats.license === null ? null : { name: value.stats.license },
      open_issues_count: value.stats.openIssues,
      stargazers_count: value.stats.stars,
      updated_at: value.stats.updatedAt,
    } : null
    const parsed = parseGitHubRepositoryStats(stats)
    if (parsed === null) return null
    return { etag: value.etag as string | null, fetchedAt: value.fetchedAt, repository, stats: parsed, version: 1 }
  } catch {
    return null
  }
}

function writeRepositoryStatsCache(path: string, cache: RepositoryStatsCache): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp-${String(process.pid)}-${Math.random().toString(36).slice(2)}`
  try {
    writeFileSync(temporary, JSON.stringify(cache) + '\n', { mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    try { if (existsSync(temporary)) rmSync(temporary) } catch {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateRepository(repository: string): void {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error(`invalid marketplace repository: ${JSON.stringify(repository)}`)
  }
}

function repositoryPathSegments(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error(`invalid repository file path: ${JSON.stringify(path)}`)
  }
  return segments
}

function repositoryContentPath(repository: string, path: string): string {
  validateRepository(repository)
  const segments = repositoryPathSegments(path)
  return `repos/${repository}/contents/${segments.map(encodeURIComponent).join('/')}`
}

function repositoryRawUrl(repository: string, path: string): string {
  validateRepository(repository)
  const segments = repositoryPathSegments(path)
  return `https://raw.githubusercontent.com/${repository}/HEAD/${segments.map(encodeURIComponent).join('/')}`
}

function catalogCachePath(
  environment: NodeJS.ProcessEnv,
  appDataPath = environment.DSH_DESKTOP_APP_DATA,
): string | null {
  if (appDataPath === undefined || appDataPath === '') return null
  return join(appDataPath, 'plugin-marketplace', 'catalog-cache.json')
}

function readCatalogCache(path: string | null, locator: string): CatalogCache | null {
  if (path === null) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isRecord(value)
      || value.version !== CATALOG_CACHE_VERSION
      || value.locator !== locator
      || typeof value.fetchedAt !== 'number'
      || !Number.isFinite(value.fetchedAt)
      || value.fetchedAt < 0
      || (value.etag !== null && typeof value.etag !== 'string')
      || !Object.hasOwn(value, 'document')) {
      return null
    }
    parseMarketplaceCatalog(value.document)
    return {
      document: value.document,
      etag: value.etag as string | null,
      fetchedAt: value.fetchedAt,
      locator,
      version: CATALOG_CACHE_VERSION,
    }
  } catch {
    return null
  }
}

function writeCatalogCache(path: string | null, cache: CatalogCache): void {
  if (path === null) return
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp-${String(process.pid)}`
  writeFileSync(temporary, JSON.stringify(cache) + '\n', { mode: 0o600 })
  renameSync(temporary, path)
}

function commandError(command: string, args: readonly string[], stderr: string, stdout: string): Error {
  const detail = stderr.trim() || stdout.trim() || 'command returned a non-zero status'
  return new Error(`${command} ${args.join(' ')} failed: ${detail}`)
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<{ stderr: string; stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const consume = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.length
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        finish(() => { reject(new Error(`${command} produced too much output`)) })
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => { consume(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { consume(stderr, chunk) })
    child.once('error', (error) => { finish(() => { reject(error) }) })
    child.once('exit', (code, signal) => {
      finish(() => {
        const out = Buffer.concat(stdout).toString('utf8')
        const err = Buffer.concat(stderr).toString('utf8')
        if (code === 0) resolve({ stderr: err, stdout: out })
        else reject(commandError(command, args, err, `${out}\nsignal=${String(signal)}`))
      })
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => { reject(new Error(`${command} timed out after ${String(options.timeoutMs ?? 120_000)} ms`)) })
    }, options.timeoutMs ?? 120_000)
  })
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function assertWithin(root: string, target: string): void {
  const child = relative(resolve(root), resolve(target))
  if (child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))) {
    return
  }
  throw new Error(`marketplace build path escapes its preview sandbox: ${target}`)
}

/** Resolve gh without invoking a shell or changing the user's Git config. */
export function findGitHubCli(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  isExecutable: (path: string) => boolean = executable,
): string | null {
  const explicit = environment.DSH_DESKTOP_GH_PATH
  if (explicit !== undefined && isExecutable(explicit)) return explicit
  const paths = platform === 'win32' ? win32 : posix
  const executableNames = platform === 'win32' ? ['gh.exe', 'gh.cmd', 'gh'] : ['gh']
  const candidates = [
    ...(environment.PATH ?? (platform === 'win32' ? environment.Path : undefined) ?? '')
      .split(paths.delimiter)
      .filter(Boolean)
      .flatMap(directory => executableNames.map(name => paths.join(directory, name))),
    ...(platform === 'darwin' ? ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'] : []),
    ...(platform === 'linux' ? ['/usr/local/bin/gh', '/usr/bin/gh'] : []),
  ]
  return candidates.find((candidate, index) => candidates.indexOf(candidate) === index && isExecutable(candidate)) ?? null
}

function withoutCommandLineGitConfig(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...environment }
  for (const key of Object.keys(clean)) {
    if (key === 'GIT_CONFIG_COUNT' || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) {
      delete clean[key]
    }
  }
  return clean
}

function gitConfigString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** Let child git processes ask gh without changing the user's Git config. */
export function withGitHubCredentials(
  environment: NodeJS.ProcessEnv,
  ghPath: string | null,
  appDataPath = environment.DSH_DESKTOP_APP_DATA,
): NodeJS.ProcessEnv {
  const clean = withoutCommandLineGitConfig(environment)
  if (ghPath === null) return clean
  if (appDataPath === undefined || appDataPath === '') return clean
  const directory = join(appDataPath, 'plugin-marketplace')
  const configPath = join(directory, 'gitconfig')
  const temporary = `${configPath}.tmp-${String(process.pid)}`
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(temporary, [
    '[credential "https://github.com"]',
    `\thelper = !${gitConfigString(ghPath)} auth git-credential`,
    '',
  ].join('\n'), { mode: 0o600 })
  renameSync(temporary, configPath)
  return {
    ...clean,
    GIT_CONFIG_GLOBAL: configPath,
  }
}

function seatbeltString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

/** Deny writes outside the disposable preview tree while allowing DSH to run. */
export function previewSandboxPolicy(root: string): string {
  const writableRoots = new Set([resolve(root)])
  if (existsSync(root)) writableRoots.add(realpathSync(root))
  const writablePaths = [...writableRoots]
    .flatMap(path => [path, join(path, '.tmp')])
    .map(path => `(subpath "${seatbeltString(path)}")`)
    .join(' ')
  return [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow file-read*)',
    '(allow network*)',
    '(allow mach-lookup)',
    '(allow sysctl-read)',
    `(allow file-write* (literal "/dev/null") ${writablePaths})`,
  ].join('')
}

export interface PreviewRuntimeLauncherInput {
  pathExists?: (path: string) => boolean
  platform?: NodeJS.Platform
  root: string
  sandbox?: string | undefined
}

/** Seatbelt on macOS, Landlock on Linux, otherwise fail closed. */
export function previewRuntimeLauncher(
  input: PreviewRuntimeLauncherInput,
): { args: string[]; command: string } {
  const platform = input.platform ?? process.platform
  const pathExists = input.pathExists ?? existsSync
  const sandbox = input.sandbox
    ?? (platform === 'darwin' ? '/usr/bin/sandbox-exec' : undefined)
  if (platform === 'darwin') {
    if (sandbox === undefined || !pathExists(sandbox)) {
      throw new Error(
        `scripted marketplace previews require a write-restricted process sandbox, which is unavailable on ${platform}`,
      )
    }
    return {
      args: ['-p', previewSandboxPolicy(input.root)],
      command: sandbox,
    }
  }
  if (platform === 'linux' && sandbox !== undefined && pathExists(sandbox)) {
    return {
      command: sandbox,
      args: ['--ro', '/', '--rw', input.root, '--rw', '/dev/null', '--'],
    }
  }
  throw new Error(
    `scripted marketplace previews require a write-restricted process sandbox, which is unavailable on ${platform}`,
  )
}

interface PreviewScriptCommandInput extends PreviewRuntimeLauncherInput {
  nodeArguments: string[]
  nodeBinary: string
}

/** Select a write-restricted launcher or reject the scripted preview. */
export function previewScriptCommand(
  input: PreviewScriptCommandInput,
): { args: string[]; command: string } {
  const launcher = previewRuntimeLauncher(input)
  return {
    args: [...launcher.args, input.nodeBinary, ...input.nodeArguments],
    command: launcher.command,
  }
}

export class ProductionMarketplacePlatform implements MarketplacePlatform {
  readonly scriptSandboxAvailable: boolean
  readonly #ghPath: string | null
  readonly #options: ProductionMarketplacePlatformOptions

  constructor(options: ProductionMarketplacePlatformOptions) {
    this.#options = options
    this.scriptSandboxAvailable = process.platform === 'darwin'
      ? existsSync('/usr/bin/sandbox-exec')
      : process.platform === 'linux' && options.sandboxLauncher !== undefined
    this.#ghPath = findGitHubCli(options.env)
  }

  async authStatus(): Promise<MarketplaceAuthResult> {
    if (this.#ghPath === null) {
      return {
        detail: 'Install GitHub CLI and run `gh auth login` to browse private organization plugins.',
        status: 'missing-cli',
      }
    }
    try {
      await runCommand(this.#ghPath, ['auth', 'status', '--hostname', 'github.com'], {
        env: this.#options.env,
        timeoutMs: 15_000,
      })
      return { detail: 'Authenticated with GitHub CLI.', status: 'ready' }
    } catch (error) {
      return {
        detail: error instanceof Error ? error.message : String(error),
        status: 'signed-out',
      }
    }
  }

  async buildBundle(input: BundleBuildInput): Promise<void> {
    assertWithin(input.sandboxRoot, input.checkout)
    const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']
    const allowed = new Set(lifecycle)
    if (input.scripts.length === 0 || input.scripts.some(script => !allowed.has(script))) {
      throw new Error('marketplace bundle build contains an unreviewed lifecycle script')
    }
    const temporary = join(input.sandboxRoot, '.tmp')
    const store = join(input.sandboxRoot, '.pnpm-store')
    mkdirSync(temporary, { recursive: true, mode: 0o700 })
    mkdirSync(store, { recursive: true, mode: 0o700 })
    const env = withGitHubCredentials({
      ...this.#options.env,
      CI: 'true',
      DSH_DESKTOP_APP_DATA: input.sandboxRoot,
      DSH_DESKTOP_PREVIEW: '1',
      HOME: input.sandboxRoot,
      TMPDIR: temporary,
    }, this.#ghPath)
    const requested = new Set(input.scripts)
    const commands = [
      {
        args: [
          this.#options.pnpmEntry,
          'install',
          '--ignore-scripts',
          existsSync(join(input.checkout, 'pnpm-lock.yaml'))
            ? '--frozen-lockfile'
            : '--no-frozen-lockfile',
          '--store-dir',
          store,
        ],
        label: 'pnpm install --ignore-scripts',
      },
      ...lifecycle
        .filter(script => requested.has(script))
        .map(script => ({
          args: [
            this.#options.pnpmEntry,
            '--config.enable-pre-post-scripts=false',
            'run',
            script,
          ],
          label: `pnpm run ${script}`,
        })),
    ]
    for (const command of commands) {
      const launcher = input.sandboxed === false
        ? { command: this.#options.nodeBinary, args: command.args }
        : previewScriptCommand({
          nodeArguments: command.args,
          nodeBinary: this.#options.nodeBinary,
          root: input.sandboxRoot,
          sandbox: this.#options.sandboxLauncher,
        })
      this.#options.onLog?.(`marketplace build: ${command.label}`)
      const result = await runCommand(launcher.command, launcher.args, {
        cwd: input.checkout,
        env,
        timeoutMs: 300_000,
      })
      if (result.stdout.trim() !== '') this.#options.onLog?.(result.stdout.trim())
      if (result.stderr.trim() !== '') this.#options.onLog?.(result.stderr.trim())
    }
  }

  async loadCatalog(options: LoadCatalogOptions = {}): Promise<unknown> {
    const locator = this.#options.env.OH_DSH_MARKETPLACE_CATALOG
      ?? `${MARKETPLACE_CATALOG_REPOSITORY}/${MARKETPLACE_CATALOG_PATH}`
    const match = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(.+)$/.exec(locator)
    if (match === null) {
      throw new Error('OH_DSH_MARKETPLACE_CATALOG must be owner/repository/path')
    }
    validateRepository(match[1] ?? '')
    const repository = match[1] ?? ''
    const path = match[2] ?? ''
    const contentPath = repositoryContentPath(repository, path)
    const cachePath = catalogCachePath(
      this.#options.env,
      this.#options.appDataPath ?? this.#options.env.DSH_DESKTOP_APP_DATA,
    )
    const cached = readCatalogCache(cachePath, locator)
    const now = this.#options.now?.() ?? Date.now()
    const age = cached === null ? Number.POSITIVE_INFINITY : now - cached.fetchedAt
    if (options.force !== true && cached !== null
      && age >= 0 && age < MARKETPLACE_CATALOG_CACHE_TTL_MS) {
      this.#options.onLog?.('marketplace catalog: using fresh local cache')
      return cached.document
    }
    const save = (document: unknown, etag: string | null): void => {
      if (this.#options.cacheReadOnly === true) return
      try {
        writeCatalogCache(cachePath, {
          document,
          etag,
          fetchedAt: now,
          locator,
          version: CATALOG_CACHE_VERSION,
        })
      } catch (error) {
        this.#options.onLog?.(`marketplace catalog: failed to update local cache: ${String(error)}`)
      }
    }
    const stale = (cache: CatalogCache, reason: unknown): unknown => {
      this.#options.onLog?.(`marketplace catalog: using stale local cache after refresh failed: ${String(reason)}`)
      return cache.document
    }
    const request = this.#options.fetch ?? globalThis.fetch
    let publicError: unknown
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': 'oh-dsh-desktop',
      }
      if (cached?.etag !== null && cached?.etag !== undefined) {
        headers['if-none-match'] = cached.etag
      }
      const response = await request(repositoryRawUrl(repository, path), {
        headers,
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status === 304 && cached !== null) {
        save(cached.document, response.headers.get('etag') ?? cached.etag)
        return cached.document
      }
      if (!response.ok) throw new Error(`GitHub Raw catalog request failed with HTTP ${String(response.status)}`)
      const document = JSON.parse(await response.text()) as unknown
      parseMarketplaceCatalog(document)
      save(document, response.headers.get('etag'))
      return document
    } catch (error) {
      publicError = error
    }
    if (this.#ghPath !== null) {
      try {
        const result = await runCommand(this.#ghPath, [
          'api',
          contentPath,
          '-H',
          'Accept: application/vnd.github.raw+json',
        ], { ...(this.#options.cwd === undefined ? {} : { cwd: this.#options.cwd }), env: this.#options.env, timeoutMs: 30_000 })
        const document = JSON.parse(result.stdout) as unknown
        parseMarketplaceCatalog(document)
        save(document, null)
        return document
      } catch (authenticatedError) {
        const failure = new Error(
          `failed to load marketplace catalog anonymously (${String(publicError)}) or with GitHub CLI (${String(authenticatedError)})`,
        )
        if (cached !== null) return stale(cached, failure)
        throw failure
      }
    }
    if (cached !== null) return stale(cached, publicError)
    throw new Error(`failed to load public marketplace catalog: ${String(publicError)}`)
  }

  async loadRepositoryStats(repository: string): Promise<MarketplaceRepositoryStats | null> {
    validateRepository(repository)
    const catalogPath = catalogCachePath(
      this.#options.env,
      this.#options.appDataPath ?? this.#options.env.DSH_DESKTOP_APP_DATA,
    )
    const cachePath = catalogPath === null
      ? null
      : join(dirname(catalogPath), 'repository-stats', `${repository.replace('/', '--')}.json`)
    const cached = readRepositoryStatsCache(cachePath, repository)
    const now = this.#options.now?.() ?? Date.now()
    const age = cached === null ? Number.POSITIVE_INFINITY : now - cached.fetchedAt
    if (cached !== null && age >= 0 && age < MARKETPLACE_REPOSITORY_STATS_CACHE_TTL_MS) {
      return cached.stats
    }

    const save = (entry: RepositoryStatsCache): void => {
      if (this.#options.cacheReadOnly === true || cachePath === null) return
      try {
        writeRepositoryStatsCache(cachePath, entry)
      } catch (error) {
        this.#options.onLog?.(`marketplace repository stats: failed to update local cache: ${String(error)}`)
      }
    }

    try {
      const headers: Record<string, string> = {
        accept: 'application/vnd.github+json',
        'user-agent': 'oh-dsh-desktop',
        'x-github-api-version': '2022-11-28',
      }
      if (cached?.etag !== null && cached?.etag !== undefined) headers['if-none-match'] = cached.etag
      const response = await (this.#options.fetch ?? globalThis.fetch)(
        `https://api.github.com/repos/${repository}`,
        { headers, signal: AbortSignal.timeout(30_000) },
      )
      if (response.status === 304 && cached !== null) {
        save({ ...cached, etag: response.headers.get('etag') ?? cached.etag, fetchedAt: now })
        return cached.stats
      }
      if (!response.ok) throw new Error(`GitHub repository request failed with HTTP ${String(response.status)}`)
      const stats = parseGitHubRepositoryStats(await response.json())
      if (stats === null) throw new Error('GitHub repository response omitted valid statistics')
      save({ etag: response.headers.get('etag'), fetchedAt: now, repository, stats, version: 1 })
      return stats
    } catch (error) {
      if (cached !== null) {
        this.#options.onLog?.(`marketplace repository ${repository}: using stale cache after refresh failed: ${String(error)}`)
        return cached.stats
      }
      this.#options.onLog?.(`marketplace repository metadata unavailable for ${repository}: ${String(error)}`)
      return null
    }
  }

  async resolveCommit(repository: string): Promise<string> {
    validateRepository(repository)
    const gh = this.requireGitHubCli()
    const result = await runCommand(gh, [
      'api',
      `repos/${repository}/commits/HEAD`,
      '--jq',
      '.sha',
    ], { env: this.#options.env, timeoutMs: 30_000 })
    const commit = result.stdout.trim()
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`GitHub returned an invalid commit for ${repository}`)
    return commit
  }

  async readRepositoryFile(repository: string, path: string, commit: string): Promise<string | null> {
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('repository commit must be a full SHA')
    const gh = this.requireGitHubCli()
    try {
      const result = await runCommand(gh, [
        'api',
        `${repositoryContentPath(repository, path)}?ref=${commit}`,
        '--jq',
        '.content',
      ], { env: this.#options.env, timeoutMs: 30_000 })
      return Buffer.from(result.stdout.replaceAll(/\s/g, ''), 'base64').toString('utf8')
    } catch (error) {
      if (error instanceof Error && /404|Not Found/i.test(error.message)) return null
      throw error
    }
  }

  async cloneRepository(repository: string, commit: string, target: string): Promise<void> {
    validateRepository(repository)
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('repository commit must be a full SHA')
    const gh = this.requireGitHubCli()
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    await runCommand(gh, [
      'repo',
      'clone',
      repository,
      target,
      '--',
      '--filter=blob:none',
      '--no-checkout',
    ], { env: this.#options.env, timeoutMs: 120_000 })
    await runCommand('git', ['-C', target, 'checkout', '--detach', commit], {
      env: withGitHubCredentials(
        this.#options.env,
        gh,
        this.#options.appDataPath ?? this.#options.env.DSH_DESKTOP_APP_DATA,
      ),
      timeoutMs: 60_000,
    })
  }

  async runDsh(input: DshCommandInput): Promise<void> {
    const sandboxed = input.sandboxed !== false
    const temporary = join(input.sandboxRoot, '.tmp')
    if (sandboxed) mkdirSync(temporary, { recursive: true, mode: 0o700 })
    const env = withGitHubCredentials({
      ...this.#options.env,
      DSH_DESKTOP_APP_DATA: input.sandboxRoot,
      ...(sandboxed ? { DSH_DESKTOP_PREVIEW: '1', TMPDIR: temporary } : {}),
      DSH_HOME: input.dshHome,
    }, this.#ghPath)
    const nodeArguments = [this.#options.cliEntry, ...input.args]
    const launcher = sandboxed
      ? previewScriptCommand({
        nodeArguments,
        nodeBinary: this.#options.nodeBinary,
        root: input.sandboxRoot,
        sandbox: this.#options.sandboxLauncher,
      })
      : { command: this.#options.nodeBinary, args: nodeArguments }
    const command = launcher.command
    const args = launcher.args
    this.#options.onLog?.(`marketplace command: dsh ${input.args.join(' ')}`)
    const result = await runCommand(command, args, {
      ...(this.#options.cwd === undefined ? {} : { cwd: this.#options.cwd }),
      env,
      timeoutMs: 180_000,
    })
    if (result.stdout.trim() !== '') this.#options.onLog?.(result.stdout.trim())
    if (result.stderr.trim() !== '') this.#options.onLog?.(result.stderr.trim())
  }

  private requireGitHubCli(): string {
    if (this.#ghPath === null) throw new Error('GitHub CLI is unavailable; install gh and run `gh auth login`')
    return this.#ghPath
  }
}

/** Stable preview temp root used by tests and UI diagnostics. */
export function defaultPreviewTemporaryRoot(): string {
  return join(tmpdir(), 'oh-dsh-plugin-preview')
}
// weave: run 'weave explain plugins/plugin-marketplace/src/host/platform.ts' for per-hunk detail, 'weave check' to verify your resolution
