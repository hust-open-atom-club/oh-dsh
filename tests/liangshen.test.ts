import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { apply, installLiangshenPreset } from '../plugins/liangshen/src/index.ts'
import {
  adaptDshLiangshenOwnership,
  adaptDshLiangshenPresentation,
  adaptTuiLiangshenPresentation,
} from '../plugins/liangshen/src/upstream-adapter.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'upstream', 'dsh-TUI', 'presets', 'liangshen')

test('Liangshen plugin installs and reconciles its managed preset', () => {
  const temp = mkdtempSync(join(tmpdir(), 'oh-dsh-liangshen-'))
  const sourceCopy = join(temp, 'source')
  const dataRoot = join(temp, 'data')
  try {
    cpSync(source, sourceCopy, { recursive: true })
    assert.equal(installLiangshenPreset({ dataRoot, sourceRoot: sourceCopy }), 'installed')
    const target = join(dataRoot, '.agent-presets', 'liangshen')
    assert.match(requireFile(join(target, 'agent.cordis.yml')), /tool-bootstrap/)
    assert.equal(installLiangshenPreset({ dataRoot, sourceRoot: sourceCopy }), 'current')

    writeFileSync(join(sourceCopy, '.dsh-tui-managed.json'), JSON.stringify({
      owner: '@deepseek-harness-tui/dsh-tui',
      preset: 'liangshen',
      revision: 'next',
    }) + '\n')
    assert.equal(installLiangshenPreset({ dataRoot, sourceRoot: sourceCopy }), 'installed')
    assert.match(requireFile(join(target, '.dsh-tui-managed.json')), /"revision":"next"/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('Liangshen plugin preserves an unmanaged user preset', () => {
  const temp = mkdtempSync(join(tmpdir(), 'oh-dsh-liangshen-conflict-'))
  const sourceCopy = join(temp, 'source')
  const dataRoot = join(temp, 'data')
  const target = join(dataRoot, '.agent-presets', 'liangshen')
  try {
    cpSync(source, sourceCopy, { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'agent.cordis.yml'), 'user-owned\n')
    assert.equal(installLiangshenPreset({ dataRoot, sourceRoot: sourceCopy }), 'conflict')
    assert.equal(requireFile(join(target, 'agent.cordis.yml')), 'user-owned\n')
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

function requireFile(path: string): string {
  return readFileSync(path, 'utf8')
}

function pinnedPackageFile(packageName: string, ...segments: string[]): string {
  const store = join(root, 'node_modules', '.pnpm')
  const packagePath = join('node_modules', '@deepseek-ai', packageName, ...segments)
  const entry = readdirSync(store, { withFileTypes: true })
    .find(candidate => candidate.isDirectory()
      && existsSync(join(store, candidate.name, packagePath)))
  assert.ok(entry, `pinned @deepseek-ai/${packageName} package is unavailable`)
  return join(store, entry.name, packagePath)
}

test('Liangshen adapters localize the pinned browser and TUI preset renderers', () => {
  const temp = mkdtempSync(join(tmpdir(), 'oh-dsh-liangshen-presentation-'))
  try {
    const runtime = join(temp, 'runtime')
    const agentPresetHost = join(
      runtime,
      'node_modules',
      '.pnpm',
      'agent-preset-host-hash',
      'node_modules',
      '@deepseek-ai',
      'dsh-agent-presets',
      'lib',
      'index.js',
    )
    const presetsWireHost = join(
      runtime,
      'node_modules',
      '.pnpm',
      'presets-wire-host-hash',
      'node_modules',
      '@deepseek-ai',
      'dsh-agent-presets',
      'lib',
      'index.js',
    )
    const presetsWireSchema = join(
      runtime,
      'node_modules',
      '.pnpm',
      'presets-wire-host-hash',
      'node_modules',
      '@deepseek-ai',
      'dsh-agent-presets',
      'lib',
      'typert.host.js',
    )
    const browserClient = join(
      runtime,
      'node_modules',
      '.pnpm',
      'virtual-store-hash',
      'node_modules',
      '@deepseek-ai',
      'dsh-client-ui-agent-preset',
      'lib',
      'client.js',
    )
    const connectionClient = join(
      runtime,
      'node_modules',
      '.pnpm',
      'connection-client-hash',
      'node_modules',
      '@deepseek-ai',
      'dsh-client-connection',
      'lib',
      'client.js',
    )
    for (const path of [agentPresetHost, presetsWireSchema, browserClient, connectionClient]) {
      mkdirSync(dirname(path), { recursive: true })
    }
    cpSync(pinnedPackageFile('dsh-agent-presets', 'lib', 'index.js'), agentPresetHost)
    cpSync(pinnedPackageFile('dsh-agent-presets', 'lib', 'typert.host.js'), presetsWireSchema)
    cpSync(pinnedPackageFile('dsh-client-ui-agent-preset', 'lib', 'client.js'), browserClient)
    cpSync(pinnedPackageFile('dsh-client-connection', 'lib', 'client.js'), connectionClient)
    adaptDshLiangshenOwnership(runtime)
    adaptDshLiangshenPresentation(runtime)
    const hostSource = requireFile(agentPresetHost)
    const apiSource = hostSource
    const wireSchemaSource = requireFile(presetsWireSchema)
    const browserSource = requireFile(browserClient)
    const connectionSource = requireFile(connectionClient)
    assert.match(hostSource, /ohDshManagedPresetOwner/)
    assert.match(hostSource, /managedBy/)
    assert.match(apiSource, /managedBy: preset\.managedBy/)
    assert.match(wireSchemaSource, /'managedBy': z\.string\(\)\.readonly\(\)\.optional\(\)/)
    assert.match(browserSource, /Liangshen mode/)
    assert.match(browserSource, /preset\.managedBy === "@deepseek-harness-tui\/dsh-tui"/)
    assert.match(browserSource, /preset\.name === "梁神模式"/)
    assert.match(browserSource, /preset\.description === "主 Agent 与子 Agent/)

    const hoistedRuntime = join(temp, 'hoisted-runtime')
    const hoistedClient = join(
      hoistedRuntime,
      'node_modules',
      '@deepseek-ai',
      'dsh-client-ui-agent-preset',
      'lib',
      'client.js',
    )
    const hoistedConnection = join(
      hoistedRuntime,
      'node_modules',
      '@deepseek-ai',
      'dsh-client-connection',
      'lib',
      'client.js',
    )
    mkdirSync(dirname(hoistedClient), { recursive: true })
    mkdirSync(dirname(hoistedConnection), { recursive: true })
    cpSync(pinnedPackageFile('dsh-client-ui-agent-preset', 'lib', 'client.js'), hoistedClient)
    cpSync(pinnedPackageFile('dsh-client-connection', 'lib', 'client.js'), hoistedConnection)
    adaptDshLiangshenPresentation(hoistedRuntime)
    assert.match(requireFile(hoistedClient), /Liangshen mode/)

    const tui = join(temp, 'tui')
    const tuiTypes = join(tui, 'lib', 'types')
    mkdirSync(join(tuiTypes, 'dsh-adapter'), { recursive: true })
    cpSync(join(root, 'upstream', 'dsh-TUI', 'lib', 'types', 'i18n.js'), join(tuiTypes, 'i18n.js'))
    cpSync(
      join(root, 'upstream', 'dsh-TUI', 'lib', 'types', 'dsh-adapter', 'channel.js'),
      join(tuiTypes, 'dsh-adapter', 'channel.js'),
    )
    adaptTuiLiangshenPresentation(tui)
    const tuiMessages = requireFile(join(tuiTypes, 'i18n.js'))
    assert.match(tuiMessages, /Liangshen mode/)
    // The 0.1.2 renderer localizes through its own preset-name-*/preset-desc-*
    // dictionary keys, so the adapter registers entries instead of patching
    // the channel mapping.
    assert.match(tuiMessages, /'preset-name-liangshen':/)
    assert.match(tuiMessages, /'preset-desc-liangshen':/)

    assert.doesNotThrow(() => {
      adaptDshLiangshenOwnership(runtime)
      adaptDshLiangshenPresentation(runtime)
      adaptDshLiangshenPresentation(hoistedRuntime)
      adaptTuiLiangshenPresentation(tui)
    })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('Nix applies Liangshen presentation adapters through the shared assembler', () => {
  const nix = requireFile(join(root, 'nix', 'oh-dsh.nix'))
  assert.equal((nix.match(/plugins\/liangshen\/src\/upstream-adapter\.mjs/g) ?? []).length, 2)
  assert.match(nix, /ownership \$out\/dsh-runtime/)
  assert.match(nix, /dsh \$out\/dsh-runtime/)
  // The renderer presentation adapter runs inside installDesktopPackages
  // (scripts/stage-runtime-lib.mjs), the same path stage-dsh.mjs uses.
  const assembler = requireFile(join(root, 'scripts', 'stage-runtime-lib.mjs'))
  assert.match(assembler, /adaptTuiLiangshenPresentation\(packageDir\)/)
})

test('Liangshen plugin skips preset installation in read-only viewer mode', () => {
  const temp = mkdtempSync(join(tmpdir(), 'oh-dsh-liangshen-readonly-'))
  const sourceCopy = join(temp, 'source')
  const dataRoot = join(temp, 'data')
  const warnings: string[] = []
  const logger = { warn: (message: string) => { warnings.push(message) } }
  const previous = process.env.OH_DSH_READ_ONLY
  try {
    cpSync(source, sourceCopy, { recursive: true })
    const options = { dataRoot, sourceRoot: sourceCopy }

    process.env.OH_DSH_READ_ONLY = '1'
    apply({ logger }, options)
    assert.equal(existsSync(join(dataRoot, '.agent-presets', 'liangshen')), false)
    assert.deepEqual(warnings, [])

    delete process.env.OH_DSH_READ_ONLY
    apply({ logger }, options)
    assert.equal(existsSync(join(dataRoot, '.agent-presets', 'liangshen')), true)
    assert.deepEqual(warnings, [])
  } finally {
    if (previous === undefined) delete process.env.OH_DSH_READ_ONLY
    else process.env.OH_DSH_READ_ONLY = previous
    rmSync(temp, { recursive: true, force: true })
  }
})
