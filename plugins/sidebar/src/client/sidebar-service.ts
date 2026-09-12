import type { ReactNode } from 'react'
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_PREFERENCES,
  SIDEBAR_MAX_SESSIONS,
  SIDEBAR_MAX_TABS,
  type DesktopSidebarPreferences,
  type PersistedSidebarSession,
  type PersistedSidebarTab,
} from '../sidebar-preferences.ts'
import type { SidebarPreferencesStorage } from './sidebar-storage.ts'

export interface DesktopSidebarTab extends PersistedSidebarTab {}

export interface DesktopSidebarTabSeed {
  id?: string
  resource?: string
  title?: string
  type: string
}

export interface DesktopSidebarRenderProps {
  active: boolean
  close(): void
  patch(patch: { resource?: string; title?: string }): void
  tab: DesktopSidebarTab
}

export interface DesktopSidebarTabDescriptor {
  action?: () => void | Promise<void>
  available?: () => boolean
  chrome?: 'custom' | 'standard'
  createTab?: (
    seed: DesktopSidebarTabSeed,
    tabs: readonly DesktopSidebarTab[],
  ) => DesktopSidebarTab | null
  dedupeKey?: (tab: DesktopSidebarTab) => string | undefined
  hidden?: boolean
  icon?: ReactNode | ((size: number) => ReactNode)
  id: string
  order?: number
  render?: (props: DesktopSidebarRenderProps) => ReactNode
  requiresWorkspace?: boolean
  shortcut?: string
  single?: boolean
  title: string | (() => string)
}

export interface DesktopSidebarSnapshot {
  activeId: string | null
  error: string | null
  maximized: boolean
  open: boolean
  openByDefault: boolean
  ready: boolean
  revision: number
  sessionId: string | null
  tabs: readonly DesktopSidebarTab[]
  tabsEnabled: Readonly<Record<string, boolean>>
  width: number
}

export type OpenTabResult =
  | { kind: 'disabled' | 'limit' | 'missing' | 'not-ready' }
  | { kind: 'focused' | 'opened'; tab: DesktopSidebarTab }

export interface DesktopSidebar {
  activateTab(id: string | null): void
  closeTab(id: string): void
  getSnapshot(): DesktopSidebarSnapshot
  getTab(id: string): DesktopSidebarTabDescriptor | undefined
  getTabs(): readonly DesktopSidebarTabDescriptor[]
  isTabEnabled(id: string): boolean
  openTab(seed: DesktopSidebarTabSeed): OpenTabResult
  patchTab(id: string, patch: { resource?: string; title?: string }): void
  registerTab(descriptor: DesktopSidebarTabDescriptor): () => void
  setMaximized(maximized: boolean): void
  setOpen(open: boolean): void
  setOpenByDefault(open: boolean): void
  setSession(sessionId: string | null): void
  setTabEnabled(id: string, enabled: boolean): void
  setWidth(width: number): void
  subscribe(listener: () => void): () => void
}

function freshPreferences(): DesktopSidebarPreferences {
  return {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    sessions: {},
    tabsEnabled: {},
  }
}

function clonePreferences(
  preferences: DesktopSidebarPreferences,
): DesktopSidebarPreferences {
  return {
    ...preferences,
    defaultWidth: clampSidebarWidth(preferences.defaultWidth),
    sessions: Object.fromEntries(Object.entries(preferences.sessions).map(
      ([id, session]) => [id, { ...session, tabs: session.tabs.map(tab => ({ ...tab })) }],
    )),
    tabsEnabled: { ...preferences.tabsEnabled },
  }
}

