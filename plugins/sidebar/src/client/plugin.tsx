import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  useSyncExternalStore,
} from 'react'
import { defineStore } from '@deepseek-ai/dsh-client-store'
import { createRoot, type Root } from 'react-dom/client'
import type { DesktopBridge } from '../../../../src/contracts.ts'
import type { DesktopPanels } from '../../../panel-controls/src/client.ts'
import type { PinnedSummary } from '../../../pinned-summary/src/client.ts'
import type {
  WorkspaceChange,
  WorkspaceFacts,
  WorkspaceHostMutationResponse,
  WorkspaceMutation,
  WorkspaceSnapshot,
} from '../protocol.ts'
import { WORKSPACE_API_PATH } from '../protocol.ts'
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '../sidebar-preferences.ts'
import { SideToolsPanel, ToolIcon } from './SideToolsPanel.tsx'
import sideToolsCss from './side-tools.css'
import workspaceCss from './sidebar.css'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import { useTranslate } from '../../../shared/use-i18n.ts'
import { WORKSPACE_MESSAGES, type WorkspaceMessage } from './i18n.ts'
import {
  DesktopSidebarService,
  type DesktopSidebar,
  type DesktopSidebarSnapshot,
} from './sidebar-service.ts'
import {
  ComposerInputHistory,
  type ComposerHistoryNode,
  type ComposerHistorySnapshot,
} from './composer-input-history.ts'
import {
  focusComposerEnd,
  isComposerInput,
  readComposerCaret,
} from './composer-history-dom.ts'
import {
  historyDirectionForKey,
  isAtHistoryBoundary,
} from './composer-history-keyboard.ts'
import {
  composerInputForSession,
  hasOpenComposerTriggerMenu,
  type ComposerHistoryInputTriggers,
} from './composer-history-bridge.ts'
import { HttpSidebarPreferencesStorage } from './sidebar-storage.ts'
import {
  addDiffStats,
  diffStats,
  prepareDiffSummaryRefresh,
  textLineCount,
  type DiffStats,
} from './diff-stats.ts'
import {
  betterSidebarApi,
  type BetterSidebarGitLogEntry,
  type BetterSidebarScope,
  workspaceChangesFromBetterSidebar,
} from './better-sidebar-api.ts'
import {
  nextReviewCommentId,
  ReviewCommentsService,
  type ReviewCommentSide,
  type ReviewSessionsService,
  type ReviewInputTriggersService,
} from './review-comments.ts'
import { reviewCommitFromBetterSidebar } from './review-diff.ts'
import type { GitReviewCommit } from './review-types.ts'
import {
  SidebarRuntimeSettingsService,
  type SidebarRuntimePreferences,
} from './runtime-settings.ts'

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionSummary {
  blank?: boolean
  cwd?: string
}

interface SessionListState {
  current?: string
  byId: Record<string, SessionSummary>
}

interface RunningToolCall {
  callId: string
  name: string
  argsRaw: string
  subCalls?: readonly RunningToolCall[]
}

interface ConversationSnapshot {
  hasMore?: boolean
  loadingOlder?: boolean
  nodes?: readonly ComposerHistoryNode[]
  runningCalls?: readonly RunningToolCall[]
}

interface SessionBinding {
  session: ObservableSnapshot<ConversationSnapshot> & {
    loadOlder?(): Promise<void>
  }
}

interface SessionsService extends ReviewSessionsService {
  list: ObservableSnapshot<SessionListState>
  binding(id: string): SessionBinding | undefined
  fork(options: { sessionId: string; increaseTitle?: boolean }): Promise<string>
  open(id: string): void
}

interface InputTriggersService extends ComposerHistoryInputTriggers, ReviewInputTriggersService {}

interface WorkspaceView {
  workspaceId: string
}

interface WorkspacesService {
  create(input: { path: string }): Promise<WorkspaceView>
  openPath(path: string): Promise<void>
}

