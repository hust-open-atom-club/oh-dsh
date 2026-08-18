import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { DSH_SOURCE_SPEC, resolveDshSource } from '../scripts/dsh-source.mjs'

test('desktop release source pins the published DSH npm package', () => {
  assert.equal(DSH_SOURCE_SPEC.source, 'npm')
  if (DSH_SOURCE_SPEC.source !== 'npm') throw new Error('unreachable')
  assert.equal(DSH_SOURCE_SPEC.package, '@deepseek-ai/dsh')
  assert.equal(DSH_SOURCE_SPEC.version, '0.1.0-rc.7')
  assert.match(DSH_SOURCE_SPEC.integrity, /^sha512-[A-Za-z0-9+/=]+$/)
  assert.equal(
    DSH_SOURCE_SPEC.tarball,
    'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.0-rc.7.tgz',
  )
  assert.match(DSH_SOURCE_SPEC.packageManager, /^pnpm@\d+\.\d+\.\d+$/)
})

test('DSH source override must match the pinned package version', () => {
  if (DSH_SOURCE_SPEC.source !== 'npm') throw new Error('unreachable')
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-source-'))
  const previous = process.env.DSH_SOURCE
  try {
    mkdirSync(join(root, 'lib'), { recursive: true })
    writeFileSync(join(root, 'lib', 'bin.js'), '#!/usr/bin/env node\n')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: DSH_SOURCE_SPEC.package,
      version: DSH_SOURCE_SPEC.version,
    }))
    process.env.DSH_SOURCE = root
    assert.equal(resolveDshSource(), resolve(root))

    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: DSH_SOURCE_SPEC.package,
      version: '0.0.0',
    }))
    assert.throws(() => resolveDshSource(), /0\.1\.0-rc\.7 is required/)
  } finally {
    if (previous === undefined) delete process.env.DSH_SOURCE
    else process.env.DSH_SOURCE = previous
    rmSync(root, { recursive: true, force: true })
  }
})
