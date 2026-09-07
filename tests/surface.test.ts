import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  hasBrowserSurface,
  OH_DSH_SURFACE_SERVICE,
  OH_DSH_SURFACE_VIEW_SERVICE,
  type OhDshSurface,
} from '../plugins/shared/surface.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('surface contract defines exactly the three Oh-DSH forms', () => {
  assert.equal(OH_DSH_SURFACE_SERVICE, 'ohDshSurface')
  assert.equal(OH_DSH_SURFACE_VIEW_SERVICE, 'ohDshSurface')
  const surface: OhDshSurface = {
    dataRoot: '/data',
    kind: 'desktop',
    platform: 'darwin',
    profile: 'desktop',
    version: '0.1.4',
  }
  assert.equal(surface.kind, 'desktop')
  assert.deepEqual(
    (['desktop', 'web', 'tui'] as const).map(kind => hasBrowserSurface(kind)),
    [true, true, false],
  )
  assert.equal(hasBrowserSurface(undefined), false)
})

test('every bundled plugin adapts explicitly per surface', () => {
  const skins = readFileSync(join(root, 'plugins/skins/src/index.ts'), 'utf8')
  assert.match(skins, /OH_DSH_SURFACE_SERVICE/)
  assert.match(skins, /hasBrowserSurface/)
  assert.match(skins, /surface\?\.kind !== 'tui'/)
  assert.match(skins, /mountTuiSkins/)
  // Sibling FIRST-LEVEL injects: the 0.1.2 loader never activates a nested
  // `ctx.inject` created inside another inject's callback.
  assert.match(skins, /ctx\.inject\(\[OH_DSH_SURFACE_SERVICE\], surfaceCtx =>/)
  assert.match(skins, /ctx\.inject\(\[OH_DSH_SURFACE_SERVICE, 'webServer'\], browserCtx =>/)

  const sidebar = readFileSync(join(root, 'plugins/sidebar/src/index.ts'), 'utf8')
  assert.match(sidebar, /export const inject = \['webServer'\]/)
  assert.doesNotMatch(sidebar, /inject = \['desktop', 'webServer'\]/)
  assert.match(sidebar, /OH_DSH_SURFACE_SERVICE/)
  assert.match(sidebar, /hasBrowserSurface/)
  assert.match(sidebar, /no browser surface; sidebar host disabled/)

  const marketplace = readFileSync(
    join(root, 'plugins/plugin-marketplace/src/client/plugin.tsx'),
    'utf8',
  )
  assert.doesNotMatch(marketplace, /Electron bridge is unavailable'\)/)
  assert.doesNotMatch(marketplace, /desktop-only/)
  assert.match(marketplace, /resolveClientBridge/)
  assert.match(marketplace, /createMarketplaceHttpBridge/)

  const desktopHost = readFileSync(join(root, 'src/plugin.ts'), 'utf8')
  assert.match(desktopHost, /kind: 'desktop'/)
  assert.match(desktopHost, /OH_DSH_SURFACE_SERVICE/)

  const marketplaceHost = readFileSync(
    join(root, 'plugins/plugin-marketplace/src/index.ts'),
    'utf8',
  )
  assert.match(marketplaceHost, /createSurfaceMarketplaceHost/)
  assert.match(marketplaceHost, /mountMarketplaceWebBridge/)
  assert.match(marketplaceHost, /mountMarketplaceTuiCommand/)
  assert.match(marketplaceHost, /OH_DSH_MARKETPLACE_PREVIEW/)
  assert.match(marketplaceHost, /previewProxy/)

  const tuiMarketplace = readFileSync(
    join(root, 'plugins/tui-marketplace/src/plugin.ts'),
    'utf8',
  )
  assert.match(tuiMarketplace, /TuiMarketplaceController/)
  assert.match(tuiMarketplace, /ctx\.on\('session\/event'/)
  assert.match(tuiMarketplace, /command\/run/)
  assert.match(tuiMarketplace, /command === 'plugins'/)

  const webHost = readFileSync(join(root, 'web/src/index.ts'), 'utf8')
  assert.match(webHost, /kind: 'web'/)
  assert.match(webHost, /OH_DSH_SURFACE_SERVICE/)

  const webClient = readFileSync(join(root, 'web/src/client.ts'), 'utf8')
  assert.match(webClient, /kind: 'web'/)
  assert.match(webClient, /OH_DSH_SURFACE_VIEW_SERVICE/)

  const tuiHost = readFileSync(join(root, 'plugins/tui/src/index.ts'), 'utf8')
  assert.match(tuiHost, /kind: 'tui'/)
  assert.match(tuiHost, /OH_DSH_SURFACE_SERVICE/)
  assert.match(tuiHost, /Oh-DSH TUI/)
})

test('every Oh-DSH surface host adds the human-approval guardrail', () => {
  const hosts = [
    'src/plugin.ts',
    'web/src/index.ts',
    'plugins/tui/src/index.ts',
  ]
  for (const file of hosts) {
    const source = readFileSync(join(root, file), 'utf8')
    assert.match(source, /humanApprovalGuidance/)
    assert.match(source, /app:oh-dsh-human-approval/)
  }
  const shared = readFileSync(join(root, 'plugins/shared/guardrails.ts'), 'utf8')
  assert.match(shared, /ask_user_question/)
  assert.match(shared, /remote repositories/)
  assert.match(shared, /explicit approval/)
})