/** The 0.1.5 navigation face: session starts live on uiWorkspace. */
interface UiWorkspaceService {
  startSession(workspaceId?: string): void
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

interface SidebarSettingsState {
  openByDefault: boolean
  revision: number
  tabsEnabled: Record<string, boolean>
  viewersEnabled: Record<string, boolean>
  width: number
}

interface BoundSidebarSettingsActions {
  sync(
    openByDefault: boolean,
    revision: number,
    tabsEnabled: Record<string, boolean>,
    viewersEnabled: Record<string, boolean>,
    width: number,
  ): void
}

interface SidebarSettingsProps {
  reset(): void
  setOpenByDefault(open: boolean): void
  setTabEnabled(id: string, enabled: boolean): void
  setViewerEnabled(id: string, enabled: boolean): void
  setWidth(width: number): void
  runtime: SidebarRuntimeSettingsService
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
  useStore<T>(selector: (state: SidebarSettingsState) => T): T
}

interface SlotsService {
  inject(name: string, register: () => unknown): void
  register(options: {
    id: string
    inject(actions: BoundSidebarSettingsActions): Omit<
      SidebarSettingsProps,
      't' | 'useStore'
    >
    locale: string
    label: () => string
    name: string
    order: number
    store: unknown
  }, component: (props: SidebarSettingsProps) => JSX.Element): unknown
}

interface WorkspaceToolsState {
  maximized: boolean
  open: boolean
  view: string
  width: number
}

export interface WorkspaceTools {
  getSnapshot(): WorkspaceToolsState
  subscribe(listener: () => void): () => void
  isOpen(): boolean
  openBrowser(): void
  openBrowserUrl(url: string): void
  openFile(path: string): void
  openFiles(): void
  openMenu(): void
  openReview(): void
  openSideChat(): Promise<void>
  openTrajectory(): void
  setOpen(open: boolean): void
  toggle(): void
  togglePanelMaximized(): void
  toggleSidePanel(): void
}

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}

export const inject = [
  'desktopPanels',
  'locale',
  'pinnedSummary',
  'sessions',
  'inputTriggers',
  'slots',
  'workspaces',
]


function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function responseJson<T>(
  response: Response,
  t: Translate<WorkspaceMessage>,
): Promise<T> {
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) {
    throw new Error(payload.error ?? t('workspace.request-failed', {
      status: response.status,
    }))
  }
  return payload
}







type ReviewCommentTarget = {
  kind: 'commit'
} | {
  kind: 'line'
  filePath: string
  line: number
  side: Exclude<ReviewCommentSide, null>
}




/** The native right-sidebar controller face (a slice of the runtime service). */
interface NativeRightbarController {
  openTab(kind: string, options?: { params?: unknown; revealIfOpened?: boolean }): void
  openResource(address: string, options?: { params?: unknown; revealIfOpened?: boolean }): void
  openTabIn?(sessionId: string, kind: string, options?: { params?: unknown; revealIfOpened?: boolean }): void
  openResourceIn?(sessionId: string, address: string, options?: { params?: unknown; revealIfOpened?: boolean }): void
}

/** Component-encode one address segment (mirrors the runtime's file-address grammar). */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

/**
 * Opens content in the native right sidebar. The surface exists only while a
 * session's panel is on screen, so opens for a session without one are
 * queued and replayed when the session list changes (the same contract the
 * upstream sidebar plugin's own surface follows).
 */
class NativeRightbarSurface {
  private readonly pending: Array<() => boolean> = []

  constructor(
    private readonly sessions: SessionsService,
    private readonly get: () => NativeRightbarController | undefined,
  ) {}

  flush(): void {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const place = this.pending[index]
      if (place === undefined || place()) this.pending.splice(index, 1)
    }
  }

  openTab(kind: string, params?: Record<string, unknown>): void {
    const place = (): boolean => {
      const api = this.get()
      if (api === undefined) return false
      const list = this.sessions.list.getSnapshot()
      const sessionId = list.current
      if (sessionId === undefined) return false
      const options = { params, revealIfOpened: true }
      api.openTabIn?.(sessionId, kind, options) ?? api.openTab(kind, options)
      return true
    }
    if (!place()) this.pending.push(place)
  }

  openFile(path: string): void {
    const place = (): boolean => {
      const api = this.get()
      if (api === undefined) return false
      const list = this.sessions.list.getSnapshot()
      const sessionId = list.current
      const cwd = sessionId === undefined ? undefined : list.byId[sessionId]?.cwd
      if (sessionId === undefined) return false
      const segments = ['dsh-resource://file', 'session', encodeSegment(sessionId)]
      const workspaceRelative = cwd !== undefined && path.startsWith(`${cwd}/`)
        ? path.slice(cwd.length + 1)
        : path
      for (const segment of workspaceRelative.split('/')) {
        if (segment !== '') segments.push(encodeSegment(segment))
      }
      const address = segments.join('/')
      const options = { revealIfOpened: true }
      api.openResourceIn?.(sessionId, address, options) ?? api.openResource(address, options)
      return true
    }
    if (!place()) this.pending.push(place)
  }
}

