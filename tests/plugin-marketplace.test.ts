import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseMarketplaceCatalog } from '../plugins/plugin-marketplace/src/catalog.ts'
import type {
  BundleBuildInput,
  DshCommandInput,
  LoadCatalogOptions,
  MarketplaceAuthResult,
  MarketplacePlatform,
} from '../plugins/plugin-marketplace/src/host/platform.ts'
import {
  findGitHubCli,
  MARKETPLACE_CATALOG_CACHE_TTL_MS,
  previewRuntimeLauncher,
  previewSandboxPolicy,
  previewScriptCommand,
  ProductionMarketplacePlatform,
  withGitHubCredentials,
} from '../plugins/plugin-marketplace/src/host/platform.ts'
import {
  PluginMarketplaceManager,
  removeWithin,
  type MarketplacePreviewRuntimeInput,
  type MarketplaceRuntime,
} from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'
import { startMarketplaceAgentGateway } from '../plugins/plugin-marketplace/src/host/agent-gateway.ts'
import {
  initialSessionNavigationState,
  transitionSessionNavigation,
} from '../plugins/plugin-marketplace/src/client/session-navigation.ts'
import {
  createMarketplaceHttpBridge,
  waitForMarketplaceRestart,
} from '../plugins/plugin-marketplace/src/client/http.ts'
import {
  formatMarketplaceCount,
  formatMarketplaceDate,
  marketplaceRepositoryDetails,
} from '../plugins/plugin-marketplace/src/client/repository-metadata.ts'
import { MARKETPLACE_MESSAGES } from '../plugins/plugin-marketplace/src/client/i18n.ts'
import type {
  MarketplacePreviewProxyContext,
} from '../plugins/plugin-marketplace/src/host/preview-proxy.ts'
import {
  MarketplacePreviewProxy,
  MARKETPLACE_WEB_PREVIEW_PATH,
} from '../plugins/plugin-marketplace/src/host/preview-proxy.ts'
import type { MarketplaceRepositoryStats, MarketplaceSnapshot } from '../plugins/plugin-marketplace/src/protocol.ts'
import { TuiMarketplaceController } from '../plugins/tui-marketplace/src/marketplace-controller.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

const UPDATED_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98'

function catalogDocument(): unknown {
  return {
    schema: 'dsh-external-hub/v0.1',
    generated: '2026-08-10T17:17:56.572Z',
    repos: [
      {
        name: 'bundle-demo',
        repo: 'dsh-external/bundle-demo',
        category: 'plugin',
        description: 'Bundle demo',
        bundle: true,
        repository: false,
        surfaces: ['web', 'desktop'],
        tags: ['web-ui'],
        pushedAt: '2026-08-10T12:00:00Z',
      },
      {
        name: 'safe-demo',
        repo: 'omdsh-dev/safe-demo',
        category: 'plugin',
        description: 'Safe bundle demo',
        bundle: true,
        repository: false,
        tags: ['safe'],
      },
      {
        name: 'repository-demo',
        repo: 'vlln/repository-demo',
        category: 'skill',
        note: 'Repository demo',
        bundle: false,
        repository: true,
        surfaces: { desktop: true, web: true, tui: false },
      },
      {
        name: 'hybrid-demo',
        category: 'plugin',
        bundle: true,
        repository: true,
      },
      { name: 'legacy-demo', category: 'plugin', bundle: false, repository: false },
      { name: 'hidden-demo', category: 'plugin', bundle: true, hide: true },
      { name: 'oh-dsh-desktop', category: 'infra', bundle: true },
      { name: '../escape', category: 'plugin', bundle: true },
    ],
  }
}

test('repository metadata formatters handle compact counts and invalid dates', () => {
  assert.equal(formatMarketplaceCount(1_250, 'en'), '1.3K')
  assert.equal(formatMarketplaceCount(null), null)
  assert.equal(formatMarketplaceCount(-1), null)
  assert.equal(formatMarketplaceDate(null, 'en', 'Unknown'), 'Unknown')
  assert.equal(formatMarketplaceDate('not-a-date', 'en', 'Unknown'), 'Unknown')
  assert.notEqual(formatMarketplaceDate('2026-08-27T12:00:00Z', 'en', 'Unknown'), 'Unknown')
})

class FakePlatform implements MarketplacePlatform {
  readonly builds: Array<{
    checkout: string
    sandboxRoot: string
    sandboxed: boolean | undefined
    scripts: string[]
  }> = []
  readonly commands: DshCommandInput[] = []
  readonly catalogLoads: LoadCatalogOptions[] = []
  catalog: unknown = catalogDocument()
  latestCommit = COMMIT
  bundleName = '@example/bundle-demo'
  bundleDescription = 'Bundle demo manifest'
  scriptSandboxAvailable = true

  async authStatus(): Promise<MarketplaceAuthResult> {
    return { detail: 'test auth', status: 'ready' }
  }

  async buildBundle(input: BundleBuildInput): Promise<void> {
    this.builds.push({
      checkout: input.checkout,
      sandboxRoot: input.sandboxRoot,
      sandboxed: input.sandboxed,
      scripts: input.scripts,
    })
  }

  async cloneRepository(_repository: string, _commit: string, target: string): Promise<void> {
    mkdirSync(target, { recursive: true })
  }

  async loadRepositoryStats(_repository: string): Promise<MarketplaceRepositoryStats | null> { return null }

  async loadCatalog(options: LoadCatalogOptions = {}): Promise<unknown> {
    this.catalogLoads.push(options)
    return this.catalog
  }

  async readRepositoryFile(repository: string, path: string): Promise<string | null> {
    const pluginId = repository.split('/').at(-1) ?? repository
    if (pluginId === 'bundle-demo' && path === 'package.json') {
      return JSON.stringify({
        name: this.bundleName,
        description: this.bundleDescription,
        dsh: { bundle: { patch: './cordis.patch.yml' } },
        scripts: { prepare: 'node build.mjs', test: 'node test.mjs' },
      })
    }
    if (pluginId === 'safe-demo' && path === 'package.json') {
      return JSON.stringify({
        name: '@example/safe-demo',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      })
    }
    if (pluginId === 'oh-dsh-desktop' && path === 'package.json') {
      return JSON.stringify({
        name: '@oh-dsh/desktop',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      })
    }
    if (pluginId === 'repository-demo' && path === '.dsh-plugin/package.json') {
      return JSON.stringify({ name: '@example/repository-demo', scripts: { prepack: 'dsh-plugin-prepare' } })
    }
    return null
  }

  async resolveCommit(_repository: string): Promise<string> {
    return this.latestCommit
  }

  async runDsh(input: DshCommandInput): Promise<void> {
    this.commands.push(input)
    const profile = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(profile, 'utf8'))
    if (input.args.includes('add')) {
      const checkout = input.args.at(-1) as string
      const dependency = checkout.includes('safe-demo')
        ? '@example/safe-demo'
        : this.bundleName
      manifest.dependencies[dependency] = `link:${checkout}`
      if (!manifest.dsh.profile.bundles.includes(dependency)) {
        manifest.dsh.profile.bundles.push(dependency)
      }
    } else if (input.args.includes('remove')) {
      const dependency = input.args.at(-1) as string
      delete manifest.dependencies[dependency]
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles
        .filter((entry: string) => entry !== dependency)
    }
    writeFileSync(profile, JSON.stringify(manifest, undefined, 2) + '\n')
  }
}

class FakeRuntime implements MarketplaceRuntime {
  liveStarts = 0
  liveStops = 0
  previewStarts: MarketplacePreviewRuntimeInput[] = []
  previewStops = 0

  async startLive(): Promise<void> { this.liveStarts += 1 }
  async stopLive(): Promise<void> { this.liveStops += 1 }
  async startPreview(input: MarketplacePreviewRuntimeInput): Promise<{ url?: string }> {
    this.previewStarts.push(input)
    return {}
  }
  async stopPreview(): Promise<void> { this.previewStops += 1 }
}

function fixture(): {
  appDataPath: string
  cleanup(): void
  dshHome: string
  manager: PluginMarketplaceManager
  platform: FakePlatform
  profileDir: string
  runtime: FakeRuntime
} {
  const appDataPath = mkdtempSync(join(tmpdir(), 'oh-dsh-marketplace-'))
  const dshHome = join(appDataPath, 'dsh')
  const profileDir = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'desktop',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@oh-dsh/desktop'] } },
  }, undefined, 2) + '\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  const platform = new FakePlatform()
  const runtime = new FakeRuntime()
  const manager = new PluginMarketplaceManager({
    appDataPath,
    dshHome,
    platform,
    profile: 'desktop',
    runtime,
  })
  return {
    appDataPath,
    cleanup: () => { rmSync(appDataPath, { recursive: true, force: true }) },
    dshHome,
    manager,
    platform,
    profileDir,
    runtime,
  }
}

test('preview tree cleanup clears Windows read-only attributes before retrying', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-marketplace-cleanup-'))
  const previews = join(root, 'plugin-marketplace', 'previews')
  const pack = join(previews, 'stale', '.git', 'objects', 'pack')
  try {
    mkdirSync(pack, { recursive: true })
    writeFileSync(join(pack, 'pack-demo.pack'), 'pack', { mode: 0o444 })
    writeFileSync(join(pack, 'pack-demo.idx'), 'idx', { mode: 0o444 })
    chmodSync(previews, 0o555)
    chmodSync(pack, 0o555)
    const warnings: string[] = []
    removeWithin(root, previews, message => { warnings.push(message) }, 'win32')
    assert.deepEqual(warnings, [])
    assert.equal(existsSync(previews), false)
  } finally {
    if (existsSync(previews)) chmodSync(previews, 0o755)
    rmSync(root, { recursive: true, force: true })
  }
})

