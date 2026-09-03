import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DshRuntimeSupervisor } from '../../../../src/runtime.ts'
import type { OhDshSurface } from '../../../shared/surface.ts'
import type {
  MarketplaceCommand,
  MarketplaceSnapshot,
  PluginMarketplaceBridge,
} from '../protocol.ts'
import { previewRuntimeLauncher, ProductionMarketplacePlatform } from './platform.ts'
import {
  MarketplacePreviewProxy,
} from './preview-proxy.ts'
import {
  PluginMarketplaceManager,
  type MarketplacePreviewRuntimeInput,
  type MarketplacePreviewRuntimeResult,
  type MarketplaceRuntime,
} from './transaction-manager.ts'

const NODE_BINARY_ENV = 'OH_DSH_MARKETPLACE_NODE_BINARY'
const CLI_ENTRY_ENV = 'OH_DSH_MARKETPLACE_CLI_ENTRY'
const PNPM_ENTRY_ENV = 'OH_DSH_MARKETPLACE_PNPM_ENTRY'
const SANDBOX_LAUNCHER_ENV = 'OH_DSH_MARKETPLACE_SANDBOX_LAUNCHER'

export type MarketplaceHostSurfaceKind = 'web' | 'tui'

interface MarketplaceHostPaths {
  appDataPath: string
  cliEntry: string
  nodeBinary: string
  pnpmEntry: string
}

function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]
  if (value === undefined || value === '') {
    throw new Error(`plugin marketplace is missing ${name}`)
  }
  return value
}

/** Resolve the launcher-injected runtime paths for a Web or TUI host. */
export function marketplaceHostPaths(
  surface: OhDshSurface,
  environment: NodeJS.ProcessEnv = process.env,
): MarketplaceHostPaths {
  return {
    appDataPath: join(surface.dataRoot, surface.kind),
    cliEntry: requiredEnvironment(environment, CLI_ENTRY_ENV),
    nodeBinary: requiredEnvironment(environment, NODE_BINARY_ENV),
    pnpmEntry: requiredEnvironment(environment, PNPM_ENTRY_ENV),
  }
}

/**
 * Profile-changing runtime adapter for in-DSH-host surfaces. Web and TUI
 * live processes are supervised by their launchers, so applying a profile
 * schedules a graceful exit after the dispatch response is delivered; the
 * launcher restarts the surface.
 */
export class SurfaceMarketplaceRuntime implements MarketplaceRuntime {
  readonly #cliEntry: string
  readonly #environment: NodeJS.ProcessEnv
  readonly #exitCode: number
  readonly #kind: MarketplaceHostSurfaceKind
  readonly #nodeBinary: string
  readonly #sandboxLauncher: string | undefined
  readonly #previewProxy: MarketplacePreviewProxy | null
  readonly #profile: string
  readonly #restartDelayMs: number
  readonly #restartMarkerPath: string | null
  #preview: DshRuntimeSupervisor | null = null
  #previewTransaction: string | null = null
  #restartTimer: NodeJS.Timeout | null = null

  constructor(input: {
    cliEntry: string
    environment: NodeJS.ProcessEnv
    exitCode?: number
    kind: MarketplaceHostSurfaceKind
    nodeBinary: string
    previewProxy?: MarketplacePreviewProxy | null
    profile: string
    restartDelayMs?: number
    restartMarkerPath?: string | null
  }) {
    this.#cliEntry = input.cliEntry
    this.#environment = input.environment
    this.#exitCode = input.exitCode ?? 0
    this.#kind = input.kind
    this.#nodeBinary = input.nodeBinary
    this.#sandboxLauncher = input.environment.OH_DSH_MARKETPLACE_SANDBOX_LAUNCHER || undefined
    this.#previewProxy = input.previewProxy ?? null
    this.#profile = input.profile
    this.#restartDelayMs = input.restartDelayMs ?? 500
    this.#restartMarkerPath = input.restartMarkerPath ?? null
  }