class WorkspaceToolsService implements WorkspaceTools {
  private state: WorkspaceToolsState
  private readonly listeners = new Set<() => void>()
  private style: HTMLStyleElement | undefined
  private element: HTMLDivElement | undefined
  private layout: HTMLDivElement | undefined
  private appRoot: HTMLElement | undefined
  private root: Root | undefined
  private stopSidebar: (() => void) | undefined
  private readonly narrowViewport = window.matchMedia('(max-width: 900px)')
  private readonly handleViewportChange = (): void => { this.applyLayout() }
  private readonly handleShortcut = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase()
    const primary = event.metaKey || event.ctrlKey
    if (event.key === 'Escape' && this.state.maximized) {
      event.preventDefault()
      this.togglePanelMaximized()
    } else if (event.ctrlKey && event.shiftKey && key === 'g') {
      event.preventDefault()
      this.openReview()
    } else if (primary && !event.altKey && key === 't') {
      event.preventDefault()
      this.openBrowser()
    } else if (primary && !event.altKey && key === 'p') {
      event.preventDefault()
      this.openFiles()
    } else if (primary && event.altKey && key === 's') {
      event.preventDefault()
      void this.openSideChat()
    } else if (primary && event.altKey && key === 'b') {
      event.preventDefault()
      this.toggleSidePanel()
    }
  }

  constructor(
    private readonly sidebar: DesktopSidebar,
    private readonly panels: DesktopPanels,
    private readonly locale: LocaleService,
    private readonly t: Translate<WorkspaceMessage>,
    private readonly pinnedSummary: PinnedSummary,
    private readonly sessions: SessionsService,
    private readonly workspaces: WorkspacesService,
    private readonly native: NativeRightbarSurface,
    private readonly uiWorkspace: UiWorkspaceService,
  ) {
    this.state = this.project(sidebar.getSnapshot())
  }

  getSnapshot = (): WorkspaceToolsState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  isOpen(): boolean { return this.state.open }

  setOpen(open: boolean): void {
    if (open) this.pinnedSummary.setOpen(false)
    this.sidebar.setOpen(open)
    if (!open) delete document.documentElement.dataset.ohDshPanelMaximized
  }

  toggle(): void {
    if (this.state.open && this.state.view === 'review') this.setOpen(false)
    else this.openReview()
  }

  // The git lens, browser, file explorer, and file viewer are the upstream
  // DSH-better-sidebar tab types registered as native right-sidebar tabs;
  // opens route through the native controller instead of our own panel.
  openReview(): void { this.native.openTab('changes') }

  openBrowser(): void { this.native.openTab('browser') }

  openBrowserUrl(url: string): void { this.native.openTab('browser', { url }) }

  openFile(path: string): void { this.native.openFile(path) }

  openFiles(): void { this.native.openTab('files') }

  openMenu(): void {
    this.pinnedSummary.setOpen(false)
    this.sidebar.activateTab(null)
    this.sidebar.setOpen(true)
  }

  toggleSidePanel(): void {
    if (this.state.open) this.setOpen(false)
    else this.openMenu()
  }

  async openSideChat(): Promise<void> {
    const current = this.sessions.list.getSnapshot().current
    if (current === undefined) this.uiWorkspace.startSession()
    else {
      const child = await this.sessions.fork({ sessionId: current, increaseTitle: true })
      this.sessions.open(child)
    }
    this.setOpen(false)
  }

  openTrajectory(): void {
    const translated = this.t('trajectory').toLowerCase()
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find(element => {
        const label = element.textContent?.trim().toLowerCase()
        return label === translated || label === 'trajectory' || label === '轨迹'
      })
    if (tab === undefined) return
    tab.click()
    this.setOpen(false)
  }

  togglePanelMaximized(): void {
    if (!this.state.open) return
    const maximized = !this.state.maximized
    this.sidebar.setMaximized(maximized)
    if (maximized) document.documentElement.dataset.ohDshPanelMaximized = 'true'
    else delete document.documentElement.dataset.ohDshPanelMaximized
  }

  setWidth(width: number): void {
    this.sidebar.setWidth(width)
  }

  mount(): void {
    if (this.state.open) this.pinnedSummary.setOpen(false)
    this.stopSidebar = this.sidebar.subscribe(() => { this.syncSidebar() })
    this.style = document.createElement('style')
    this.style.dataset.ohDshDesktopSidebarStyles = 'true'
    this.style.textContent = `${workspaceCss}\n${sideToolsCss}`
    document.head.append(this.style)
    this.element = document.createElement('div')
    this.element.id = 'oh-dsh-sidebar-root'
    const appRoot = document.getElementById('root')
    if (appRoot === null) throw new Error('sidebar: app root is unavailable')
    const layout = document.createElement('div')
    layout.id = 'oh-dsh-embedded-layout'
    appRoot.before(layout)
    layout.append(appRoot, this.element)
    this.appRoot = appRoot
    this.layout = layout
    this.root = createRoot(this.element)
    this.root.render(
      <WorkspaceToolsSurface
        locale={this.locale}
        t={this.t}
        service={this}
        panels={this.panels}
        pinnedSummary={this.pinnedSummary}
        sessions={this.sessions}
        workspaces={this.workspaces}
        sidebar={this.sidebar}
      />,
    )
    this.narrowViewport.addEventListener('change', this.handleViewportChange)
    window.addEventListener('keydown', this.handleShortcut, true)
    this.applyLayout()
  }

  dispose(): void {
    this.stopSidebar?.()
    window.removeEventListener('keydown', this.handleShortcut, true)
    this.narrowViewport.removeEventListener('change', this.handleViewportChange)
    this.root?.unmount()
    this.element?.remove()
    if (this.layout !== undefined && this.appRoot !== undefined) {
      this.layout.before(this.appRoot)
      this.layout.remove()
    }
    this.style?.remove()
    delete document.documentElement.dataset.ohDshDesktopSidebarOpen
    delete document.documentElement.dataset.ohDshPanelMaximized
    document.documentElement.style.removeProperty('--oh-dsh-sidebar-width')
    if (document.documentElement.dataset.ohDshRightPanelOwner === 'sidebar') {
      delete document.documentElement.dataset.ohDshRightPanelOwner
      document.getElementById('root')?.style.removeProperty('padding-right')
    }
  }

  private publish(next: WorkspaceToolsState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private openView(view: string, resource?: string): void {
    this.pinnedSummary.setOpen(false)
    this.sidebar.openTab({
      type: view,
      ...(resource !== undefined ? { resource } : {}),
    })
    this.sidebar.setOpen(true)
  }

  private project(snapshot: DesktopSidebarSnapshot): WorkspaceToolsState {
    const active = snapshot.tabs.find(tab => tab.id === snapshot.activeId)
    return {
      maximized: snapshot.maximized,
      open: snapshot.open,
      view: active?.type ?? 'menu',
      width: snapshot.width,
    }
  }

  private syncSidebar(): void {
    const next = this.project(this.sidebar.getSnapshot())
    if (next.open) this.pinnedSummary.setOpen(false)
    this.publish(next)
    if (next.maximized) {
      document.documentElement.dataset.ohDshPanelMaximized = 'true'
    } else {
      delete document.documentElement.dataset.ohDshPanelMaximized
    }
    this.applyLayout()
  }

  private applyLayout(): void {
    document.documentElement.style.setProperty('--oh-dsh-sidebar-width', `${String(this.state.width)}px`)
    const html = document.documentElement
    const appRoot = document.getElementById('root')
    if (this.state.open) {
      html.dataset.ohDshDesktopSidebarOpen = 'true'
      html.dataset.ohDshRightPanelOwner = 'sidebar'
      appRoot?.style.removeProperty('padding-right')
    } else {
      delete html.dataset.ohDshDesktopSidebarOpen
      if (html.dataset.ohDshRightPanelOwner === 'sidebar') {
        delete html.dataset.ohDshRightPanelOwner
        appRoot?.style.removeProperty('padding-right')
      }
    }
    if (this.layout !== undefined) {
      if (this.state.open && this.state.maximized) {
        this.layout.style.gridTemplateColumns = '0 minmax(0, 1fr)'
      } else {
        const track = this.state.open && !this.narrowViewport.matches ? this.state.width : 0
        this.layout.style.gridTemplateColumns = `minmax(0, 1fr) ${String(track)}px`
      }
    }
  }
}