test('preview tree cleanup unlinks Windows junctions without deleting their targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-marketplace-junction-'))
  const previews = join(root, 'plugin-marketplace', 'previews')
  const sandbox = join(previews, 'txn', 'dsh', 'profiles', 'desktop', 'node_modules')
  const external = join(root, 'bundled-runtime')
  const junction = join(sandbox, 'packaged-runtime')
  try {
    mkdirSync(sandbox, { recursive: true })
    mkdirSync(external, { recursive: true })
    writeFileSync(join(external, 'bin.js'), 'runtime')
    symlinkSync(
      process.platform === 'win32' ? external : join('..', '..', '..', '..', '..', '..', '..', 'bundled-runtime'),
      junction,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const warnings: string[] = []
    removeWithin(root, previews, message => { warnings.push(message) }, 'win32')
    assert.deepEqual(warnings, [])
    assert.equal(existsSync(junction), false)
    assert.equal(existsSync(join(external, 'bin.js')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('preview tree cleanup removes dangling Windows junctions', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-marketplace-dangling-'))
  const previews = join(root, 'plugin-marketplace', 'previews')
  const danglingTarget = join(root, 'missing-runtime')
  const dangling = join(previews, 'dangling-runtime')
  try {
    mkdirSync(previews, { recursive: true })
    if (process.platform === 'win32') {
      mkdirSync(danglingTarget, { recursive: true })
      symlinkSync(danglingTarget, dangling, 'junction')
      rmSync(danglingTarget, { recursive: true, force: true })
    } else {
      symlinkSync(danglingTarget, dangling, 'dir')
    }
    const warnings: string[] = []
    removeWithin(root, previews, message => { warnings.push(message) }, 'win32')
    assert.deepEqual(warnings, [])
    assert.equal(existsSync(previews), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('marketplace startup clears read-only Git pack files on Windows', {
  skip: process.platform !== 'win32' ? 'requires Windows read-only attribute semantics' : false,
}, () => {
  const appDataPath = mkdtempSync(join(tmpdir(), 'oh-dsh-marketplace-windows-'))
  const dshHome = join(appDataPath, 'dsh')
  const profileDir = join(dshHome, 'profiles', 'desktop')
  const previews = join(appDataPath, 'plugin-marketplace', 'previews')
  const pack = join(previews, 'stale', '.git', 'objects', 'pack')
  try {
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'desktop',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@oh-dsh/desktop'] } },
    }, undefined, 2) + '\n')
    mkdirSync(pack, { recursive: true })
    writeFileSync(join(pack, 'pack-demo.pack'), 'pack')
    writeFileSync(join(pack, 'pack-demo.idx'), 'idx')
    chmodSync(join(pack, 'pack-demo.pack'), 0o444)
    chmodSync(join(pack, 'pack-demo.idx'), 0o444)
    const warnings: string[] = []
    const manager = new PluginMarketplaceManager({
      appDataPath,
      dshHome,
      onWarn: message => { warnings.push(message) },
      platform: new FakePlatform(),
      profile: 'desktop',
      runtime: new FakeRuntime(),
    })
    assert.deepEqual(warnings, [])
    assert.equal(existsSync(join(previews, 'stale')), false)
    assert.deepEqual(manager.getSnapshot().installed, [])
  } finally {
    rmSync(appDataPath, { recursive: true, force: true })
  }
})

test('marketplace startup survives a previews tree that cannot be removed', {
  skip: process.platform === 'win32'
    ? 'Windows directory read-only attributes do not block recursive removal'
    : false,
}, () => {
  const appDataPath = mkdtempSync(join(tmpdir(), 'oh-dsh-marketplace-startup-'))
  const dshHome = join(appDataPath, 'dsh')
  const profileDir = join(dshHome, 'profiles', 'desktop')
  const previews = join(appDataPath, 'plugin-marketplace', 'previews')
  try {
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'desktop',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@oh-dsh/desktop'] } },
    }, undefined, 2) + '\n')
    mkdirSync(join(previews, 'stale'), { recursive: true })
    writeFileSync(join(previews, 'stale', 'pack-demo.pack'), 'pack')
    chmodSync(previews, 0o555)
    const warnings: string[] = []
    const manager = new PluginMarketplaceManager({
      appDataPath,
      dshHome,
      onWarn: message => { warnings.push(message) },
      platform: new FakePlatform(),
      profile: 'desktop',
      runtime: new FakeRuntime(),
    })
    assert.match(warnings.join('\n'), /failed to clean plugin marketplace tree/)
    assert.equal(existsSync(previews), true)
    assert.deepEqual(manager.getSnapshot().installed, [])
  } finally {
    if (existsSync(previews)) chmodSync(previews, 0o755)
    rmSync(appDataPath, { recursive: true, force: true })
  }
})

test('catalog parser keeps safe entries and labels unsupported managers', () => {
  const catalog = parseMarketplaceCatalog(catalogDocument())
  assert.equal(catalog.generatedAt, '2026-08-10T17:17:56.572Z')
  assert.deepEqual(catalog.plugins.map(plugin => [plugin.id, plugin.mechanism]), [
    ['bundle-demo', 'bundle'],
    ['hybrid-demo', 'bundle'],
    ['oh-dsh-desktop', 'bundle'],
    ['repository-demo', 'repository'],
    ['safe-demo', 'bundle'],
    ['legacy-demo', 'unsupported'],
  ])
  assert.equal(
    catalog.plugins.find(plugin => plugin.id === 'repository-demo')?.description,
    'Repository demo',
  )
  assert.equal(
    catalog.plugins.find(plugin => plugin.id === 'repository-demo')?.repository,
    'vlln/repository-demo',
  )
  assert.equal(catalog.plugins[0]?.url, 'https://github.com/dsh-external/bundle-demo')
  assert.deepEqual(
    catalog.plugins.find(plugin => plugin.id === 'bundle-demo')?.surfaces,
    { declared: true, desktop: true, web: true, tui: false },
  )
  assert.deepEqual(
    catalog.plugins.find(plugin => plugin.id === 'repository-demo')?.surfaces,
    { declared: true, desktop: true, web: true, tui: false },
  )
  assert.deepEqual(
    catalog.plugins.find(plugin => plugin.id === 'legacy-demo')?.surfaces,
    { declared: false, desktop: true, web: true, tui: true },
  )
  const builtin = catalog.plugins.find(plugin => plugin.id === 'oh-dsh-desktop')
  assert.equal(builtin?.builtin, true)
  assert.equal(builtin?.protected, true)
  assert.equal(builtin?.category, 'infra')
  assert.equal(catalog.plugins.find(plugin => plugin.id === 'safe-demo')?.builtin, false)
})

test('marketplace built-in copy is complete in both browser locales', () => {
  assert.equal(MARKETPLACE_MESSAGES.en.builtin, 'Built-in')
  assert.equal(MARKETPLACE_MESSAGES.en['show-builtins'], 'Show built-in plugins')
  assert.equal(MARKETPLACE_MESSAGES.zh.builtin, '内置')
  assert.equal(MARKETPLACE_MESSAGES.zh['show-builtins'], '显示内置插件')
})

test('community and registry catalogs preserve repositories across owners', () => {
  const community = parseMarketplaceCatalog({
    _meta: { schema_version: '1.0', generated_at: '2026-08-14T00:00:00Z' },
    plugins: [
      { id: 'alpha-plugin', name: 'Alpha', repo: 'omdsh-dev/alpha-plugin', category: 'plugin', description: { en: 'Alpha plugin' } },
      { id: 'beta-plugin', name: 'Beta', repo: 'vlln/beta-plugin', category: 'skill', description: { en: 'Beta plugin' } },
    ],
  })
  assert.deepEqual(community.plugins.map(plugin => [plugin.id, plugin.repository, plugin.mechanism]), [
    ['alpha-plugin', 'omdsh-dev/alpha-plugin', 'discover'],
    ['beta-plugin', 'vlln/beta-plugin', 'discover'],
  ])

  const registry = parseMarketplaceCatalog({
    schema: 'omdsh-registry/v1',
    entries: [{
      id: 'registry-plugin',
      displayName: 'Registry plugin',
      description: 'Registry plugin',
      kind: 'plugin',
      source: { repository: 'whyihaveyou/registry-plugin' },
      install: { mode: 'repository-plugin' },
      listing: { state: 'reviewed' },
    }],
  })
  assert.equal(registry.plugins[0]?.repository, 'whyihaveyou/registry-plugin')
  assert.equal(registry.plugins[0]?.mechanism, 'repository')
})

test('GitHub credentials use an app-owned config without command-line pairs', () => {
  const appDataPath = mkdtempSync(join(tmpdir(), 'oh-dsh-git-config-'))
  try {
    const environment = withGitHubCredentials({
      DSH_DESKTOP_APP_DATA: appDataPath,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'unsafe.key',
      GIT_CONFIG_VALUE_0: 'unsafe value',
    }, '/opt/homebrew/bin/gh')
    assert.equal(environment.GIT_CONFIG_COUNT, undefined)
    assert.equal(environment.GIT_CONFIG_KEY_0, undefined)
    assert.equal(environment.GIT_CONFIG_VALUE_0, undefined)
    assert.equal(
      environment.GIT_CONFIG_GLOBAL,
      join(appDataPath, 'plugin-marketplace', 'gitconfig'),
    )
    const config = readFileSync(environment.GIT_CONFIG_GLOBAL, 'utf8')
    assert.match(config, /credential "https:\/\/github\.com"/)
    assert.match(config, /helper = !"\/opt\/homebrew\/bin\/gh" auth git-credential/)
    assert.doesNotMatch(config, /token|unsafe/i)
  } finally {
    rmSync(appDataPath, { recursive: true, force: true })
  }
})

test('GitHub CLI discovery follows Windows PATH syntax and executable names', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-gh-path-'))
  try {
    const expected = win32.join(root, 'gh.exe')
    assert.equal(findGitHubCli({
      Path: `${root};C:\\Program Files\\GitHub CLI`,
    }, 'win32', candidate => candidate === expected), expected)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('public catalogs load anonymously without GitHub CLI', async () => {
  let requested = ''
  const platform = new ProductionMarketplacePlatform({
    cliEntry: '/unused/dsh.mjs',
    cwd: tmpdir(),
    env: {
      OH_DSH_MARKETPLACE_CATALOG: 'public-owner/public-catalog/data/plugins.json',
      PATH: '',
    },
    fetch: async (input): Promise<Response> => {
      requested = String(input)
      return new Response(JSON.stringify(catalogDocument()), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    },
    nodeBinary: process.execPath,
    pnpmEntry: '/unused/pnpm.mjs',
  })

  assert.notEqual((await platform.authStatus()).status, 'ready')
  assert.deepEqual(await platform.loadCatalog(), catalogDocument())
  assert.equal(
    requested,
    'https://raw.githubusercontent.com/public-owner/public-catalog/HEAD/data/plugins.json',
  )
})

test('catalog cache survives restarts, revalidates with ETags, and expires after two hours', async () => {
  const appDataPath = mkdtempSync(join(tmpdir(), 'oh-dsh-marketplace-catalog-cache-'))
  let now = 1_000
  let requests = 0
  let transportFails = false
  const conditionalHeaders: Array<string | null> = []
  const createPlatform = (): ProductionMarketplacePlatform => new ProductionMarketplacePlatform({
    cliEntry: '/unused/dsh.mjs',
    cwd: appDataPath,
    env: {
      DSH_DESKTOP_APP_DATA: appDataPath,
      DSH_DESKTOP_GH_PATH: process.execPath,
      OH_DSH_MARKETPLACE_CATALOG: 'public-owner/public-catalog/data/plugins.json',
      PATH: '',
    },
    fetch: async (_input, init): Promise<Response> => {
      requests += 1
      conditionalHeaders.push(new Headers(init?.headers).get('if-none-match'))
      if (transportFails) throw new Error('offline')
      if (requests === 2) {
        return new Response(null, { headers: { etag: '"catalog-v1"' }, status: 304 })
      }
      return new Response(JSON.stringify(catalogDocument()), {
        headers: { etag: '"catalog-v1"' },
        status: 200,
      })
    },
    nodeBinary: process.execPath,
    now: () => now,
    pnpmEntry: '/unused/pnpm.mjs',
  })

  try {
    writeFileSync(join(appDataPath, 'api'), 'process.exit(1)\n')
    assert.deepEqual(await createPlatform().loadCatalog(), catalogDocument())
    now += MARKETPLACE_CATALOG_CACHE_TTL_MS - 1
    assert.deepEqual(await createPlatform().loadCatalog(), catalogDocument())
    assert.equal(requests, 1)

    assert.deepEqual(await createPlatform().loadCatalog({ force: true }), catalogDocument())
    assert.equal(requests, 2)
    assert.deepEqual(conditionalHeaders, [null, '"catalog-v1"'])

    now += MARKETPLACE_CATALOG_CACHE_TTL_MS
    assert.deepEqual(await createPlatform().loadCatalog(), catalogDocument())
    assert.equal(requests, 3)

    transportFails = true
    assert.deepEqual(await createPlatform().loadCatalog({ force: true }), catalogDocument())
    assert.equal(requests, 4)
  } finally {
    rmSync(appDataPath, { recursive: true, force: true })
  }
})

test('catalog cache rejects unsupported documents before reuse', async () => {
  const appDataPath = mkdtempSync(join(tmpdir(), 'oh-dsh-marketplace-invalid-cache-'))
  const command = join(appDataPath, 'api')
  const cachePath = join(appDataPath, 'plugin-marketplace', 'catalog-cache.json')
  let document: unknown = { schema: 'unsupported/v1' }
  let requests = 0
  const createPlatform = (): ProductionMarketplacePlatform => new ProductionMarketplacePlatform({
    cliEntry: '/unused/dsh.mjs',
    cwd: appDataPath,
    env: {
      DSH_DESKTOP_APP_DATA: appDataPath,
      DSH_DESKTOP_GH_PATH: process.execPath,
      OH_DSH_MARKETPLACE_CATALOG: 'public-owner/public-catalog/data/plugins.json',
      PATH: '',
    },
    fetch: async (): Promise<Response> => {
      requests += 1
      return new Response(JSON.stringify(document), { status: 200 })
    },
    nodeBinary: process.execPath,
    now: () => 1_000,
    pnpmEntry: '/unused/pnpm.mjs',
  })

  try {
    writeFileSync(command, 'process.exit(1)\n')
    await assert.rejects(createPlatform().loadCatalog(), /unsupported plugin catalog/)
    assert.equal(existsSync(cachePath), false)

    document = catalogDocument()
    assert.deepEqual(await createPlatform().loadCatalog(), catalogDocument())
    assert.equal(requests, 2)
  } finally {
    rmSync(appDataPath, { recursive: true, force: true })
  }
})

test('GitHub CLI fallback reads raw catalogs larger than one megabyte', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-marketplace-gh-raw-'))
  const command = join(root, 'api')
  const catalogPath = join(root, 'catalog.json')
  const argumentsPath = join(root, 'arguments.json')
  const largeCatalog = {
    ...catalogDocument() as Record<string, unknown>,
    padding: 'x'.repeat(1024 * 1024),
  }
  try {
    const serializedCatalog = JSON.stringify(largeCatalog)
    assert.ok(Buffer.byteLength(serializedCatalog) > 1024 * 1024)
    writeFileSync(catalogPath, serializedCatalog)
    writeFileSync(command, [
      "const { readFileSync, writeFileSync } = require('node:fs')",
      "writeFileSync(process.env.OH_DSH_TEST_GH_ARGS, JSON.stringify(process.argv.slice(2)))",
      "process.stdout.write(readFileSync(process.env.OH_DSH_TEST_CATALOG))",
      '',
    ].join('\n'))
    const platform = new ProductionMarketplacePlatform({
      cliEntry: '/unused/dsh.mjs',
      cwd: root,
      env: {
        DSH_DESKTOP_GH_PATH: process.execPath,
        OH_DSH_MARKETPLACE_CATALOG: 'public-owner/public-catalog/data/plugins.json',
        OH_DSH_TEST_CATALOG: catalogPath,
        OH_DSH_TEST_GH_ARGS: argumentsPath,
      },
      fetch: async (): Promise<Response> => new Response('rate limited', { status: 403 }),
      nodeBinary: process.execPath,
      pnpmEntry: '/unused/pnpm.mjs',
    })

    assert.deepEqual(await platform.loadCatalog(), largeCatalog)
    assert.deepEqual(JSON.parse(readFileSync(argumentsPath, 'utf8')), [
      'repos/public-owner/public-catalog/contents/data/plugins.json',
      '-H',
      'Accept: application/vnd.github.raw+json',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('production bundle build runs approved hooks in its own workspace', {
  skip: process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')
    ? 'requires macOS Seatbelt'
    : false,
}, async () => {
  const sandboxRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-bundle-build-'))
  const candidateProfile = join(sandboxRoot, 'dsh-home', 'profiles', 'desktop')
  const checkout = join(sandboxRoot, 'bundle-builds', 'prepare-fixture')
  const helper = join(checkout, 'packages', 'helper')
  mkdirSync(helper, { recursive: true })
  mkdirSync(candidateProfile, { recursive: true })
  writeFileSync(join(candidateProfile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  writeFileSync(join(candidateProfile, 'package.json'), JSON.stringify({
    name: 'candidate-profile',
    private: true,
    scripts: { prepare: 'node profile-build.mjs' },
  }))
  writeFileSync(join(candidateProfile, 'profile-build.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    "writeFileSync(new URL('./profile-built', import.meta.url), 'wrong project\\n')",
    '',
  ].join('\n'))
  writeFileSync(join(checkout, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  writeFileSync(join(checkout, 'package.json'), JSON.stringify({
    name: '@example/prepare-fixture',
    dependencies: { '@example/workspace-helper': 'workspace:*' },
    scripts: {
      prepare: 'node build.mjs',
      prepack: 'node prepack.mjs',
      preprepack: 'node unexpected-prepack.mjs',
    },
    version: '1.0.0',
  }))
  writeFileSync(join(checkout, 'build.mjs'), [
    "import value from '@example/workspace-helper'",
    "import { mkdirSync, writeFileSync } from 'node:fs'",
    "mkdirSync(new URL('./lib/', import.meta.url), { recursive: true })",
    "writeFileSync(new URL('./lib/index.js', import.meta.url), `${value}\\n`)",
    '',
  ].join('\n'))
  writeFileSync(join(checkout, 'prepack.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    "writeFileSync(new URL('./prepacked', import.meta.url), 'prepacked\\n')",
    '',
  ].join('\n'))
  writeFileSync(join(checkout, 'unexpected-prepack.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    "writeFileSync(new URL('./unexpected-prepack', import.meta.url), 'unexpected\\n')",
    '',
  ].join('\n'))
  writeFileSync(join(helper, 'package.json'), JSON.stringify({
    name: '@example/workspace-helper',
    exports: './index.mjs',
    scripts: { prepare: 'node unexpected-prepare.mjs' },
    version: '1.0.0',
  }))
  writeFileSync(join(helper, 'index.mjs'), "export default 'workspace-built'\n")
  writeFileSync(join(helper, 'unexpected-prepare.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    "writeFileSync(new URL('./unexpected-prepare', import.meta.url), 'unexpected\\n')",
    '',
  ].join('\n'))

  try {
    const platform = new ProductionMarketplacePlatform({
      cliEntry: '/unused/dsh.mjs',
      cwd: checkout,
      env: process.env,
      nodeBinary: process.execPath,
      pnpmEntry: fileURLToPath(new URL('../node_modules/pnpm/bin/pnpm.mjs', import.meta.url)),
    })
    await platform.buildBundle({
      checkout,
      sandboxRoot,
      scripts: ['prepare', 'prepack'],
    })
    assert.equal(readFileSync(join(checkout, 'lib/index.js'), 'utf8'), 'workspace-built\n')
    assert.equal(readFileSync(join(checkout, 'prepacked'), 'utf8'), 'prepacked\n')
    assert.equal(existsSync(join(checkout, 'unexpected-prepack')), false)
    assert.equal(existsSync(join(helper, 'unexpected-prepare')), false)
    assert.equal(existsSync(join(candidateProfile, 'profile-built')), false)
  } finally {
    rmSync(sandboxRoot, { recursive: true, force: true })
  }
})

test('scripted bundle previews use Linux Landlock and fail closed without it', () => {
  const linux = previewScriptCommand({
    nodeArguments: ['/preview/pnpm.mjs', 'install'],
    nodeBinary: '/preview/node',
    pathExists: () => true,
    platform: 'linux',
    root: '/preview',
    sandbox: '/runtime/landlock-run',
  })
  assert.deepEqual(linux, {
    command: '/runtime/landlock-run',
    args: ['--ro', '/', '--rw', '/preview', '--rw', '/dev/null', '--', '/preview/node', '/preview/pnpm.mjs', 'install'],
  })
  assert.throws(() => previewScriptCommand({
    nodeArguments: ['/preview/pnpm.mjs', 'install'],
    nodeBinary: '/preview/node',
    pathExists: () => false,
    platform: 'linux',
    root: '/preview',
  }), /unavailable on linux/)
  assert.throws(() => previewScriptCommand({
    nodeArguments: ['/preview/pnpm.mjs', 'install'],
    nodeBinary: '/preview/node',
    pathExists: () => false,
    platform: 'win32',
    root: '/preview',
  }), /unavailable on win32/)
  assert.throws(() => previewScriptCommand({
    nodeArguments: ['/preview/pnpm.mjs', 'install'],
    nodeBinary: '/preview/node',
    pathExists: () => false,
    platform: 'darwin',
    root: '/preview',
  }), /unavailable on darwin/)
  const darwinRuntime = previewRuntimeLauncher({
    pathExists: () => true,
    platform: 'darwin',
    root: '/preview',
  })
  assert.deepEqual(darwinRuntime, {
    command: '/usr/bin/sandbox-exec',
    args: ['-p', previewSandboxPolicy('/preview')],
  })
})

test('refresh keeps public catalogs available when GitHub CLI is unavailable', async () => {
  const setup = fixture()
  try {
    setup.platform.authStatus = async (): Promise<MarketplaceAuthResult> => ({
      detail: 'GitHub CLI is unavailable',
      status: 'missing-cli',
    })
    const snapshot = await setup.manager.dispatch({ type: 'refresh', force: true })
    assert.equal(snapshot.auth.status, 'missing-cli')
    assert.equal(snapshot.catalog.length, 6)
    assert.equal(snapshot.error, null)
    assert.deepEqual(setup.platform.catalogLoads, [{ force: true }])
  } finally {
    setup.cleanup()
  }
})

test('a client reconnect during apply does not leave a sticky busy error', async () => {
  const setup = fixture()
  try {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    setup.platform.loadCatalog = async (): Promise<unknown> => {
      await gate
      return catalogDocument()
    }
    const refresh = setup.manager.dispatch({ type: 'refresh' })
    await new Promise(resolve => { setImmediate(resolve) })
    const reconnect = await setup.manager.dispatch({ type: 'refresh' })
    assert.equal(reconnect.busy, true)
    assert.equal(reconnect.error, null)
    release?.()
    const settled = await refresh
    assert.equal(settled.busy, false)
    assert.equal(settled.error, null)
  } finally {
    setup.cleanup()
  }
})

test('Agent gateway authenticates and defers runtime-restarting applies', async () => {
  const setup = fixture()
  const gateway = await startMarketplaceAgentGateway(setup.manager, { deferMs: 5 })
  try {
    const unauthorized = await fetch(gateway.url, {
      body: JSON.stringify({ type: 'snapshot' }),
      method: 'POST',
    })
    assert.equal(unauthorized.status, 401)

    await setup.manager.dispatch({ type: 'refresh' })
    const prepare = await fetch(gateway.url, {
      body: JSON.stringify({
        type: 'dispatch',
        command: { type: 'prepare', action: 'install', pluginId: 'safe-demo' },
      }),
      headers: { authorization: `Bearer ${gateway.token}` },
      method: 'POST',
    })
    assert.equal(prepare.status, 200)
    const prepared = await prepare.json() as { snapshot: { preview: { pluginId: string } | null } }
    assert.equal(prepared.snapshot.preview?.pluginId, 'safe-demo')

    const apply = await fetch(gateway.url, {
      body: JSON.stringify({ type: 'dispatch', command: { type: 'apply' } }),
      headers: { authorization: `Bearer ${gateway.token}` },
      method: 'POST',
    })
    assert.equal(apply.status, 202)
    const accepted = await apply.json() as { deferred: boolean }
    assert.equal(accepted.deferred, true)
    assert.equal(setup.manager.getSnapshot().preview?.pluginId, 'safe-demo')

    for (let attempt = 0; attempt < 30 && setup.manager.getSnapshot().preview !== null; attempt += 1) {
      await new Promise(resolve => { setTimeout(resolve, 5) })
    }
    assert.equal(setup.manager.getSnapshot().preview, null)
    assert.equal(setup.manager.getSnapshot().installed[0]?.pluginId, 'safe-demo')
  } finally {
    await gateway.close()
    setup.cleanup()
  }
})

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('test server did not bind a TCP port'))
        return
      }
      resolve(`http://127.0.0.1:${String(address.port)}`)
    })
  })
}

test('web preview proxy publishes the loopback child through the outer origin', async () => {
  const target = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end(`preview:${_request.url ?? '/'}`)
  })
  const targetUrl = await listen(target)
  const proxy = new MarketplacePreviewProxy()
  const previewPath = proxy.register('tx-123', new URL(targetUrl))
  assert.equal(
    previewPath,
    `${MARKETPLACE_WEB_PREVIEW_PATH}/tx-123/?oh-dsh-marketplace-preview=1`,
  )
  let mounted: Parameters<MarketplacePreviewProxyContext['webServer']['register']>[0] | undefined
  proxy.mount({
    webServer: {
      register: route => {
        mounted = route
        return () => {}
      },
    },
  })
  assert.ok(mounted)
  assert.equal(mounted?.kind, 'prefix')
  const outer = createServer((request, response) => {
    if (mounted === undefined) {
      response.writeHead(500)
      response.end()
      return
    }
    void mounted.handler(request, response)
  })
  const outerUrl = await listen(outer)
  try {
    const response = await fetch(`${outerUrl}${MARKETPLACE_WEB_PREVIEW_PATH}/tx-123/assets/app.js?from=outer`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'preview:/assets/app.js?from=outer')
    proxy.unregister('tx-123')
    const missing = await fetch(`${outerUrl}${MARKETPLACE_WEB_PREVIEW_PATH}/tx-123/`)
    assert.equal(missing.status, 404)
  } finally {
    await new Promise<void>(resolve => { target.close(() => { resolve() }) })
    await new Promise<void>(resolve => { outer.close(() => { resolve() }) })
  }
})

test('web restart wait observes the old host leave and the new host arrive', async () => {
  let calls = 0
  const fetcher = async () => {
    calls += 1
    if (calls <= 2) return new Response(null, { status: 200 })
    if (calls === 3) throw new Error('old host exited')
    return new Response(null, { status: 200 })
  }
  await waitForMarketplaceRestart(
    '/oh-dsh/plugin-marketplace',
    5_000,
    5_000,
    fetcher as unknown as typeof fetch,
  )
  assert.equal(calls, 4)
})

test('TUI repository metadata includes every fetched field', async () => {
  const plugin = parseMarketplaceCatalog({
    schema: 'dsh-external-hub/v0.1',
    repos: [{
      name: 'tui-demo',
      repo: 'example/tui-demo',
      category: 'plugin',
      description: 'TUI demo',
      bundle: true,
      stats: {
        forks: 5,
        language: 'TypeScript',
        license: 'MIT License',
        openIssues: 7,
        stars: 42,
        updatedAt: '2026-08-27T12:00:00Z',
      },
    }],
  }).plugins[0]
  assert.notEqual(plugin, undefined)
  if (plugin === undefined) return

  const lines = marketplaceRepositoryDetails(plugin)
  assert.match(lines.join('\n'), /★ 42/)
  assert.match(lines.join('\n'), /forks 5/)
  assert.match(lines.join('\n'), /issues \+ PRs 7/)
  assert.match(lines.join('\n'), /TypeScript/)
  assert.match(lines.join('\n'), /MIT License/)
  assert.doesNotMatch(lines.join('\n'), /updated: unknown/)
})

test('TUI marketplace loads repository metadata when details open', async () => {
  const plugin = parseMarketplaceCatalog({
    schema: 'dsh-external-hub/v0.1',
    repos: [{
      name: 'tui-demo',
      repo: 'example/tui-demo',
      category: 'plugin',
      description: 'TUI demo',
      bundle: true,
    }],
  }).plugins[0]
  assert.notEqual(plugin, undefined)
  if (plugin === undefined) return
  const snapshot: MarketplaceSnapshot = {
    auth: { detail: '', status: 'ready' },
    busy: false,
    catalog: [plugin],
    catalogGeneratedAt: null,
    error: null,
    installed: [],
    lastAction: null,
    lifecycle: { candidate: null, current: { profile: 'tui', state: 'live' }, previous: null },
    plan: null,
    preview: null,
    sourceLocks: [],
    undoAvailable: false,
  }
  const stats = {
    forks: 5,
    language: 'TypeScript',
    license: 'MIT License',
    openIssues: 7,
    stars: 42,
    updatedAt: '2026-08-27T12:00:00Z',
  }
  const commands: unknown[] = []
  const controller = new TuiMarketplaceController({
    getSnapshot: async () => snapshot,
    dispatch: async (command): Promise<MarketplaceSnapshot> => {
      commands.push(command)
      return { ...snapshot, catalog: [{ ...plugin, stats }] }
    },
  })

  await controller.load()
  controller.openDetail(plugin.id)
  await new Promise<void>(resolve => { setImmediate(resolve) })

  assert.deepEqual(commands, [{ type: 'load-repository-stats', pluginId: plugin.id }])
  assert.deepEqual(controller.selectedPlugin()?.stats, stats)
  controller.openDetail(null)
  controller.openDetail(plugin.id)
  await new Promise<void>(resolve => { setImmediate(resolve) })
  assert.equal(commands.length, 1)
})

test('TUI marketplace hides built-ins until the user reveals them', async () => {
  const catalog = parseMarketplaceCatalog(catalogDocument()).plugins
  const snapshot: MarketplaceSnapshot = {
    auth: { detail: '', status: 'ready' },
    busy: false,
    catalog,
    catalogGeneratedAt: null,
    error: null,
    installed: [],
    lastAction: null,
    lifecycle: { candidate: null, current: { profile: 'tui', state: 'live' }, previous: null },
    plan: null,
    preview: null,
    sourceLocks: [],
    undoAvailable: false,
  }
  const controller = new TuiMarketplaceController({
    getSnapshot: async () => snapshot,
    dispatch: async () => snapshot,
  })

  await controller.load()
  assert.equal(controller.getSnapshot().showBuiltins, false)
  assert.equal(controller.filteredPlugins().some(plugin => plugin.builtin), false)

  controller.toggleBuiltins()
  assert.equal(controller.getSnapshot().showBuiltins, true)
  const builtin = controller.filteredPlugins().find(plugin => plugin.builtin)
  assert.equal(builtin?.id, 'oh-dsh-desktop')
  if (builtin === undefined) return

  controller.openDetail(builtin.id)
  controller.toggleBuiltins()
  assert.equal(controller.getSnapshot().showBuiltins, false)
  assert.equal(controller.getSnapshot().screen, 'list')
  assert.equal(controller.getSnapshot().selectedId, null)
  const tui = readFileSync(new URL(
    '../plugins/tui-marketplace/src/marketplace.tsx',
    import.meta.url,
  ), 'utf8')
  assert.match(tui, /key\.ctrl && input === 'b'/)
  assert.match(tui, /plugin\.protected === false/)
  assert.match(tui, /plugin\.builtin[\s\S]*?\? 'built-in'/)
})

test('TUI marketplace collects explicit risk confirmations before preview', async () => {
  const snapshot: MarketplaceSnapshot = {
    auth: { detail: '', status: 'ready' },
    busy: false,
    catalog: [],
    catalogGeneratedAt: null,
    error: 'test snapshot is already loaded',
    installed: [],
    lastAction: null,
    lifecycle: { candidate: null, current: { profile: 'tui', state: 'live' }, previous: null },
    plan: {
      action: 'install',
      buildScripts: { prepare: 'node build.mjs' },
      description: '',
      manifestHash: '',
      mechanism: 'bundle',
      packageName: '@example/tui',
      pluginId: 'tui-demo',
      repository: 'example/tui-demo',
      requirements: ['allow-build-scripts', 'accept-high-risk'],
      resolvedCommit: COMMIT,
      riskLevel: 'high',
      riskReasons: ['install-scripts', 'trusted-host-code'],
      source: `github:example/tui-demo#${COMMIT}`,
      sourceReview: 'first-use',
    },
    preview: null,
    sourceLocks: [],
    undoAvailable: false,
  }
  const commands: unknown[] = []
  const controller = new TuiMarketplaceController({
    getSnapshot: async () => snapshot,
    dispatch: async (command): Promise<MarketplaceSnapshot> => {
      commands.push(command)
      return {
        ...snapshot,
        preview: {
          action: 'install',
          isolated: true,
          pluginId: 'tui-demo',
          previewUrl: null,
          resolvedCommit: COMMIT,
          startedAt: '',
          transactionId: 'tx',
        },
      }
    },
  })
  await controller.load()
  commands.length = 0
  await controller.preview()
  assert.equal(controller.getSnapshot().confirmation, 'allow-build-scripts')
  controller.acceptConfirmation()
  assert.equal(controller.getSnapshot().confirmation, 'accept-high-risk')
  controller.acceptConfirmation()
  await new Promise<void>(resolve => { setImmediate(resolve) })
  assert.deepEqual(commands, [{
    type: 'preview',
    confirmations: ['allow-build-scripts', 'accept-high-risk'],
  }])
})

test('web HTTP bridge carries the shared marketplace protocol', async () => {
  const snapshot = {
    auth: { detail: '', status: 'ready' },
    busy: false,
    catalog: [],
    catalogGeneratedAt: null,
    error: 'test snapshot is already loaded',
    installed: [],
    lastAction: null,
    lifecycle: { candidate: null, current: { profile: 'web', state: 'live' }, previous: null },
    plan: null,
    preview: null,
    sourceLocks: [],
    undoAvailable: false,
  }
  const calls: Array<{ body?: unknown; method?: string | null }> = []
  const fetcher = async (_path: string, init?: RequestInit) => {
    calls.push({ body: init?.body, method: init?.method ?? null })
    if (init?.body !== undefined) {
      return new Response(JSON.stringify(snapshot), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    }
    return new Response(JSON.stringify(snapshot), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    })
  }
  const bridge = createMarketplaceHttpBridge(
    '/oh-dsh/plugin-marketplace',
    fetcher as unknown as typeof fetch,
  )
  assert.deepEqual(await bridge.getSnapshot(), snapshot)
  assert.deepEqual(calls[0], { body: undefined, method: 'GET' })
  assert.deepEqual(await bridge.dispatch({ type: 'discard' }), snapshot)
  assert.deepEqual(calls[1], {
    body: JSON.stringify({ type: 'discard' }),
    method: 'POST',
  })
})

test('marketplace navigation preserves the Settings footer geometry', () => {
  const client = readFileSync(new URL(
    '../plugins/plugin-marketplace/src/client/plugin.tsx',
    import.meta.url,
  ), 'utf8')
  const css = readFileSync(new URL(
    '../plugins/plugin-marketplace/src/client/marketplace.css',
    import.meta.url,
  ), 'utf8')
  const messages = readFileSync(new URL(
    '../plugins/plugin-marketplace/src/client/i18n.ts',
    import.meta.url,
  ), 'utf8')
  assert.doesNotMatch(client, /--oh-marketplace-sidebar-height/)
  assert.doesNotMatch(client, /SIDEBAR_BOTTOM_INSET/)
  assert.doesNotMatch(css, /data-oh-dsh-marketplace-sidebar-root/)
  assert.match(css, /\.oh-marketplace-nav \{[\s\S]*gap: 8px;/)
  assert.match(css, /\.oh-marketplace-nav \{[\s\S]*padding: 6px 2px 6px 10px;/)
  assert.match(css, /\.oh-marketplace-nav svg \{[\s\S]*width: 16px;[\s\S]*height: 16px;/)
  assert.match(css, /data-oh-dsh-marketplace-footer-stack='true'/)
  assert.match(css, /flex-direction: column !important;/)
  assert.match(client, /marketplaceFooter\(settings\)/)
  assert.match(client, /removeAttribute\(FOOTER_STACK_ATTRIBUTE\)/)
  assert.match(client, /export const inject = \['locale', 'sessions', 'slots'\]/)
  assert.match(client, /ctx\.get\('sessions'\) as SessionsService/)
  assert.match(client, /this\.#sessions\.list\.subscribe\(syncSessionNavigation\)/)
  assert.match(client, /this\.#unsubscribeSessions\?\.\(\)/)
  assert.match(client, /locale\.register\('oh-dsh\.plugin-marketplace'/)
  assert.match(client, /\['installed', t\('installed'\)\]/)
  assert.match(client, /\['available', t\('not-installed'\)\]/)
  assert.match(client, /\['updates', t\('updates'\)\]/)
  assert.match(client, /\['disabled', t\('disabled'\)\]/)
  assert.match(client, /const \[showBuiltins, setShowBuiltins\] = useState\(false\)/)
  assert.match(client, /value=\{BUILTIN_CATEGORY_FILTER\}>\{t\('builtin'\)\}/)
  assert.match(client, /aria-label=\{t\('show-builtins'\)\}/)
  assert.match(client, /showBuiltins \|\| !plugin\.builtin/)
  assert.match(client, /return plugin\.installed \|\| plugin\.builtin/)
  assert.match(client, /visibleCatalog\.filter\(presentationInstalled\)/)
  assert.match(client, /statusFilter === 'installed' && !installed/)
  assert.match(client, /statusFilter === 'available' && installed/)
  assert.match(client, /plugin\.builtin \|\| !plugin\.updateAvailable/)
  assert.match(client, /plugin\.builtin \|\| !plugin\.installed \|\| plugin\.enabled/)
  assert.match(client, /plugin\.builtin \? t\('builtin'\)/)
  assert.match(client, /plugin\.installed && !plugin\.builtin/)
  assert.match(client, /!plugin\.builtin && plugin\.updateAvailable/)
  assert.match(client, /plugin\.id === selectedId && plugin\.builtin/)
  assert.match(client, /type: 'prepare'/)
  assert.match(client, /confirmations\.includes\(requirement\)/)
  assert.match(client, /snapshot\.auth\.status !== 'ready' && snapshot\.catalog\.length === 0/)
  assert.match(client, /source-review\.\$\{plan\.sourceReview\}/)
  assert.match(client, /risk-level\.\$\{plan\.riskLevel\}/)
  assert.match(messages, /installed: '已安装'/)
  assert.match(messages, /'not-installed': '未安装'/)
  assert.match(messages, /'accept-high-risk': '我了解/)
  assert.match(messages, /'recovery-note': '应用时会原子替换/)
  assert.match(css, /\.oh-marketplace-flow/)
  assert.match(css, /data-risk='high'/)
  assert.match(client, /settingsDialogOpen\(\)/)
  assert.match(client, /document\.addEventListener\('click', this\.#handleDocumentClick, true\)/)
  assert.match(client, /button === settingsButton\(\)/)
  assert.match(client, /const sidebar = document\.querySelector<HTMLElement>\('\[data-slot="sidebar"\]'\)/)
  assert.match(client, /sidebar === null[\s\S]*?querySelectorAll<HTMLButtonElement>\('button'\)/)
  assert.match(client, /sidebar\.querySelectorAll<HTMLButtonElement>\('button'\)/)
  assert.match(client, /if \(!this\.#state\.open\) return/)
  assert.match(client, /if \(open\) this\.scheduleGeometry\(\)/)
  assert.match(client, /this\.synchronizeFooterStack\(\)/)
  assert.match(client, /settingsButton\(false\)/)
  assert.match(client, /if \(disposed \|\| info\.preview !== null\) return/)
  assert.match(client, /const slots = ctx\.get\('slots'\) as SlotsService/)
  assert.match(client, /slots\.inject\('sidebar\.footer\.action'/)
  assert.doesNotMatch(client, /ctx\.slots/)
  assert.doesNotMatch(client, /parent\.insertBefore\(this\.#entry, settings\)/)
})

test('browser marketplace resets category filters removed with built-ins', () => {
  const client = readFileSync(new URL(
    '../plugins/plugin-marketplace/src/client/plugin.tsx',
    import.meta.url,
  ), 'utf8')

  assert.match(client, /const remainingCategories = new Set\(\(snapshot\?\.catalog \?\? \[\]\)[\s\S]*?\.filter\(plugin => !plugin\.builtin\)[\s\S]*?\.map\(plugin => plugin\.category\)\)/)
  assert.match(client, /categoryFilter !== 'all' && !remainingCategories\.has\(categoryFilter\)/)
  assert.doesNotMatch(client, /categoryFilter === BUILTIN_CATEGORY_FILTER\) setCategoryFilter\('all'\)/)
})

test('marketplace startup disables manual refresh until refresh settles', () => {
  const client = readFileSync(new URL(
    '../plugins/plugin-marketplace/src/client/plugin.tsx',
    import.meta.url,
  ), 'utf8')
  assert.match(client, /const \[pending, setPending\] = useState\(true\)/)
  assert.match(client, /\.finally\(\(\) => \{\s*if \(alive\) setPending\(false\)\s*\}\)/)
  assert.match(client, /disabled=\{pending\}[\s\S]{0,160}type: 'refresh', force: true/)
})

test('marketplace closes after ready session navigation, not during startup', () => {
  let state = initialSessionNavigationState()
  let transition = transitionSessionNavigation(state, {
    current: undefined,
    phase: 'pending',
  })
  assert.equal(transition.close, false)
  assert.deepEqual(transition.state, { current: undefined, ready: false })

  state = transition.state
  transition = transitionSessionNavigation(state, {
    current: 'session-a',
    phase: 'ready',
  })
  assert.equal(transition.close, false)
  assert.deepEqual(transition.state, { current: 'session-a', ready: true })

  state = transition.state
  transition = transitionSessionNavigation(state, {
    current: 'session-b',
    phase: 'pending',
  })
  assert.equal(transition.close, false)
  assert.deepEqual(transition.state, { current: 'session-a', ready: true })

  state = transition.state
  transition = transitionSessionNavigation(state, {
    current: 'session-b',
    phase: 'ready',
  })
  assert.equal(transition.close, true)
  assert.deepEqual(transition.state, { current: 'session-b', ready: true })

  state = transition.state
  transition = transitionSessionNavigation(state, {
    current: 'session-b',
    phase: 'ready',
  })
  assert.equal(transition.close, false)
})

test('marketplace closes when an empty baseline activates a new session', () => {
  let state = initialSessionNavigationState()
  state = transitionSessionNavigation(state, {
    current: undefined,
    phase: 'ready',
  }).state
  const transition = transitionSessionNavigation(state, {
    current: 'new-session',
    phase: 'ready',
  })
  assert.equal(transition.close, true)
  assert.deepEqual(transition.state, { current: 'new-session', ready: true })
})

test('preview strips a stale pnpm store reference from the copied profile', async () => {
  const setup = fixture()
  try {
    // Simulate a live profile whose node_modules references a store that no
    // longer exists (a previously applied preview deleted its store). pnpm
    // refuses such trees with ERR_PNPM_UNEXPECTED_STORE.
    const modulesDir = join(setup.profileDir, 'node_modules')
    mkdirSync(modulesDir, { recursive: true })
    writeFileSync(join(modulesDir, '.modules.yaml'), 'storeDir: "/deleted/preview/.pnpm-store/v11"\n')
    writeFileSync(join(setup.profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n')

    let snapshot = await setup.manager.dispatch({ type: 'refresh' })
    assert.equal(snapshot.error, null)
    snapshot = await setup.manager.dispatch({ type: 'inspect', action: 'install', pluginId: 'bundle-demo' })
    assert.equal(snapshot.error, null)
    snapshot = await setup.manager.dispatch({ type: 'preview', confirmations: ["allow-build-scripts"] })
    assert.equal(snapshot.error, null)

    // The copied candidate must not keep the stale tree: the preview's pnpm
    // commands would fail on it, and the applied profile would again
    // reference a store deleted with the preview.
    const candidate = join(
      setup.appDataPath,
      'plugin-marketplace',
      'previews',
      snapshot.preview?.transactionId ?? '',
      'dsh',
      'profiles',
      'desktop',
    )
    assert.equal(existsSync(join(candidate, 'node_modules')), false)
    assert.equal(existsSync(join(candidate, 'pnpm-lock.yaml')), false)
    // The live profile keeps its (stale) tree untouched — only the copy is
    // stripped for rebuild.
    assert.equal(existsSync(join(setup.profileDir, 'node_modules')), true)
  } finally {
    setup.cleanup()
  }
})

test('bundle preview remains isolated until apply and supports undo', async () => {
  const setup = fixture()
  try {
    let snapshot = await setup.manager.dispatch({ type: 'refresh' })
    assert.equal(snapshot.catalog.length, 6)
    snapshot = await setup.manager.dispatch({ type: 'inspect', action: 'install', pluginId: 'bundle-demo' })
    assert.deepEqual(snapshot.plan?.buildScripts, { prepare: 'node build.mjs' })

    snapshot = await setup.manager.dispatch({ type: 'preview', confirmations: [] })
    assert.match(snapshot.error ?? '', /allow-build-scripts/)
    assert.equal(snapshot.preview, null)

    snapshot = await setup.manager.dispatch({ type: 'preview', confirmations: ["allow-build-scripts"] })
    assert.equal(snapshot.error, null)
    assert.equal(snapshot.preview?.pluginId, 'bundle-demo')
    assert.equal(snapshot.preview?.isolated, true)
    assert.equal(setup.platform.builds.length, 1)
    assert.equal(setup.platform.builds[0]?.sandboxed, true)
    assert.equal(setup.platform.commands[0]?.sandboxed, true)
    assert.equal(setup.platform.commands[1]?.sandboxed, true)
    assert.equal(setup.runtime.previewStarts[0]?.sandboxed, true)
    assert.deepEqual(setup.platform.builds[0]?.scripts, ['prepare'])
    const build = setup.platform.builds[0]
    assert.equal(
      build?.checkout,
      join(
        build?.sandboxRoot ?? '',
        'bundle-builds',
        `bundle-demo-${COMMIT.slice(0, 12)}`,
      ),
    )
    assert.equal(setup.runtime.previewStarts.length, 1)
    const liveBefore = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.deepEqual(liveBefore.dependencies, {})

    snapshot = await setup.manager.dispatch({ type: 'apply' })
    assert.equal(snapshot.preview, null)
    assert.equal(snapshot.undoAvailable, true)
    assert.equal(snapshot.installed[0]?.pluginId, 'bundle-demo')
    const liveAfter = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.match(
      liveAfter.dependencies['@example/bundle-demo'],
      /^link:\.oh-dsh\/sources\/bundle-demo-/,
    )
    assert.doesNotMatch(
      liveAfter.dependencies['@example/bundle-demo'],
      /plugin-marketplace\/previews/,
    )
    assert.equal(setup.platform.commands.length, 3)
    assert.deepEqual(setup.platform.commands[1]?.args.slice(-2), ['install', '--ignore-scripts'])
    // After apply, the live profile's node_modules is re-homed against the
    // persistent store: an unsandboxed install on the live profile, so the
    // profile never keeps referencing the preview store deleted below.
    assert.deepEqual(setup.platform.commands[2]?.args.slice(-2), ['install', '--ignore-scripts'])
    assert.equal(setup.platform.commands[2]?.sandboxed, false)
    assert.equal(setup.platform.commands[2]?.dshHome, setup.dshHome)
    assert.equal(setup.runtime.liveStops, 1)
    assert.equal(setup.runtime.liveStarts, 1)

    snapshot = await setup.manager.dispatch({ type: 'undo' })
    assert.equal(snapshot.undoAvailable, false)
    assert.deepEqual(snapshot.installed, [])
    const restored = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.deepEqual(restored.dependencies, {})
  } finally {
    setup.cleanup()
  }
})

test('safe actions prepare an isolated candidate in one transaction', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    const snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'safe-demo',
    })
    assert.equal(snapshot.error, null)
    assert.equal(snapshot.plan?.riskLevel, 'low')
    assert.deepEqual(snapshot.plan?.requirements, [])
    assert.equal(snapshot.plan?.sourceReview, 'first-use')
    assert.match(snapshot.plan?.manifestHash ?? '', /^[0-9a-f]{64}$/)
    assert.equal(snapshot.preview?.pluginId, 'safe-demo')
    assert.equal(snapshot.preview?.isolated, true)
    assert.equal(setup.runtime.previewStarts[0]?.sandboxed, true)
    assert.equal(setup.platform.commands[0]?.sandboxed, true)
  } finally {
    setup.cleanup()
  }
})

test('unsandboxed builds require direct human approval', async () => {
  const setup = fixture()
  try {
    setup.platform.scriptSandboxAvailable = false
    await setup.manager.dispatch({ type: 'refresh' })
    let snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'bundle-demo',
    })
    assert.deepEqual(snapshot.plan?.requirements, [
      'allow-build-scripts',
      'accept-unsandboxed-build',
    ])

    snapshot = await setup.manager.dispatch({
      type: 'preview',
      confirmations: ['allow-build-scripts', 'accept-unsandboxed-build'],
    }, 'agent')
    assert.match(snapshot.error ?? '', /direct human approval/)
    assert.equal(snapshot.preview, null)
    assert.equal(setup.platform.builds.length, 0)

    snapshot = await setup.manager.dispatch({
      type: 'preview',
      confirmations: ['allow-build-scripts', 'accept-unsandboxed-build'],
    }, 'human-ui')
    assert.equal(snapshot.error, null)
    assert.equal(snapshot.preview?.pluginId, 'bundle-demo')
    assert.equal(snapshot.preview?.isolated, false)
    assert.match(snapshot.lastAction ?? '', /without process isolation/)
    assert.equal(setup.platform.builds.length, 1)
    assert.equal(setup.platform.builds[0]?.sandboxed, false)
    assert.equal(setup.platform.commands[0]?.sandboxed, false)
    assert.equal(setup.platform.commands[1]?.sandboxed, false)
    assert.equal(setup.runtime.previewStarts[0]?.sandboxed, false)
  } finally {
    setup.cleanup()
  }
})

test('scriptless previews stay usable when confinement is unavailable', async () => {
  const setup = fixture()
  try {
    setup.platform.scriptSandboxAvailable = false
    await setup.manager.dispatch({ type: 'refresh' })
    const snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'safe-demo',
    })
    assert.equal(snapshot.error, null)
    assert.deepEqual(snapshot.plan?.requirements, [])
    assert.equal(snapshot.preview?.pluginId, 'safe-demo')
    assert.equal(snapshot.preview?.isolated, false)
    assert.equal(setup.platform.commands[0]?.sandboxed, false)
    assert.equal(setup.runtime.previewStarts[0]?.sandboxed, false)
  } finally {
    setup.cleanup()
  }
})

test('risky plans require explicit acknowledgements before preview', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    let snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'bundle-demo',
    })
    assert.equal(snapshot.preview, null)
    assert.equal(snapshot.plan?.riskLevel, 'elevated')
    assert.deepEqual(snapshot.plan?.riskReasons, ['install-scripts'])
    assert.deepEqual(snapshot.plan?.requirements, ['allow-build-scripts'])

    snapshot = await setup.manager.dispatch({
      type: 'preview',
      confirmations: [],
    })
    assert.match(snapshot.error ?? '', /allow-build-scripts/)
    assert.equal(snapshot.preview, null)

    snapshot = await setup.manager.dispatch({
      type: 'preview',
      confirmations: ['allow-build-scripts'],
    })
    assert.equal(snapshot.error, null)
    assert.equal(snapshot.preview?.pluginId, 'bundle-demo')

    await setup.manager.dispatch({ type: 'discard' })
    snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'repository-demo',
    })
    assert.equal(snapshot.plan?.riskLevel, 'high')
    assert.ok(snapshot.plan?.riskReasons.includes('trusted-host-code'))
    assert.ok(snapshot.plan?.requirements.includes('accept-high-risk'))
  } finally {
    setup.cleanup()
  }
})

test('TOFU locks survive uninstall and gate source identity changes', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'safe-demo',
    })
    let snapshot = await setup.manager.dispatch({ type: 'apply' })
    assert.equal(snapshot.sourceLocks.length, 1)
    assert.equal(snapshot.sourceLocks[0]?.pluginId, 'safe-demo')
    assert.equal(snapshot.lifecycle.previous?.pluginId, 'safe-demo')

    snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'uninstall',
      pluginId: 'safe-demo',
    })
    assert.equal(snapshot.preview?.action, 'uninstall')
    snapshot = await setup.manager.dispatch({ type: 'apply' })
    assert.deepEqual(snapshot.installed, [])
    assert.equal(snapshot.sourceLocks.length, 1)

    await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'bundle-demo',
    })
    await setup.manager.dispatch({
      type: 'preview',
      confirmations: ['allow-build-scripts'],
    })
    await setup.manager.dispatch({ type: 'apply' })
    await setup.manager.dispatch({
      type: 'prepare',
      action: 'uninstall',
      pluginId: 'bundle-demo',
    })
    await setup.manager.dispatch({ type: 'apply' })

    setup.platform.bundleName = '@example/renamed-bundle'
    setup.platform.latestCommit = UPDATED_COMMIT
    snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'bundle-demo',
    })
    assert.equal(snapshot.plan?.sourceReview, 'changed')
    assert.equal(snapshot.plan?.riskLevel, 'high')
    assert.ok(snapshot.plan?.requirements.includes('accept-source-change'))
  } finally {
    setup.cleanup()
  }
})

