import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  BUNDLED_DESKTOP_CLIENT_PLUGINS,
} from '../src/profile.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const pluginSource = readFileSync(
  join(root, 'plugins/save-as-image/src/SaveAsImageAction.tsx'),
  'utf8',
)
const captureSource = readFileSync(
  join(root, 'plugins/save-as-image/src/capture.ts'),
  'utf8',
)
const localesSource = readFileSync(
  join(root, 'plugins/save-as-image/src/locales.ts'),
  'utf8',
)
const clientEntry = readFileSync(
  join(root, 'plugins/save-as-image/src/client.ts'),
  'utf8',
)
const hostEntry = readFileSync(
  join(root, 'plugins/save-as-image/src/index.ts'),
  'utf8',
)

test('save-as-image contributes one assistant-actions slot entry', () => {
  assert.match(pluginSource, /export const inject = \['slots', 'locale'\]/)
  assert.match(
    pluginSource,
    /ctx\.slots\.inject\('conversation\.chat\.assistant-actions'/,
  )
  assert.match(pluginSource, /id: 'save-as-image'/)
  assert.match(pluginSource, /order: 20/)
  assert.match(pluginSource, /locale: 'oh-dsh\.save-as-image'/)
  assert.match(
    pluginSource,
    /ctx\.effect\(\s*\(\) => ctx\.locale\.register\('oh-dsh\.save-as-image', SAVE_AS_IMAGE_MESSAGES\)/,
  )
})

test('save-as-image is enrolled in the desktop and web compositions', () => {
  const build = readFileSync(join(root, 'scripts/build.mjs'), 'utf8')
  const webManifest = JSON.parse(readFileSync(
    join(root, 'web/package.json'),
    'utf8',
  ))
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  const webPatch = readFileSync(join(root, 'web/cordis.patch.yml'), 'utf8')
  const stage = readFileSync(join(root, 'scripts/stage-runtime-lib.mjs'), 'utf8')

  assert.equal(
    BUNDLED_DESKTOP_CLIENT_PLUGINS.includes('@oh-dsh/save-as-image'),
    true,
  )
  assert.match(build, /directory: 'save-as-image'/)
  assert.match(build, /id: '@oh-dsh\/save-as-image'/)
  assert.match(build, /clientExternal: \['@deepseek-ai\/\*'\]/)
  assert.equal(
    webManifest.dsh.client.inject.includes('@oh-dsh/save-as-image'),
    true,
  )
  assert.match(patch, /- id: oh-save-as-image\s*\n\s*name: '@oh-dsh\/save-as-image'/)
  assert.match(webPatch, /- id: oh-save-as-image\s*\n\s*name: '@oh-dsh\/save-as-image'/)
  assert.match(stage, /'plugin-marketplace',\s*\n\s*'save-as-image',/)
})

test('the save control is reachable, labelled, and stateful', () => {
  assert.match(pluginSource, /<Tooltip label=\{label\} side="bottom">/)
  assert.match(pluginSource, /type="button"/)
  assert.match(pluginSource, /aria-label=\{label\}/)
  assert.match(pluginSource, /disabled=\{phase === 'capturing'\}/)
  assert.match(pluginSource, /t\('action\.saveAsImage'\)/)
  assert.match(pluginSource, /t\('status\.capturing'\)/)
  assert.match(pluginSource, /t\('status\.saved'\)/)
  assert.match(pluginSource, /t\('status\.failed'\)/)
  assert.match(pluginSource, /role="status" data-oh-dsh-save-as-image-failure/)
  assert.match(pluginSource, /SAVED_RESET_MS = 1500/)
  assert.match(pluginSource, /IconDownloadOutline16/)
  assert.match(pluginSource, /IconCheckOutline16/)
})

test('locale dictionaries keep the zh and en key sets identical', () => {
  const dictionaryKeys = (language: 'zh' | 'en'): string[] => {
    const block = localesSource.match(
      new RegExp(`${language}: \\{([\\s\\S]*?)\\n  \\}`),
    )
    assert.ok(block, `${language} dictionary block is present`)
    const body = block[1] ?? ''
    return [...body.matchAll(/^    '([\w.]+)':/gm)]
      .map(match => match[1])
      .filter((key): key is string => key !== undefined)
  }
  const zh = dictionaryKeys('zh')
  const en = dictionaryKeys('en')
  assert.deepEqual(zh, [
    'action.saveAsImage',
    'status.capturing',
    'status.saved',
    'status.failed',
  ])
  assert.deepEqual(zh, en)
})

test('capture targets the assistant-step sibling and excludes the action row', () => {
  assert.match(captureSource, /closest\(FLOW_ITEM_SELECTOR\)/)
  assert.match(captureSource, /FLOW_ITEM_SELECTOR = '\[data-chat-flow-kind\]'/)
  assert.match(captureSource, /ASSISTANT_STEP_KIND = 'assistant-step'/)
  assert.match(captureSource, /previousElementSibling/)
  assert.match(captureSource, /MAX_SIBLING_HOPS = 10/)
  assert.match(captureSource, /dsh-response-\$\{[^}]*\}\.png/)
  assert.match(captureSource, /\[\^a-zA-Z0-9\._-\]\+/)
})

test('capture stays browser-local and degrades instead of failing the export', () => {
  const pluginSources = pluginSource + captureSource + localesSource
    + clientEntry + hostEntry
  assert.doesNotMatch(pluginSources, /\bfetch\(/)
  assert.doesNotMatch(pluginSources, /XMLHttpRequest/)
  assert.match(captureSource, /getFontEmbedCSS/)
  assert.match(captureSource, /skipFonts: true/)
  assert.match(captureSource, /renderBlob\(node, 2, fontEmbedCSS\)/)
  assert.match(captureSource, /renderBlob\(node, 1, fontEmbedCSS\)/)
  assert.match(captureSource, /URL\.createObjectURL/)
  assert.match(captureSource, /anchor\.download = fileName/)
  assert.match(captureSource, /URL\.revokeObjectURL/)
  assert.match(captureSource, /setTimeout[\s\S]*?URL\.revokeObjectURL/)
})

test('the host half stays behavior-free and the client barrel re-exports it', () => {
  assert.match(clientEntry, /export \{ apply, inject \} from '\.\/SaveAsImageAction\.tsx'/)
  assert.match(hostEntry, /export function apply\(\): void \{\}/)
  const manifest = JSON.parse(readFileSync(
    join(root, 'plugins/save-as-image/package.json'),
    'utf8',
  ))
  assert.deepEqual(manifest.dsh.client.platform, 'web')
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-conversation',
  ])
  assert.equal(manifest.dependencies['html-to-image'] !== undefined, true)
})