function WorkspaceToolsSurface(props: {
  locale: LocaleService
  t: Translate<WorkspaceMessage>
  service: WorkspaceToolsService
  sidebar: DesktopSidebar
  panels: DesktopPanels
  pinnedSummary: PinnedSummary
  sessions: SessionsService
  workspaces: WorkspacesService
}): JSX.Element {
  const t = useTranslate(props.locale, props.t)
  const panelState = useSyncExternalStore(props.service.subscribe, props.service.getSnapshot)
  const sessionList = useSyncExternalStore(props.sessions.list.subscribe, props.sessions.list.getSnapshot)
  const sessionId = sessionList.current
  const cwd = sessionId === undefined ? undefined : sessionList.byId[sessionId]?.cwd
  return (
    <>
      <SideToolsPanel
        cwd={cwd}
        open={panelState.open}
        width={panelState.width}
        maximized={panelState.maximized}
        sidebar={props.sidebar}
        t={t}
        onClose={() => { props.service.setOpen(false) }}
        onResize={width => { props.service.setWidth(width) }}
      />
    </>
  )
}




function activeWorkspace(sessions: SessionsService): string | undefined {
  const snapshot = sessions.list.getSnapshot()
  return snapshot.current === undefined
    ? undefined
    : snapshot.byId[snapshot.current]?.cwd
}

