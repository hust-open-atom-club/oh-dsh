import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { test } from 'node:test'
import { parseMarketplaceCatalog } from '../plugins/plugin-marketplace/src/catalog.ts'
import type {
  DshCommandInput,
  MarketplaceAuthResult,
  MarketplacePlatform,
} from '../plugins/plugin-marketplace/src/host/platform.ts'
import {
  findGitHubCli,
  ProductionMarketplacePlatform,
  withGitHubCredentials,
} from '../plugins/plugin-marketplace/src/host/platform.ts'
import {
  PluginMarketplaceManager,
  type MarketplacePreviewRuntimeInput,
  type MarketplaceRuntime,
} from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'
import { startMarketplaceAgentGateway } from '../plugins/plugin-marketplace/src/host/agent-gateway.ts'

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

class FakePlatform implements MarketplacePlatform {
  readonly commands: DshCommandInput[] = []
  latestCommit = COMMIT
  bundleName = '@example/bundle-demo'
  bundleDescription = 'Bundle demo manifest'

  async authStatus(): Promise<MarketplaceAuthResult> {
    return { detail: 'test auth', status: 'ready' }
  }

  async cloneRepository(_repository: string, _commit: string, target: string): Promise<void> {
    mkdirSync(target, { recursive: true })
  }

  async loadCatalog(): Promise<unknown> {
    return catalogDocument()
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
  async startPreview(input: MarketplacePreviewRuntimeInput): Promise<void> { this.previewStarts.push(input) }
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
  })

  assert.notEqual((await platform.authStatus()).status, 'ready')
  assert.deepEqual(await platform.loadCatalog(), catalogDocument())
  assert.equal(
    requested,
    'https://api.github.com/repos/public-owner/public-catalog/contents/data/plugins.json',
  )
})

test('refresh keeps public catalogs available when GitHub CLI is unavailable', async () => {
  const setup = fixture()
  try {
    setup.platform.authStatus = async (): Promise<MarketplaceAuthResult> => ({
      detail: 'GitHub CLI is unavailable',
      status: 'missing-cli',
    })
    const snapshot = await setup.manager.dispatch({ type: 'refresh' })
    assert.equal(snapshot.auth.status, 'missing-cli')
    assert.equal(snapshot.catalog.length, 6)
    assert.equal(snapshot.error, null)
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

test('marketplace navigation reserves room for Settings in short windows', () => {
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
  assert.match(client, /window\.innerHeight - top/)
  assert.match(client, /SIDEBAR_BOTTOM_INSET = 8/)
  assert.match(client, /--oh-marketplace-sidebar-height/)
  assert.match(css, /height: var\(--oh-marketplace-sidebar-height, 100%\) !important/)
  assert.match(css, /\.oh-marketplace-nav \{[\s\S]*gap: 8px;/)
  assert.match(css, /\.oh-marketplace-nav \{[\s\S]*padding: 6px 2px 6px 10px;/)
  assert.match(css, /\.oh-marketplace-nav svg \{[\s\S]*width: 16px;[\s\S]*height: 16px;/)
  assert.match(css, /\.oh-marketplace-nav\[data-collapsed='true'\] svg \{[\s\S]*transform: scale\(1\.56\);/)
  assert.match(client, /this\.#entrySeat\.className = settingsSeat\.className/)
  assert.match(client, /sidebarRoot\.insertBefore\(this\.#entrySeat, settingsSeat\)/)
  assert.match(client, /export const inject = \['locale'\]/)
  assert.match(client, /locale\.register\('oh-dsh\.plugin-marketplace'/)
  assert.match(client, /\['installed', t\('installed'\)\]/)
  assert.match(client, /\['available', t\('not-installed'\)\]/)
  assert.match(client, /\['updates', t\('updates'\)\]/)
  assert.match(client, /\['disabled', t\('disabled'\)\]/)
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
  assert.match(client, /if \(disposed \|\| info\.preview !== null\) return/)
})

test('bundle preview remains isolated until apply and supports undo', async () => {
  const setup = fixture()
  try {
    let snapshot = await setup.manager.dispatch({ type: 'refresh' })
    assert.equal(snapshot.catalog.length, 6)
    snapshot = await setup.manager.dispatch({ type: 'inspect', action: 'install', pluginId: 'bundle-demo' })
    assert.deepEqual(snapshot.plan?.buildScripts, { prepare: 'node build.mjs' })

    snapshot = await setup.manager.dispatch({ type: 'preview', allowBuildScripts: false })
    assert.match(snapshot.error ?? '', /allow-build-scripts/)
    assert.equal(snapshot.preview, null)

    snapshot = await setup.manager.dispatch({ type: 'preview', allowBuildScripts: true })
    assert.equal(snapshot.error, null)
    assert.equal(snapshot.preview?.pluginId, 'bundle-demo')
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
    assert.equal(setup.platform.commands.length, 2)
    assert.deepEqual(setup.platform.commands[1]?.args.slice(-2), ['install', '--ignore-scripts'])
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
    assert.equal(snapshot.lifecycle.candidate?.pluginId, 'safe-demo')
    assert.equal(snapshot.lifecycle.current.profile, 'desktop')
    assert.equal(snapshot.lifecycle.previous, null)
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
    assert.match(snapshot.error ?? '', /protected by the desktop/)
    assert.equal(snapshot.preview, null)
    assert.equal(
      snapshot.catalog.find(plugin => plugin.id === 'oh-dsh-desktop')?.protected,
      true,
    )
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
    await setup.manager.dispatch({ type: 'preview', allowBuildScripts: true })
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
    await setup.manager.dispatch({ type: 'preview', allowBuildScripts: false })
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
    await setup.manager.dispatch({ type: 'preview', allowBuildScripts: true })
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
    await setup.manager.dispatch({ type: 'preview', allowBuildScripts: false })
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