test('TOFU detects changed content at an already pinned commit', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'bundle-demo',
    })
    await setup.manager.dispatch({
      type: 'preview',
      confirmations: ['allow-build-scripts'],
    })
    await setup.manager.dispatch({ type: 'apply' })
    await setup.manager.dispatch({
      type: 'prepare',
      action: 'uninstall',
      pluginId: 'bundle-demo',
    })
    await setup.manager.dispatch({ type: 'apply' })

    setup.platform.bundleDescription = 'Tampered manifest at the same commit'
    const snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'bundle-demo',
    })
    assert.match(snapshot.error ?? '', /changed content at pinned commit/)
    assert.equal(snapshot.preview, null)
  } finally {
    setup.cleanup()
  }
})

test('the marketplace refuses to modify protected desktop plugins', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    const snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'oh-dsh-desktop',
    })
    assert.match(snapshot.error ?? '', /protected by Oh-DSH/)
    assert.equal(snapshot.preview, null)
    const plugin = snapshot.catalog.find(candidate => candidate.id === 'oh-dsh-desktop')
    assert.equal(plugin?.protected, true)
    assert.equal(plugin?.builtin, true)
  } finally {
    setup.cleanup()
  }
})

test('the marketplace protects the bundled dsh-auth plugin', async () => {
  const setup = fixture()
  try {
    setup.platform.catalog = {
      schema: 'dsh-external-hub/v0.1',
      generated: '2026-08-14T00:00:00Z',
      repos: [{
        name: 'dsh-auth',
        repo: 'ccch1mneyyy/dsh-auth',
        category: 'plugin',
        description: 'Subscription OAuth sign-in already bundled by Oh-DSH',
        bundle: true,
      }],
    }
    await setup.manager.dispatch({ type: 'refresh' })
    const snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'dsh-auth',
    })
    assert.match(snapshot.error ?? '', /protected by Oh-DSH/)
    assert.equal(snapshot.preview, null)
    assert.equal(snapshot.catalog[0]?.protected, true)
    assert.equal(snapshot.catalog[0]?.builtin, true)
    assert.equal(setup.platform.commands.length, 0)
  } finally {
    setup.cleanup()
  }
})

