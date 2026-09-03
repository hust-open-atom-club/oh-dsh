import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import type { Stats } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parseMarketplaceCatalog } from '../catalog.ts'
import type {
  MarketplaceAction,
  MarketplaceCommand,
  MarketplaceConfirmation,
  MarketplaceInstalledPlugin,
  MarketplacePlan,
  MarketplacePlugin,
  MarketplacePreview,
  MarketplaceRiskLevel,
  MarketplaceRiskReason,
  MarketplaceSnapshot,
  MarketplaceSourceLock,
  MarketplaceSourceReview,
} from '../protocol.ts'
import {
  isProtectedMarketplacePlugin,
} from '../protocol.ts'
import type { MarketplacePlatform } from './platform.ts'

const STATE_VERSION = 2

const MANAGED_DIRECTORY = '.oh-dsh'

const STATE_FILE = 'marketplace.json'

const PATCH_BEGIN = '# >>> Oh-DSH-Desktop plugin marketplace'

const PATCH_END = '# <<< Oh-DSH-Desktop plugin marketplace'

const BUILD_BEGIN = '# >>> Oh-DSH-Desktop allowed plugin builds'

const BUILD_END = '# <<< Oh-DSH-Desktop allowed plugin builds'

interface MarketplaceStateFile {
  entries: MarketplaceInstalledPlugin[]
  locks: MarketplaceSourceLock[]
  version: 2
}

interface RollbackState {
  appliedAt: string
  backupProfile: string
  pluginId: string
  transactionId: string
}

interface ActivePreview {
  candidateHome: string
  candidateProfile: string
  preview: MarketplacePreview
  root: string
}

export interface MarketplacePreviewRuntimeInput {
  dshHome: string
  pluginId: string
  sandboxRoot: string
  sandboxed: boolean
  transactionId: string
}

/** Facts a preview runtime reports back after becoming ready. */
export interface MarketplacePreviewRuntimeResult {
  url?: string
}

/** Runtime/window operations injected by Electron and replaced in tests. */
export interface MarketplaceRuntime {
  startLive(): Promise<void>
  startPreview(input: MarketplacePreviewRuntimeInput): Promise<MarketplacePreviewRuntimeResult>
  stopLive(): Promise<void>
  stopPreview(): Promise<void>
}

export type MarketplaceDispatchPrincipal = 'human-ui' | 'agent'

export interface PluginMarketplaceOptions {
  appDataPath: string
  dshHome: string
  onWarn?: (message: string) => void
  platform: MarketplacePlatform
  profile: string
  /** Viewer mode: browse snapshots, refuse every mutating dispatch. */
  readOnly?: boolean
  runtime: MarketplaceRuntime
}

interface PackageManifest {
  dependencies?: unknown
  dsh?: {
    bundle?: { patch?: unknown }
    profile?: { bundles?: unknown }
  }
  name?: unknown
  scripts?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp-${String(process.pid)}-${randomUUID()}`
  writeFileSync(temporary, JSON.stringify(value, undefined, 2) + '\n', { mode: 0o600 })
  renameSync(temporary, path)
}

function validateInstalledEntry(value: unknown): value is MarketplaceInstalledPlugin {
  if (!isRecord(value)) return false
  return typeof value.pluginId === 'string'
    && /^[A-Za-z0-9_.-]{1,100}$/.test(value.pluginId)
    && (value.mechanism === 'bundle' || value.mechanism === 'repository')
    && (value.packageName === null || typeof value.packageName === 'string')
    && typeof value.resolvedCommit === 'string'
    && /^[0-9a-f]{40}$/.test(value.resolvedCommit)
    && typeof value.source === 'string'
    && typeof value.installedAt === 'string'
}

function validateSourceLock(value: unknown): value is MarketplaceSourceLock {
  if (!isRecord(value)) return false
  return typeof value.canonicalSource === 'string'
    && typeof value.firstSeenCommit === 'string'
    && /^[0-9a-f]{40}$/.test(value.firstSeenCommit)
    && typeof value.manifestHash === 'string'
    && /^[0-9a-f]{64}$/.test(value.manifestHash)
    && (value.mechanism === 'bundle' || value.mechanism === 'repository')
    && typeof value.packageName === 'string'
    && typeof value.pluginId === 'string'
    && /^[A-Za-z0-9_.-]{1,100}$/.test(value.pluginId)
    && typeof value.recordedAt === 'string'
    && typeof value.resolvedCommit === 'string'
    && /^[0-9a-f]{40}$/.test(value.resolvedCommit)
}

function readMarketplaceState(profileDir: string): MarketplaceStateFile {
  const path = join(profileDir, MANAGED_DIRECTORY, STATE_FILE)
  if (!existsSync(path)) return { entries: [], locks: [], version: STATE_VERSION }
  try {
    const parsed = readJson(path)
    if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
      throw new Error('unsupported marketplace state version')
    }
    if (parsed.version === 1) {
      return {
        entries: parsed.entries.filter(validateInstalledEntry),
        locks: [],
        version: STATE_VERSION,
      }
    }
    if (parsed.version !== STATE_VERSION || !Array.isArray(parsed.locks)) {
      throw new Error('unsupported marketplace state version')
    }
    return {
      entries: parsed.entries.filter(validateInstalledEntry),
      locks: parsed.locks.filter(validateSourceLock),
      version: STATE_VERSION,
    }
  } catch (error) {
    throw new Error(`failed to read plugin marketplace state at ${path}: ${message(error)}`)
  }
}

function writeMarketplaceState(profileDir: string, state: MarketplaceStateFile): void {
  writeJsonAtomic(join(profileDir, MANAGED_DIRECTORY, STATE_FILE), {
    entries: state.entries,
    locks: state.locks,
    version: STATE_VERSION,
  } satisfies MarketplaceStateFile)
}

function manifestHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function canonicalSource(repository: string): string {
  return `github:${repository}`
}

function sourceReview(
  lock: MarketplaceSourceLock | undefined,
  input: Pick<MarketplacePlan,
    'manifestHash' | 'mechanism' | 'packageName' | 'pluginId' | 'repository' | 'resolvedCommit'>,
  installed?: MarketplaceInstalledPlugin,
): MarketplaceSourceReview {
  if (lock === undefined) {
    if (installed === undefined) return 'first-use'
    return repositoryFromSource(installed.source) === input.repository
      && installed.mechanism === input.mechanism
      && installed.packageName === input.packageName
      ? 'matched'
      : 'changed'
  }
  if (lock.resolvedCommit === input.resolvedCommit
    && lock.manifestHash !== input.manifestHash) {
    throw new Error(`${input.pluginId} changed content at pinned commit ${input.resolvedCommit}`)
  }
  return lock.canonicalSource === canonicalSource(input.repository)
    && lock.mechanism === input.mechanism
    && lock.packageName === input.packageName
    ? 'matched'
    : 'changed'
}

function assessRisk(input: {
  action: MarketplaceAction
  buildScripts: Record<string, string>
  mechanism: MarketplacePlan['mechanism']
  protectedPlugin: boolean
  sandboxAvailable: boolean
  sourceReview: MarketplaceSourceReview
}): {
  requirements: MarketplaceConfirmation[]
  riskLevel: MarketplaceRiskLevel
  riskReasons: MarketplaceRiskReason[]
} {
  if (input.protectedPlugin) {
    return {
      requirements: [],
      riskLevel: 'blocked',
      riskReasons: ['protected-plugin'],
    }
  }
  const reasons: MarketplaceRiskReason[] = []
  const requirements: MarketplaceConfirmation[] = []
  const activatesCode = input.action === 'install'
    || input.action === 'update'
    || input.action === 'enable'
  if (activatesCode && input.mechanism === 'repository') {
    reasons.push('trusted-host-code')
    requirements.push('accept-high-risk')
  }
  if (activatesCode && Object.keys(input.buildScripts).length > 0) {
    reasons.push('install-scripts')
    requirements.push('allow-build-scripts')
    if (!input.sandboxAvailable) requirements.push('accept-unsandboxed-build')
  }
  if (input.sourceReview === 'changed') {
    reasons.push('source-change')
    requirements.push('accept-source-change')
  }
  const riskLevel: MarketplaceRiskLevel = reasons.includes('source-change')
    || reasons.includes('trusted-host-code')
    ? 'high'
    : reasons.length > 0 ? 'elevated' : 'low'
  return { requirements, riskLevel, riskReasons: reasons }
}

function sourceLockFromPlan(
  plan: MarketplacePlan,
  previous: MarketplaceSourceLock | undefined,
): MarketplaceSourceLock {
  if (plan.packageName === null) throw new Error('source lock requires a package name')
  return {
    canonicalSource: canonicalSource(plan.repository),
    firstSeenCommit: previous?.firstSeenCommit ?? plan.resolvedCommit,
    manifestHash: plan.manifestHash,
    mechanism: plan.mechanism,
    packageName: plan.packageName,
    pluginId: plan.pluginId,
    recordedAt: previous?.recordedAt ?? new Date().toISOString(),
    resolvedCommit: plan.resolvedCommit,
  }
}

function parsePackageManifest(text: string, path: string): PackageManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${message(error)}`)
  }
  if (!isRecord(parsed)) throw new Error(`${path} must contain an object`)
  return parsed as PackageManifest
}

