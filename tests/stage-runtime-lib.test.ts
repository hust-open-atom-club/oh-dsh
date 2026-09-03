import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import {
  ALL_SURFACE_PACKAGE_NAMES,
  SURFACE_PACKAGE_NAMES,
  createStageRuntime,
  parseStageSurface,
} from '../scripts/stage-runtime-lib.mjs'

function writeManifest(directory: string, manifest: object): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
}

function writeFile(directory: string, name: string, content: string): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, name), content)
}

function sorted(...values: Iterable<string>[]): string[] {
  return [...new Set(values.flatMap(set => [...set]))].sort()
}

function buildSurfaceFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'oh-dsh-stage-runtime-'))
  const repo = join(fixture, 'repo')
  const runtime = join(fixture, 'runtime')
  const nodeRuntime = join(fixture, 'node-runtime')
  mkdirSync(repo, { recursive: true })
  mkdirSync(runtime, { recursive: true })

  // Root desktop manifest + compiled files.
  writeManifest(repo, {
    name: '@oh-dsh/desktop',
    version: '0.1.10',
    dependencies: {},
    scripts: { test: 'true' },
    devDependencies: { typescript: '5' },
    build: 'tsc',
  })
  for (const name of ['plugin.js', 'client.js', 'client.js.map', 'cordis.patch.yml']) {
    writeFile(join(repo, 'dist'), name, 'desktop:' + name + '\n')
  }

  // Generic compiled plugins (vision adds a LICENSE, tui adds its patch).
  for (const name of [
    'about', 'desktop-frame', 'skins', 'sidebar', 'panel-controls',
    'pinned-summary', 'plugin-marketplace', 'vision', 'liangshen', 'tui',
    'tui-marketplace',
  ]) {
    writeManifest(join(repo, 'plugins', name), {
      name: '@oh-dsh/' + name, version: '0.1.0', dependencies: {}, ohDsh: {},
    })
    writeFile(join(repo, 'dist', 'plugins', name), 'index.js', 'export const plugin = ' + JSON.stringify(name) + '\n')
    writeFile(join(repo, 'dist', 'plugins', name), 'client.js', 'export {}\n')
    writeFile(join(repo, 'dist', 'plugins', name), 'client.js.map', 'map\n')
  }
  writeFile(join(repo, 'dist', 'plugins', 'vision'), 'LICENSE', 'MIT\n')
  writeFile(join(repo, 'dist', 'plugins', 'tui'), 'cordis.patch.yml', 'patch: tui\n')

  // better-sidebar-runtime (dependency wiring covered by its own test).
  writeManifest(join(repo, 'plugins', 'better-sidebar-runtime'), {
    name: '@oh-dsh/better-sidebar-runtime', version: '0.1.0',
    dependencies: {}, ohDsh: { hostDependencies: [] },
  })
  writeFile(join(repo, 'dist', 'plugins', 'better-sidebar-runtime'), 'index.js', 'export {}\n')

  // Web surface package.
  writeManifest(join(repo, 'web'), {
    name: '@oh-dsh/web', version: '0.1.8', dependencies: {},
    scripts: { test: 'true' }, devDependencies: { typescript: '5' }, build: 'tsc',
  })
  for (const name of ['index.js', 'client.js', 'client.js.map', 'cordis.patch.yml']) {
    writeFile(join(repo, 'dist', 'web'), name, 'web:' + name + '\n')
  }

  // Upstream trees (published release layouts).
  writeManifest(join(repo, 'upstream', 'dsh-TUI'), {
    name: '@deepseek-harness-tui/dsh-tui', version: '0.9.2', dependencies: {},
  })
  writeFile(join(repo, 'upstream', 'dsh-TUI', 'lib'), 'index.js', 'export {}\n')
  writeFile(join(repo, 'upstream', 'dsh-TUI', 'presets', 'liangshen'), 'preset.yml', 'id: liangshen\n')
  writeFile(join(repo, 'upstream', 'dsh-TUI', 'skills'), 'skill.md', 'skill\n')
  writeFile(join(repo, 'upstream', 'dsh-TUI', 'dsh-ecosystem-spec'), 'spec.yml', 'spec\n')
  writeFile(join(repo, 'upstream', 'dsh-TUI'), 'cordis.patch.yml', 'patch: tui\n')
  writeFile(join(repo, 'upstream', 'dsh-TUI'), 'cordis.yml', 'cordis: tui\n')
  writeFile(join(repo, 'upstream', 'dsh-TUI'), 'LICENSE', 'MIT\n')

  writeManifest(join(repo, 'upstream', 'dsh-TUI', 'dsh-auth'), {
    name: '@deepseek-harness-tui/dsh-auth', version: '0.1.0', dependencies: {},
  })
  writeFile(join(repo, 'upstream', 'dsh-TUI', 'dsh-auth', 'lib'), 'index.js', 'export {}\n')
  writeFile(join(repo, 'upstream', 'dsh-TUI', 'dsh-auth'), 'dsh-plugin.json', '{}\n')
  writeFile(join(repo, 'upstream', 'dsh-TUI', 'dsh-auth'), 'cordis.patch.yml', 'patch: auth\n')
  writeFile(join(repo, 'upstream', 'dsh-TUI', 'dsh-auth'), 'LICENSE', 'MIT\n')

  writeManifest(join(repo, 'upstream', 'dsh-context'), {
    name: 'dsh-context', version: '0.31.1', dependencies: {},
  })
  writeFile(join(repo, 'upstream', 'dsh-context', 'lib'), 'index.js', 'export {}\n')
  writeFile(join(repo, 'upstream', 'dsh-context'), 'cordis.patch.yml', 'patch: context\n')
  writeFile(join(repo, 'upstream', 'dsh-context'), 'LICENSE', 'MIT\n')

  // Minimal runtime: DSH manifest + node-pty for the sidebar alignment.
  writeManifest(runtime, { name: '@deepseek-ai/dsh', version: '0.1.1-rc.7', dependencies: {} })
  writeManifest(join(runtime, 'node_modules', 'node-pty'), { name: 'node-pty', version: '1.1.0' })

  const adapterCalls: string[] = []
  const staging = createStageRuntime({
    root: repo,
    stage: join(fixture, '.stage'),
    runtime,
    nodeRuntime,
    dshSource: repo,
    isWindowsNode: false,
    nodePlatform: 'linux',
    nodeArch: 'x64',
    npmRelease: true,
    run: (command: string, args: readonly string[]) => {
      throw new Error('unexpected run: ' + command + ' ' + args.join(' '))
    },
    adapters: {
      adaptTuiRendererPackage: (packageDir: string) => { adapterCalls.push('renderer:' + packageDir) },
      adaptTuiLiangshenPresentation: (packageDir: string) => { adapterCalls.push('liangshen:' + packageDir) },
    },
  })
  return { fixture, repo, runtime, nodeRuntime, staging, adapterCalls }
}

