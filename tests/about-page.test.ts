import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

test('about plugin registers one settings section over injected versions', () => {
  const plugin = read('plugins/about/src/client/plugin.tsx')
  assert.match(plugin, /slots\.inject\('settings\.section'/)
  assert.match(plugin, /id: 'oh-dsh-about'/)
  assert.match(plugin, /locale: 'oh-dsh\.about'/)

  const manifest = JSON.parse(read('plugins/about/package.json'))
  assert.equal(manifest.name, '@oh-dsh/about')
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-settings',
  ])
})

test('build injects the About version facts as bundle literals', () => {
  const buildScript = read('scripts/build.mjs')
  for (const constant of [
    '__OH_DSH_SOURCE_VERSION__',
    '__OH_DSH_SOURCE_PACKAGE__',
    '__OH_DSH_PLUGIN_VERSIONS__',
    '__OH_DSH_DEPENDENCY_VERSIONS__',
  ]) {
    assert.match(buildScript, new RegExp(constant), `missing define ${constant}`)
    assert.match(
      read('plugins/about/src/client/versions.ts'),
      new RegExp(`declare const ${constant}`),
      `missing declaration ${constant}`,
    )
  }
  assert.match(buildScript, /dsh-source\.json/)
  assert.match(buildScript, /aboutVersionDefines/)
})

test('desktop About opens the gated update window through one IPC', () => {
  assert.match(read('src/contracts.ts'), /openUpdater\(\): Promise<void>/)
  assert.doesNotMatch(read('src/contracts.ts'), /openProfileDir/)
  assert.match(read('src/preload.ts'), /desktop:open-updater/)
  assert.doesNotMatch(read('src/preload.ts'), /open-profile-dir/)
  const main = read('src/main.ts')
  assert.match(main, /desktop:open-updater/)
  assert.match(main, /void openUpdateWindow\(\)/)
  assert.doesNotMatch(main, /open-profile-dir/)
  // The update state/command channels keep their update-window-only gate.
  assert.match(main, /assertUpdateWindowSender/)
})

test('the About update card drives the inline check/download/install flow', () => {
  const contracts = read('src/contracts.ts')
  assert.match(contracts, /type AboutUpdateSnapshot/)
  assert.match(contracts, /type AboutUpdateCommand = 'check' \| 'download' \| 'install-now'/)
  const main = read('src/main.ts')
  for (const channel of ['desktop:about-update:get-state', 'desktop:about-update:check', 'desktop:about-update:command']) {
    assert.match(main, new RegExp(channel), `missing About update channel ${channel}`)
  }
  // The About command surface is limited to the three inline steps: the
  // parse guard must reject every other update command.
  assert.match(main, /parseAboutUpdateCommand/)
  assert.match(main, /\['check', 'download', 'install-now'\]/)
  assert.doesNotMatch(main, /desktop:about-update:download|desktop:about-update:install/)
  const about = read('plugins/about/src/client/plugin.tsx')
  assert.match(about, /projection\.check\(\)/)
  assert.match(about, /projection\.command\(command\)/)
  // Only the three allow-listed commands may reach projection.command.
  assert.doesNotMatch(about, /command\('(?!check|download|install-now)/)
})

test('about styles follow the DSH theme instead of hard-coded colors', () => {
  const css = read('plugins/about/src/client/about.css')
  // Theme-driven: brand and success tokens drive every accent; hex values
  // appear only as var() fallbacks, and the mock's lavender palette is gone.
  assert.match(css, /var\(--dsw-alias-brand-primary/)
  assert.match(css, /var\(--dsw-alias-state-success/)
  for (const line of css.split('\n')) {
    if (line.includes('#')) assert.match(line, /var\(--dsw-alias-/)
  }
})

test('about footer links work on Web without a desktop bridge', () => {
  const about = read('plugins/about/src/client/plugin.tsx')
  assert.match(about, /function openExternal\(url: string\): void/)
  // Desktop goes through the bridge; Web falls back to a sandboxed new tab.
  assert.match(about, /window\.dshDesktop\.openExternal\(url\)/)
  assert.match(about, /open\(url, '_blank', 'noopener,noreferrer'\)/)
  assert.doesNotMatch(about, /void desktop\?\.openExternal\(/)
})

test('both surfaces mount the About plugin', () => {
  for (const patch of ['cordis.patch.yml', 'web/cordis.patch.yml']) {
    assert.match(read(patch), /id: oh-about/)
    assert.match(read(patch), /name: '@oh-dsh\/about'/)
  }
  assert.match(read('scripts/stage-dsh.mjs'), /plugins\/about\/client\.js/)
  assert.match(read('scripts/stage-runtime-lib.mjs'), /'about',/)
  assert.match(read('scripts/stage-runtime-lib.mjs'), /'@oh-dsh\/about'/)
  const profile = read('src/profile.ts')
  assert.match(profile, /'@oh-dsh\/about'/)
})
