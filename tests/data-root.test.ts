import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import {
  defaultOhDshHome,
  desktopElectronDataRoot,
  migrateLegacyDesktopState,
  migrateLegacyWebState,
  resolveOhDshHome,
} from '../src/data-root.ts'

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

test('all surfaces resolve one shared Oh-DSH state root', () => {
  assert.equal(defaultOhDshHome('/home/user'), join('/home/user', '.ohdsh'))
  assert.equal(resolveOhDshHome({}, '/home/user'), resolve('/home/user/.ohdsh'))
  assert.equal(
    resolveOhDshHome({ OH_DSH_HOME: '/data/oh-dsh' }, '/home/user'),
    resolve('/data/oh-dsh'),
  )
  assert.equal(
    desktopElectronDataRoot('/data/oh-dsh'),
    join('/data/oh-dsh', 'desktop'),
  )
})

test('legacy Desktop state migrates once without replacing shared state', t => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ohdsh-desktop-migrate-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

  const appDataRoot = join(temporaryRoot, 'app-data')
  const legacyRoot = join(appDataRoot, 'Oh-DSH-Desktop')
  const sharedRoot = join(temporaryRoot, '.ohdsh')
  write(join(legacyRoot, 'dsh', 'sessions', 'legacy.json'), 'legacy')
  write(join(legacyRoot, 'dsh', 'sessions', 'current.json'), 'legacy')
  write(join(sharedRoot, 'sessions', 'current.json'), 'current')
  write(join(legacyRoot, 'skins.json'), 'legacy skin')
  write(join(sharedRoot, 'skins.json'), 'current skin')
  write(join(legacyRoot, 'plugin-marketplace', 'receipt.json'), 'receipt')
  write(join(legacyRoot, 'Local Storage', 'leveldb', 'state'), 'legacy ui')
  write(join(sharedRoot, 'desktop', 'Local Storage', 'leveldb', 'state'), 'new ui')

  assert.equal(migrateLegacyDesktopState({
    appDataRoot,
    env: {},
    ohDshHome: sharedRoot,
  }), true)
  assert.equal(
    readFileSync(join(sharedRoot, 'sessions', 'legacy.json'), 'utf8'),
    'legacy',
  )
  assert.equal(
    readFileSync(join(sharedRoot, 'sessions', 'current.json'), 'utf8'),
    'current',
  )
  assert.equal(readFileSync(join(sharedRoot, 'skins.json'), 'utf8'), 'current skin')
  assert.equal(
    readFileSync(join(sharedRoot, 'plugin-marketplace', 'receipt.json'), 'utf8'),
    'receipt',
  )
  assert.equal(
    readFileSync(join(sharedRoot, 'desktop', 'Local Storage', 'leveldb', 'state'), 'utf8'),
    'new ui',
  )
  assert.equal(existsSync(join(legacyRoot, 'dsh', 'sessions', 'legacy.json')), true)

  write(join(legacyRoot, 'dsh', 'sessions', 'late.json'), 'late')
  assert.equal(migrateLegacyDesktopState({
    appDataRoot,
    env: {},
    ohDshHome: sharedRoot,
  }), false)
  assert.equal(existsSync(join(sharedRoot, 'sessions', 'late.json')), false)
})

test('legacy Web roots flatten once without replacing shared state', t => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ohdsh-web-migrate-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

  const sharedRoot = join(temporaryRoot, '.ohdsh')
  const legacyDefaultRoot = join(temporaryRoot, '.oh-dsh-web')
  write(join(sharedRoot, 'sessions', 'current.json'), 'current')
  write(join(sharedRoot, 'dsh', 'sessions', 'current.json'), 'legacy')
  write(join(sharedRoot, 'dsh', 'sessions', 'flat.json'), 'flat')
  write(join(legacyDefaultRoot, 'dsh', 'sessions', 'default.json'), 'default')
  write(join(legacyDefaultRoot, 'skins.json'), 'legacy skin')
  write(join(legacyDefaultRoot, 'sidebar.json'), 'legacy sidebar')
  write(join(sharedRoot, 'skins.json'), 'current skin')

  assert.equal(migrateLegacyWebState({
    dataRoot: sharedRoot,
    legacyDefaultDataRoot: legacyDefaultRoot,
  }), true)
  assert.equal(
    readFileSync(join(sharedRoot, 'sessions', 'current.json'), 'utf8'),
    'current',
  )
  assert.equal(readFileSync(join(sharedRoot, 'sessions', 'flat.json'), 'utf8'), 'flat')
  assert.equal(
    readFileSync(join(sharedRoot, 'sessions', 'default.json'), 'utf8'),
    'default',
  )
  assert.equal(readFileSync(join(sharedRoot, 'skins.json'), 'utf8'), 'current skin')
  assert.equal(
    readFileSync(join(sharedRoot, 'sidebar.json'), 'utf8'),
    'legacy sidebar',
  )
  assert.equal(existsSync(join(sharedRoot, 'dsh', 'sessions', 'flat.json')), true)
  assert.equal(
    existsSync(join(legacyDefaultRoot, 'dsh', 'sessions', 'default.json')),
    true,
  )

  write(join(sharedRoot, 'dsh', 'sessions', 'late-flat.json'), 'late')
  write(join(legacyDefaultRoot, 'dsh', 'sessions', 'late-default.json'), 'late')
  write(join(legacyDefaultRoot, 'sidebar.json'), 'late sidebar')
  assert.equal(migrateLegacyWebState({
    dataRoot: sharedRoot,
    legacyDefaultDataRoot: legacyDefaultRoot,
  }), false)
  assert.equal(existsSync(join(sharedRoot, 'sessions', 'late-flat.json')), false)
  assert.equal(existsSync(join(sharedRoot, 'sessions', 'late-default.json')), false)
  assert.equal(
    readFileSync(join(sharedRoot, 'sidebar.json'), 'utf8'),
    'legacy sidebar',
  )
})

