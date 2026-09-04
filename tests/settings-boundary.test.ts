import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { restoreSettingsBoundary } from '../scripts/settings-boundary.mjs'

function fixture(layout = 'pnpm') {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-settings-boundary-'))
  const index = layout === 'hoisted'
    ? join(
      root,
      'node_modules',
      '@deepseek-ai',
      'dsh-api-settings-controller',
      'lib',
      'index.js',
    )
    : join(
      root,
      'node_modules',
      '.pnpm',
      '@deepseek-ai+dsh-api-settings-controller@0.1.2-alpha.3',
      'node_modules',
      '@deepseek-ai',
      'dsh-api-settings-controller',
      'lib',
      'index.js',
    )
  mkdirSync(dirname(index), { recursive: true })
  writeFileSync(index, [
    'const MAX_DESCRIBE_REFS = 64;',
    'const snapshot = {',
    '  namespaces: settings.describe({ redactSecrets: true }).map(namespaceView)',
    '};',
    'const namespace = parsed.data.ns;',
  ].join('\n'))
  return { root, index }
}

test('settings boundary patches every assembled runtime idempotently', () => {
  const { root, index } = fixture()
  try {
    restoreSettingsBoundary(root)
    const once = readFileSync(index, 'utf8')
    restoreSettingsBoundary(root)
    assert.equal(readFileSync(index, 'utf8'), once)
    assert.match(once, /WEB_SETTINGS_NAMESPACES/)
    assert.match(once, /llm\.listConfigurableProviders\(\)/)
    assert.match(once, /settings-not-exposed/)
    assert.match(once, /"agent-presets"/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('settings boundary patches hoisted runtimes used by Windows release builds', () => {
  const { root, index } = fixture('hoisted')
  try {
    restoreSettingsBoundary(root)
    assert.match(readFileSync(index, 'utf8'), /WEB_SETTINGS_NAMESPACES/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Nix assembly applies the shared settings boundary', () => {
  const nix = readFileSync(
    new URL('../nix/oh-dsh.nix', import.meta.url),
    'utf8',
  )
  const boundary = nix.indexOf('${../scripts/settings-boundary.mjs}')
  const assembly = nix.indexOf('${ohDshBundle}/lib/oh-dsh/dsh-runtime')
  assert.ok(boundary >= 0)
  assert.ok(assembly >= 0)
  assert.ok(assembly < boundary)
})