function buildScripts(manifest: PackageManifest): Record<string, string> {
  if (!isRecord(manifest.scripts)) return {}
  const executable = new Set(['preinstall', 'install', 'postinstall', 'prepare', 'prepack'])
  return Object.fromEntries(Object.entries(manifest.scripts)
    .filter((entry): entry is [string, string] => executable.has(entry[0]) && typeof entry[1] === 'string'))
}

function packageName(manifest: PackageManifest, path: string): string {
  if (typeof manifest.name !== 'string' || !/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(manifest.name)) {
    throw new Error(`${path} must declare a valid package name`)
  }
  return manifest.name
}

function profileManifest(profileDir: string): PackageManifest {
  const path = join(profileDir, 'package.json')
  const manifest = readJson(path)
  if (!isRecord(manifest)) throw new Error(`${path} must contain an object`)
  return manifest as PackageManifest
}

function profileBundles(manifest: PackageManifest): string[] {
  const bundles = manifest.dsh?.profile?.bundles
  return Array.isArray(bundles)
    ? bundles.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function bundleInstalled(profileDir: string, packageNameValue: string | null): boolean {
  if (packageNameValue === null) return false
  const dependencies = profileManifest(profileDir).dependencies
  return isRecord(dependencies) && typeof dependencies[packageNameValue] === 'string'
}

function bundleEnabled(profileDir: string, packageNameValue: string | null): boolean {
  return packageNameValue !== null
    && profileBundles(profileManifest(profileDir)).includes(packageNameValue)
}

function setBundleEnabled(
  profileDir: string,
  packageNameValue: string,
  enabled: boolean,
): void {
  const path = join(profileDir, 'package.json')
  const manifest = profileManifest(profileDir)
  if (!isRecord(manifest.dsh)) manifest.dsh = {}
  if (!isRecord(manifest.dsh.profile)) manifest.dsh.profile = {}
  const current = profileBundles(manifest)
  manifest.dsh.profile.bundles = enabled
    ? current.includes(packageNameValue) ? current : [...current, packageNameValue]
    : current.filter(entry => entry !== packageNameValue)
  writeJsonAtomic(path, manifest)
}

function removeMarkedBlock(text: string, begin: string, end: string): string {
  const start = text.indexOf(begin)
  if (start < 0) return text
  const finish = text.indexOf(end, start)
  if (finish < 0) throw new Error(`managed configuration block is missing ${end}`)
  const after = finish + end.length
  return `${text.slice(0, start).trimEnd()}\n${text.slice(after).trimStart()}`.trimEnd() + '\n'
}

function repositorySources(text: string): string[] {
  const result = new Set<string>()
  for (const match of text.matchAll(/github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[^\s'"\]]+/g)) {
    result.add(match[0])
  }
  return [...result]
}

function repositoryFromSource(source: string): string | null {
  const match = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#/.exec(source)
  return match?.[1] ?? null
}

function repositoryEnabled(
  profileDir: string,
  entry: MarketplaceInstalledPlugin,
): boolean {
  const path = join(profileDir, 'cordis.patch.yml')
  const patch = existsSync(path) ? readFileSync(path, 'utf8') : ''
  return repositorySources(patch).includes(entry.source)
}

function installedEntryEnabled(
  profileDir: string,
  entry: MarketplaceInstalledPlugin,
): boolean {
  return entry.mechanism === 'bundle'
    ? bundleEnabled(profileDir, entry.packageName)
    : repositoryEnabled(profileDir, entry)
}

function yamlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function patchWithRootList(text: string, addingEntries: boolean): string {
  const lines = text.trimEnd().split('\n')
  if (addingEntries) {
    return lines.filter(line => line.trim() !== '[]').join('\n').trimEnd()
  }
  const semantic = lines.filter(line => line.trim() !== '' && !line.trimStart().startsWith('#'))
  if (semantic.length > 0) return lines.join('\n').trimEnd() + '\n'
  return [...lines, '[]'].join('\n').trim() + '\n'
}

function updateRepositoryPatch(
  profileDir: string,
  entries: readonly MarketplaceInstalledPlugin[],
  enabledOverrides: ReadonlyMap<string, boolean> = new Map(),
): void {
  const path = join(profileDir, 'cordis.patch.yml')
  const original = existsSync(path) ? readFileSync(path, 'utf8') : '[]\n'
  const withoutManaged = removeMarkedBlock(original, PATCH_BEGIN, PATCH_END)
  const enabledSources = new Set(repositorySources(original))
  const marketplaceSources = entries
    .filter(entry => entry.mechanism === 'repository')
    .filter(entry => enabledOverrides.get(entry.pluginId)
      ?? enabledSources.has(entry.source))
    .map(entry => entry.source)
  if (marketplaceSources.length === 0) {
    writeFileSync(path, patchWithRootList(withoutManaged, false), { mode: 0o600 })
    return
  }
  const sources = [...new Set([...repositorySources(withoutManaged), ...marketplaceSources])]
  const block = [
    PATCH_BEGIN,
    '- id: repository-plugins',
    '  config:',
    '    repositories:',
    ...sources.map(source => `      - ${yamlString(source)}`),
    PATCH_END,
    '',
  ].join('\n')
  const normalizedBase = patchWithRootList(withoutManaged, true)
  const base = normalizedBase === '' ? '' : normalizedBase + '\n\n'
  writeFileSync(path, base + block, { mode: 0o600 })
}

function allowBuild(profileDir: string, packageNameValue: string): void {
  const path = join(profileDir, 'pnpm-workspace.yaml')
  const original = existsSync(path) ? readFileSync(path, 'utf8') : 'packages:\n  - .\n'
  const clean = removeMarkedBlock(original, BUILD_BEGIN, BUILD_END)
  const escapedName = packageNameValue.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`^\\s{2,}${escapedName}:\\s*true\\s*$`, 'm').test(clean)
    || new RegExp(`^\\s{2,}${yamlString(packageNameValue).replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*true\\s*$`, 'm').test(clean)) {
    writeFileSync(path, clean, { mode: 0o600 })
    return
  }
  const lines = clean.trimEnd().split('\n')
  const allowIndex = lines.findIndex(line => /^allowBuilds:\s*$/.test(line))
  if (allowIndex >= 0) {
    let end = allowIndex + 1
    while (end < lines.length && (lines[end]?.trim() === '' || /^\s/.test(lines[end] ?? ''))) end += 1
    lines.splice(end, 0,
      `  ${BUILD_BEGIN}`,
      `  ${yamlString(packageNameValue)}: true`,
      `  ${BUILD_END}`,
    )
    writeFileSync(path, lines.join('\n') + '\n', { mode: 0o600 })
    return
  }
  lines.push(
    '',
    BUILD_BEGIN,
    'allowBuilds:',
    `  ${yamlString(packageNameValue)}: true`,
    BUILD_END,
  )
  writeFileSync(path, lines.join('\n') + '\n', { mode: 0o600 })
}

function ensureWithin(parent: string, candidate: string): void {
  const root = resolve(parent)
  const target = resolve(candidate)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`refusing filesystem operation outside ${root}: ${target}`)
  }
}

