import type {
  MarketplaceAction,
  MarketplaceCommand,
  MarketplaceConfirmation,
  MarketplacePlugin,
  MarketplaceSnapshot,
  PluginMarketplaceBridge,
} from '../../plugin-marketplace/src/protocol.ts'

export type TuiMarketplaceScreen = 'list' | 'detail'

export interface TuiMarketplaceState {
  acceptedConfirmations: MarketplaceConfirmation[]
  busy: boolean
  confirmation: MarketplaceConfirmation | null
  error: string | null
  notice: string | null
  query: string
  screen: TuiMarketplaceScreen
  selectedId: string | null
  showBuiltins: boolean
  snapshot: MarketplaceSnapshot | null
}

export function surfaceMarker(plugin: MarketplacePlugin): string {
  const surfaces = plugin.surfaces
  const marks = (['desktop', 'web', 'tui'] as const)
    .map(kind => `${kind}:${surfaces[kind] ? 'yes' : 'no'}`)
    .join(' ')
  return surfaces.declared ? marks : `${marks} (assumed)`
}

export class TuiMarketplaceController {
  readonly #bridge: PluginMarketplaceBridge
  readonly #onBeforeRestart: (() => void) | undefined
  readonly #listeners = new Set<() => void>()
  readonly #requestedRepositoryStats = new Set<string>()
  #state: TuiMarketplaceState = {
    acceptedConfirmations: [],
    busy: false,
    confirmation: null,
    error: null,
    notice: null,
    query: '',
    screen: 'list',
    selectedId: null,
    showBuiltins: false,
    snapshot: null,
  }

  constructor(
    bridge: PluginMarketplaceBridge,
    onBeforeRestart?: () => void,
  ) {
    this.#bridge = bridge
    this.#onBeforeRestart = onBeforeRestart
  }

  getSnapshot = (): TuiMarketplaceState => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  filteredPlugins(): MarketplacePlugin[] {
    const needle = this.#state.query.trim().toLowerCase()
    const catalog = this.#state.snapshot?.catalog ?? []
    return catalog.filter(plugin => {
      if (!this.#state.showBuiltins && plugin.builtin) return false
      return needle === '' || [
        plugin.title,
        plugin.description,
        plugin.category,
        ...plugin.tags,
      ].some(value => value.toLowerCase().includes(needle))
    })
  }

  selectedPlugin(): MarketplacePlugin | null {
    return this.#state.snapshot?.catalog
      .find(plugin => plugin.id === this.#state.selectedId) ?? null
  }

  setQuery(query: string): void {
    this.#state = { ...this.#state, query }
    this.emit()
  }

  toggleBuiltins(): void {
    const showBuiltins = !this.#state.showBuiltins
    const hidesSelected = !showBuiltins && this.selectedPlugin()?.builtin === true
    this.#state = {
      ...this.#state,
      screen: hidesSelected ? 'list' : this.#state.screen,
      selectedId: hidesSelected ? null : this.#state.selectedId,
      showBuiltins,
    }
    this.emit()
  }

  moveSelection(delta: number): void {
    const plugins = this.filteredPlugins()
    if (plugins.length === 0) return
    const current = plugins.findIndex(plugin => plugin.id === this.#state.selectedId)
    const next = current < 0
      ? delta < 0 ? plugins.length - 1 : 0
      : (current + delta + plugins.length) % plugins.length
    const plugin = plugins[next]
    if (plugin === undefined) return
    this.#state = { ...this.#state, selectedId: plugin.id }
    this.emit()
  }

  openDetail(pluginId: string | null): void {
    this.#state = {
      ...this.#state,
      error: null,
      notice: null,
      screen: pluginId === null ? 'list' : 'detail',
      selectedId: pluginId,
    }
    this.emit()
    if (pluginId === null) return
    const plugin = this.#state.snapshot?.catalog.find(candidate => candidate.id === pluginId)
    if (plugin?.stats === null && !this.#requestedRepositoryStats.has(pluginId)) {
      this.#requestedRepositoryStats.add(pluginId)
      void this.dispatch({ type: 'load-repository-stats', pluginId })
    }
  }

  async load(): Promise<void> {
    if (this.#state.busy) return
    this.#state = { ...this.#state, busy: true, error: null }
    this.emit()
    try {
      let snapshot = await this.#bridge.getSnapshot()
      if (snapshot.catalog.length === 0 && snapshot.error === null) {
        snapshot = await this.#bridge.dispatch({ type: 'refresh' })
      }
      this.#state = {
        ...this.#state,
        busy: false,
        snapshot,
      }
    } catch (error) {
      this.#state = {
        ...this.#state,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    this.emit()
  }

  async refresh(): Promise<void> {
    if (this.#state.busy) return
    this.#state = { ...this.#state, busy: true, error: null }
    this.emit()
    try {
      this.#state = {
        ...this.#state,
        busy: false,
        snapshot: await this.#bridge.dispatch({ type: 'refresh', force: true }),
      }
    } catch (error) {
      this.#state = {
        ...this.#state,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    this.emit()
  }

  async dispatch(command: MarketplaceCommand, notice?: string): Promise<void> {
    if (this.#state.busy) return
    if (command.type === 'apply' || command.type === 'undo') {
      this.#onBeforeRestart?.()
    }
    this.#state = { ...this.#state, busy: true, error: null }
    this.emit()
    try {
      const snapshot = await this.#bridge.dispatch(command)
      this.#state = {
        ...this.#state,
        busy: false,
        notice: notice ?? snapshot.lastAction ?? snapshot.error,
        snapshot,
      }
    } catch (error) {
      this.#state = {
        ...this.#state,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    this.emit()
  }

  async prepare(action: MarketplaceAction, pluginId: string): Promise<void> {
    await this.dispatch(
      { type: 'prepare', action, pluginId },
      undefined,
    )
  }

  async preview(): Promise<void> {
    const plan = this.#state.snapshot?.plan
    if (plan === null || plan === undefined) return
    const requirements = [...plan.requirements]
    if (requirements.length === 0) {
      await this.dispatch({ type: 'preview', confirmations: [] })
      return
    }
    this.#state = {
      ...this.#state,
      acceptedConfirmations: [],
      confirmation: requirements[0] ?? null,
      notice: null,
    }
    this.emit()
  }

  acceptConfirmation(): void {
    const current = this.#state.confirmation
    if (current === null) return
    const accepted = [...this.#state.acceptedConfirmations, current]
    const requirements = this.#state.snapshot?.plan?.requirements ?? []
    const next = requirements.find(requirement => accepted.includes(requirement) === false)
    if (next === undefined) {
      this.#state = {
        ...this.#state,
        acceptedConfirmations: accepted,
        confirmation: null,
      }
      this.emit()
      void this.dispatch({
        type: 'preview',
        confirmations: accepted,
      })
      return
    }
    this.#state = {
      ...this.#state,
      acceptedConfirmations: accepted,
      confirmation: next,
    }
    this.emit()
  }

  cancelConfirmation(): void {
    if (this.#state.confirmation === null) return
    this.#state = {
      ...this.#state,
      acceptedConfirmations: [],
      confirmation: null,
    }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.#listeners) listener()
  }
}
