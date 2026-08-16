import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  classifySession,
  classifyTask,
  coreToolsFor,
  firstUserMessage,
} from '../plugins/routing/src/core.ts'
import { apply as applyRouter } from '../plugins/routing/src/index.ts'
import { apply as applyInjectorTools } from '../plugins/routing-injector/src/index.ts'
import { apply as applyInjectorHost } from '../plugins/routing-injector-host/src/index.ts'
import { RoutingInjector } from '../plugins/routing-injector/src/index.ts'
import { ensureDesktopProfile } from '../src/profile.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

interface FakeEntry {
  options: { name: string }
}

class FakeLoader {
  readonly active = new Map<string, FakeEntry>()
  readonly created: string[] = []
  readonly removed: string[] = []

  async create(options: { name: string }): Promise<string> {
    const id = `entry-${String(this.created.length + 1)}`
    this.created.push(options.name)
    this.active.set(id, { options })
    return id
  }

  entries(): Iterable<FakeEntry> {
    return this.active.values()
  }

  async remove(id: string): Promise<void> {
    this.removed.push(id)
    this.active.delete(id)
  }
}

function userMessage(text: string): { data: unknown; type: string } {
  return {
    data: { content: [{ text, type: 'text' }], source: { kind: 'user' } },
    type: 'user/message',
  }
}

function packageAt(rootPath: string, name = 'local-router-plugin'): string {
  const directory = join(rootPath, name)
  const lib = join(directory, 'lib')
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
  writeFileSync(join(lib, 'index.js'), 'export function apply() {}\n')
  return directory
}

test('router mode is a native preset composition source', () => {
  const preset = readFileSync(join(root, 'agent-presets/router-standard/preset.yml'), 'utf8')
  const composition = readFileSync(join(root, 'agent-presets/router-standard/agent.cordis.yml'), 'utf8')
  assert.match(preset, /^name: 思维注入 \+ 路由模式$/m)
  assert.match(composition, /name: '@oh-dsh\/routing'/)
  assert.match(composition, /name: '@oh-dsh\/routing-injector'/)
  assert.match(composition, /disabled: !!js process\.env\.OH_DSH_PROFILE === 'tui'/)
})

test('router classifies only the first real user message with legacy fallback', () => {
  const session = {
    events: [
      { data: { content: [{ text: 'plugin generated' }], source: { kind: 'plugin' } }, type: 'user/message' },
      userMessage('Please build a small web application.'),
      userMessage('Fix the deployment warning.'),
    ],
    id: 'session-1',
  }
  assert.equal(classifySession(session), 'react')
  assert.equal(classifyTask('Fix this broken configuration.'), 'spec')
  assert.deepEqual(coreToolsFor('spec'), ['read', 'edit', 'glob', 'grep'])

  const legacy = { events: [{ data: { content: [{ text: '修复配置' }] }, type: 'user/message' }], id: 'legacy' }
  assert.equal(firstUserMessage(legacy), legacy.events[0])
  assert.equal(classifySession(legacy), 'spec')
})

test('router narrows only the first request and releases per-session state', async () => {
  type Listener = (...args: any[]) => unknown
  const listeners = new Map<string, Listener>()
  const tools = new Map<string, Record<string, unknown>>()
  const context = {
    effect(callback: () => (() => void) | void): void { void callback() },
    on(event: string, listener: Listener): void { listeners.set(event, listener) },
    tools: { register(tool: Record<string, unknown>): () => void {
      tools.set(String(tool.name), tool)
      return () => { tools.delete(String(tool.name)) }
    } },
  }
  applyRouter(context)
  const session = { events: [userMessage('Build a local tool.')], id: 'shared' }
  const agent = { session }
  const assemble = listeners.get('system-prompt/assemble')
  assert.ok(assemble)
  const request = async () => await assemble(
    undefined,
    { agent },
    async () => ({
      contexts: [],
      sections: [{ name: 'persona', order: 0, text: 'default' }],
      tools: [{ name: 'read' }, { name: 'write' }, { name: 'edit' }, { name: 'grep' }],
    }),
  ) as { sections: Array<{ name: string }>; tools: Array<{ name: string }> }
  assert.deepEqual((await request()).tools.map(tool => tool.name), ['read', 'write', 'edit'])
  session.events.push({ data: { name: 'write' }, type: 'tool/call' })
  assert.deepEqual((await request()).tools.map(tool => tool.name), ['read', 'write', 'edit', 'grep'])

  const modeTool = tools.get('dev_router_mode')
  assert.ok(modeTool)
  const mode = modeTool.execute as (args: unknown, execution: unknown) => Promise<{ message: string }>
  await mode({ mode: 'spec' }, { agent })
  const disposed = listeners.get('agent/disposed')
  assert.ok(disposed)
  disposed({ agent })
  const fresh = { session: { events: [userMessage('Build a new application.')], id: 'shared' } }
  const freshResult = await assemble(
    undefined,
    { agent: fresh },
    async () => ({ contexts: [], sections: [], tools: [{ name: 'read' }, { name: 'write' }, { name: 'edit' }] }),
  ) as { sections: Array<{ name: string }> }
  assert.ok(freshResult.sections.some(section => section.name === 'router-persona'))
})

