import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Windows portable build shows an NSIS-compatible extraction splash', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const splash = packageJson.build?.portable?.splashImage
  assert.equal(splash, 'assets/portable-splash.bmp')

  const splashUrl = new URL(`../${splash}`, import.meta.url)
  assert.equal(existsSync(splashUrl), true)
  const bitmap = readFileSync(splashUrl)
  assert.equal(bitmap.toString('ascii', 0, 2), 'BM')
  assert.equal(bitmap.readInt32LE(18), 640)
  assert.equal(Math.abs(bitmap.readInt32LE(22)), 360)
  assert.equal(bitmap.readUInt16LE(28), 24)
  assert.equal(bitmap.readUInt32LE(30), 0)
})

test('Linux runtime smoke disables the Chromium sandbox before Electron starts', () => {
  const smokeRuntime = readFileSync(
    new URL('../scripts/smoke-runtime.mjs', import.meta.url),
    'utf8',
  )
  assert.match(
    smokeRuntime,
    /spawnSync\(electronBinary, \[\s*\.\.\.\(process\.platform === 'linux' \? \['--no-sandbox'\] : \[\]\),\s*join\(root, 'scripts', 'smoke-client\.cjs'\)/,
  )
})