test('the marketplace protects the bundled dsh-context plugin', async () => {
  const setup = fixture()
  try {
    setup.platform.catalog = {
      schema: 'dsh-external-hub/v0.1',
      generated: '2026-08-14T00:00:00Z',
      repos: [{
        name: 'dsh-context',
        repo: 'bowenliang123/dsh-context',
        category: 'plugin',
        description: 'Context insight plugin already bundled by Oh-DSH',
        bundle: true,
      }],
    }
    await setup.manager.dispatch({ type: 'refresh' })
    const snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'dsh-context',
    })
    assert.match(snapshot.error ?? '', /protected by Oh-DSH/)
    assert.equal(snapshot.preview, null)
    assert.equal(snapshot.catalog[0]?.protected, true)
    assert.equal(snapshot.catalog[0]?.builtin, true)
    assert.equal(setup.platform.commands.length, 0)
  } finally {
    setup.cleanup()
  }
})

test('the marketplace protects the upstream Better Sidebar alias', async () => {
  const setup = fixture()
  try {
    setup.platform.catalog = {
      schema: 'dsh-external-hub/v0.1',
      generated: '2026-08-14T00:00:00Z',
      repos: [{
        name: 'dsh-better-sidebar',
        repo: 'dsh-external/DSH-better-sidebar',
        category: 'plugin',
        description: 'Upstream sidebar already bundled by the desktop',
        bundle: true,
      }],
    }
    await setup.manager.dispatch({ type: 'refresh' })
    const snapshot = await setup.manager.dispatch({
      type: 'prepare',
      action: 'install',
      pluginId: 'dsh-better-sidebar',
    })
    assert.match(snapshot.error ?? '', /protected by Oh-DSH/)
    assert.equal(snapshot.preview, null)
    assert.equal(snapshot.catalog[0]?.protected, true)
    assert.equal(snapshot.catalog[0]?.builtin, true)
    assert.equal(setup.platform.commands.length, 0)
  } finally {
    setup.cleanup()
  }
})