  async startLive(): Promise<void> {
    if (this.#restartTimer !== null) return
    if (this.#restartMarkerPath !== null) {
      mkdirSync(dirname(this.#restartMarkerPath), { recursive: true, mode: 0o700 })
      writeFileSync(this.#restartMarkerPath, `${this.#exitCode}\n`, { mode: 0o600 })
    }
    this.#restartTimer = setTimeout(() => {
      process.exit(this.#exitCode)
    }, this.#restartDelayMs)
  }

  async stopLive(): Promise<void> {
    // The live profile can only be replaced while this process is not
    // serving requests. The launcher owns restart; the scheduled exit
    // happens in startLive() after the swap is durable.
  }

  async startPreview(
    input: MarketplacePreviewRuntimeInput,
  ): Promise<MarketplacePreviewRuntimeResult> {
    await this.stopPreview()
    const workspace = join(input.sandboxRoot, 'workspace')
    const temporary = join(input.sandboxRoot, '.tmp')
    mkdirSync(workspace, { recursive: true, mode: 0o700 })
    mkdirSync(temporary, { recursive: true, mode: 0o700 })
    const environment: NodeJS.ProcessEnv = {
      ...this.#environment,
      DSH_HOME: input.dshHome,
      OH_DSH_HOME: input.dshHome,
      TMPDIR: temporary,
    }
    const launcher = input.sandboxed
      ? previewRuntimeLauncher({
        root: input.sandboxRoot,
        sandbox: this.#sandboxLauncher,
      })
      : undefined
    const previewCommand = (args: string[]): { command: string; args: string[] } =>
      launcher === undefined
        ? { command: this.#nodeBinary, args: [this.#cliEntry, ...args] }
        : {
          command: launcher.command,
          args: [...launcher.args, this.#nodeBinary, this.#cliEntry, ...args],
        }
    if (this.#kind === 'tui') {
      const { spawnSync } = await import('node:child_process')
      // Compose the candidate profile first so configuration errors fail
      // before activation.
      const composeCommand = previewCommand([
        '--profile', this.#profile,
        '--dump-config',
      ])
      const composed = spawnSync(composeCommand.command, composeCommand.args, {
        cwd: workspace,
        encoding: 'utf8',
        env: environment,
        timeout: 90_000,
      })
      if (composed.status !== 0) {
        throw new Error(
          `plugin preview profile failed composition: ${composed.stderr || composed.stdout || `exit ${String(composed.status)}`}`,
        )
      }
      // Then boot the candidate without the interactive renderer. Every row
      // before the TUI front door has activated by the time the probe exits,
      // so plugin apply-time failures surface here instead of after apply.
      const activationCommand = previewCommand(['--profile', this.#profile])
      const activated = spawnSync(activationCommand.command, activationCommand.args, {
        cwd: workspace,
        encoding: 'utf8',
        env: {
          ...environment,
          OH_DSH_TUI_MARKETPLACE_PREVIEW_PROBE: '1',
        },
        timeout: 90_000,
      })
      if (activated.status !== 0) {
        throw new Error(
          `plugin preview profile failed activation: ${activated.stderr || activated.stdout || `exit ${String(activated.status)}`}`,
        )
      }
      return {}
    }
    const supervisor = new DshRuntimeSupervisor({
      args: [
        '--profile', this.#profile,
        '--host', '127.0.0.1',
        '--port', '0',
      ],
      cliEntry: this.#cliEntry,
      cwd: workspace,
      env: {
        ...environment,
        DSH_OH_WEB: '1',
        DSH_OH_WEB_DATA: input.sandboxRoot,
        DSH_OH_WEB_PROFILE: this.#profile,
        DSH_OH_WEB_VERSION: this.#environment.DSH_OH_WEB_VERSION ?? 'preview',
        // The candidate runtime serves the preview page. Suppress its own
        // marketplace so a nested transaction cannot mutate the candidate
        // behind the outer review boundary.
        OH_DSH_MARKETPLACE_PREVIEW: '1',
      },
      nodeBinary: this.#nodeBinary,
      ...(launcher === undefined ? {} : { launcher }),
      readyTimeoutMs: 90_000,
    })
    const url = await supervisor.start()
    this.#preview = supervisor
    this.#previewTransaction = input.transactionId
    const previewUrl = this.#previewProxy === null
      ? url.href
      : this.#previewProxy.register(input.transactionId, url)
    return { url: previewUrl }
  }

  async stopPreview(): Promise<void> {
    const preview = this.#preview
    const transaction = this.#previewTransaction
    this.#preview = null
    this.#previewTransaction = null
    if (transaction !== null) this.#previewProxy?.unregister(transaction)
    await preview?.stop()
  }
}

export interface SurfaceMarketplaceHost {
  manager: PluginMarketplaceManager
  previewProxy: MarketplacePreviewProxy | null
}

/** Build the one shared transaction manager for a Web or TUI host. */
export function createSurfaceMarketplaceHost(input: {
  environment: NodeJS.ProcessEnv
  kind: MarketplaceHostSurfaceKind
  onLog?: (message: string) => void
  /** Viewer mode: browse the catalog, refuse every mutating transaction. */
  readOnly?: boolean
  surface: OhDshSurface
}): SurfaceMarketplaceHost {
  const paths = marketplaceHostPaths(input.surface, input.environment)
  const workingDirectory = join(paths.appDataPath, 'plugin-marketplace')
  if (input.readOnly !== true) {
    mkdirSync(workingDirectory, { recursive: true, mode: 0o700 })
  }
  const platform = new ProductionMarketplacePlatform({
    appDataPath: paths.appDataPath,
    cliEntry: paths.cliEntry,
    // In read-only viewer mode the working directory is not created (spawned
    // catalog commands must not inherit a nonexistent cwd, ENOENT) and the
    // catalog cache under the shared data root is never written.
    ...(input.readOnly === true
      ? { cacheReadOnly: true }
      : { cwd: workingDirectory }),
    env: input.environment,
    nodeBinary: paths.nodeBinary,
    pnpmEntry: paths.pnpmEntry,
    sandboxLauncher: input.environment[SANDBOX_LAUNCHER_ENV] || undefined,
    ...(input.onLog === undefined ? {} : { onLog: input.onLog }),
  })
  const previewProxy = input.kind === 'web'
    ? new MarketplacePreviewProxy()
    : null
  const manager = new PluginMarketplaceManager({
    appDataPath: paths.appDataPath,
    dshHome: input.environment.DSH_HOME ?? input.surface.dataRoot,
    ...(input.readOnly === true ? { readOnly: true } : {}),
    ...(input.onLog === undefined
      ? {}
      : { onWarn: input.onLog }),
    platform,
    profile: input.surface.profile,
    runtime: new SurfaceMarketplaceRuntime({
      cliEntry: paths.cliEntry,
      environment: input.environment,
      exitCode: input.kind === 'tui' ? 75 : 0,
      kind: input.kind,
      nodeBinary: paths.nodeBinary,
      previewProxy,
      profile: input.surface.profile,
      restartMarkerPath: input.kind === 'web'
        ? join(paths.appDataPath, 'marketplace-restart')
        : null,
    }),
  })
  return { manager, previewProxy }
}

/** Expose one manager behind the shared client-side bridge shape. */
export function marketplaceBridge(
  manager: PluginMarketplaceManager,
): PluginMarketplaceBridge {
  return Object.freeze({
    dispatch: async (command: MarketplaceCommand): Promise<MarketplaceSnapshot> =>
      manager.dispatch(command, 'human-ui'),
    getSnapshot: async (): Promise<MarketplaceSnapshot> =>
      manager.getSnapshot(),
  })
}