function defaultWarn(message: string): void {
  console.warn(`plugin-marketplace: ${message}`)
}

/**
 * Windows maps the read-only attribute to the owner write bit. Git packs and
 * some cloned files are created read-only, so deletion can fail with EPERM.
 * Clear that attribute before unlinking files or removing directories.
 */
function makeWritable(
  path: string,
  platform: NodeJS.Platform,
): void {
  if (platform !== 'win32') return
  try {
    const stats = lstatSync(path)
    chmodSync(path, stats.mode | 0o200)
  } catch {
    // Best-effort attribute pass; the caller reports the real failure.
  }
}

/**
 * A directory junction on Windows is a reparse point that `lstat` may report
 * as a plain directory. Detect those entries by attempting to read the link
 * target so recursive cleanup unlinks the junction instead of descending into
 * the bundled runtime it points at.
 */
function isLinkEntry(
  path: string,
  stats: Stats,
): boolean {
  if (stats.isSymbolicLink()) return true
  if (!stats.isDirectory()) return false
  try {
    readlinkSync(path)
    return true
  } catch {
    return false
  }
}

function removeLinkEntry(path: string): void {
  try {
    // unlink removes the reparse point/symlink itself on every platform and
    // never descends into the target.
    unlinkSync(path)
  } catch (error) {
    // Some Windows Node versions still require rmdir for a junction that
    // lstat reports as a directory. Removing the junction still does not
    // follow into the target.
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EISDIR' || code === 'EPERM' || code === 'ENOTEMPTY') {
      rmdirSync(path)
      return
    }
    throw error
  }
}

/**
 * Recursively delete a disposable tree without ever descending through a
 * symlink or Windows directory junction. This is the Windows-safe replacement
 * for `rmSync(..., { recursive: true })`, which can follow junctions and
 * delete files outside the tree (including the packaged dsh-runtime).
 */