test('installed bundles keep enabled state and update through isolated previews', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    await setup.manager.dispatch({
      type: 'inspect',
      action: 'install',
      pluginId: 'bundle-demo',
    })
    await setup.manager.dispatch({ type: 'preview', confirmations: ["allow-build-scripts"] })
    let snapshot = await setup.manager.dispatch({ type: 'apply' })
    let plugin = snapshot.catalog.find(entry => entry.id === 'bundle-demo')
    assert.equal(plugin?.installed, true)
    assert.equal(plugin?.enabled, true)
    assert.equal(plugin?.currentCommit, COMMIT)
    assert.equal(plugin?.updateAvailable, false)

    await setup.manager.dispatch({
      type: 'inspect',
      action: 'disable',
      pluginId: 'bundle-demo',
    })
    await setup.manager.dispatch({ type: 'preview', confirmations: [] })
    snapshot = await setup.manager.dispatch({ type: 'apply' })
    plugin = snapshot.catalog.find(entry => entry.id === 'bundle-demo')
    assert.equal(plugin?.installed, true)
    assert.equal(plugin?.enabled, false)
    let manifest = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.equal(typeof manifest.dependencies['@example/bundle-demo'], 'string')
    assert.ok(!manifest.dsh.profile.bundles.includes('@example/bundle-demo'))

    await setup.manager.dispatch({
      type: 'inspect',
      action: 'enable',
      pluginId: 'bundle-demo',
    })
    await setup.manager.dispatch({ type: 'preview', confirmations: [] })
    snapshot = await setup.manager.dispatch({ type: 'apply' })
    plugin = snapshot.catalog.find(entry => entry.id === 'bundle-demo')
    assert.equal(plugin?.enabled, true)

    setup.platform.latestCommit = UPDATED_COMMIT
    snapshot = await setup.manager.dispatch({ type: 'refresh' })
    plugin = snapshot.catalog.find(entry => entry.id === 'bundle-demo')
    assert.equal(plugin?.latestCommit, UPDATED_COMMIT)
    assert.equal(plugin?.updateAvailable, true)

    await setup.manager.dispatch({
      type: 'inspect',
      action: 'update',
      pluginId: 'bundle-demo',
    })
    await setup.manager.dispatch({ type: 'preview', confirmations: ["allow-build-scripts"] })
    snapshot = await setup.manager.dispatch({ type: 'apply' })
    plugin = snapshot.catalog.find(entry => entry.id === 'bundle-demo')
    assert.equal(plugin?.currentCommit, UPDATED_COMMIT)
    assert.equal(plugin?.updateAvailable, false)
    manifest = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.match(
      manifest.dependencies['@example/bundle-demo'],
      new RegExp(`bundle-demo-${UPDATED_COMMIT.slice(0, 12)}`),
    )
  } finally {
    setup.cleanup()
  }
})