test('stage-runtime-lib keeps the official surface package manifest', () => {
  assert.deepEqual(sorted(SURFACE_PACKAGE_NAMES.desktop), [
    '@deepseek-harness-tui/dsh-auth',
    '@oh-dsh/about',
    '@oh-dsh/better-sidebar-runtime',
    '@oh-dsh/desktop',
    '@oh-dsh/desktop-frame',
    '@oh-dsh/liangshen',
    '@oh-dsh/panel-controls',
    '@oh-dsh/pinned-summary',
    '@oh-dsh/plugin-marketplace',
    '@oh-dsh/sidebar',
    '@oh-dsh/skins',
    '@oh-dsh/vision',
    'dsh-context',
  ])
  assert.deepEqual(sorted(SURFACE_PACKAGE_NAMES.web), [
    '@deepseek-harness-tui/dsh-auth',
    '@oh-dsh/about',
    '@oh-dsh/better-sidebar-runtime',
    '@oh-dsh/liangshen',
    '@oh-dsh/panel-controls',
    '@oh-dsh/pinned-summary',
    '@oh-dsh/plugin-marketplace',
    '@oh-dsh/sidebar',
    '@oh-dsh/skins',
    '@oh-dsh/vision',
    '@oh-dsh/web',
    'dsh-context',
  ])
  assert.deepEqual(sorted(SURFACE_PACKAGE_NAMES.tui), [
    '@deepseek-harness-tui/dsh-tui',
    '@oh-dsh/plugin-marketplace',
    '@oh-dsh/skins',
    '@oh-dsh/tui',
    '@oh-dsh/tui-marketplace',
    '@oh-dsh/vision',
  ])
  assert.deepEqual(sorted(ALL_SURFACE_PACKAGE_NAMES), sorted(
    SURFACE_PACKAGE_NAMES.desktop,
    SURFACE_PACKAGE_NAMES.web,
    SURFACE_PACKAGE_NAMES.tui,
  ))
})