test('legacy directory links are followed before migration completes', t => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ohdsh-linked-migrate-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

  const appDataRoot = join(temporaryRoot, 'app-data')
  const legacyDesktopRoot = join(appDataRoot, 'Oh-DSH-Desktop')
  const legacyDesktopTarget = join(temporaryRoot, 'legacy-desktop')
  const desktopTarget = join(temporaryRoot, 'desktop-dsh')
  const dependencyTarget = join(temporaryRoot, 'dependency')
  const sharedDesktopRoot = join(temporaryRoot, 'shared-desktop')
  write(join(desktopTarget, 'sessions', 'desktop.json'), 'desktop')
  write(join(dependencyTarget, 'package.json'), '{"name":"linked"}\n')
  mkdirSync(join(desktopTarget, 'node_modules'), { recursive: true })
  const dependencyLink = join(desktopTarget, 'node_modules', 'linked')
  symlinkSync(
    process.platform === 'win32'
      ? dependencyTarget
      : relative(dirname(dependencyLink), dependencyTarget),
    dependencyLink,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  mkdirSync(legacyDesktopTarget, { recursive: true })
  symlinkSync(
    desktopTarget,
    join(legacyDesktopTarget, 'dsh'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  mkdirSync(appDataRoot, { recursive: true })
  symlinkSync(
    legacyDesktopTarget,
    legacyDesktopRoot,
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  assert.equal(migrateLegacyDesktopState({
    appDataRoot,
    env: {},
    ohDshHome: sharedDesktopRoot,
  }), true)
  assert.equal(
    readFileSync(join(sharedDesktopRoot, 'sessions', 'desktop.json'), 'utf8'),
    'desktop',
  )
  assert.equal(
    lstatSync(join(sharedDesktopRoot, 'node_modules', 'linked')).isSymbolicLink(),
    true,
  )
  assert.equal(
    readFileSync(
      join(sharedDesktopRoot, 'node_modules', 'linked', 'package.json'),
      'utf8',
    ),
    '{"name":"linked"}\n',
  )

  const sharedWebRoot = join(temporaryRoot, 'shared-web')
  const webTarget = join(temporaryRoot, 'web-dsh')
  write(join(webTarget, 'sessions', 'web.json'), 'web')
  mkdirSync(sharedWebRoot, { recursive: true })
  symlinkSync(
    webTarget,
    join(sharedWebRoot, 'dsh'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  assert.equal(migrateLegacyWebState({ dataRoot: sharedWebRoot }), true)
  assert.equal(
    readFileSync(join(sharedWebRoot, 'sessions', 'web.json'), 'utf8'),
    'web',
  )
})

test('unavailable Windows junctions keep migration retryable', t => {
  if (process.platform !== 'win32') {
    t.skip('Windows junction behavior')
    return
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ohdsh-junction-retry-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

  const appDataRoot = join(temporaryRoot, 'app-data')
  const legacyRoot = join(appDataRoot, 'Oh-DSH-Desktop')
  const dependencyTarget = join(temporaryRoot, 'dependency')
  const dependencyLink = join(legacyRoot, 'dsh', 'node_modules', 'linked')
  const sharedRoot = join(temporaryRoot, 'shared')
  mkdirSync(dirname(dependencyLink), { recursive: true })
  symlinkSync(dependencyTarget, dependencyLink, 'junction')

  assert.equal(migrateLegacyDesktopState({
    appDataRoot,
    env: {},
    ohDshHome: sharedRoot,
  }), false)

  write(join(dependencyTarget, 'package.json'), '{"name":"linked"}\n')
  assert.equal(migrateLegacyDesktopState({
    appDataRoot,
    env: {},
    ohDshHome: sharedRoot,
  }), true)
  assert.equal(
    readFileSync(join(sharedRoot, 'node_modules', 'linked', 'package.json'), 'utf8'),
    '{"name":"linked"}\n',
  )
})