test('repository preview can be discarded without changing the live patch', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    let snapshot = await setup.manager.dispatch({
      type: 'inspect',
      action: 'install',
      pluginId: 'repository-demo',
    })
    assert.equal(snapshot.plan?.mechanism, 'repository')
    snapshot = await setup.manager.dispatch({
      type: 'preview',
      confirmations: ['allow-build-scripts', 'accept-high-risk'],
    })
    assert.equal(snapshot.preview?.pluginId, 'repository-demo')
    assert.equal(readFileSync(join(setup.profileDir, 'cordis.patch.yml'), 'utf8'), '[]\n')
    const previewHome = setup.runtime.previewStarts[0]?.dshHome
    assert.ok(previewHome)
    const previewPatch = readFileSync(join(previewHome, 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8')
    assert.doesNotMatch(previewPatch, /^\[\]\s*\n- id:/m)
    assert.match(previewPatch, /- id: repository-plugins/)
    snapshot = await setup.manager.dispatch({ type: 'discard' })
    assert.equal(snapshot.preview, null)
    assert.deepEqual(snapshot.installed, [])
    assert.equal(readFileSync(join(setup.profileDir, 'cordis.patch.yml'), 'utf8'), '[]\n')
  } finally {
    setup.cleanup()
  }
})

test('repository plugins can be disabled without losing their install receipt', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    await setup.manager.dispatch({
      type: 'inspect',
      action: 'install',
      pluginId: 'repository-demo',
    })
    await setup.manager.dispatch({
      type: 'preview',
      confirmations: ['allow-build-scripts', 'accept-high-risk'],
    })
    let snapshot = await setup.manager.dispatch({ type: 'apply' })
    let plugin = snapshot.catalog.find(entry => entry.id === 'repository-demo')
    assert.equal(plugin?.installed, true)
    assert.equal(plugin?.enabled, true)

    await setup.manager.dispatch({
      type: 'inspect',
      action: 'disable',
      pluginId: 'repository-demo',
    })
    await setup.manager.dispatch({ type: 'preview', confirmations: [] })
    snapshot = await setup.manager.dispatch({ type: 'apply' })
    plugin = snapshot.catalog.find(entry => entry.id === 'repository-demo')
    assert.equal(plugin?.installed, true)
    assert.equal(plugin?.enabled, false)
    assert.doesNotMatch(
      readFileSync(join(setup.profileDir, 'cordis.patch.yml'), 'utf8'),
      /github:vlln\/repository-demo/,
    )

    await setup.manager.dispatch({
      type: 'inspect',
      action: 'enable',
      pluginId: 'repository-demo',
    })
    await setup.manager.dispatch({
      type: 'preview',
      confirmations: ['accept-high-risk'],
    })
    snapshot = await setup.manager.dispatch({ type: 'apply' })
    plugin = snapshot.catalog.find(entry => entry.id === 'repository-demo')
    assert.equal(plugin?.enabled, true)
    assert.match(
      readFileSync(join(setup.profileDir, 'cordis.patch.yml'), 'utf8'),
      /github:vlln\/repository-demo/,
    )
  } finally {
    setup.cleanup()
  }
})