function removeTreeWindows(
  path: string,
  platform: NodeJS.Platform,
): void {
  let stats: Stats
  try {
    stats = lstatSync(path)
  } catch (error) {
    // existsSync would return false for a dangling junction/symlink, so use
    // lstat and only ignore a genuinely missing entry.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (isLinkEntry(path, stats)) {
    removeLinkEntry(path)
    return
  }
  makeWritable(path, platform)
  if (stats.isDirectory()) {
    for (const entry of readdirSync(path)) {
      removeTreeWindows(join(path, entry), platform)
    }
    rmdirSync(path)
    return
  }
  unlinkSync(path)
}

function removeTree(
  path: string,
  onWarn: (message: string) => void = defaultWarn,
  platform: NodeJS.Platform = process.platform,
): void {
  try {
    if (platform === 'win32') {
      removeTreeWindows(path, platform)
    } else {
      rmSync(path, { force: true, recursive: true })
    }
  } catch (error) {
    onWarn(`failed to clean plugin marketplace tree at ${path}: ${message(error)}`)
  }
}

export function removeWithin(
  parent: string,
  candidate: string,
  onWarn: (message: string) => void = defaultWarn,
  platform: NodeJS.Platform = process.platform,
): void {
  ensureWithin(parent, candidate)
  removeTree(candidate, onWarn, platform)
}

function copyDirectory(source: string, target: string): void {
  if (!existsSync(source)) throw new Error(`source profile does not exist: ${source}`)
  if (existsSync(target)) throw new Error(`candidate profile already exists: ${target}`)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  cpSync(source, target, {
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true,
  })
}

function normalizeBundleDependency(
  profileDir: string,
  packageNameValue: string,
  checkout: string,
): void {
  ensureWithin(profileDir, checkout)
  const path = join(profileDir, 'package.json')
  const manifest = readJson(path)
  if (!isRecord(manifest) || !isRecord(manifest.dependencies)) {
    throw new Error('DSH profile package.json is missing dependencies')
  }
  const source = relative(profileDir, checkout).split(sep).join('/')
  if (source === '' || source === '..' || source.startsWith('../')) {
    throw new Error(`bundle checkout is not portable from the profile: ${checkout}`)
  }
  manifest.dependencies[packageNameValue] = `link:${source}`
  writeJsonAtomic(path, manifest)
}

function assertPortableBundleProfile(profileDir: string, previewRoot: string): void {
  for (const name of ['package.json', 'pnpm-lock.yaml']) {
    const path = join(profileDir, name)
    if (existsSync(path) && readFileSync(path, 'utf8').includes(previewRoot)) {
      throw new Error(`${name} retained an absolute path into the disposable preview`)
    }
  }
}

function cloneSnapshot(snapshot: MarketplaceSnapshot): MarketplaceSnapshot {
  return structuredClone(snapshot)
}

/**
 * Own the complete preview/apply/undo transaction behind a two-method
 * interface. Callers never manipulate profile paths or package commands.
 */