test('injector stores canonical approved packages and rejects changed restore targets', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'oh-dsh-routing-injector-'))
  try {
    const plugin = packageAt(temporary)
    const home = join(temporary, 'home')
    const loader = new FakeLoader()
    const injector = new RoutingInjector(loader, { OH_DSH_HOME: home, OH_DSH_PROFILE: 'desktop' })
    await injector.ready
    assert.equal(existsSync(join(home, 'routing-injector')), false)

    const record = await injector.inject(plugin)
    assert.equal(record.path, realpathSync(plugin))
    assert.equal(loader.created[0], 'local-router-plugin')
    assert.equal(existsSync(join(home, 'profiles', 'desktop', 'node_modules', 'local-router-plugin')), true)
    const registry = JSON.parse(readFileSync(join(home, 'routing-injector', 'registry.json'), 'utf8'))
    assert.equal(registry.records[0].fingerprint, record.fingerprint)

    writeFileSync(join(plugin, 'lib', 'index.js'), 'export function apply() { return 1 }\n')
    const restored = new RoutingInjector(new FakeLoader(), { OH_DSH_HOME: home, OH_DSH_PROFILE: 'desktop' })
    await restored.ready
    assert.deepEqual(restored.snapshot().inactive, {
      'local-router-plugin': 'approved package fingerprint changed',
    })
  } finally {
    rmSync(temporary, { force: true, recursive: true })
  }
})

test('injector fingerprints executable package files outside lib', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'oh-dsh-routing-injector-fingerprint-'))
  try {
    const plugin = packageAt(temporary, 'external-entry-plugin')
    writeFileSync(
      join(plugin, 'package.json'),
      JSON.stringify({ main: 'entry.js', name: 'external-entry-plugin', version: '1.0.0' }),
    )
    writeFileSync(join(plugin, 'entry.js'), 'export function apply() { return 1 }\n')
    const home = join(temporary, 'home')
    const injector = new RoutingInjector(new FakeLoader(), {
      OH_DSH_HOME: home,
      OH_DSH_PROFILE: 'desktop',
    })
    await injector.ready
    await injector.inject(plugin)

    writeFileSync(join(plugin, 'entry.js'), 'export function apply() { return 2 }\n')
    const restored = new RoutingInjector(new FakeLoader(), {
      OH_DSH_HOME: home,
      OH_DSH_PROFILE: 'desktop',
    })
    await restored.ready
    assert.deepEqual(restored.snapshot().inactive, {
      'external-entry-plugin': 'approved package fingerprint changed',
    })
  } finally {
    rmSync(temporary, { force: true, recursive: true })
  }
})

test('injector contains registry parse failures and repairs them after approval', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'oh-dsh-routing-injector-corrupt-'))
  try {
    const home = join(temporary, 'home')
    const registryDirectory = join(home, 'routing-injector')
    mkdirSync(registryDirectory, { recursive: true })
    writeFileSync(join(registryDirectory, 'registry.json'), '{not-json')
    const injector = new RoutingInjector(new FakeLoader(), {
      OH_DSH_HOME: home,
      OH_DSH_PROFILE: 'desktop',
    })
    await injector.ready
    const inactiveState = injector.snapshot().inactive as Record<string, unknown>
    assert.match(String(inactiveState.__registry__), /JSON|Unexpected token/)

    const record = await injector.inject(packageAt(temporary, 'repairable-plugin'))
    assert.equal(record.packageName, 'repairable-plugin')
    assert.equal((injector.snapshot().inactive as Record<string, unknown>).__registry__, undefined)
    assert.equal((JSON.parse(readFileSync(join(registryDirectory, 'registry.json'), 'utf8')) as { version: number }).version, 1)
    assert.equal(readdirSync(registryDirectory).some(name => name.startsWith('registry.json.corrupt-')), true)
  } finally {
    rmSync(temporary, { force: true, recursive: true })
  }
})