test('legacy dsh-external repository receipts remain manageable', async () => {
  const setup = fixture()
  try {
    const source = `github:dsh-external/legacy-plugin#${COMMIT}&path:/.dsh-plugin`
    mkdirSync(join(setup.profileDir, '.oh-dsh'), { recursive: true })
    writeFileSync(join(setup.profileDir, '.oh-dsh', 'marketplace.json'), JSON.stringify({
      version: 1,
      entries: [{
        installedAt: '2026-08-12T00:00:00Z',
        mechanism: 'repository',
        packageName: '@legacy/plugin',
        pluginId: 'legacy-plugin',
        resolvedCommit: COMMIT,
        source,
      }],
    }))
    writeFileSync(join(setup.profileDir, 'cordis.patch.yml'), [
      '# >>> Oh-DSH-Desktop plugin marketplace',
      '- id: repository-plugins',
      '  config:',
      '    repositories:',
      `      - '${source}'`,
      '# <<< Oh-DSH-Desktop plugin marketplace',
      '',
    ].join('\n'))

    let snapshot = setup.manager.getSnapshot()
    assert.equal(snapshot.installed[0]?.pluginId, 'legacy-plugin')
    assert.equal(snapshot.installed[0]?.source, source)
    snapshot = await setup.manager.dispatch({ type: 'prepare', action: 'disable', pluginId: 'legacy-plugin' })
    assert.equal(snapshot.preview?.pluginId, 'legacy-plugin')
    snapshot = await setup.manager.dispatch({ type: 'apply' })
    assert.doesNotMatch(readFileSync(join(setup.profileDir, 'cordis.patch.yml'), 'utf8'), /legacy-plugin/)
    snapshot = await setup.manager.dispatch({ type: 'prepare', action: 'enable', pluginId: 'legacy-plugin' })
    assert.equal(snapshot.preview, null)
    assert.ok(snapshot.plan?.requirements.includes('accept-high-risk'))
    snapshot = await setup.manager.dispatch({ type: 'preview', confirmations: ['accept-high-risk'] })
    assert.equal(snapshot.preview?.pluginId, 'legacy-plugin')
  } finally {
    setup.cleanup()
  }
})