test('web surface installs exactly the official web closure', () => {
  const { fixture, repo, runtime, staging } = buildSurfaceFixture()
  try {
    staging.installDesktopPackages('web')

    const modules = join(runtime, 'node_modules')
    for (const name of [
      '@oh-dsh/web', '@oh-dsh/liangshen', '@oh-dsh/better-sidebar-runtime',
      '@oh-dsh/vision', '@oh-dsh/about', '@oh-dsh/skins',
      '@oh-dsh/pinned-summary', '@oh-dsh/sidebar', '@oh-dsh/panel-controls',
      '@oh-dsh/plugin-marketplace', 'dsh-context', '@deepseek-harness-tui/dsh-auth',
    ]) {
      assert.equal(existsSync(join(modules, ...name.split('/'))), true, name + ' registered')
    }
    for (const name of [
      '@oh-dsh/desktop', '@oh-dsh/desktop-frame', '@oh-dsh/tui',
      '@oh-dsh/tui-marketplace', '@deepseek-harness-tui/dsh-tui',
    ]) {
      assert.equal(existsSync(join(modules, ...name.split('/'))), false, name + ' stays out of the web closure')
    }

    assert.equal(existsSync(join(modules, '@oh-dsh', 'web', 'dist', 'index.js')), true)
    assert.equal(existsSync(join(modules, '@oh-dsh', 'web', 'dist', 'cordis.patch.yml')), true)
    assert.equal(
      existsSync(join(modules, '@oh-dsh', 'liangshen', 'presets', 'liangshen', 'preset.yml')),
      true,
      'liangshen preset carried into the web closure',
    )

    const stagedWeb = JSON.parse(readFileSync(join(modules, '@oh-dsh', 'web', 'package.json'), 'utf8'))
    assert.equal(stagedWeb.scripts, undefined, 'scripts stripped')
    assert.equal(stagedWeb.devDependencies, undefined, 'devDependencies stripped')
    assert.equal(stagedWeb.build, undefined, 'build stripped')

    const sidebar = JSON.parse(readFileSync(join(modules, '@oh-dsh', 'better-sidebar-runtime', 'package.json'), 'utf8'))
    assert.equal(sidebar.dependencies['node-pty'], '1.1.0', 'sidebar pty aligned to the runtime copy')

    const runtimeManifest = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8'))
    assert.equal(runtimeManifest.dependencies['@oh-dsh/web'], '0.1.8', 'profile fallback lists web')
    assert.equal(runtimeManifest.dependencies['@oh-dsh/plugin-marketplace'], '0.1.0')
    assert.equal(runtimeManifest.dependencies['dsh-context'], '0.31.1')
    assert.equal(runtimeManifest.dependencies['@oh-dsh/desktop'], undefined, 'desktop not listed')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('full closure installs every official package and adapts the renderer', () => {
  const { fixture, runtime, staging, adapterCalls } = buildSurfaceFixture()
  try {
    staging.installDesktopPackages('all')

    const modules = join(runtime, 'node_modules')
    for (const name of ALL_SURFACE_PACKAGE_NAMES) {
      assert.equal(existsSync(join(modules, ...name.split('/'))), true, name + ' in the full closure')
    }

    const renderer = join(modules, '@deepseek-harness-tui', 'dsh-tui')
    assert.equal(existsSync(join(renderer, 'lib', 'index.js')), true)
    assert.equal(existsSync(join(renderer, 'presets', 'liangshen', 'preset.yml')), true)
    assert.equal(existsSync(join(renderer, 'skills', 'skill.md')), true)
    assert.equal(existsSync(join(renderer, 'dsh-ecosystem-spec', 'spec.yml')), true)
    assert.equal(existsSync(join(renderer, 'cordis.patch.yml')), true)
    assert.equal(adapterCalls.length, 2, 'renderer adapters applied')
    assert.ok(adapterCalls.some(call => call.startsWith('renderer:') && call.endsWith(renderer)))

    const desktopManifest = JSON.parse(readFileSync(join(modules, '@oh-dsh', 'desktop', 'package.json'), 'utf8'))
    assert.equal(desktopManifest.build, undefined)
    assert.equal(existsSync(join(modules, '@oh-dsh', 'desktop', 'dist', 'plugin.js')), true)
    assert.equal(existsSync(join(modules, '@oh-dsh', 'tui-marketplace', 'dist', 'index.js')), true)
    assert.equal(
      existsSync(join(modules, '@deepseek-harness-tui', 'dsh-auth', 'lib', 'index.js')),
      true,
    )
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('tui closure excludes web, desktop, and the Liangshen plugin', () => {
  const { fixture, runtime, staging } = buildSurfaceFixture()
  try {
    staging.installDesktopPackages('tui')

    const modules = join(runtime, 'node_modules')
    for (const name of [
      '@deepseek-harness-tui/dsh-tui', '@oh-dsh/tui', '@oh-dsh/tui-marketplace',
      '@oh-dsh/skins', '@oh-dsh/plugin-marketplace', '@oh-dsh/vision',
    ]) {
      assert.equal(existsSync(join(modules, ...name.split('/'))), true, name + ' registered')
    }
    for (const name of [
      '@oh-dsh/web', '@oh-dsh/desktop', '@oh-dsh/liangshen',
      '@oh-dsh/better-sidebar-runtime', 'dsh-context', '@deepseek-harness-tui/dsh-auth',
    ]) {
      assert.equal(existsSync(join(modules, ...name.split('/'))), false, name + ' stays out of the tui closure')
    }
    const runtimeManifest = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8'))
    assert.equal(runtimeManifest.dependencies['@oh-dsh/tui-marketplace'], '0.1.0')
    assert.equal(runtimeManifest.dependencies['@oh-dsh/liangshen'], undefined)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('compiled package dependencies are copied into a package-local store', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'oh-dsh-stage-runtime-deps-'))
  const repo = join(fixture, 'repo')
  const runtime = join(fixture, 'runtime')
  mkdirSync(runtime, { recursive: true })
  try {
    writeManifest(join(repo, 'plugins', 'foo'), {
      name: '@oh-dsh/foo', version: '1.0.0', dependencies: { 'dep-a': '1.0.0' },
    })
    writeManifest(join(repo, 'plugins', 'foo', 'node_modules', 'dep-a'), {
      name: 'dep-a', version: '1.0.0', dependencies: { 'dep-b': '2.0.0' },
    })
    writeFile(join(repo, 'plugins', 'foo', 'node_modules', 'dep-a'), 'index.js', 'export {}\n')
    writeManifest(join(repo, 'plugins', 'foo', 'node_modules', 'dep-b'), {
      name: 'dep-b', version: '2.0.0',
    })
    writeFile(join(repo, 'plugins', 'foo', 'node_modules', 'dep-b'), 'index.js', 'export {}\n')
    writeManifest(runtime, { name: '@deepseek-ai/dsh', version: '0.1.1-rc.7', dependencies: {} })

    const staging = createStageRuntime({
      root: repo, stage: join(fixture, '.stage'), runtime,
      nodeRuntime: join(fixture, 'node-runtime'), dshSource: repo,
      isWindowsNode: false, nodePlatform: 'linux', nodeArch: 'x64',
      npmRelease: true,
      run: (command: string, args: readonly string[]) => {
        throw new Error('unexpected run: ' + command)
      },
    })
    const packageDir = join(runtime, 'node_modules', '@oh-dsh', 'foo')
    staging.installCompiledPackageDependencies(join(repo, 'plugins', 'foo', 'package.json'), packageDir)

    const depLink = join(packageDir, 'node_modules', 'dep-a')
    assert.equal(existsSync(depLink), true)
    const copied = realpathSync(depLink)
    assert.ok(copied.includes(join('.oh-dsh-store', 'dep-a_1.0.0')), 'copied into the package-local store')
    assert.equal(readFileSync(join(copied, 'index.js'), 'utf8'), 'export {}\n')
    assert.equal(existsSync(join(copied, 'node_modules', 'dep-b')), true, 'transitive dependency linked')
    assert.equal(realpathSync(join(copied, 'node_modules', 'dep-b')).includes('dep-b_2.0.0'), true)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('host dependencies link into the staged runtime graph', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'oh-dsh-stage-runtime-host-'))
  const repo = join(fixture, 'repo')
  const runtime = join(fixture, 'runtime')
  mkdirSync(runtime, { recursive: true })
  try {
    writeManifest(join(repo, 'plugins', 'foo'), {
      name: '@oh-dsh/foo', version: '1.0.0', dependencies: {},
      ohDsh: { hostDependencies: ['@fixture/host'] },
    })
    writeManifest(join(runtime, 'node_modules', '@fixture', 'host'), {
      name: '@fixture/host', version: '9.0.0',
    })
    const staging = createStageRuntime({
      root: repo, stage: join(fixture, '.stage'), runtime,
      nodeRuntime: join(fixture, 'node-runtime'), dshSource: repo,
      isWindowsNode: false, nodePlatform: 'linux', nodeArch: 'x64',
      npmRelease: true,
      run: (command: string, args: readonly string[]) => {
        throw new Error('unexpected run: ' + command)
      },
    })
    const packageDir = join(runtime, 'node_modules', '@oh-dsh', 'foo')
    staging.installCompiledPackageHostDependencies(join(repo, 'plugins', 'foo', 'package.json'), packageDir)

    const link = join(packageDir, 'node_modules', '@fixture', 'host')
    assert.equal(realpathSync(link), realpathSync(join(runtime, 'node_modules', '@fixture', 'host')))
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('stagePnpmIntoNodeRuntime builds the published runtime layout', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'oh-dsh-stage-runtime-pnpm-'))
  const nodeRuntime = join(fixture, 'node-runtime')
  const pnpm = join(fixture, 'pnpm')
  try {
    mkdirSync(join(nodeRuntime, 'bin'), { recursive: true })
    writeFile(join(pnpm, 'bin'), 'pnpm.mjs', '#!/usr/bin/env node\n')
    writeFile(join(pnpm, 'dist'), 'pnpm.mjs', 'export {}\n')
    writeManifest(pnpm, { name: 'pnpm', version: '11.21.0' })
    writeFile(pnpm, 'LICENSE', 'MIT\n')

    const staging = createStageRuntime({
      root: fixture, stage: join(fixture, '.stage'), runtime: nodeRuntime,
      nodeRuntime, dshSource: fixture, isWindowsNode: false,
      nodePlatform: 'linux', nodeArch: 'x64', npmRelease: true,
      run: (command: string, args: readonly string[]) => {
        throw new Error('unexpected run: ' + command)
      },
    })
    staging.stagePnpmIntoNodeRuntime({ pnpmSource: pnpm })

    const entry = join(nodeRuntime, 'lib', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
    assert.equal(existsSync(entry), true)
    assert.equal(existsSync(join(nodeRuntime, 'lib', 'node_modules', 'pnpm', 'dist', 'pnpm.mjs')), true)
    assert.equal(existsSync(join(nodeRuntime, 'lib', 'node_modules', 'pnpm', 'package.json')), true)
    assert.equal(existsSync(join(nodeRuntime, 'lib', 'node_modules', 'pnpm', 'LICENSE')), true)
    assert.equal(readlinkSync(join(nodeRuntime, 'bin', 'pnpm')), relative(dirname(join(nodeRuntime, 'bin', 'pnpm')), entry))
    if (process.platform !== 'win32') {
      assert.equal(statSync(entry).mode & 0o777, 0o755, 'published pnpm entry stays executable')
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('parseStageSurface reads env and argv surfaces', () => {
  assert.equal(parseStageSurface([], { DSH_STAGE_SURFACE: 'tui' }), 'tui')
  assert.equal(parseStageSurface(['--surface', 'web'], {}), 'web')
  assert.equal(parseStageSurface(['--surface=desktop'], {}), 'desktop')
  assert.equal(parseStageSurface([], {}), 'all')
  assert.throws(() => parseStageSurface(['--surface', 'electron'], {}), /invalid stage surface/)
  assert.throws(() => parseStageSurface(['--bogus'], {}), /unknown stage option/)
})
