import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { apply } from '../src/plugin.ts'
import {
  mountMarketplaceAgentTools,
  requireHealthyMarketplaceSnapshot,
} from '../src/marketplace-tools.ts'

test('desktop client replaces the hero title and keeps the Preview badge', () => {
  const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  assert.match(client, /element\.textContent = 'Oh-DSH Desktop'/)
  assert.match(client, /\['Into the Unknown', '探索未知之境', '探索未至之境'\]/)
  assert.doesNotMatch(client, /data-oh-dsh-hero-preview/)
})

test('desktop Settings stays below portaled menus and above desktop surfaces', () => {
  const client = readFileSync(
    new URL('../src/client.ts', import.meta.url),
    'utf8',
  )

  assert.match(
    client,
    /#root:has\(\s*\[role='presentation'\] > \[role='dialog'\]\s*\)[^{]*\{[^}]*z-index: 1000 !important;[^}]*overflow: visible !important;/s,
  )
  assert.match(
    client,
    /\[role='presentation'\]:has\(\s*> \[role='dialog'\]\s*\)[^{]*\{[^}]*z-index: 1000 !important;[^}]*backdrop-filter: blur\(/s,
  )
  assert.match(
    client,
    /:has\(\s*#root \[role='presentation'\] > \[role='dialog'\]\s*\) \.oh-dsh-panel-toolbar,[\s\S]*#oh-dsh-sidebar-root,[\s\S]*\[data-oh-dsh-pinned-summary\],[\s\S]*#oh-dsh-plugin-marketplace-root[^}]*\{[^}]*z-index: 999 !important;/s,
  )
})

test('every bundled Oh-DSH client follows the native locale service', () => {
  const clients = [
    '../plugins/skins/src/client/plugin.tsx',
    '../src/client.ts',
    '../plugins/about/src/client/plugin.tsx',
    '../plugins/panel-controls/src/terminal/plugin.tsx',
    '../plugins/pinned-summary/src/client.ts',
    '../plugins/plugin-marketplace/src/client/plugin.tsx',
    '../plugins/sidebar/src/client/plugin.tsx',
  ]
  for (const path of clients) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /export const inject = \[[^\]]*'locale'/)
    assert.match(source, /locale\.register\('oh-dsh\./)
  }

  const dictionaries = [
    '../plugins/skins/src/client/i18n.ts',
    '../plugins/about/src/client/i18n.ts',
    '../plugins/panel-controls/src/terminal/i18n.ts',
    '../plugins/pinned-summary/src/i18n.ts',
    '../plugins/plugin-marketplace/src/client/i18n.ts',
    '../plugins/sidebar/src/client/i18n.ts',
  ]
  for (const path of dictionaries) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /en: \{/)
    assert.match(source, /zh: \{/)
  }
})

test('desktop sidebar exposes one configurable tool registry in settings', () => {
  const client = readFileSync(
    new URL('../plugins/sidebar/src/client/plugin.tsx', import.meta.url),
    'utf8',
  )
  const manifest = readFileSync(
    new URL('../plugins/sidebar/package.json', import.meta.url),
    'utf8',
  )
  const runtimeSettings = readFileSync(
    new URL(
      '../plugins/sidebar/src/client/runtime-settings.ts',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(client, /defineStore<SidebarSettingsState>/)
  assert.match(client, /slots\.inject\('settings\.section'/)
  assert.match(client, /new SidebarRuntimeSettingsService/)
  assert.match(runtimeSettings, /betterSidebarApi/)
  assert.match(runtimeSettings, /settingsUpdate\(patch, previous\.revision\)/)
  assert.match(client, /desktopSidebar\.setTabEnabled/)
  assert.match(client, /desktopSidebar\.setViewerEnabled/)
  assert.match(manifest, /@deepseek-ai\/dsh-client-ui-settings/)
  assert.match(manifest, /@deepseek-ai\/dsh-client-ui-slots/)
})

test('desktop Host plugin publishes capability, prompt, and bash environment', () => {
  const previous = {
    appData: process.env.DSH_DESKTOP_APP_DATA,
    profile: process.env.DSH_DESKTOP_PROFILE,
    version: process.env.DSH_DESKTOP_VERSION,
  }
  process.env.DSH_DESKTOP_APP_DATA = '/tmp/dsh-desktop-data'
  process.env.DSH_DESKTOP_PROFILE = 'desktop'
  process.env.DSH_DESKTOP_VERSION = '9.8.7'
  let capability: unknown
  const sections: { text: () => string }[] = []
  let resolvedEnvironment: Record<string, string> = {}
  const context = {
    effect: <T>(effect: () => T): T => effect(),
    get: () => undefined,
    logger: {
      debug: () => {},
      warn: () => {},
    },
    on: () => {},
    inject: (names: string[], callback: (ctx: unknown) => void): void => {
      if (names[0] === 'systemPrompt') {
        callback({
          systemPrompt: {
            section: (section: { text: () => string }) => { sections.push(section) },
          },
        })
      }
      if (names[0] === 'bashEnv') {
        callback({
          bashEnv: {
            register: (entry: { resolve: () => Record<string, string> }) => {
              resolvedEnvironment = entry.resolve()
            },
          },
        })
      }
    },
    provide: (name: string, value: unknown): void => {
      if (name === 'desktop') capability = value
    },
    tools: {
      register: () => {},
    },
  }
  try {
    apply(context as Parameters<typeof apply>[0])
    assert.deepEqual(capability, {
      appDataPath: '/tmp/dsh-desktop-data',
      kind: 'electron',
      platform: process.platform,
      profile: 'desktop',
      version: '9.8.7',
    })
    const prompt = sections.map(section => section.text()).join('\n')
    assert.match(prompt, /Oh-DSH Desktop/)
    assert.match(prompt, /explicit approval/)
    assert.match(prompt, /remote repositories/)
    assert.match(prompt, /ask_user_question/)
    assert.doesNotMatch(prompt, /ChatGPT|OpenAI/)
    assert.deepEqual(resolvedEnvironment, {
      DSH_DESKTOP: '1',
      DSH_DESKTOP_APP_DATA: '/tmp/dsh-desktop-data',
      DSH_DESKTOP_PROFILE: 'desktop',
      DSH_DESKTOP_VERSION: '9.8.7',
    })
  } finally {
    if (previous.appData === undefined) delete process.env.DSH_DESKTOP_APP_DATA
    else process.env.DSH_DESKTOP_APP_DATA = previous.appData
    if (previous.profile === undefined) delete process.env.DSH_DESKTOP_PROFILE
    else process.env.DSH_DESKTOP_PROFILE = previous.profile
    if (previous.version === undefined) delete process.env.DSH_DESKTOP_VERSION
    else process.env.DSH_DESKTOP_VERSION = previous.version
  }
})

test('desktop Agent tools share the guarded marketplace transaction owner', async () => {
  const names: string[] = []
  const definitions: unknown[] = []
  type AgentPolicy = Parameters<Parameters<typeof mountMarketplaceAgentTools>[0]['on']>[1]
  let policy: AgentPolicy | undefined
  const environment: NodeJS.ProcessEnv = {
    OH_DSH_MARKETPLACE_AGENT_TOKEN: 'secret-token',
    OH_DSH_MARKETPLACE_AGENT_URL: 'http://127.0.0.1:43210/v1/marketplace',
  }
  mountMarketplaceAgentTools({
    on: (_name, listener) => { policy = listener },
    tools: {
      register: definition => {
        names.push(definition.name)
        definitions.push(definition)
      },
    },
  }, environment)
  assert.deepEqual(names, [
    'desktop_plugin_search',
    'desktop_plugin_status',
    'desktop_plugin_prepare',
    'desktop_plugin_preview',
    'desktop_plugin_discard',
    'desktop_plugin_apply',
    'desktop_plugin_recover',
  ])
  assert.equal(environment.OH_DSH_MARKETPLACE_AGENT_TOKEN, undefined)
  assert.equal(environment.OH_DSH_MARKETPLACE_AGENT_URL, undefined)
  const first = definitions[0] as {
    output: { schema: { properties: Record<string, Record<string, unknown>>; required: string[] } }
    parameters: { properties: Record<string, Record<string, unknown>>; type: string }
  }
  assert.equal(first.parameters.type, 'object')
  assert.equal(first.parameters.properties.query?.required, undefined)
  assert.deepEqual(first.output.schema.required, ['summary', 'data'])
  assert.equal(first.output.schema.properties.summary?.required, undefined)
  assert.ok(policy)
  assert.deepEqual(
    await policy({ name: 'desktop_plugin_apply' }, async () => ({ kind: 'allow' })),
    {
      kind: 'ask',
      reason: 'Apply the tested plugin preview to Oh-DSH Desktop?',
    },
  )
  assert.deepEqual(
    await policy({ name: 'desktop_plugin_search' }, async () => ({ kind: 'allow' })),
    { kind: 'allow' },
  )
})

test('desktop Agent tools reject marketplace failures instead of reporting an empty catalog', () => {
  assert.throws(() => requireHealthyMarketplaceSnapshot({
    auth: { detail: 'catalog unavailable', status: 'error' },
    busy: false,
    catalog: [],
    catalogGeneratedAt: null,
    error: 'GitHub returned 404 for the configured catalog',
    installed: [],
    lastAction: null,
    lifecycle: {
      candidate: null,
      current: { profile: 'desktop', state: 'live' },
      previous: null,
    },
    plan: null,
    preview: null,
    sourceLocks: [],
    undoAvailable: false,
  }), /404/)
})
