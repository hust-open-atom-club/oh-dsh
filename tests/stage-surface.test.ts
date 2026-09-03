import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('stage-dsh validates the requested surface before staging', () => {
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts', 'stage-dsh.mjs'), '--surface', 'invalid'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /invalid stage surface/)
})

test('Make surface targets select isolated staging profiles', () => {
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8')
  assert.match(makefile, /OH_DSH_HOME \?= \$\(HOME\)\/\.ohdsh/)
  assert.match(makefile, /export OH_DSH_HOME/)
  assert.match(makefile, /run stage:dsh -- --surface tui/)
  assert.match(makefile, /run stage:dsh -- --surface web/)
  assert.match(makefile, /run stage:dsh -- --surface desktop/)
})

test('surface staging keeps Desktop isolated and ships Liangshen as a Web/Desktop plugin', () => {
  const script = readFileSync(join(root, 'scripts', 'stage-runtime-lib.mjs'), 'utf8')
  const desktopStart = script.indexOf("desktop: new Set([")
  const webStart = script.indexOf("web: new Set([")
  assert.ok(desktopStart >= 0 && webStart > desktopStart)
  const desktopPackages = script.slice(desktopStart, webStart)
  assert.match(desktopPackages, /'@oh-dsh\/desktop'/)
  assert.match(desktopPackages, /'@oh-dsh\/liangshen'/)
  assert.doesNotMatch(script.slice(webStart, script.indexOf("tui: new Set([")), /'@oh-dsh\/desktop'/)
  assert.match(script, /plugins', 'liangshen', 'package\.json'/)
  assert.match(script, /upstream', 'dsh-TUI', 'presets', 'liangshen/)
  assert.doesNotMatch(script.slice(script.indexOf("tui: new Set([")), /'@oh-dsh\/liangshen'/)
  assert.match(script, /alignBetterSidebarPtyDependency/)
  assert.match(script, /runtimePackageDirectory\('node-pty'\)/)
})

test('root deploy workspace owns nested TUI link packages', () => {
  const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')

  assert.match(workspace, /^  - upstream\/dsh-TUI\/dsh-auth$/m)
  assert.match(lockfile, /^  upstream\/dsh-TUI\/dsh-auth:$/m)
})