function activeSidebarScope(sessions: SessionsService): {
  sessionId: string
  cwd: string
} | undefined {
  const snapshot = sessions.list.getSnapshot()
  if (snapshot.current === undefined) return undefined
  const cwd = snapshot.byId[snapshot.current]?.cwd
  return cwd === undefined ? undefined : { sessionId: snapshot.current, cwd }
}

function registerBuiltinSidebarTools(options: {
  openExternalPath(path: string): Promise<void>
  panels: DesktopPanels
  reviewComments: ReviewCommentsService
  service: WorkspaceToolsService
  sessions: SessionsService
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
  workspaces: WorkspacesService
}): () => void {
  const {
    openExternalPath,
    panels,
    reviewComments,
    service,
    sessions,
    sidebar,
    t,
    workspaces,
  } = options
  const disposers = [
    sidebar.registerTab({
      action: () => { panels.toggleBottomPanel() },
      icon: <ToolIcon kind="terminal" />,
      id: 'terminal',
      order: 20,
      shortcut: '⌘J',
      title: () => t('terminal'),
    }),
    sidebar.registerTab({
      action: async () => { await service.openSideChat() },
      icon: <ToolIcon kind="chat" />,
      id: 'side-chat',
      order: 50,
      shortcut: '⌥⌘S',
      title: () => t('side-chat'),
    }),
    sidebar.registerTab({
      action: () => { service.openTrajectory() },
      icon: <ToolIcon kind="trajectory" />,
      id: 'trajectory',
      order: 60,
      requiresWorkspace: true,
      title: () => t('trajectory'),
    }),
  ]
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

function sidebarLabel(value: string | (() => string)): string {
  return typeof value === 'function' ? value() : value
}

function SidebarSettingsRow({
  reset,
  runtime,
  setOpenByDefault,
  setTabEnabled,
  setViewerEnabled,
  setWidth,
  sidebar,
  t,
  useStore,
}: SidebarSettingsProps): JSX.Element {
  const state = useStore(snapshot => snapshot)
  const runtimeState = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
  )
  const tabs = sidebar.getTabs().filter(descriptor => descriptor.hidden !== true)
  const viewers = sidebar.getViewers()
  const updateRuntime = (
    key: keyof SidebarRuntimePreferences,
    enabled: boolean,
  ): void => {
    void runtime.update({ [key]: enabled })
  }
  return (
    <div className="oh-dsh-sidebar-settings">
      <div className="oh-dsh-sidebar-settings-heading">
        <div>
          <strong>{t('settings.title')}</strong>
          <p>{t('settings.description')}</p>
        </div>
        <button type="button" onClick={reset}>{t('settings.reset')}</button>
      </div>
      <label className="oh-dsh-sidebar-settings-row">
        <span>
          <strong>{t('settings.open-by-default')}</strong>
          <small>{t('settings.open-by-default-description')}</small>
        </span>
        <input
          type="checkbox"
          checked={state.openByDefault}
          onChange={event => { setOpenByDefault(event.currentTarget.checked) }}
        />
      </label>
      <label className="oh-dsh-sidebar-settings-size">
        <span>
          <strong>{t('settings.width')}</strong>
          <small>{t('settings.width-value', { width: state.width })}</small>
        </span>
        <input
          type="range"
          min={SIDEBAR_MIN_WIDTH}
          max={SIDEBAR_MAX_WIDTH}
          step="10"
          value={state.width}
          onChange={event => { setWidth(Number(event.currentTarget.value)) }}
        />
      </label>
      <section>
        <h4>{t('settings.runtime')}</h4>
        <p>{t('settings.runtime-description')}</p>
        <label className="oh-dsh-sidebar-settings-row">
          <span>
            <strong>{t('settings.agent-terminal-tools')}</strong>
            <small>{t('settings.agent-terminal-tools-description')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState.preferences.agentTerminalTools}
            disabled={runtimeState.busy}
            onChange={event => {
              updateRuntime('agentTerminalTools', event.currentTarget.checked)
            }}
          />
        </label>
        <label className="oh-dsh-sidebar-settings-row">
          <span>
            <strong>{t('settings.bottom-terminal')}</strong>
            <small>{t('settings.bottom-terminal-description')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState.preferences.bottomPanelAutoTerminal}
            disabled={runtimeState.busy}
            onChange={event => {
              updateRuntime(
                'bottomPanelAutoTerminal',
                event.currentTarget.checked,
              )
            }}
          />
        </label>
        <label className="oh-dsh-sidebar-settings-row">
          <span>
            <strong>{t('settings.open-files')}</strong>
            <small>{t('settings.open-files-description')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState.preferences.interceptOpenPath}
            disabled={runtimeState.busy}
            onChange={event => {
              updateRuntime('interceptOpenPath', event.currentTarget.checked)
            }}
          />
        </label>
        <label className="oh-dsh-sidebar-settings-row">
          <span>
            <strong>{t('settings.open-links')}</strong>
            <small>{t('settings.open-links-description')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState.preferences.browserInterceptLinks}
            disabled={runtimeState.busy}
            onChange={event => {
              updateRuntime(
                'browserInterceptLinks',
                event.currentTarget.checked,
              )
            }}
          />
        </label>
        {runtimeState.error !== null && (
          <p className="oh-dsh-sidebar-settings-error" role="alert">
            {t(runtimeState.error === 'load'
              ? 'settings.runtime-load-failed'
              : 'settings.runtime-save-failed')}
          </p>
        )}
      </section>
      <section>
        <h4>{t('settings.tools')}</h4>
        <p>{t('settings.tools-description')}</p>
        <div className="oh-dsh-sidebar-settings-list">
          {tabs.map(descriptor => (
            <label key={descriptor.id}>
              <span>{sidebarLabel(descriptor.title)}</span>
              <input
                type="checkbox"
                checked={state.tabsEnabled[descriptor.id] !== false}
                onChange={event => {
                  setTabEnabled(descriptor.id, event.currentTarget.checked)
                }}
              />
            </label>
          ))}
        </div>
      </section>
      <section>
        <h4>{t('settings.viewers')}</h4>
        <p>{t('settings.viewers-description')}</p>
        <div className="oh-dsh-sidebar-settings-list">
          {viewers.map(descriptor => (
            <label key={descriptor.id}>
              <span>{sidebarLabel(descriptor.title)}</span>
              <input
                type="checkbox"
                checked={state.viewersEnabled[descriptor.id] !== false}
                onChange={event => {
                  setViewerEnabled(descriptor.id, event.currentTarget.checked)
                }}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  )
}

function syncSidebarSettings(
  actions: BoundSidebarSettingsActions | undefined,
  snapshot: DesktopSidebarSnapshot,
): void {
  actions?.sync(
    snapshot.openByDefault,
    snapshot.revision,
    { ...snapshot.tabsEnabled },
    { ...snapshot.viewersEnabled },
    snapshot.width,
  )
}

function pathBelongsToActiveWorkspace(
  sessions: SessionsService,
  path: string,
): boolean {
  const cwd = activeWorkspace(sessions)
  if (cwd === undefined) return false
  const normalizedRoot = cwd.replaceAll('\\', '/').replace(/\/+$/, '')
  const normalizedPath = path.replaceAll('\\', '/').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot
    || normalizedPath.startsWith(`${normalizedRoot}/`)
}

export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const slots = ctx.get('slots') as SlotsService
  const t: Translate<WorkspaceMessage> = locale.bind('oh-dsh.sidebar')
  ctx.effect(
    () => locale.register('oh-dsh.sidebar', WORKSPACE_MESSAGES),
    'oh-dsh-sidebar: workspace tools dictionaries',
  )
  const panels = ctx.get('desktopPanels') as DesktopPanels
  const pinnedSummary = ctx.get('pinnedSummary') as PinnedSummary
  const sessions = ctx.get('sessions') as SessionsService
  const inputTriggers = ctx.get('inputTriggers') as InputTriggersService
  const workspaces = ctx.get('workspaces') as WorkspacesService
  const originalOpenPath = workspaces.openPath
  const openExternalPath = async (path: string): Promise<void> => {
    await originalOpenPath.call(workspaces, path)
  }
  const reviewComments = new ReviewCommentsService(
    sessions,
    inputTriggers,
    window.localStorage,
  )
  const desktopSidebar = new DesktopSidebarService(
    new HttpSidebarPreferencesStorage(fetch.bind(globalThis)),
  )
  const runtimeSettings = new SidebarRuntimeSettingsService()
  const composerHistory = new ComposerInputHistory()
  const nativeSurface = new NativeRightbarSurface(
    sessions,
    () => ctx.get('sidebarRight') as NativeRightbarController | undefined,
  )
  const service = new WorkspaceToolsService(
    desktopSidebar,
    panels,
    locale,
    t,
    pinnedSummary,
    sessions,
    workspaces,
    nativeSurface,
    ctx.get('uiWorkspace') as UiWorkspaceService,
  )
  const unregisterBuiltins = registerBuiltinSidebarTools({
    openExternalPath,
    panels,
    reviewComments,
    service,
    sessions,
    sidebar: desktopSidebar,
    t,
    workspaces,
  })
  const settingsStore = defineStore<SidebarSettingsState>({
    init: () => ({
      openByDefault: false,
      revision: -1,
      tabsEnabled: {},
      viewersEnabled: {},
      width: DEFAULT_SIDEBAR_PREFERENCES.defaultWidth,
    }),
    actions: {
      sync: (
        draft,
        openByDefault: boolean,
        revision: number,
        tabsEnabled: Record<string, boolean>,
        viewersEnabled: Record<string, boolean>,
        width: number,
      ) => {
        if (revision < draft.revision) return
        draft.openByDefault = openByDefault
        draft.revision = revision
        draft.tabsEnabled = tabsEnabled
        draft.viewersEnabled = viewersEnabled
        draft.width = width
      },
    },
  })
  let settingsActions: BoundSidebarSettingsActions | undefined
  ctx.effect(() => {
    let historySessionId: string | undefined
    let stopHistory = (): void => {}
    const synchronizeHistory = (): void => {
      const nextSessionId = sessions.list.getSnapshot().current
      if (nextSessionId === historySessionId) return
      composerHistory.resetNavigation(historySessionId)
      stopHistory()
      historySessionId = undefined
      if (nextSessionId === undefined) return
      const binding = sessions.binding(nextSessionId)
      if (binding === undefined) return
      historySessionId = nextSessionId
      const synchronize = (): void => {
        composerHistory.synchronize(nextSessionId, binding.session.getSnapshot() as ComposerHistorySnapshot)
      }
      synchronize()
      stopHistory = binding.session.subscribe(synchronize)
    }
    const syncSession = (): void => {
      desktopSidebar.setSession(sessions.list.getSnapshot().current ?? null)
      synchronizeHistory()
    }
    const resetComposerHistory = (target: EventTarget | null): void => {
      if (!isComposerInput(target)) return
      composerHistory.resetNavigation(sessions.list.getSnapshot().current)
    }
    const onComposerInput = (event: Event): void => {
      resetComposerHistory(event.target)
    }
    const onComposerClick = (event: MouseEvent): void => {
      const target = event.target
      const button = target instanceof Element ? target.closest('button') : null
      if (button === null || button.closest('[data-composer-card]') === null) return
      composerHistory.resetNavigation(sessions.list.getSnapshot().current)
    }
    const onComposerKeyDown = (event: KeyboardEvent): void => {
      const composer = event.target
      if (!isComposerInput(composer)) return
      const sessionId = sessions.list.getSnapshot().current
      if (sessionId === undefined) return
      if (hasOpenComposerTriggerMenu(inputTriggers, sessions, sessionId)) return
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        composerHistory.resetNavigation(sessionId)
        return
      }
      const direction = historyDirectionForKey(event)
      if (direction === null) return
      const history = composerHistory.forSession(sessionId)
      const state = history.snapshot()
      const caret = readComposerCaret(composer)
      if (caret === null) return
      if (!isAtHistoryBoundary(caret, direction, state.cursor !== null)) return
      if (state.entries.length === 0 || (direction === 'newer' && state.cursor === null)) return
      const input = composerInputForSession(ctx, sessions, sessionId)
      if (input === undefined) return
      const result = history.navigate(direction, caret.value)
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!result.changed || result.value === null) {
        if (direction === 'older') {
          const binding = sessions.binding(sessionId)
          if (binding !== undefined) composerHistory.requestOlder(sessionId, binding.session)
        }
        return
      }
      input.setDraft(result.value)
      window.requestAnimationFrame(() => {
        if (composer.isConnected) focusComposerEnd(composer)
      })
    }
    syncSession()
    const stopSessions = sessions.list.subscribe(() => {
      syncSession()
      nativeSurface.flush()
    })
    const stopSettings = desktopSidebar.subscribe(() => {
      syncSidebarSettings(settingsActions, desktopSidebar.getSnapshot())
    })
    const syncRuntime = (): void => {
      panels.setAutoOpenTerminal(
        runtimeSettings.getSnapshot().preferences.bottomPanelAutoTerminal,
      )
    }
    const stopRuntime = runtimeSettings.subscribe(syncRuntime)
    const interceptOpenPath = async (path: string): Promise<void> => {
      const runtime = runtimeSettings.getSnapshot().preferences
      const snapshot = desktopSidebar.getSnapshot()
      if (runtime.interceptOpenPath
        && snapshot.ready
        && pathBelongsToActiveWorkspace(sessions, path)) {
        service.openFile(path)
        return
      }
      await openExternalPath(path)
    }
    const interceptExternalLink = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }
      const target = event.target
      const anchor = target instanceof Element
        ? target.closest<HTMLAnchorElement>('a[href]')
        : null
      if (anchor === null || anchor.hasAttribute('download')) return
      let url: URL
      try { url = new URL(anchor.href, window.location.href) } catch { return }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return
      if (url.origin === window.location.origin) return
      const runtime = runtimeSettings.getSnapshot().preferences
      const snapshot = desktopSidebar.getSnapshot()
      if (window.dshDesktop === undefined
        || !runtime.browserInterceptLinks
        || !snapshot.ready) return
      event.preventDefault()
      service.openBrowserUrl(url.href)
    }
    workspaces.openPath = interceptOpenPath
    document.addEventListener('click', interceptExternalLink, true)
    document.addEventListener('click', onComposerClick, true)
    document.addEventListener('input', onComposerInput, true)
    document.addEventListener('keydown', onComposerKeyDown, true)
    syncRuntime()
    void runtimeSettings.start()
    void desktopSidebar.start()
    service.mount()
    const removeSidebar = ctx.reflect.provide(
      'desktopSidebar',
      desktopSidebar,
      undefined,
    )
    const removeService = ctx.reflect.provide('workspaceTools', service, undefined)
    return () => {
      stopHistory()
      stopSessions()
      stopSettings()
      stopRuntime()
      document.removeEventListener('click', interceptExternalLink, true)
      document.removeEventListener('click', onComposerClick, true)
      document.removeEventListener('input', onComposerInput, true)
      document.removeEventListener('keydown', onComposerKeyDown, true)
      if (workspaces.openPath === interceptOpenPath) {
        workspaces.openPath = originalOpenPath
      }
      service.dispose()
      unregisterBuiltins()
      reviewComments.dispose()
      desktopSidebar.dispose()
      runtimeSettings.dispose()
      void removeSidebar?.()
      void removeService?.()
    }
  }, 'oh-dsh-sidebar: workspace tools and panel toolbar')

  slots.inject('settings.section', () => slots.register({
    id: 'oh-dsh-sidebar',
    inject: actions => {
      settingsActions = actions
      syncSidebarSettings(settingsActions, desktopSidebar.getSnapshot())
      return {
        reset: () => {
          desktopSidebar.setOpenByDefault(
            DEFAULT_SIDEBAR_PREFERENCES.openByDefault,
          )
          desktopSidebar.setWidth(DEFAULT_SIDEBAR_PREFERENCES.defaultWidth)
          for (const descriptor of desktopSidebar.getTabs()) {
            desktopSidebar.setTabEnabled(descriptor.id, true)
          }
          for (const descriptor of desktopSidebar.getViewers()) {
            desktopSidebar.setViewerEnabled(descriptor.id, true)
          }
          void runtimeSettings.reset()
        },
        setOpenByDefault: open => { desktopSidebar.setOpenByDefault(open) },
        setTabEnabled: (id, enabled) => {
          desktopSidebar.setTabEnabled(id, enabled)
        },
        setViewerEnabled: (id, enabled) => {
          desktopSidebar.setViewerEnabled(id, enabled)
        },
        setWidth: width => { desktopSidebar.setWidth(width) },
        runtime: runtimeSettings,
        sidebar: desktopSidebar,
      }
    },
    label: () => t('settings.title'),
    locale: 'oh-dsh.sidebar',
    name: 'settings.section',
    order: 40,
    store: settingsStore,
  }, SidebarSettingsRow))
}