test('inactive injector records can be replaced or explicitly removed', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'oh-dsh-routing-injector-recover-'))
  try {
    const plugin = packageAt(temporary, 'recoverable-plugin')
    const home = join(temporary, 'home')
    const first = new RoutingInjector(new FakeLoader(), { OH_DSH_HOME: home, OH_DSH_PROFILE: 'desktop' })
    await first.ready
    await first.inject(plugin)
    writeFileSync(join(plugin, 'lib', 'index.js'), 'export function apply() { return 2 }\n')

    const restored = new RoutingInjector(new FakeLoader(), { OH_DSH_HOME: home, OH_DSH_PROFILE: 'desktop' })
    await restored.ready
    assert.equal((restored.snapshot().inactive as Record<string, unknown>)['recoverable-plugin'], 'approved package fingerprint changed')
    await restored.inject(plugin)
    assert.deepEqual(restored.snapshot().inactive, {})

    writeFileSync(join(plugin, 'lib', 'index.js'), 'export function apply() { return 3 }\n')
    const inactive = new RoutingInjector(new FakeLoader(), { OH_DSH_HOME: home, OH_DSH_PROFILE: 'desktop' })
    await inactive.ready
    await inactive.uninject('recoverable-plugin')
    assert.deepEqual(JSON.parse(readFileSync(join(home, 'routing-injector', 'registry.json'), 'utf8')).records, [])
    assert.equal(existsSync(join(home, 'profiles', 'desktop', 'node_modules', 'recoverable-plugin')), false)
  } finally {
    rmSync(temporary, { force: true, recursive: true })
  }
})

test('inactive recovery removes dangling injector-owned links', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'oh-dsh-routing-injector-dangling-'))
  try {
    const originalRoot = join(temporary, 'original')
    const recoverable = packageAt(originalRoot, 'recoverable-plugin')
    const removable = packageAt(originalRoot, 'removable-plugin')
    const home = join(temporary, 'home')
    const injector = new RoutingInjector(new FakeLoader(), {
      OH_DSH_HOME: home,
      OH_DSH_PROFILE: 'desktop',
    })
    await injector.ready
    await injector.inject(recoverable)
    await injector.inject(removable)
    rmSync(originalRoot, { force: true, recursive: true })

    const restored = new RoutingInjector(new FakeLoader(), {
      OH_DSH_HOME: home,
      OH_DSH_PROFILE: 'desktop',
    })
    await restored.ready
    const replacement = packageAt(join(temporary, 'replacement'), 'recoverable-plugin')
    await restored.inject(replacement)
    assert.equal(realpathSync(join(
      home,
      'profiles',
      'desktop',
      'node_modules',
      'recoverable-plugin',
    )), realpathSync(replacement))

    const removableLink = join(
      home,
      'profiles',
      'desktop',
      'node_modules',
      'removable-plugin',
    )
    await restored.uninject('removable-plugin')
    assert.throws(() => lstatSync(removableLink), { code: 'ENOENT' })
  } finally {
    rmSync(temporary, { force: true, recursive: true })
  }
})

test('injector registry writes preserve records from concurrent profiles', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'oh-dsh-routing-injector-lock-'))
  try {
    const home = join(temporary, 'home')
    const left = new RoutingInjector(new FakeLoader(), { OH_DSH_HOME: home, OH_DSH_PROFILE: 'desktop' })
    const right = new RoutingInjector(new FakeLoader(), { OH_DSH_HOME: home, OH_DSH_PROFILE: 'web' })
    await Promise.all([left.ready, right.ready])
    await Promise.all([
      left.inject(packageAt(temporary, 'desktop-plugin')),
      right.inject(packageAt(temporary, 'web-plugin')),
    ])
    const registry = JSON.parse(readFileSync(join(home, 'routing-injector', 'registry.json'), 'utf8'))
    assert.deepEqual(registry.records.map((record: { packageName: string }) => record.packageName).sort(), [
      'desktop-plugin',
      'web-plugin',
    ])
  } finally {
    rmSync(temporary, { force: true, recursive: true })
  }
})

test('injector promotion rolls back the profile when registry commit fails', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'oh-dsh-routing-injector-promote-'))
  try {
    const home = join(temporary, 'home')
    const { profileDir } = ensureDesktopProfile(home)
    const manifestPath = join(profileDir, 'package.json')
    const injector = new RoutingInjector(new FakeLoader(), {
      OH_DSH_HOME: home,
      OH_DSH_PROFILE: 'desktop',
    })
    await injector.ready
    await injector.inject(packageAt(temporary, 'promoted-plugin'))
    const profileBefore = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const registryBefore = JSON.parse(readFileSync(injector.registryPath, 'utf8'))
    const registryTemporary = `${injector.registryPath}.tmp-${String(process.pid)}`
    mkdirSync(registryTemporary)

    await assert.rejects(injector.promote('promoted-plugin'))
    assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), profileBefore)
    assert.deepEqual(JSON.parse(readFileSync(injector.registryPath, 'utf8')), registryBefore)

    rmSync(registryTemporary, { force: true, recursive: true })
    const promoted = await injector.promote('promoted-plugin')
    assert.equal(promoted.promoted, true)
    assert.equal(
      JSON.parse(readFileSync(manifestPath, 'utf8')).dsh.profile.bundles.includes('promoted-plugin'),
      true,
    )
    assert.equal(
      JSON.parse(readFileSync(injector.registryPath, 'utf8')).records[0].promoted,
      true,
    )
    assert.equal(existsSync(injector.promotionJournalPath), false)
  } finally {
    rmSync(temporary, { force: true, recursive: true })
  }
})

