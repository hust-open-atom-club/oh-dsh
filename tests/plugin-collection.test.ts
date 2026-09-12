import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  BUNDLED_DESKTOP_CLIENT_PLUGINS,
  BUNDLED_DESKTOP_HOST_PLUGINS,
  BUNDLED_DESKTOP_PLUGINS,
} from '../src/profile.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('desktop bundle registers every packaged DSH plugin', () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  for (const plugin of BUNDLED_DESKTOP_PLUGINS) {
    assert.match(patch, new RegExp(`name: ['"]${plugin.replace('/', '\\/')}['"]`))
  }
  for (const plugin of BUNDLED_DESKTOP_CLIENT_PLUGINS) {
    const directory = plugin.slice(plugin.lastIndexOf('/') + 1)
    const manifestPath = plugin === '@oh-dsh/desktop'
      ? join(root, 'package.json')
      : plugin === 'dsh-context'
        ? join(root, 'upstream', 'dsh-context', 'package.json')
        : plugin === 'dsh-better-sidebar'
          ? join(root, 'upstream', 'DSH-better-sidebar', 'package.json')
          : join(root, 'plugins', directory, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.equal(manifest.name, plugin)
    assert.equal(manifest.dsh.client.platform, 'web')
    assert.equal(manifest.dshClient, undefined)
  }
  for (const plugin of BUNDLED_DESKTOP_HOST_PLUGINS) {
    const manifestPath = plugin === '@deepseek-harness-tui/dsh-auth'
      ? join(root, 'upstream', 'dsh-TUI', 'dsh-auth', 'package.json')
      : join(root, 'plugins', plugin.slice(plugin.lastIndexOf('/') + 1), 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.equal(manifest.name, plugin)
    // Host plugins enroll no browser half; upstream bundle manifests may
    // still declare their patch layer.
    assert.equal(manifest.dsh?.client, undefined)
  }
})