function titleOf(descriptor: DesktopSidebarTabDescriptor): string {
  return typeof descriptor.title === 'function'
    ? descriptor.title()
    : descriptor.title
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class DesktopSidebarService implements DesktopSidebar {
  private readonly listeners = new Set<() => void>()
  private readonly tabDescriptors = new Map<string, DesktopSidebarTabDescriptor>()
  private preferences = freshPreferences()
  private dirty = false
  private disposed = false
  private flushing: Promise<void> | undefined
  private instance = 0
  private readonly storage: SidebarPreferencesStorage
  private snapshot: DesktopSidebarSnapshot = {
    activeId: null,
    error: null,
    maximized: false,
    open: false,
    openByDefault: false,
    ready: false,
    revision: 0,
    sessionId: null,
    tabs: [],
    tabsEnabled: {},
    width: DEFAULT_SIDEBAR_PREFERENCES.defaultWidth,
  }

  constructor(storage: SidebarPreferencesStorage) {
    this.storage = storage
  }

  getSnapshot = (): DesktopSidebarSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async start(): Promise<void> {
    const requestedSession = this.snapshot.sessionId
    try {
      this.preferences = clonePreferences(await this.storage.load())
      this.publish({
        ...this.sessionSnapshot(requestedSession),
        error: null,
        maximized: false,
        open: this.preferences.openByDefault,
        openByDefault: this.preferences.openByDefault,
        ready: true,
        revision: this.snapshot.revision + 1,
        sessionId: requestedSession,
        tabsEnabled: { ...this.preferences.tabsEnabled },
        width: this.preferences.defaultWidth,
      })
    } catch (error) {
      this.publish({
        ...this.snapshot,
        error: messageOf(error),
        ready: true,
        revision: this.snapshot.revision + 1,
      })
    }
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  registerTab(descriptor: DesktopSidebarTabDescriptor): () => void {
    if (this.tabDescriptors.has(descriptor.id)) {
      throw new Error(`sidebar: duplicate tab "${descriptor.id}"`)
    }
    this.tabDescriptors.set(descriptor.id, descriptor)
    this.touch()
    return () => {
      if (this.tabDescriptors.get(descriptor.id) === descriptor) {
        this.tabDescriptors.delete(descriptor.id)
        this.touch()
      }
    }
  }

  getTabs(): readonly DesktopSidebarTabDescriptor[] {
    return [...this.tabDescriptors.values()].sort(
      (left, right) => (left.order ?? 100) - (right.order ?? 100),
    )
  }

  getTab(id: string): DesktopSidebarTabDescriptor | undefined {
    return this.tabDescriptors.get(id)
  }

  isTabEnabled(id: string): boolean {
    return this.preferences.tabsEnabled[id] !== false
  }

  setSession(sessionId: string | null): void {
    if (sessionId === this.snapshot.sessionId) return
    this.publish({
      ...this.snapshot,
      ...this.sessionSnapshot(sessionId),
      revision: this.snapshot.revision + 1,
      sessionId,
    })
  }

  openTab(seed: DesktopSidebarTabSeed): OpenTabResult {
    if (!this.snapshot.ready) return { kind: 'not-ready' }
    const descriptor = this.tabDescriptors.get(seed.type)
    if (descriptor === undefined) return { kind: 'missing' }
    if (!this.isTabEnabled(seed.type)) return { kind: 'disabled' }
    if (descriptor.available?.() === false) return { kind: 'disabled' }
    if (descriptor.action !== undefined && descriptor.render === undefined) {
      void descriptor.action()
      return { kind: 'focused', tab: {
        id: descriptor.id,
        type: descriptor.id,
        title: titleOf(descriptor),
      } }
    }
    const tabs = [...this.snapshot.tabs]
    const created = descriptor.createTab?.(seed, tabs)
    if (created === null) return { kind: 'disabled' }
    let tab = created ?? {
      id: seed.id ?? (descriptor.single === true
        ? descriptor.id
        : `${descriptor.id}:${String(Date.now())}:${String(++this.instance)}`),
      type: descriptor.id,
      title: seed.title ?? titleOf(descriptor),
      ...(seed.resource !== undefined ? { resource: seed.resource } : {}),
    }
    const key = descriptor.dedupeKey?.(tab)
      ?? (descriptor.single === true ? descriptor.id : undefined)
    const existing = tabs.find(candidate => {
      if (candidate.id === tab.id) return true
      if (candidate.type !== tab.type || key === undefined) return false
      const candidateKey = descriptor.dedupeKey?.(candidate)
        ?? (descriptor.single === true ? descriptor.id : undefined)
      return candidateKey === key
    })
    if (existing !== undefined) {
      this.activateTab(existing.id)
      return { kind: 'focused', tab: existing }
    }
    if (tabs.length >= SIDEBAR_MAX_TABS) return { kind: 'limit' }
    tab = { ...tab }
    this.writeSession([...tabs, tab], tab.id)
    return { kind: 'opened', tab }
  }

  closeTab(id: string): void {
    const index = this.snapshot.tabs.findIndex(tab => tab.id === id)
    if (index === -1) return
    const tabs = this.snapshot.tabs.filter(tab => tab.id !== id)
    const activeId = this.snapshot.activeId === id
      ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null
      : this.snapshot.activeId
    this.writeSession(tabs, activeId)
  }

  activateTab(id: string | null): void {
    if (id !== null && !this.snapshot.tabs.some(tab => tab.id === id)) return
    if (this.snapshot.activeId === id) return
    this.writeSession(this.snapshot.tabs, id)
  }

  patchTab(id: string, patch: { resource?: string; title?: string }): void {
    let changed = false
    const tabs = this.snapshot.tabs.map(tab => {
      if (tab.id !== id) return tab
      changed = true
      return {
        ...tab,
        ...(patch.title !== undefined ? { title: patch.title.slice(0, 240) } : {}),
        ...(patch.resource !== undefined
          ? { resource: patch.resource.slice(0, 4096) }
          : {}),
      }
    })
    if (changed) this.writeSession(tabs, this.snapshot.activeId)
  }

  setOpen(open: boolean): void {
    if (this.snapshot.open === open) return
    this.publish({
      ...this.snapshot,
      maximized: open ? this.snapshot.maximized : false,
      open,
      revision: this.snapshot.revision + 1,
    })
  }

  setMaximized(maximized: boolean): void {
    if (!this.snapshot.open || this.snapshot.maximized === maximized) return
    this.publish({
      ...this.snapshot,
      maximized,
      revision: this.snapshot.revision + 1,
    })
  }

  setWidth(width: number): void {
    const next = clampSidebarWidth(width)
    if (this.snapshot.width === next) return
    this.preferences.defaultWidth = next
    this.publish({ ...this.snapshot, width: next, revision: this.snapshot.revision + 1 })
    this.schedulePersist()
  }

  setOpenByDefault(open: boolean): void {
    if (this.preferences.openByDefault === open) return
    this.preferences.openByDefault = open
    this.publish({
      ...this.snapshot,
      openByDefault: open,
      revision: this.snapshot.revision + 1,
    })
    this.schedulePersist()
  }

  setTabEnabled(id: string, enabled: boolean): void {
    if (this.isTabEnabled(id) === enabled
      && Object.hasOwn(this.preferences.tabsEnabled, id)) return
    this.preferences.tabsEnabled[id] = enabled
    this.publish({
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      tabsEnabled: { ...this.preferences.tabsEnabled },
    })
    this.schedulePersist()
  }

  async settle(): Promise<void> {
    await this.flushing
  }

  private sessionSnapshot(sessionId: string | null): Pick<
    DesktopSidebarSnapshot,
    'activeId' | 'tabs'
  > {
    const session = sessionId === null
      ? undefined
      : this.preferences.sessions[sessionId]
    return {
      activeId: session?.activeId ?? null,
      tabs: session?.tabs.map(tab => ({ ...tab })) ?? [],
    }
  }

  private writeSession(
    tabs: readonly DesktopSidebarTab[],
    activeId: string | null,
  ): void {
    const sessionId = this.snapshot.sessionId
    if (sessionId !== null) {
      this.preferences.sessions[sessionId] = {
        activeId,
        lastUsed: Date.now(),
        tabs: tabs.map(tab => ({ ...tab })),
      }
      this.pruneSessions()
      this.schedulePersist()
    }
    this.publish({
      ...this.snapshot,
      activeId,
      revision: this.snapshot.revision + 1,
      tabs: tabs.map(tab => ({ ...tab })),
    })
  }

  private pruneSessions(): void {
    const entries = Object.entries(this.preferences.sessions)
    if (entries.length <= SIDEBAR_MAX_SESSIONS) return
    entries.sort((left, right) => right[1].lastUsed - left[1].lastUsed)
    this.preferences.sessions = Object.fromEntries(
      entries.slice(0, SIDEBAR_MAX_SESSIONS),
    )
  }

  private touch(): void {
    this.publish({ ...this.snapshot, revision: this.snapshot.revision + 1 })
  }

  private publish(snapshot: DesktopSidebarSnapshot): void {
    this.snapshot = snapshot
    for (const listener of [...this.listeners]) listener()
  }

  private schedulePersist(): void {
    if (!this.snapshot.ready || this.disposed) return
    this.dirty = true
    if (this.flushing === undefined) {
      this.flushing = this.flush().finally(() => { this.flushing = undefined })
      void this.flushing.catch(error => {
        this.publish({
          ...this.snapshot,
          error: messageOf(error),
          revision: this.snapshot.revision + 1,
        })
      })
    }
  }

  private async flush(): Promise<void> {
    await Promise.resolve()
    while (this.dirty && !this.disposed) {
      this.dirty = false
      await this.storage.save(clonePreferences(this.preferences))
    }
  }
}
