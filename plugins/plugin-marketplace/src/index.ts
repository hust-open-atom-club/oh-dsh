import {
  OH_DSH_SURFACE_SERVICE,
  type OhDshSurface,
} from '../../shared/surface.ts'
import {
  createSurfaceMarketplaceHost,
  marketplaceBridge,
} from './host/surface.ts'
import { mountMarketplaceTuiCommand } from './host/tui-command.ts'
import { mountMarketplaceWebBridge } from './host/web-bridge.ts'

interface HostContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  inject(names: string[], callback: (ctx: HostContext) => void): void
  logger: { warn(message: string): void }
  provide(name: string, value: unknown): void
}

export const name = 'oh-dsh-plugin-marketplace'
// Deliberately empty (the dsh-auth pattern): a hard code-level inject would
// deadlock compositions without the carrier service (desktop uses the
// Electron IPC bridge). Instead, apply registers sibling FIRST-LEVEL dynamic
// injects per carrier — the 0.1.2 loader never activates a nested
// `ctx.inject` created inside another inject's callback.
export const inject: readonly string[] = []

/** Facts other Host plugins can inspect without receiving Electron access. */
export interface PluginMarketplaceHost {
  catalog: 'public-dsh-catalog'
  preview: 'isolated-profile'
}

interface MountedMarketplaceHost {
  manager: ReturnType<typeof createSurfaceMarketplaceHost>['manager']
  previewProxy: ReturnType<typeof createSurfaceMarketplaceHost>['previewProxy']
}

/** Create the surface manager, or log why this composition stays inert. */
function mountSurfaceHost(
  ctx: HostContext,
  surface: OhDshSurface & { kind: 'web' | 'tui' },
): MountedMarketplaceHost | undefined {
  if (process.env.OH_DSH_MARKETPLACE_PREVIEW === '1') {
    ctx.logger.warn('plugin-marketplace: disabled inside an isolated preview runtime')
    return undefined
  }
  if (process.env.OH_DSH_READ_ONLY === '1') {
    // Viewer mode keeps the shared pluginMarketplace service available so
    // dependent surfaces (for example the TUI marketplace scene) still
    // activate; the manager refuses every mutating transaction.
    ctx.logger.warn('plugin-marketplace: read-only viewer mode; transactions disabled')
  }
  if (surface.dataRoot === '') {
    ctx.logger.warn('plugin-marketplace: no writable data root; host disabled')
    return undefined
  }
  try {
    const host = createSurfaceMarketplaceHost({
      environment: process.env,
      kind: surface.kind,
      onLog: line => ctx.logger.warn(`[marketplace] ${line}`),
      ...(process.env.OH_DSH_READ_ONLY === '1' ? { readOnly: true } : {}),
      surface,
    })
    ctx.provide('pluginMarketplace', marketplaceBridge(host.manager))
    return host
  } catch (error) {
    ctx.logger.warn(
      `plugin-marketplace: host disabled: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }
}

export function apply(ctx: HostContext): void {
  ctx.provide('pluginMarketplaceHost', Object.freeze({
    catalog: 'public-dsh-catalog',
    preview: 'isolated-profile',
  } satisfies PluginMarketplaceHost))

  // Web carrier: the HTTP bridge follows the surface and its web server.
  ctx.inject([OH_DSH_SURFACE_SERVICE, 'webServer'], webCtx => {
    const surface = webCtx.get(OH_DSH_SURFACE_SERVICE) as OhDshSurface | undefined
    if (surface?.kind !== 'web') return
    const host = mountSurfaceHost(webCtx, surface as OhDshSurface & { kind: 'web' })
    if (host === undefined) return
    const webServer = webCtx.get('webServer') as
      Parameters<typeof mountMarketplaceWebBridge>[0]['webServer'] | undefined
    if (webServer === undefined) {
      webCtx.logger.warn('plugin-marketplace: web HTTP bridge is unavailable')
      return
    }
    webCtx.effect(() => {
      const disposers = [
        mountMarketplaceWebBridge({ logger: webCtx.logger, webServer }, host.manager),
        ...(host.previewProxy === null ? [] : [host.previewProxy.mount({ webServer })]),
      ]
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'oh-dsh-plugin-marketplace: web HTTP bridge and preview proxy')
  })

  // TUI carrier: the slash command follows the surface and the command registry.
  ctx.inject([OH_DSH_SURFACE_SERVICE, 'commands'], tuiCtx => {
    const surface = tuiCtx.get(OH_DSH_SURFACE_SERVICE) as OhDshSurface | undefined
    if (surface?.kind !== 'tui') return
    const host = mountSurfaceHost(tuiCtx, surface as OhDshSurface & { kind: 'tui' })
    if (host === undefined) return
    const commands = tuiCtx.get('commands') as
      Parameters<typeof mountMarketplaceTuiCommand>[0] | undefined
    if (commands === undefined) {
      tuiCtx.logger.warn('plugin-marketplace: TUI command registry is unavailable')
      return
    }
    tuiCtx.effect(
      () => mountMarketplaceTuiCommand(commands),
      'oh-dsh-plugin-marketplace: TUI command',
    )
  })

}
