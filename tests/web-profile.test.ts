import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  DESKTOP_PROFILE,
  ensureWebProfile,
  WEB_BUNDLES,
  WEB_PROFILE,
} from '../src/profile.ts'
import {
  DshRuntimeSupervisor,
  type DshRuntimeOptions,
} from '../src/runtime.ts'
import {
  DEFAULT_DATA_DIR_NAME,
  DEFAULT_WEB_HOST,
  DEFAULT_WEB_PORT,
  main,
  parseLaunchArgs,
  resolveWebVersion,
  UsageError,
} from '../src/web.ts'

test('web profile initializes required bundles and preserves user plugins', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-web-profile-'))
  try {
    const first = ensureWebProfile(join(root, 'home'))
    const manifestPath = join(first.profileDir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.equal(manifest.name, 'dsh-profile-web')
    assert.deepEqual(manifest.dsh.profile.bundles, WEB_BUNDLES)
    assert.equal(manifest.dsh.profile.bundles.includes('@oh-dsh/desktop'), false)

    manifest.dependencies['example-plugin'] = '1.0.0'
    manifest.dsh.profile.bundles = ['example-plugin', '@oh-dsh/web']
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    writeFileSync(join(first.profileDir, 'cordis.patch.yml'), '- id: custom\n  disabled: true\n')

    const second = ensureWebProfile(join(root, 'home'))
    const upgraded = JSON.parse(readFileSync(join(second.profileDir, 'package.json'), 'utf8'))
    assert.deepEqual(upgraded.dsh.profile.bundles, [...WEB_BUNDLES, 'example-plugin'])
    assert.equal(upgraded.dependencies['example-plugin'], '1.0.0')
    assert.match(readFileSync(join(second.profileDir, 'cordis.patch.yml'), 'utf8'), /custom/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('web profile is a separate surface from the desktop profile', () => {
  assert.notEqual(WEB_PROFILE, DESKTOP_PROFILE)
  assert.deepEqual(WEB_BUNDLES, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@oh-dsh/web'])
  assert.equal(WEB_BUNDLES.includes('@oh-dsh/desktop'), false)
})

test('web client uses the Oh-DSH Web surface name', () => {
  const client = readFileSync(new URL('../web/src/client.ts', import.meta.url), 'utf8')
  assert.match(client, /document\.title = 'Oh-DSH Web'/)
  assert.match(client, /element\.textContent = 'Oh-DSH Web'/)
  assert.doesNotMatch(client, /Oh-DSH-Web/)
})

test('packaged web distribution exposes the unified ohdsh command', () => {
  const build = readFileSync(new URL('../scripts/build-web.mjs', import.meta.url), 'utf8')
  assert.match(build, /join\(packageDir, 'bin', 'ohdsh'\)/)
  assert.match(build, /join\(packageDir, 'lib', 'oh-dsh', 'cli\.js'\)/)
  assert.match(build, /exec "\$ROOT\/bin\/ohdsh" web "\$@"/)
  assert.match(build, /数据默认保存在 \\`~\/\.ohdsh\\`/)
})

test('full and web-only distributions expose the same release version', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-web-version-'))
  try {
    writeFileSync(join(root, 'package.json'), '{"version":"1.2.3"}\n')
    assert.equal(resolveWebVersion(root), '1.2.3')
    rmSync(join(root, 'package.json'))

    mkdirSync(join(root, 'lib', 'oh-dsh'), { recursive: true })
    writeFileSync(
      join(root, 'lib', 'oh-dsh', 'package.json'),
      '{"version":"4.5.6"}\n',
    )
    assert.equal(resolveWebVersion(root), '4.5.6')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('full distribution keeps app and release manifests distinct', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const releaseManifest = manifest.build.extraResources.find(
    (resource: { to?: string }) => resource.to === 'lib/oh-dsh/package.json',
  )
  assert.equal(releaseManifest.from, 'dist/release-package.json')
})

test('web bundle patch mounts the web-capable Oh-DSH plugins', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const patch = readFileSync(join(root, 'web', 'cordis.patch.yml'), 'utf8')
  for (const row of [
    'oh-web',
    'oh-better-sidebar-runtime',
    'oh-vision',
    'oh-routing-injector-host',
    'oh-skins',
    'oh-pinned-summary',
    'oh-sidebar',
    'oh-panel-controls',
  ]) {
    assert.match(patch, new RegExp(`- id: ${row}`))
  }
  // Electron-bound surfaces stay out of the web composition.
  for (const desktopRow of ['oh-desktop', 'oh-plugin-marketplace']) {
    assert.doesNotMatch(patch, new RegExp(`- id: ${desktopRow}\\b`))
  }
})

test('web launcher defaults match the dsh-web-app bundle surface', () => {
  const options = parseLaunchArgs([], {}, false, `/home/user/${DEFAULT_DATA_DIR_NAME}`)
  assert.equal(options.host, DEFAULT_WEB_HOST)
  assert.equal(options.port, DEFAULT_WEB_PORT)
  assert.equal(options.open, false)
  assert.equal(options.dataRoot, `/home/user/${DEFAULT_DATA_DIR_NAME}`)
  assert.deepEqual(options.trustedHosts, [])
  assert.equal(options.help, false)
})

test('web launcher honors environment and flag precedence', () => {
  const base = parseLaunchArgs([], {
    DSH_OH_WEB_HOST: '0.0.0.0',
    DSH_OH_WEB_PORT: '9090',
    DSH_OH_WEB_HOME: '/data/web',
    DSH_OH_WEB_OPEN: '0',
  }, true, '/default')
  assert.equal(base.host, '0.0.0.0')
  assert.equal(base.port, 9090)
  assert.equal(base.dataRoot, '/data/web')
  assert.equal(base.open, false)

  const flags = parseLaunchArgs([
    '--host', '127.0.0.1',
    '--port=8080',
    '--data', '/flags',
    '--open',
    '--trusted-host', 'lab.internal:3080',
    '--trusted-host=10.0.0.9',
  ], {
    DSH_OH_WEB_HOST: '0.0.0.0',
    DSH_OH_WEB_PORT: '9090',
  }, false, '/default')
  assert.equal(flags.host, '127.0.0.1')
  assert.equal(flags.port, 8080)
  assert.equal(flags.dataRoot, '/flags')
  assert.equal(flags.open, true)
  assert.deepEqual(flags.trustedHosts, ['lab.internal:3080', '10.0.0.9'])

  const noOpen = parseLaunchArgs(['--no-open'], { DSH_OH_WEB_OPEN: '1' }, true, '/default')
  assert.equal(noOpen.open, false)
})

test('web launcher rejects invalid arguments', () => {
  assert.throws(() => parseLaunchArgs(['--port', 'not-a-port'], {}, false, '/d'), UsageError)
  assert.throws(() => parseLaunchArgs(['--port', '70000'], {}, false, '/d'), UsageError)
  assert.throws(() => parseLaunchArgs(['--host'], {}, false, '/d'), UsageError)
  assert.throws(() => parseLaunchArgs(['--unknown'], {}, false, '/d'), UsageError)
  assert.throws(() => parseLaunchArgs([], { DSH_OH_WEB_PORT: 'abc' }, false, '/d'), UsageError)
})

test('web launcher requires trusted hosts for non-loopback exposure', async () => {
  await assert.rejects(
    main(['--host', '0.0.0.0'], {}, { isTTY: false } as NodeJS.WriteStream),
    UsageError,
  )
})

test('web launcher --help short-circuits', () => {
  const options = parseLaunchArgs(['--help'], {}, false, '/d')
  assert.equal(options.help, true)
})

test('web launcher resolves a relative data root before spawning the runtime', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'dsh-web-main-'))
  const dataRoot = realpathSync(temp)
  const packaged = join(dataRoot, 'package')
  const nodeBinary = process.platform === 'win32'
    ? join(packaged, 'node-runtime', 'node.exe')
    : join(packaged, 'node-runtime', 'bin', 'node')
  mkdirSync(dirname(nodeBinary), { recursive: true })
  mkdirSync(join(packaged, 'dsh-runtime', 'lib'), { recursive: true })
  writeFileSync(nodeBinary, '')
  writeFileSync(join(packaged, 'dsh-runtime', 'lib', 'bin.js'), '')

  class FailingRuntime extends DshRuntimeSupervisor {
    readonly plan: DshRuntimeOptions

    constructor(plan: DshRuntimeOptions) {
      super(plan)
      this.plan = plan
    }

    async start(): Promise<URL> {
      throw new Error('test runtime never becomes ready')
    }
  }

  const previous = process.cwd()
  let runtime: FailingRuntime | undefined
  process.chdir(dataRoot)
  try {
    const code = await main(
      ['--data', './state'],
      { DSH_OH_WEB_ROOT: packaged, PATH: process.env.PATH },
      { isTTY: false } as NodeJS.WriteStream,
      plan => {
        runtime = new FailingRuntime(plan)
        return runtime
      },
    )
    assert.equal(code, 1)
    assert.ok(runtime)
    assert.equal(runtime.plan.cwd, join(dataRoot, 'state'))
    assert.equal(runtime.plan.env.DSH_HOME, join(dataRoot, 'state'))
    assert.equal(runtime.plan.env.DSH_OH_WEB_DATA, join(dataRoot, 'state'))
    assert.equal(runtime.plan.env.OH_DSH_HOME, join(dataRoot, 'state'))
    assert.equal(runtime.plan.env.OH_DSH_PROFILE, WEB_PROFILE)
  } finally {
    process.chdir(previous)
    rmSync(temp, { recursive: true, force: true })
  }
})

test('web launcher defers profile setup until migration can finish', async t => {
  if (process.platform !== 'win32') {
    t.skip('Windows junction behavior')
    return
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ohdsh-web-start-retry-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

  const dataRoot = join(temporaryRoot, 'state')
  const packaged = join(temporaryRoot, 'package')
  const nodeBinary = join(packaged, 'node-runtime', 'node.exe')
  const cliEntry = join(packaged, 'dsh-runtime', 'lib', 'bin.js')
  const unavailableTarget = join(temporaryRoot, 'unavailable-profiles')
  const legacyProfiles = join(dataRoot, 'dsh', 'profiles')
  mkdirSync(dirname(nodeBinary), { recursive: true })
  mkdirSync(dirname(cliEntry), { recursive: true })
  mkdirSync(dirname(legacyProfiles), { recursive: true })
  writeFileSync(nodeBinary, '')
  writeFileSync(cliEntry, '')
  symlinkSync(unavailableTarget, legacyProfiles, 'junction')

  let runtimeCreated = false
  await assert.rejects(
    main(
      ['--data', dataRoot],
      { DSH_OH_WEB_ROOT: packaged, PATH: process.env.PATH },
      { isTTY: false } as NodeJS.WriteStream,
      options => {
        runtimeCreated = true
        return new DshRuntimeSupervisor(options)
      },
    ),
    /legacy Web state migration .* is incomplete/,
  )
  assert.equal(runtimeCreated, false)
  assert.equal(existsSync(join(dataRoot, 'profiles')), false)
})
