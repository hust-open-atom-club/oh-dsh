/** Host half of Oh-DSH skins: durable preferences on the surface origin. */

import {
  mountDesktopSkinPreferences,
  type DesktopCapability,
  type DesktopSkinPreferencesHostContext,
} from './preferences-server.ts'
import { mountTuiSkins } from './tui-adapter.ts'
import {
  hasBrowserSurface,
  OH_DSH_SURFACE_SERVICE,
  type OhDshSurface,
} from '../../shared/surface.ts'

interface HostContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  inject(names: string[], callback: (ctx: HostContext) => void): void
  logger: DesktopSkinPreferencesHostContext['logger']
}

export const name = 'oh-dsh-skins'
// Deliberately empty (the dsh-auth pattern): a hard code-level inject would
// deadlock the TUI composition, which never mounts webServer. Instead, apply
// registers two sibling FIRST-LEVEL dynamic injects — the 0.1.2 loader never
// activates a nested `ctx.inject` created inside another inject's callback —
// so the TUI palette mounts without webServer while browser surfaces wait
// for the preferences server's carrier.
export const inject: readonly string[] = []

function surfaceDataRoot(ctx: HostContext): string {
  const surface = ctx.get(OH_DSH_SURFACE_SERVICE) as OhDshSurface | undefined
  const legacy = ctx.get('desktop') as DesktopCapability | undefined
  return surface?.dataRoot ?? legacy?.appDataPath ?? ''
}

export function apply(ctx: HostContext): void {
  // Every surface: the TUI palette adapter needs no browser service.
  ctx.inject([OH_DSH_SURFACE_SERVICE], surfaceCtx => {
    const surface = surfaceCtx.get(OH_DSH_SURFACE_SERVICE) as OhDshSurface | undefined
    if (surface?.kind !== 'tui') return
    const dataRoot = surfaceDataRoot(surfaceCtx)
    if (dataRoot === '') {
      surfaceCtx.logger.warn('oh-dsh-skins: no writable data root; TUI palette adapter disabled')
      return
    }
    const tuiConfigRoot = process.env.OH_DSH_TUI_CONFIG_HOME
    surfaceCtx.effect(() => {
      mountTuiSkins(dataRoot, tuiConfigRoot)
    }, 'oh-dsh-skins: TUI palette adapter')
  })

  // Browser surfaces: the preferences server follows its web server carrier.
  ctx.inject([OH_DSH_SURFACE_SERVICE, 'webServer'], browserCtx => {
    const surface = browserCtx.get(OH_DSH_SURFACE_SERVICE) as OhDshSurface | undefined
    const legacy = browserCtx.get('desktop') as DesktopCapability | undefined
    if (!hasBrowserSurface(surface?.kind) && legacy === undefined) return
    const dataRoot = surfaceDataRoot(browserCtx)
    if (dataRoot === '') {
      browserCtx.logger.warn('oh-dsh-skins: no writable data root; skin preferences disabled')
      return
    }
    const webServer = browserCtx.get('webServer') as
      DesktopSkinPreferencesHostContext['webServer'] | undefined
    if (webServer === undefined) {
      browserCtx.logger.warn('oh-dsh-skins: browser preferences server is unavailable')
      return
    }
    browserCtx.effect(
      () => mountDesktopSkinPreferences({ logger: browserCtx.logger, webServer }, {
        appDataPath: dataRoot,
      }),
      'oh-dsh-skins: skin preferences',
    )
  })
}