test('legacy receipts require confirmation before changing repository identity', async () => {
  const setup = fixture()
  try {
    const source = `github:dsh-external/legacy-plugin#${COMMIT}&path:/.dsh-plugin`
    mkdirSync(join(setup.profileDir, '.oh-dsh'), { recursive: true })
    writeFileSync(join(setup.profileDir, '.oh-dsh', 'marketplace.json'), JSON.stringify({
      version: 1,
      entries: [{
        installedAt: '2026-08-12T00:00:00Z',
        mechanism: 'repository',
        packageName: '@legacy/plugin',
        pluginId: 'legacy-plugin',
        resolvedCommit: COMMIT,
        source,
      }],
    }))
    writeFileSync(join(setup.profileDir, 'cordis.patch.yml'), [
      '# >>> Oh-DSH-Desktop plugin marketplace',
      '- id: repository-plugins',
      '  config:',
      '    repositories:',
      `      - '${source}'`,
      '# <<< Oh-DSH-Desktop plugin marketplace',
      '',
    ].join('\n'))
    setup.platform.latestCommit = UPDATED_COMMIT
    setup.platform.readRepositoryFile = async (_repository, path): Promise<string | null> =>
      path === '.dsh-plugin/package.json'
        ? JSON.stringify({ name: '@legacy/plugin' })
        : null
    const repositoryCatalog = (repository: string): unknown => ({
      schema: 'omdsh-registry/v1',
      entries: [{
        id: 'legacy-plugin',
        displayName: 'Legacy plugin',
        description: 'Legacy plugin',
        kind: 'plugin',
        source: { repository },
        install: { mode: 'repository-plugin' },
        listing: { state: 'reviewed' },
      }],
    })

    setup.platform.loadCatalog = async (): Promise<unknown> => repositoryCatalog('dsh-external/legacy-plugin')
    await setup.manager.dispatch({ type: 'refresh' })
    let snapshot = await setup.manager.dispatch({ type: 'inspect', action: 'update', pluginId: 'legacy-plugin' })
    assert.equal(snapshot.plan?.sourceReview, 'matched')
    assert.ok(!snapshot.plan?.requirements.includes('accept-source-change'))

    setup.platform.loadCatalog = async (): Promise<unknown> => repositoryCatalog('vlln/legacy-plugin')
    await setup.manager.dispatch({ type: 'refresh' })
    snapshot = await setup.manager.dispatch({ type: 'inspect', action: 'update', pluginId: 'legacy-plugin' })
    assert.equal(snapshot.plan?.sourceReview, 'changed')
    assert.ok(snapshot.plan?.requirements.includes('accept-source-change'))
  } finally {
    setup.cleanup()
  }
})

test('discover updates remove an old bundle before switching to a repository plugin', async () => {
  const setup = fixture()
  try {
    let repositoryMode = false
    setup.platform.bundleName = '@example/changing-plugin'
    setup.platform.loadCatalog = async (): Promise<unknown> => ({
      _meta: { schema_version: '1.0', generated_at: '2026-08-14T00:00:00Z' },
      plugins: [{
        id: 'changing-plugin',
        name: 'Changing plugin',
        repo: 'omdsh-dev/changing-plugin',
        category: 'plugin',
        description: { en: 'Changing plugin' },
      }],
    })
    setup.platform.readRepositoryFile = async (_repository, path): Promise<string | null> => {
      if (!repositoryMode && path === 'package.json') {
        return JSON.stringify({
          name: '@example/changing-plugin',
          dsh: { bundle: { patch: './cordis.patch.yml' } },
        })
      }
      if (repositoryMode && path === '.dsh-plugin/package.json') {
        return JSON.stringify({ name: '@example/changing-plugin' })
      }
      return null
    }

    await setup.manager.dispatch({ type: 'refresh' })
    await setup.manager.dispatch({ type: 'prepare', action: 'install', pluginId: 'changing-plugin' })
    let snapshot = await setup.manager.dispatch({ type: 'apply' })
    assert.equal(snapshot.installed[0]?.mechanism, 'bundle')
    let manifest = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.equal(typeof manifest.dependencies['@example/changing-plugin'], 'string')

    repositoryMode = true
    setup.platform.latestCommit = UPDATED_COMMIT
    await setup.manager.dispatch({ type: 'refresh' })
    snapshot = await setup.manager.dispatch({ type: 'inspect', action: 'update', pluginId: 'changing-plugin' })
    assert.equal(snapshot.plan?.mechanism, 'repository')
    assert.ok(snapshot.plan?.requirements.includes('accept-source-change'))
    await setup.manager.dispatch({
      type: 'preview',
      confirmations: ['accept-high-risk', 'accept-source-change'],
    })
    snapshot = await setup.manager.dispatch({ type: 'apply' })

    assert.equal(snapshot.installed[0]?.mechanism, 'repository')
    manifest = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.equal(manifest.dependencies['@example/changing-plugin'], undefined)
    assert.ok(!manifest.dsh.profile.bundles.includes('@example/changing-plugin'))
    assert.match(
      readFileSync(join(setup.profileDir, 'cordis.patch.yml'), 'utf8'),
      /github:omdsh-dev\/changing-plugin/,
    )
    assert.ok(setup.platform.commands.some(command =>
      command.args.join(' ') === 'plugin --profile desktop remove @example/changing-plugin'))
  } finally {
    setup.cleanup()
  }
})

test('read-only viewer manager browses without writing or transacting', async () => {
  const appDataPath = mkdtempSync(join(tmpdir(), 'oh-dsh-marketplace-readonly-'))
  const dshHome = join(appDataPath, 'dsh')
  const profileDir = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'desktop',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@oh-dsh/desktop'] } },
  }, undefined, 2) + '\n')
  const platform = new FakePlatform()
  const runtime = new FakeRuntime()
  const manager = new PluginMarketplaceManager({
    appDataPath,
    dshHome,
    platform,
    profile: 'desktop',
    readOnly: true,
    runtime,
  })
  try {
    // Viewer mode shares a data root with the lock holder: no preview or
    // rollback directories may be created on construction.
    assert.equal(existsSync(join(appDataPath, 'plugin-marketplace', 'previews')), false)
    assert.equal(existsSync(join(appDataPath, 'plugin-marketplace', 'rollbacks')), false)

    const snapshot = await manager.dispatch({ type: 'refresh' })
    assert.equal(snapshot.error, null)
    assert.ok(snapshot.catalog.length > 0)

    const refused = await manager.dispatch({
      type: 'inspect',
      action: 'install',
      pluginId: 'bundle-demo',
    })
    assert.match(refused.error ?? '', /read-only/)
    assert.equal(platform.builds.length, 0)
  } finally {
    rmSync(appDataPath, { recursive: true, force: true })
  }
})

test('read-only viewers load the catalog without writing the shared cache', async () => {
  const appDataPath = mkdtempSync(join(tmpdir(), 'oh-dsh-marketplace-cache-readonly-'))
  try {
    const createPlatform = (cacheReadOnly: boolean): ProductionMarketplacePlatform =>
      new ProductionMarketplacePlatform({
        appDataPath,
        cacheReadOnly,
        cliEntry: '/unused/dsh.mjs',
        env: {
          OH_DSH_MARKETPLACE_CATALOG: 'public-owner/public-catalog/data/plugins.json',
          PATH: '',
        },
        fetch: async (): Promise<Response> =>
          new Response(JSON.stringify(catalogDocument()), { status: 200 }),
        nodeBinary: process.execPath,
        pnpmEntry: '/unused/pnpm.mjs',
      })

    assert.deepEqual(await createPlatform(true).loadCatalog(), catalogDocument())
    assert.equal(
      existsSync(join(appDataPath, 'plugin-marketplace', 'catalog-cache.json')),
      false,
      'viewer mode must not create the shared catalog cache',
    )

    assert.deepEqual(await createPlatform(false).loadCatalog(), catalogDocument())
    assert.equal(
      existsSync(join(appDataPath, 'plugin-marketplace', 'catalog-cache.json')),
      true,
      'writer mode still refreshes the shared catalog cache',
    )
  } finally {
    rmSync(appDataPath, { recursive: true, force: true })
  }
})