export class PluginMarketplaceManager {
  readonly #options: PluginMarketplaceOptions
  readonly #profileDir: string
  readonly #root: string
  readonly #previewsRoot: string
  readonly #rollbacksRoot: string
  readonly #rollbackStatePath: string
  #active: ActivePreview | null = null
  #busy = false
  #catalog: MarketplacePlugin[] = []
  #catalogGeneratedAt: string | null = null
  readonly #repositoryStats = new Map<string, MarketplacePlugin['stats']>()
  #auth: MarketplaceSnapshot['auth'] = {
    detail: 'Plugin catalog has not been refreshed yet.',
    status: 'error',
  }
  #error: string | null = null
  readonly #latestCommits = new Map<string, string>()
  #lastAction: string | null = null
  #plan: MarketplacePlan | null = null
  #rollback: RollbackState | null
  readonly #warn: (message: string) => void

  constructor(options: PluginMarketplaceOptions) {
    this.#options = options
    this.#warn = options.onWarn ?? defaultWarn
    this.#profileDir = join(options.dshHome, 'profiles', options.profile)
    this.#root = join(options.appDataPath, 'plugin-marketplace')
    this.#previewsRoot = join(this.#root, 'previews')
    this.#rollbacksRoot = join(this.#root, 'rollbacks')
    this.#rollbackStatePath = join(this.#rollbacksRoot, 'current.json')
    // Viewer mode shares the data root with the surface holding the runtime
    // lock, so it must not recreate preview or rollback directories.
    if (options.readOnly !== true) {
      removeTree(this.#previewsRoot, this.#warn)
      mkdirSync(this.#previewsRoot, { recursive: true, mode: 0o700 })
      mkdirSync(this.#rollbacksRoot, { recursive: true, mode: 0o700 })
    }
    this.#rollback = this.readRollback()
  }

  getSnapshot(): MarketplaceSnapshot {
    const state = readMarketplaceState(this.#profileDir)
    const receipts = state.entries
    const installed = receipts.filter(entry => entry.mechanism === 'repository'
      || bundleInstalled(this.#profileDir, entry.packageName))
    const installedById = new Map(installed.map(entry => [entry.pluginId, entry]))
    return cloneSnapshot({
      auth: this.#auth,
      busy: this.#busy,
      catalog: this.#catalog.map(plugin => {
        const receipt = installedById.get(plugin.id)
        const latestCommit = this.#latestCommits.get(plugin.id) ?? null
        const enabled = receipt === undefined
          ? false
          : receipt.mechanism === 'bundle'
            ? bundleEnabled(this.#profileDir, receipt.packageName)
            : repositoryEnabled(this.#profileDir, receipt)
        return {
          ...plugin,
          currentCommit: receipt?.resolvedCommit ?? null,
          enabled,
          installed: receipt !== undefined,
          latestCommit,
          stats: this.#repositoryStats.get(plugin.repository) ?? plugin.stats,
          updateAvailable: receipt !== undefined
            && latestCommit !== null
            && latestCommit !== receipt.resolvedCommit,
        }
      }),
      catalogGeneratedAt: this.#catalogGeneratedAt,
      error: this.#error,
      installed,
      lastAction: this.#lastAction,
      lifecycle: {
        candidate: this.#active?.preview ?? null,
        current: {
          profile: this.#options.profile,
          state: 'live',
        },
        previous: this.#rollback === null ? null : {
          appliedAt: this.#rollback.appliedAt,
          pluginId: this.#rollback.pluginId,
          transactionId: this.#rollback.transactionId,
        },
      },
      plan: this.#plan,
      preview: this.#active?.preview ?? null,
      sourceLocks: state.locks,
      undoAvailable: this.#rollback !== null,
    })
  }

  async dispatch(
    command: MarketplaceCommand,
    principal: MarketplaceDispatchPrincipal = 'human-ui',
  ): Promise<MarketplaceSnapshot> {
    if (this.#busy) return this.getSnapshot()
    if (this.#options.readOnly === true
      && command.type !== 'refresh'
      && command.type !== 'load-repository-stats') {
      this.#lastAction = command.type
      this.#error = 'The marketplace is read-only while another Oh-DSH surface holds the runtime lock.'
      return this.getSnapshot()
    }
    this.#busy = true
    this.#error = null
    try {
      switch (command.type) {
        case 'refresh':
          await this.refresh(command.force === true)
          break
        case 'load-repository-stats':
          await this.loadRepositoryStats(command.pluginId)
          break
        case 'inspect':
          await this.inspect(command.action, command.pluginId)
          break
        case 'prepare':
          await this.prepare(command.action, command.pluginId)
          break
        case 'preview':
          if (principal === 'agent' && command.confirmations?.includes('accept-unsandboxed-build')) {
            throw new Error('unsandboxed marketplace builds require direct human approval')
          }
          await this.preview(command.confirmations ?? [])
          break
        case 'discard':
          await this.discard()
          break
        case 'apply':
          await this.applyPreview()
          break
        case 'undo':
          await this.undo()
          break
        default:
          command satisfies never
      }
    } catch (error) {
      this.#error = message(error)
    } finally {
      this.#busy = false
    }
    const snapshot = this.getSnapshot()
    // The snapshot above already reports this dispatch's outcome. Clear the
    // error so later read-only snapshots (search/status polls) do not keep
    // surfacing a stale failure from a previous dispatch.
    this.#error = null
    return snapshot
  }

  private async refresh(force = false): Promise<void> {
    this.#auth = await this.#options.platform.authStatus()
    const installed = readMarketplaceState(this.#profileDir).entries
    const catalog = parseMarketplaceCatalog(await this.#options.platform.loadCatalog({ force }), installed)
    this.#catalog = catalog.plugins
    this.#catalogGeneratedAt = catalog.generatedAt
    this.#latestCommits.clear()
    this.#repositoryStats.clear()
    const available = new Map(catalog.plugins
      .filter(plugin => plugin.mechanism !== 'unsupported')
      .map(plugin => [plugin.id, plugin.repository]))
    await Promise.all(installed
      .filter(entry => available.has(entry.pluginId))
      .map(async entry => {
        try {
          this.#latestCommits.set(
            entry.pluginId,
            await this.#options.platform.resolveCommit(available.get(entry.pluginId) as string),
          )
        } catch {
          // A failed update check must not hide the installed plugin catalog.
        }
      }))
    this.#lastAction = `Loaded ${String(catalog.plugins.length)} catalog plugins.`
  }

  private async loadRepositoryStats(pluginId: string): Promise<void> {
    const plugin = this.#catalog.find(candidate => candidate.id === pluginId)
    if (plugin === undefined) throw new Error(`plugin is not present in the loaded catalog: ${pluginId}`)
    const stats = await this.#options.platform.loadRepositoryStats(plugin.repository)
    if (stats !== null) this.#repositoryStats.set(plugin.repository, stats)
  }

  private async prepare(action: MarketplaceAction, pluginId: string): Promise<void> {
    await this.inspect(action, pluginId)
    if (this.#plan?.riskLevel === 'blocked') {
      throw new Error(`${pluginId} is protected by Oh-DSH and cannot be modified by its own marketplace`)
    }
    if (this.#plan?.requirements.length === 0) await this.preview([])
  }

  private async inspect(action: MarketplaceAction, pluginId: string): Promise<void> {
    if (this.#active !== null) throw new Error('Apply or discard the current preview first.')
    const state = readMarketplaceState(this.#profileDir)
    const installed = state.entries
    const current = installed.find(entry => entry.pluginId === pluginId)
    const catalogPlugin = this.#catalog.find(plugin => plugin.id === pluginId)
    if (isProtectedMarketplacePlugin(pluginId, catalogPlugin?.repository)
      || catalogPlugin?.protected === true) {
      throw new Error(`${pluginId} is protected by Oh-DSH and cannot be modified by its own marketplace`)
    }
    if (action === 'uninstall' || action === 'enable' || action === 'disable') {
      if (current === undefined) throw new Error(`${pluginId} was not installed by this marketplace`)
      const enabled = installedEntryEnabled(this.#profileDir, current)
      if (action === 'enable' && enabled) throw new Error(`${pluginId} is already enabled`)
      if (action === 'disable' && !enabled) throw new Error(`${pluginId} is already disabled`)
      const review: MarketplaceSourceReview = state.locks.some(lock => lock.pluginId === pluginId)
        ? 'matched'
        : 'first-use'
      const risk = assessRisk({
        action,
        buildScripts: {},
        mechanism: current.mechanism,
        protectedPlugin: false,
        sandboxAvailable: this.#options.platform.scriptSandboxAvailable !== false,
        sourceReview: review,
      })
      this.#plan = {
        action,
        buildScripts: {},
        description: catalogPlugin?.description ?? `Manage ${pluginId} in the Oh-DSH profile.`,
        mechanism: current.mechanism,
        packageName: current.packageName,
        pluginId,
        manifestHash: state.locks.find(lock => lock.pluginId === pluginId)?.manifestHash ?? '',
        requirements: risk.requirements,
        repository: catalogPlugin?.repository ?? repositoryFromSource(current.source)
          ?? (() => { throw new Error(`${pluginId} has an invalid repository source`) })(),
        resolvedCommit: current.resolvedCommit,
        riskLevel: risk.riskLevel,
        riskReasons: risk.riskReasons,
        source: current.source,
        sourceReview: review,
      }
      return
    }
    if (action === 'install' && current !== undefined) {
      throw new Error(`${pluginId} is already installed`)
    }
    if (action === 'update' && current === undefined) {
      throw new Error(`${pluginId} is not installed`)
    }
    if (catalogPlugin === undefined) throw new Error(`plugin is not present in the loaded catalog: ${pluginId}`)
    if (catalogPlugin.mechanism === 'unsupported') {
      throw new Error(`${pluginId} does not use a preview-safe bundle or repository package`)
    }
    const commit = await this.#options.platform.resolveCommit(catalogPlugin.repository)
    this.#latestCommits.set(pluginId, commit)
    if (action === 'update' && current?.resolvedCommit === commit) {
      throw new Error(`${pluginId} is already at the latest commit`)
    }
    let resolvedMechanism: MarketplacePlan['mechanism'] | null =
      catalogPlugin.mechanism === 'bundle' || catalogPlugin.mechanism === 'repository'
        ? catalogPlugin.mechanism
        : null
    let manifestPath = resolvedMechanism === 'repository'
      ? '.dsh-plugin/package.json'
      : 'package.json'
    let manifestText = await this.#options.platform.readRepositoryFile(
      catalogPlugin.repository,
      manifestPath,
      commit,
    )
    if (catalogPlugin.mechanism === 'discover') {
      const bundleText = manifestText
      if (bundleText !== null) {
        const bundleManifest = parsePackageManifest(bundleText, `${pluginId}/package.json`)
        if (isRecord(bundleManifest.dsh) && isRecord(bundleManifest.dsh.bundle)
          && typeof bundleManifest.dsh.bundle.patch === 'string') {
          resolvedMechanism = 'bundle'
        } else {
          manifestPath = '.dsh-plugin/package.json'
          manifestText = await this.#options.platform.readRepositoryFile(
            catalogPlugin.repository,
            manifestPath,
            commit,
          )
          resolvedMechanism = manifestText === null ? null : 'repository'
        }
      } else {
        manifestPath = '.dsh-plugin/package.json'
        manifestText = await this.#options.platform.readRepositoryFile(
          catalogPlugin.repository,
          manifestPath,
          commit,
        )
        resolvedMechanism = manifestText === null ? null : 'repository'
      }
    }
    if (resolvedMechanism === null) {
      throw new Error(`${pluginId} has no DSH bundle or .dsh-plugin manifest at ${commit}`)
    }
    if (manifestText === null) throw new Error(`${pluginId} is missing ${manifestPath} at ${commit}`)
    const manifest = parsePackageManifest(manifestText, `${pluginId}/${manifestPath}`)
    const resolvedPackage = packageName(manifest, manifestPath)
    if (isProtectedMarketplacePlugin(
      pluginId,
      catalogPlugin.repository,
      resolvedPackage,
    )) {
      throw new Error(
        `${pluginId} is protected by Oh-DSH and cannot be modified by its own marketplace`,
      )
    }
    if (resolvedMechanism === 'bundle'
      && (!isRecord(manifest.dsh) || !isRecord(manifest.dsh.bundle)
        || typeof manifest.dsh.bundle.patch !== 'string')) {
      throw new Error(`${pluginId} does not declare dsh.bundle.patch`)
    }
    const source = resolvedMechanism === 'repository'
      ? `github:${catalogPlugin.repository}#${commit}&path:/.dsh-plugin`
      : `github:${catalogPlugin.repository}#${commit}`
    const hash = manifestHash(manifestText)
    const review = sourceReview(
      state.locks.find(lock => lock.pluginId === pluginId),
      {
        manifestHash: hash,
        mechanism: resolvedMechanism,
        packageName: resolvedPackage,
        pluginId,
        repository: catalogPlugin.repository,
        resolvedCommit: commit,
      },
      current,
    )
    const scripts = buildScripts(manifest)
    const risk = assessRisk({
      action,
      buildScripts: scripts,
      mechanism: resolvedMechanism,
      protectedPlugin: catalogPlugin.protected,
      sandboxAvailable: this.#options.platform.scriptSandboxAvailable !== false,
      sourceReview: review,
    })
    this.#plan = {
      action,
      buildScripts: scripts,
      description: catalogPlugin.description,
      manifestHash: hash,
      mechanism: resolvedMechanism,
      packageName: resolvedPackage,
      pluginId,
      requirements: risk.requirements,
      repository: catalogPlugin.repository,
      resolvedCommit: commit,
      riskLevel: risk.riskLevel,
      riskReasons: risk.riskReasons,
      source,
      sourceReview: review,
    }
  }

  private async preview(confirmations: readonly MarketplaceConfirmation[]): Promise<void> {
    const plan = this.#plan
    if (plan === null) throw new Error('Inspect a plugin before starting its preview.')
    if (this.#active !== null) throw new Error('A plugin preview is already active.')
    const missing = plan.requirements.filter(requirement => !confirmations.includes(requirement))
    if (missing.length > 0) {
      throw new Error(`Preview requires explicit confirmation: ${missing.join(', ')}`)
    }
    const sandboxAvailable = this.#options.platform.scriptSandboxAvailable !== false
    const confineBuild = sandboxAvailable || !confirmations.includes('accept-unsandboxed-build')
    const transactionId = randomUUID()
    const root = join(this.#previewsRoot, transactionId)
    const candidateHome = join(root, 'dsh')
    const candidateProfile = join(candidateHome, 'profiles', this.#options.profile)
    copyDirectory(this.#profileDir, candidateProfile)
    try {
      // A live profile can carry a `node_modules` whose `.modules.yaml` points
      // at a pnpm store that no longer exists: applying a preview deletes the
      // preview root (and its store) while the applied profile keeps the
      // store reference, so every later preview copy inherits a tree pnpm
      // refuses with ERR_PNPM_UNEXPECTED_STORE. Drop the copied tree and
      // lockfile for actions that run pnpm anyway, so pnpm rebuilds them
      // against the preview's own store.
      if (plan.action === 'install' || plan.action === 'update' || plan.action === 'uninstall') {
        removeWithin(candidateProfile, join(candidateProfile, 'node_modules'), this.#warn)
        rmSync(join(candidateProfile, 'pnpm-lock.yaml'), { force: true })
      }
      const candidateState = readMarketplaceState(candidateProfile)
      const current = candidateState.entries
      const remaining = current.filter(entry => entry.pluginId !== plan.pluginId)
      const existing = current.find(entry => entry.pluginId === plan.pluginId)
      if (plan.action === 'install' || plan.action === 'update') {
        const preserveEnabled = existing === undefined
          ? true
          : installedEntryEnabled(candidateProfile, existing)
        const installed: MarketplaceInstalledPlugin = {
          installedAt: new Date().toISOString(),
          mechanism: plan.mechanism,
          packageName: plan.packageName,
          pluginId: plan.pluginId,
          resolvedCommit: plan.resolvedCommit,
          source: plan.source,
        }
        if (existing?.mechanism === 'bundle'
          && (plan.mechanism !== 'bundle' || existing.packageName !== plan.packageName)) {
          await this.removeBundle(candidateHome, candidateProfile, root, existing, sandboxAvailable)
        }
        if (plan.mechanism === 'bundle') {
          if (plan.packageName === null) throw new Error('bundle plan is missing its package name')
          const sources = join(candidateProfile, MANAGED_DIRECTORY, 'sources')
          if (existsSync(sources)) {
            for (const entry of readdirSync(sources)) {
              if (entry.startsWith(`${plan.pluginId}-`)) {
                removeWithin(sources, join(sources, entry), this.#warn)
              }
            }
          }
          mkdirSync(sources, { recursive: true, mode: 0o700 })
          const sourceName = `${plan.pluginId}-${plan.resolvedCommit.slice(0, 12)}`
          const checkout = join(sources, sourceName)
          const scriptNames = Object.keys(plan.buildScripts)
          const cloneTarget = scriptNames.length > 0
            ? join(root, 'bundle-builds', sourceName)
            : checkout
          await this.#options.platform.cloneRepository(
            plan.repository,
            plan.resolvedCommit,
            cloneTarget,
          )
          if (scriptNames.length > 0) {
            allowBuild(candidateProfile, plan.packageName)
            await this.#options.platform.buildBundle({
              checkout: cloneTarget,
              sandboxRoot: root,
              scripts: scriptNames,
              sandboxed: confineBuild,
            })
            renameSync(cloneTarget, checkout)
          }
          await this.#options.platform.runDsh({
            args: ['plugin', '--profile', this.#options.profile, 'add', checkout],
            dshHome: candidateHome,
            sandboxRoot: root,
            sandboxed: sandboxAvailable,
          })
          const manifest = readJson(join(candidateProfile, 'package.json'))
          if (!isRecord(manifest) || !isRecord(manifest.dependencies)
            || typeof manifest.dependencies[plan.packageName] !== 'string') {
            throw new Error(`DSH did not add ${plan.packageName} to the preview profile`)
          }
          normalizeBundleDependency(candidateProfile, plan.packageName, checkout)
          await this.#options.platform.runDsh({
            args: ['plugin', '--profile', this.#options.profile, 'install', '--ignore-scripts'],
            dshHome: candidateHome,
            sandboxRoot: root,
            sandboxed: sandboxAvailable,
          })
          setBundleEnabled(candidateProfile, plan.packageName, preserveEnabled)
          assertPortableBundleProfile(candidateProfile, root)
        }
        const next = [...remaining, installed]
        const previousLock = candidateState.locks.find(lock => lock.pluginId === plan.pluginId)
        const locks = [
          ...candidateState.locks.filter(lock => lock.pluginId !== plan.pluginId),
          sourceLockFromPlan(plan, previousLock),
        ]
        updateRepositoryPatch(
          candidateProfile,
          next,
          new Map([[plan.pluginId, preserveEnabled]]),
        )
        writeMarketplaceState(candidateProfile, {
          entries: next,
          locks,
          version: STATE_VERSION,
        })
      } else if (plan.action === 'uninstall') {
        const installed = existing
        if (installed === undefined) throw new Error(`${plan.pluginId} is no longer installed`)
        if (installed.mechanism === 'bundle') {
          await this.removeBundle(candidateHome, candidateProfile, root, installed, sandboxAvailable)
        }
        updateRepositoryPatch(candidateProfile, remaining)
        writeMarketplaceState(candidateProfile, {
          entries: remaining,
          locks: candidateState.locks,
          version: STATE_VERSION,
        })
      } else {
        const installed = existing
        if (installed === undefined) throw new Error(`${plan.pluginId} is no longer installed`)
        const enabled = plan.action === 'enable'
        if (installed.mechanism === 'bundle') {
          if (installed.packageName === null) {
            throw new Error('installed bundle is missing its package name')
          }
          setBundleEnabled(candidateProfile, installed.packageName, enabled)
        } else {
          updateRepositoryPatch(
            candidateProfile,
            current,
            new Map([[plan.pluginId, enabled]]),
          )
        }
        writeMarketplaceState(candidateProfile, {
          entries: current,
          locks: candidateState.locks,
          version: STATE_VERSION,
        })
      }
      const preview: MarketplacePreview = {
        action: plan.action,
        isolated: sandboxAvailable,
        pluginId: plan.pluginId,
        previewUrl: null,
        resolvedCommit: plan.resolvedCommit,
        startedAt: new Date().toISOString(),
        transactionId,
      }
      this.#active = { candidateHome, candidateProfile, preview, root }
      const started = await this.#options.runtime.startPreview({
        dshHome: candidateHome,
        pluginId: plan.pluginId,
        sandboxRoot: root,
        sandboxed: sandboxAvailable,
        transactionId,
      })
      if (started.url !== undefined) {
        this.#active = {
          ...this.#active,
          preview: { ...preview, previewUrl: started.url },
        }
      }
      this.#lastAction = sandboxAvailable
        ? `Isolated ${plan.action} preview is ready for ${plan.pluginId}.`
        : `${plan.action} preview is ready for ${plan.pluginId} without process isolation.`
    } catch (error) {
      this.#active = null
      await this.#options.runtime.stopPreview().catch(() => {})
      removeWithin(this.#previewsRoot, root, this.#warn)
      throw error
    }
  }

  private async removeBundle(
    candidateHome: string,
    candidateProfile: string,
    sandboxRoot: string,
    installed: MarketplaceInstalledPlugin,
    sandboxed: boolean,
  ): Promise<void> {
    if (installed.packageName === null) throw new Error('installed bundle is missing its package name')
    await this.#options.platform.runDsh({
      args: ['plugin', '--profile', this.#options.profile, 'remove', installed.packageName],
      dshHome: candidateHome,
      sandboxRoot,
      sandboxed,
    })
    const sources = join(candidateProfile, MANAGED_DIRECTORY, 'sources')
    if (!existsSync(sources)) return
    for (const entry of readdirSync(sources)) {
      if (entry.startsWith(`${installed.pluginId}-`)) removeWithin(sources, join(sources, entry), this.#warn)
    }
  }

  private async discard(): Promise<void> {
    const active = this.#active
    if (active === null) {
      this.#plan = null
      return
    }
    await this.#options.runtime.stopPreview()
    removeWithin(this.#previewsRoot, active.root, this.#warn)
    this.#active = null
    this.#plan = null
    this.#lastAction = `Discarded the ${active.preview.pluginId} preview without changing the profile.`
  }

  private async applyPreview(): Promise<void> {
    const active = this.#active
    if (active === null) throw new Error('There is no prepared preview to apply.')
    await this.#options.runtime.stopPreview()
    await this.#options.runtime.stopLive()
    const rollbackRoot = join(this.#rollbacksRoot, active.preview.transactionId)
    const backupProfile = join(rollbackRoot, this.#options.profile)
    mkdirSync(rollbackRoot, { recursive: true, mode: 0o700 })
    let candidateInstalled = false
    try {
      renameSync(this.#profileDir, backupProfile)
      renameSync(active.candidateProfile, this.#profileDir)
      candidateInstalled = true
      const candidateCache = join(active.candidateHome, 'cache', 'repository-plugins')
      if (existsSync(candidateCache)) {
        const liveCache = join(this.#options.dshHome, 'cache', 'repository-plugins')
        mkdirSync(dirname(liveCache), { recursive: true, mode: 0o700 })
        cpSync(candidateCache, liveCache, { recursive: true, preserveTimestamps: true })
      }
      // The applied profile's node_modules was linked from the preview's
      // store, which is deleted with the preview root below. Re-home it
      // against the persistent home store (unsandboxed) so the live profile
      // never references a vanished store. Best effort: the hard links keep
      // the tree usable even if this fails, and the dsh CLI self-heals the
      // store reference on the next pnpm command.
      try {
        removeWithin(this.#profileDir, join(this.#profileDir, 'node_modules'), this.#warn)
        rmSync(join(this.#profileDir, 'pnpm-lock.yaml'), { force: true })
        await this.#options.platform.runDsh({
          args: ['plugin', '--profile', this.#options.profile, 'install', '--ignore-scripts'],
          dshHome: this.#options.dshHome,
          sandboxRoot: this.#options.appDataPath,
          sandboxed: false,
        })
      } catch (error) {
        this.#options.onWarn?.(`applied profile store could not be re-homed: ${message(error)}`)
      }
      await this.#options.runtime.startLive()
    } catch (error) {
      await this.#options.runtime.stopLive().catch(() => {})
      if (candidateInstalled && existsSync(this.#profileDir)) {
        const failed = join(rollbackRoot, 'failed-candidate')
        renameSync(this.#profileDir, failed)
      }
      if (existsSync(backupProfile)) renameSync(backupProfile, this.#profileDir)
      await this.#options.runtime.startLive().catch(() => {})
      throw new Error(`plugin preview failed to apply and was rolled back: ${message(error)}`)
    }
    this.#rollback = {
      appliedAt: new Date().toISOString(),
      backupProfile,
      pluginId: active.preview.pluginId,
      transactionId: active.preview.transactionId,
    }
    writeJsonAtomic(this.#rollbackStatePath, this.#rollback)
    removeWithin(this.#previewsRoot, active.root, this.#warn)
    this.#active = null
    this.#plan = null
    this.#lastAction = `Applied ${active.preview.pluginId}; the previous profile remains available for Undo.`
    this.remapCatalogInstalled()
  }

  private async undo(): Promise<void> {
    const rollback = this.#rollback
    if (rollback === null || !existsSync(rollback.backupProfile)) {
      this.#rollback = null
      throw new Error('There is no previous plugin profile to restore.')
    }
    await this.#options.runtime.stopLive()
    const rollbackRoot = dirname(rollback.backupProfile)
    const replacedProfile = join(rollbackRoot, `replaced-${Date.now().toString(36)}`)
    let restored = false
    try {
      renameSync(this.#profileDir, replacedProfile)
      renameSync(rollback.backupProfile, this.#profileDir)
      restored = true
      await this.#options.runtime.startLive()
    } catch (error) {
      await this.#options.runtime.stopLive().catch(() => {})
      if (restored && existsSync(this.#profileDir)) renameSync(this.#profileDir, rollback.backupProfile)
      if (existsSync(replacedProfile)) renameSync(replacedProfile, this.#profileDir)
      await this.#options.runtime.startLive().catch(() => {})
      throw new Error(`failed to restore the previous plugin profile: ${message(error)}`)
    }
    removeWithin(this.#rollbacksRoot, replacedProfile, this.#warn)
    rmSync(this.#rollbackStatePath, { force: true })
    removeWithin(this.#rollbacksRoot, rollbackRoot, this.#warn)
    this.#rollback = null
    this.#lastAction = `Restored the profile from before ${rollback.pluginId} was applied.`
    this.remapCatalogInstalled()
  }

  private remapCatalogInstalled(): void {
    const installed = new Set(readMarketplaceState(this.#profileDir).entries.map(entry => entry.pluginId))
    this.#catalog = this.#catalog.map(plugin => ({ ...plugin, installed: installed.has(plugin.id) }))
  }

  private readRollback(): RollbackState | null {
    if (!existsSync(this.#rollbackStatePath)) return null
    try {
      const value = readJson(this.#rollbackStatePath)
      if (!isRecord(value) || typeof value.backupProfile !== 'string'
        || typeof value.pluginId !== 'string' || typeof value.transactionId !== 'string') return null
      ensureWithin(this.#rollbacksRoot, value.backupProfile)
      return existsSync(value.backupProfile) ? {
        appliedAt: typeof value.appliedAt === 'string'
          ? value.appliedAt
          : new Date(0).toISOString(),
        backupProfile: value.backupProfile,
        pluginId: value.pluginId,
        transactionId: value.transactionId,
      } : null
    } catch {
      return null
    }
  }
}
