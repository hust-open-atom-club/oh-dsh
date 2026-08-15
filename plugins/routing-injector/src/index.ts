import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

export const MUTATING_TOOLS = new Set([
  'dev_inject_plugin',
  'dev_reload_package',
  'dev_stage_promote',
  'dev_uninject_plugin',
  'dev_clear_routes',
])
const SAFE_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const INTERNAL_PACKAGE_NAME = /^@(oh-dsh|deepseek-ai)\//
const MAX_PLUGIN_BYTES = 32 * 1024 * 1024
const MAX_PLUGIN_FILES = 2_000

type BrowserProfile = 'desktop' | 'web'

interface LoaderEntry {
  options: { name: string }
}

export interface Loader {
  create(options: { name: string }): Promise<string>
  entries(): Iterable<LoaderEntry>
  remove(id: string): Promise<void>
}

interface ToolExecution {
  name: string
}

interface InjectorToolsContext {
  effect(callback: () => (() => void) | void, label?: string): void
  routingInjector: RoutingInjectorService
  tools: {
    register(tool: Record<string, unknown>): () => void
  }
}

interface RegistryEntry {
  fingerprint: string
  linkOwned: boolean
  packageName: string
  path: string
  profile: BrowserProfile
  promoted: boolean
}

export interface RoutingInjectorService {
  readonly ready: Promise<void>
  inject(directory: string): Promise<RegistryEntry>
  reload(packageName: string): Promise<RegistryEntry>
  promote(packageName: string): Promise<RegistryEntry>
  uninject(packageName: string): Promise<void>
  snapshot(): Record<string, unknown>
}

interface Registry {
  records: RegistryEntry[]
  version: 1
}

interface ActiveEntry {
  entryId: string
  record: RegistryEntry
}

interface PackageManifest {
  name?: unknown
}

const RESULT_SCHEMA = {
  additionalProperties: false,
  properties: {
    data: {},
    summary: { type: 'string' },
  },
  required: ['summary', 'data'],
  type: 'object',
} as const

function output(summary: string, data: unknown = null): { data: unknown; summary: string } {
  return { data, summary }
}

function renderedOutput() {
  return {
    render: (_args: unknown, value: { data: unknown; summary: string }) => [{
      text: value.data === null
        ? value.summary
        : `${value.summary}\n${JSON.stringify(value.data, undefined, 2)}`,
      type: 'text',
    }],
    schema: RESULT_SCHEMA,
  }
}

function parameterSchema(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): Record<string, unknown> {
  return {
    additionalProperties: false,
    properties,
    ...(required.length === 0 ? {} : { required }),
    type: 'object',
  }
}