test('injector recovers an interrupted profile promotion on startup', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'oh-dsh-routing-injector-journal-'))
  try {
    const home = join(temporary, 'home')
    const { profileDir } = ensureDesktopProfile(home)
    const manifestPath = join(profileDir, 'package.json')
    const injector = new RoutingInjector(new FakeLoader(), {
      OH_DSH_HOME: home,
      OH_DSH_PROFILE: 'desktop',
    })
    await injector.ready
    const record = await injector.inject(packageAt(temporary, 'interrupted-plugin'))
    const previousProfile = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const previousRegistry = JSON.parse(readFileSync(injector.registryPath, 'utf8'))
    const interruptedProfile = structuredClone(previousProfile)
    interruptedProfile.dependencies['interrupted-plugin'] = `file:${record.path}`
    interruptedProfile.dsh.profile.bundles.push('interrupted-plugin')
    writeFileSync(injector.promotionJournalPath, JSON.stringify({
      packageName: 'interrupted-plugin',
      previousProfile,
      previousRegistry,
      profile: 'desktop',
      version: 1,
    }))
    writeFileSync(manifestPath, JSON.stringify(interruptedProfile))

    const restored = new RoutingInjector(new FakeLoader(), {
      OH_DSH_HOME: home,
      OH_DSH_PROFILE: 'desktop',
    })
    await restored.ready
    assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), previousProfile)
    assert.deepEqual(JSON.parse(readFileSync(injector.registryPath, 'utf8')), previousRegistry)
    assert.equal(existsSync(injector.promotionJournalPath), false)
    assert.equal((restored.snapshot().active as unknown[]).length, 1)
  } finally {
    rmSync(temporary, { force: true, recursive: true })
  }
})

test('injector gates every mutation and exposes no HTTP or polling surface', async () => {
  type Decision = { kind: 'allow' | 'ask' | 'deny'; reason?: string }
  let gate: ((execution: { name: string }, next: () => Promise<Decision>) => Promise<Decision>) | undefined
  let service: RoutingInjector | undefined
  const tools = new Map<string, Record<string, unknown>>()
  const context = {
    effect(callback: () => (() => void) | void): void { void callback() },
    loader: new FakeLoader(),
    on(_event: 'tools/pre-execute', listener: typeof gate): void { gate = listener },
    provide(_name: string, value: unknown): void { service = value as RoutingInjector },
    tools: { register(tool: Record<string, unknown>): () => void {
      tools.set(String(tool.name), tool)
      return () => { tools.delete(String(tool.name)) }
    } },
  }
  const home = mkdtempSync(join(tmpdir(), 'oh-dsh-routing-injector-gate-'))
  const previousHome = process.env.OH_DSH_HOME
  const previousProfile = process.env.OH_DSH_PROFILE
  process.env.OH_DSH_HOME = home
  process.env.OH_DSH_PROFILE = 'desktop'
  try {
    applyInjectorHost(context)
    assert.ok(gate)
    assert.ok(service)
    assert.equal((await gate({ name: 'dev_inject_plugin' }, async () => ({ kind: 'allow' }))).kind, 'ask')
    assert.equal((await gate({ name: 'dev_plugin_status' }, async () => ({ kind: 'allow' }))).kind, 'allow')
    applyInjectorTools({
      effect: context.effect,
      routingInjector: service,
      tools: context.tools,
    })
    assert.ok(tools.has('dev_inject_plugin'))
    assert.ok(tools.has('dev_plugin_status'))
    const source = readFileSync(join(root, 'plugins/routing-injector/src/index.ts'), 'utf8')
    assert.doesNotMatch(source, /webServer|setInterval|fetch\(/)
  } finally {
    if (previousHome === undefined) delete process.env.OH_DSH_HOME
    else process.env.OH_DSH_HOME = previousHome
    if (previousProfile === undefined) delete process.env.OH_DSH_PROFILE
    else process.env.OH_DSH_PROFILE = previousProfile
    rmSync(home, { force: true, recursive: true })
  }
})
