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
  inject(
    names: string[],
    callback: (ctx: HostContext & Record<string, unknown>) => void,
  ): void
  logger: { warn(message: string): void }
  provide(name: string, value: unknown): void
}

export const name = 'oh-dsh-plugin-marketplace'
export const inject: string[] = []

/** Facts other Host plugins can inspect without receiving Electron access. */
export interface PluginMarketplaceHost {
  catalog: 'public-dsh-catalog'
  preview: 'isolated-profile'
}

export function apply(ctx: HostContext): void {
  ctx.provide('pluginMarketplaceHost', Object.freeze({
    catalog: 'public-dsh-catalog',
    preview: 'isolated-profile',
  } satisfies PluginMarketplaceHost))

  // Desktop keeps its Electron-owned transaction manager and IPC bridge.
  // Web and TUI run the same manager in their DSH host process and expose
  // it to their own UI carrier (HTTP bridge or slash-command renderer).
  // Preview runtimes must not mount a nested transaction owner: their host
  // would target the candidate profile the outer transaction is reviewing.
  ctx.inject([OH_DSH_SURFACE_SERVICE], surfaceCtx => {
    const surface = surfaceCtx.get(OH_DSH_SURFACE_SERVICE) as OhDshSurface | undefined
    if (surface === undefined || (surface.kind !== 'web' && surface.kind !== 'tui')) {
      return
    }
    if (process.env.OH_DSH_MARKETPLACE_PREVIEW === '1') {
      surfaceCtx.logger.warn('plugin-marketplace: disabled inside an isolated preview runtime')
      return
    }
    if (process.env.OH_DSH_READ_ONLY === '1') {
      // Viewer mode keeps the shared pluginMarketplace service available so
      // dependent surfaces (for example the TUI marketplace scene) still
      // activate; the manager refuses every mutating transaction.
      surfaceCtx.logger.warn('plugin-marketplace: read-only viewer mode; transactions disabled')
    }
    if (surface.dataRoot === '') {
      surfaceCtx.logger.warn('plugin-marketplace: no writable data root; host disabled')
      return
    }
    let host
    try {
      host = createSurfaceMarketplaceHost({
        environment: process.env,
        kind: surface.kind,
        onLog: line => surfaceCtx.logger.warn(`[marketplace] ${line}`),
        ...(process.env.OH_DSH_READ_ONLY === '1' ? { readOnly: true } : {}),
        surface,
      })
    } catch (error) {
      surfaceCtx.logger.warn(
        `plugin-marketplace: host disabled: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }
    const { manager, previewProxy } = host
    surfaceCtx.provide('pluginMarketplace', marketplaceBridge(manager))

    if (surface.kind === 'web') {
      surfaceCtx.inject(['webServer'], webCtx => {
        const bridgeCtx = webCtx as unknown as typeof webCtx & {
          webServer: Parameters<typeof mountMarketplaceWebBridge>[0]['webServer']
        }
        bridgeCtx.effect(() => {
          const disposers = [
            mountMarketplaceWebBridge(bridgeCtx, manager),
            ...(previewProxy === null ? [] : [previewProxy.mount(bridgeCtx)]),
          ]
          return () => {
            for (const dispose of disposers) dispose()
          }
        }, 'oh-dsh-plugin-marketplace: web HTTP bridge and preview proxy')
      })
      return
    }
    surfaceCtx.inject(['commands'], commandCtx => {
      const bridgeCtx = commandCtx as unknown as typeof commandCtx & {
        commands: Parameters<typeof mountMarketplaceTuiCommand>[0]
      }
      bridgeCtx.effect(
        () => mountMarketplaceTuiCommand(bridgeCtx.commands),
        'oh-dsh-plugin-marketplace: TUI command',
      )
    })
  })
}