function asString(args: unknown, key: string): string {
  if (args === null || typeof args !== 'object') throw new Error(`${key} is required`)
  const value = (args as Record<string, unknown>)[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} is required`)
  return value.trim()
}

function isWithin(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(parent + sep)
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function pluginFingerprint(root: string): string {
  const hash = createHash('sha256')
  const files: string[] = [join(root, 'package.json')]
  const lib = join(root, 'lib')
  let bytes = 0

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const real = realpathSync(path)
      if (!isWithin(root, real)) throw new Error('plugin lib cannot contain links outside its package')
      if (entry.isDirectory()) {
        visit(real)
      } else if (entry.isFile()) {
        files.push(real)
      } else {
        throw new Error('plugin lib contains an unsupported filesystem entry')
      }
    }
  }

  visit(lib)
  if (files.length > MAX_PLUGIN_FILES) throw new Error('plugin package contains too many files')
  for (const file of files.sort()) {
    const content = readFileSync(file)
    bytes += content.length
    if (bytes > MAX_PLUGIN_BYTES) throw new Error('plugin package exceeds the approved size limit')
    hash.update(relative(root, file))
    hash.update('\0')
    hash.update(content)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function resolveProfile(environment: NodeJS.ProcessEnv): BrowserProfile {
  const profile = environment.OH_DSH_PROFILE
  if (profile === 'desktop' || profile === 'web') return profile
  throw new Error('routing injector requires the internal OH_DSH_PROFILE browser profile')
}

function validateRegistry(value: unknown): Registry {
  if (value === null || typeof value !== 'object') throw new Error('injector registry must be an object')
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.records)) {
    throw new Error('injector registry has an unsupported schema')
  }
  const records: RegistryEntry[] = []
  for (const candidate of record.records) {
    if (candidate === null || typeof candidate !== 'object') throw new Error('injector registry contains an invalid record')
    const entry = candidate as Record<string, unknown>
    if (typeof entry.fingerprint !== 'string'
      || typeof entry.linkOwned !== 'boolean'
      || typeof entry.packageName !== 'string'
      || typeof entry.path !== 'string'
      || (entry.profile !== 'desktop' && entry.profile !== 'web')
      || typeof entry.promoted !== 'boolean') {
      throw new Error('injector registry contains an invalid record')
    }
    records.push({
      fingerprint: entry.fingerprint,
      linkOwned: entry.linkOwned,
      packageName: entry.packageName,
      path: entry.path,
      profile: entry.profile,
      promoted: entry.promoted,
    })
  }
  return { records, version: 1 }
}

/**
 * Profile-local, approval-gated runtime injector. It does not own a server,
 * timer, client bundle, or external API; its entire mutable surface is tools.
 */
export class RoutingInjector {
  readonly active = new Map<string, ActiveEntry>()
  readonly inactive = new Map<string, string>()
  private readonly loader: Loader
  readonly profile: BrowserProfile
  readonly profileDir: string
  readonly registryPath: string
  readonly ready: Promise<void>

  constructor(
    loader: Loader,
    environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.loader = loader
    const home = environment.OH_DSH_HOME ?? environment.DSH_HOME
    if (home === undefined || home === '') throw new Error('routing injector requires OH_DSH_HOME')
    this.profile = resolveProfile(environment)
    this.profileDir = join(home, 'profiles', this.profile)
    this.registryPath = join(home, 'routing-injector', 'registry.json')
    this.ready = this.restore()
  }

  private registry(): Registry {
    if (!existsSync(this.registryPath)) return { records: [], version: 1 }
    return validateRegistry(loadJson(this.registryPath))
  }

  private writeRegistry(registry: Registry): void {
    const directory = dirname(this.registryPath)
    mkdirSync(directory, { mode: 0o700, recursive: true })
    const temporary = `${this.registryPath}.tmp-${String(process.pid)}`
    writeFileSync(temporary, `${JSON.stringify(registry, undefined, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.registryPath)
  }

  private profileLink(packageName: string): string {
    return join(this.profileDir, 'node_modules', ...packageName.split('/'))
  }

  private ensureLink(record: RegistryEntry): boolean {
    const link = this.profileLink(record.packageName)
    if (existsSync(link)) {
      if (realpathSync(link) !== record.path) {
        throw new Error(`${record.packageName} already has a different profile-local package link`)
      }
      return false
    }
    mkdirSync(dirname(link), { mode: 0o700, recursive: true })
    symlinkSync(record.path, link, process.platform === 'win32' ? 'junction' : 'dir')
    return true
  }

  private removeOwnedLink(record: RegistryEntry): void {
    if (!record.linkOwned) return
    const link = this.profileLink(record.packageName)
    if (!existsSync(link)) return
    if (realpathSync(link) !== record.path) {
      throw new Error(`${record.packageName} package link no longer matches its approved path`)
    }
    rmSync(link, { force: true, recursive: true })
  }

  private packageRecord(directory: string, previous?: RegistryEntry): RegistryEntry {
    const path = realpathSync(resolve(directory))
    const manifestPath = join(path, 'package.json')
    const entry = join(path, 'lib', 'index.js')
    if (!existsSync(manifestPath) || !existsSync(entry) || !lstatSync(entry).isFile()) {
      throw new Error('plugin package must contain package.json and lib/index.js')
    }
    const manifest = loadJson(manifestPath) as PackageManifest
    if (typeof manifest.name !== 'string' || !SAFE_PACKAGE_NAME.test(manifest.name)
      || INTERNAL_PACKAGE_NAME.test(manifest.name)) {
      throw new Error('plugin package name is invalid or reserved by Oh-DSH')
    }
    return {
      fingerprint: pluginFingerprint(path),
      linkOwned: previous?.linkOwned ?? false,
      packageName: manifest.name,
      path,
      profile: this.profile,
      promoted: previous?.promoted ?? false,
    }
  }

  private hasLoaderEntry(packageName: string): boolean {
    return [...this.loader.entries()].some(entry => entry.options.name === packageName)
  }

  private async load(record: RegistryEntry): Promise<ActiveEntry> {
    if (this.active.has(record.packageName) || this.hasLoaderEntry(record.packageName)) {
      throw new Error(`${record.packageName} is already active`)
    }
    const linkOwned = this.ensureLink(record)
    const linked = { ...record, linkOwned: record.linkOwned || linkOwned }
    try {
      const entryId = await this.loader.create({ name: linked.packageName })
      return { entryId, record: linked }
    } catch (error) {
      if (linkOwned) rmSync(this.profileLink(record.packageName), { force: true, recursive: true })
      throw error
    }
  }

  private async unload(active: ActiveEntry): Promise<void> {
    await this.loader.remove(active.entryId)
    this.removeOwnedLink(active.record)
  }

  async restore(): Promise<void> {
    const registry = this.registry()
    for (const record of registry.records) {
      if (record.profile !== this.profile || record.promoted) continue
      try {
        const current = this.packageRecord(record.path, record)
        if (current.packageName !== record.packageName || current.fingerprint !== record.fingerprint) {
          this.inactive.set(record.packageName, 'approved package fingerprint changed')
          continue
        }
        const active = await this.load(record)
        this.active.set(record.packageName, active)
      } catch (error) {
        this.inactive.set(record.packageName, error instanceof Error ? error.message : String(error))
      }
    }
  }

  async inject(directory: string): Promise<RegistryEntry> {
    await this.ready
    const record = this.packageRecord(directory)
    const active = await this.load(record)
    try {
      const registry = this.registry()
      if (registry.records.some(entry => entry.packageName === record.packageName && entry.profile === this.profile)) {
        throw new Error(`${record.packageName} already has an injector record`)
      }
      this.writeRegistry({ ...registry, records: [...registry.records, active.record] })
      this.active.set(record.packageName, active)
      this.inactive.delete(record.packageName)
      return active.record
    } catch (error) {
      await this.unload(active).catch(() => undefined)
      throw error
    }
  }

  async reload(packageName: string): Promise<RegistryEntry> {
    await this.ready
    const active = this.active.get(packageName)
    if (active === undefined) throw new Error(`${packageName} is not an active injected package`)
    const updated = this.packageRecord(active.record.path, active.record)
    await this.loader.remove(active.entryId)
    this.active.delete(packageName)
    try {
      const replacement = await this.load(updated)
      const registry = this.registry()
      this.writeRegistry({
        ...registry,
        records: registry.records.map(record => record.packageName === packageName
          && record.profile === this.profile ? replacement.record : record),
      })
      this.active.set(packageName, replacement)
      return replacement.record
    } catch (error) {
      this.inactive.set(packageName, 'reload failed; inject again after fixing the package')
      throw error
    }
  }

  async promote(packageName: string): Promise<RegistryEntry> {
    await this.ready
    const active = this.active.get(packageName)
    if (active === undefined) throw new Error(`${packageName} is not an active injected package`)
    const manifestPath = join(this.profileDir, 'package.json')
    const manifest = loadJson(manifestPath)
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('current profile manifest is invalid')
    }
    const profile = manifest as Record<string, unknown>
    const dsh = profile.dsh !== null && typeof profile.dsh === 'object' && !Array.isArray(profile.dsh)
      ? profile.dsh as Record<string, unknown>
      : {}
    const profileConfig = dsh.profile !== null && typeof dsh.profile === 'object' && !Array.isArray(dsh.profile)
      ? dsh.profile as Record<string, unknown>
      : {}
    const bundles = Array.isArray(profileConfig.bundles)
      ? profileConfig.bundles.filter((value): value is string => typeof value === 'string')
      : []
    const dependencies = profile.dependencies !== null && typeof profile.dependencies === 'object'
      && !Array.isArray(profile.dependencies)
      ? profile.dependencies as Record<string, unknown>
      : {}
    const next = {
      ...profile,
      dependencies: { ...dependencies, [packageName]: `file:${active.record.path}` },
      dsh: {
        ...dsh,
        profile: { ...profileConfig, bundles: bundles.includes(packageName) ? bundles : [...bundles, packageName] },
      },
    }
    const temporary = `${manifestPath}.injector-tmp-${String(process.pid)}`
    writeFileSync(temporary, `${JSON.stringify(next, undefined, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, manifestPath)
    const registry = this.registry()
    const promoted = { ...active.record, promoted: true }
    this.writeRegistry({
      ...registry,
      records: registry.records.map(record => record.packageName === packageName
        && record.profile === this.profile ? promoted : record),
    })
    this.active.set(packageName, { ...active, record: promoted })
    return promoted
  }

  async uninject(packageName: string): Promise<void> {
    await this.ready
    const active = this.active.get(packageName)
    if (active === undefined) throw new Error(`${packageName} is not an active injected package`)
    if (active.record.promoted) {
      throw new Error(`${packageName} is profile-promoted; remove it through the profile transaction`)
    }
    const registry = this.registry()
    const next = {
      ...registry,
      records: registry.records.filter(record => record.packageName !== packageName || record.profile !== this.profile),
    }
    this.writeRegistry(next)
    try {
      await this.unload(active)
      this.active.delete(packageName)
    } catch (error) {
      this.writeRegistry(registry)
      throw error
    }
  }

  snapshot(): Record<string, unknown> {
    return {
      active: [...this.active.values()].map(active => ({
        fingerprint: active.record.fingerprint,
        packageName: active.record.packageName,
        path: active.record.path,
        promoted: active.record.promoted,
      })),
      inactive: Object.fromEntries(this.inactive),
      profile: this.profile,
    }
  }
}

/** Stable Cordis plugin name for the guarded browser-profile injector. */
export const name = 'oh-dsh-routing-injector'

/** Model-facing tools are mounted only by the Router Agent preset. */
export const inject = ['routingInjector', 'tools']

export function apply(ctx: InjectorToolsContext): void {
  const injector = ctx.routingInjector

  const register = (tool: Record<string, unknown>, label: string): void => {
    ctx.effect(() => ctx.tools.register({ ...tool, output: renderedOutput() }), label)
  }

  register({
    description: 'Inject one approved local DSH plugin package into this browser profile.',
    execute: async (args: unknown) => output('Plugin injected.', await injector.inject(asString(args, 'directory'))),
    name: 'dev_inject_plugin',
    parameters: parameterSchema({ directory: { description: 'Absolute local plugin package directory.', type: 'string' } }, ['directory']),
  }, 'oh-dsh-routing-injector-inject')
  register({
    description: 'Reload one approved injected local package after an explicit approval.',
    execute: async (args: unknown) => output('Plugin reloaded.', await injector.reload(asString(args, 'packageName'))),
    name: 'dev_reload_package',
    parameters: parameterSchema({ packageName: { description: 'Exact injected package name.', type: 'string' } }, ['packageName']),
  }, 'oh-dsh-routing-injector-reload')
  register({
    description: 'Promote an injected package into the current profile for the next launch.',
    execute: async (args: unknown) => output('Plugin promoted to the current profile.', await injector.promote(asString(args, 'packageName'))),
    name: 'dev_stage_promote',
    parameters: parameterSchema({ packageName: { description: 'Exact injected package name.', type: 'string' } }, ['packageName']),
  }, 'oh-dsh-routing-injector-promote')
  register({
    description: 'Unload one approved injected package and remove its injector record.',
    execute: async (args: unknown) => {
      await injector.uninject(asString(args, 'packageName'))
      return output('Plugin unloaded.')
    },
    name: 'dev_uninject_plugin',
    parameters: parameterSchema({ packageName: { description: 'Exact injected package name.', type: 'string' } }, ['packageName']),
  }, 'oh-dsh-routing-injector-uninject')
  register({
    description: 'Report that the guarded injector creates no web routes to clear.',
    execute: async () => output('No injector web routes are installed.'),
    name: 'dev_clear_routes',
    parameters: parameterSchema({}),
  }, 'oh-dsh-routing-injector-clear-routes')
  register({
    description: 'List current injected package records without changing them.',
    execute: async () => output('Injected package records.', injector.snapshot()),
    name: 'dev_injected_list',
    parameters: parameterSchema({}),
  }, 'oh-dsh-routing-injector-list')
  register({
    description: 'Show guarded injector status for the active browser profile.',
    execute: async () => output('Routing injector status.', injector.snapshot()),
    name: 'dev_plugin_status',
    parameters: parameterSchema({}),
  }, 'oh-dsh-routing-injector-status')
}
