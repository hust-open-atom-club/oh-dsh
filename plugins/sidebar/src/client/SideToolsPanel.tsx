import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { Translate } from '../../../shared/i18n.ts'
import type { WorkspaceFilesResponse, WorkspaceFileKind } from '../protocol.ts'
import {
  betterSidebarApi,
  mapBetterSidebarFile,
  mapBetterSidebarTree,
  type BetterSidebarScope,
} from './better-sidebar-api.ts'
import type {
  DesktopSidebar,
  DesktopSidebarRenderProps,
  DesktopSidebarTabDescriptor,
} from './sidebar-service.ts'
import type { WorkspaceMessage } from './i18n.ts'

interface ElectronWebviewElement extends HTMLElement {
  canGoBack(): boolean
  getURL(): string
  goBack(): void
  loadURL(url: string): Promise<void>
  reload(): void
}

interface SideToolsPanelProps {
  cwd: string | undefined
  maximized: boolean
  onClose(): void
  onResize(width: number): void
  open: boolean
  reviewSummary: { additions: number; deletions: number } | null
  reviewSummaryLoading: boolean
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
  width: number
}

type ToolIconKind =
  | 'browser'
  | 'chat'
  | 'file'
  | 'files'
  | 'review'
  | 'terminal'
  | 'trajectory'

export function ToolIcon({ kind }: { kind: ToolIconKind }): JSX.Element {
  if (kind === 'review') return <svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="3" /><path d="M9 9h6M9 13h6M12 7v4" /></svg>
  if (kind === 'terminal') return <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3" /><path d="m8 10 2 2-2 2M13 15h3" /></svg>
  if (kind === 'browser') return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>
  if (kind === 'files') return <svg viewBox="0 0 24 24"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" /></svg>
  if (kind === 'file') return <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v5h5" /></svg>
  if (kind === 'chat') return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M11 7v8M7 11h8M16 16l4 4" /></svg>
  return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l-3 2" /></svg>
}

function defaultIcon(id: string): ToolIconKind {
  if (id === 'review' || id === 'terminal' || id === 'browser'
    || id === 'files' || id === 'trajectory') return id
  if (id === 'side-chat') return 'chat'
  return 'file'
}

function descriptorTitle(descriptor: DesktopSidebarTabDescriptor): string {
  return typeof descriptor.title === 'function'
    ? descriptor.title()
    : descriptor.title
}

function DescriptorIcon({ descriptor }: {
  descriptor: DesktopSidebarTabDescriptor
}): JSX.Element {
  const icon = typeof descriptor.icon === 'function'
    ? descriptor.icon(21)
    : descriptor.icon
  return <>{icon ?? <ToolIcon kind={defaultIcon(descriptor.id)} />}</>
}

function ToolRow(props: {
  descriptor: DesktopSidebarTabDescriptor
  disabled?: boolean
  summary?: ReactNode
  onClick(): void
}): JSX.Element {
  return (
    <button
      className="oh-dsh-side-tool-row"
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <DescriptorIcon descriptor={props.descriptor} />
      <span>{descriptorTitle(props.descriptor)}</span>
      {props.summary}
      {props.descriptor.shortcut !== undefined && (
        <kbd>{props.descriptor.shortcut}</kbd>
      )}
    </button>
  )
}

function SideMenu(props: SideToolsPanelProps): JSX.Element {
  const [error, setError] = useState('')
  const open = async (descriptor: DesktopSidebarTabDescriptor): Promise<void> => {
    try {
      setError('')
      if (descriptor.action !== undefined && descriptor.render === undefined) {
        await descriptor.action()
        return
      }
      const result = props.sidebar.openTab({ type: descriptor.id })
      if (result.kind === 'limit') throw new Error(props.t('side.tab-limit'))
      if (result.kind === 'disabled') throw new Error(props.t('side.tool-disabled'))
      if (result.kind === 'missing') throw new Error(props.t('side.tool-missing'))
      if (result.kind === 'not-ready') throw new Error(props.t('side.not-ready'))
    } catch (next) {
      setError(next instanceof Error ? next.message : String(next))
    }
  }
  const descriptors = props.sidebar.getTabs().filter(descriptor =>
    descriptor.hidden !== true && props.sidebar.isTabEnabled(descriptor.id),
  )
  return (
    <div className="oh-dsh-side-menu">
      {descriptors.map(descriptor => (
        <ToolRow
          key={descriptor.id}
          descriptor={descriptor}
          disabled={(descriptor.requiresWorkspace === true && props.cwd === undefined)
            || descriptor.available?.() === false}
          summary={descriptor.id === 'review' && (props.reviewSummaryLoading || props.reviewSummary !== null)
            ? (
              <span className="oh-dsh-side-tool-summary" aria-label="diff summary" style={{ fontSize: '16px', fontWeight: 700, lineHeight: 1 }}>
                {props.reviewSummaryLoading
                  ? <span className="oh-dsh-change-stats-loading">…</span>
                  : (
                    <>
                      <span className="oh-dsh-change-stat-add">+{props.reviewSummary?.additions}</span>
                      <span className="oh-dsh-change-stat-delete">-{props.reviewSummary?.deletions}</span>
                    </>
                  )}
              </span>
            )
            : undefined}
          onClick={() => { void open(descriptor) }}
        />
      ))}
      {error !== '' && <div className="oh-dsh-side-error" role="alert">{error}</div>}
    </div>
  )
}

function normalizeBrowserUrl(
  raw: string,
  t: Translate<WorkspaceMessage>,
): string {
  const value = raw.trim()
  if (value === '') throw new Error(t('browser.enter-url'))
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value)
    ? value
    : `https://${value}`)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(t('browser.http-only'))
  }
  return url.href
}

export function BrowserView({
  patch,
  t,
  tab,
}: DesktopSidebarRenderProps & {
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const container = useRef<HTMLDivElement | null>(null)
  const webview = useRef<ElectronWebviewElement | null>(null)
  const [address, setAddress] = useState(tab.resource ?? '')
  const [error, setError] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)

  useEffect(() => {
    const host = container.current
    if (host === null) return
    const element = document.createElement('webview') as unknown as ElectronWebviewElement
    element.className = 'oh-dsh-browser-webview'
    element.setAttribute('partition', 'persist:oh-dsh-browser')
    element.setAttribute('src', tab.resource ?? 'about:blank')
    const update = (event: Event): void => {
      const next = 'url' in event && typeof event.url === 'string'
        ? event.url
        : element.getURL()
      if (next !== '' && next !== 'about:blank') {
        try {
          const safe = normalizeBrowserUrl(next, t)
          const url = new URL(safe)
          setAddress(safe)
          patch({ resource: safe, title: url.hostname || t('browser') })
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : String(nextError))
        }
      }
      setCanGoBack(element.canGoBack())
    }
    const guard = (event: Event): void => {
      if (!('url' in event) || typeof event.url !== 'string') return
      try {
        normalizeBrowserUrl(event.url, t)
      } catch (nextError) {
        event.preventDefault()
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      }
    }
    const failed = (event: Event): void => {
      const description = 'errorDescription' in event
        ? String(event.errorDescription)
        : t('browser.page-failed')
      setError(description)
    }
    element.addEventListener('did-navigate', update)
    element.addEventListener('did-navigate-in-page', update)
    element.addEventListener('will-navigate', guard)
    element.addEventListener('did-fail-load', failed)
    host.append(element)
    webview.current = element
    return () => {
      webview.current = null
      element.remove()
    }
  }, [tab.id])

  const navigate = async (): Promise<void> => {
    try {
      const url = normalizeBrowserUrl(address, t)
      setAddress(url)
      setError('')
      await webview.current?.loadURL(url)
    } catch (next) {
      setError(next instanceof Error ? next.message : String(next))
    }
  }

  return (
    <div className="oh-dsh-browser-view">
      <form
        className="oh-dsh-browser-bar"
        onSubmit={event => { event.preventDefault(); void navigate() }}
      >
        <button
          type="button"
          disabled={!canGoBack}
          aria-label={t('browser.back')}
          onClick={() => { webview.current?.goBack() }}
        >‹</button>
        <button
          type="button"
          aria-label={t('browser.reload')}
          onClick={() => { webview.current?.reload() }}
        >↻</button>
        <input
          value={address}
          placeholder={t('browser.enter-url')}
          aria-label={t('browser.url')}
          onChange={event => { setAddress(event.currentTarget.value) }}
        />
        <button type="submit">{t('browser.go')}</button>
      </form>
      {error !== '' && <div className="oh-dsh-browser-error" role="alert">{error}</div>}
      <div ref={container} className="oh-dsh-browser-host" />
    </div>
  )
}

function formatSize(size: number | null): string {
  if (size === null) return ''
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function fileGlyph(kind: WorkspaceFileKind): string {
  return kind === 'directory' ? '▱' : kind === 'symlink' ? '↗' : '▤'
}

export function FilesView({
  patch,
  scope,
  sidebar,
  t,
  tab,
}: DesktopSidebarRenderProps & {
  scope: BetterSidebarScope | undefined
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const cwd = scope?.cwd
  const [path, setPath] = useState(tab.resource ?? cwd)
  const [snapshot, setSnapshot] = useState<WorkspaceFilesResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const next = tab.resource ?? cwd
    setPath(next)
    setSnapshot(null)
  }, [cwd, tab.id, tab.resource])
  useEffect(() => {
    if (cwd === undefined || path === undefined || scope === undefined) return
    const controller = new AbortController()
    setLoading(true)
    void betterSidebarApi.fsTree(scope, path, controller.signal).then(
      listing => {
        setSnapshot(mapBetterSidebarTree(cwd, listing))
        setError('')
      },
    ).catch((next: unknown) => {
      if (!controller.signal.aborted) {
        setError(next instanceof Error ? next.message : String(next))
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => { controller.abort() }
  }, [cwd, path, refreshKey, scope?.sessionId])

  const browse = (next: string): void => {
    setPath(next)
    patch({ resource: next })
  }
  if (cwd === undefined) {
    return <div className="oh-dsh-side-empty">{t('files.select-workspace')}</div>
  }
  return (
    <div className="oh-dsh-files-view">
      <div className="oh-dsh-files-path" title={snapshot?.path ?? cwd}>
        <button
          type="button"
          disabled={snapshot?.parent == null}
          onClick={() => {
            if (snapshot?.parent !== undefined && snapshot.parent !== null) {
              browse(snapshot.parent)
            }
          }}
        >‹</button>
        <span>{(snapshot?.path ?? cwd).slice(cwd.length) || '/'}</span>
        <button
          type="button"
          onClick={() => { setRefreshKey(value => value + 1) }}
        >↻</button>
      </div>
      {loading && <div className="oh-dsh-side-muted">{t('files.loading')}</div>}
      {error !== '' && <div className="oh-dsh-side-error" role="alert">{error}</div>}
      {snapshot?.kind === 'directory' && (
        <div className="oh-dsh-file-list">
          {snapshot.entries.map(entry => (
            <button
              key={entry.path}
              type="button"
              onClick={() => {
                if (entry.kind === 'directory') browse(entry.path)
                else {
                  sidebar.openTab({
                    resource: entry.path,
                    title: entry.name,
                    type: 'file',
                  })
                }
              }}
            >
              <span>{fileGlyph(entry.kind)}</span>
              <span title={entry.name}>{entry.name}</span>
              <small>{formatSize(entry.size)}</small>
            </button>
          ))}
          {snapshot.entries.length === 0 && (
            <div className="oh-dsh-side-muted">{t('files.empty-directory')}</div>
          )}
          {snapshot.truncated && (
            <div className="oh-dsh-side-muted">{t('files.showing-first')}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function FileView({
  onOpenPath,
  scope,
  sidebar,
  t,
  tab,
}: DesktopSidebarRenderProps & {
  scope: BetterSidebarScope | undefined
  onOpenPath(path: string): Promise<void>
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const cwd = scope?.cwd
  const [snapshot, setSnapshot] = useState<WorkspaceFilesResponse | null>(null)
  const [error, setError] = useState('')
  const path = tab.resource

  useEffect(() => {
    if (cwd === undefined || path === undefined || scope === undefined) return
    const controller = new AbortController()
    void betterSidebarApi.fsRead(scope, path, controller.signal).then(
      result => {
        setSnapshot(mapBetterSidebarFile(cwd, path, result))
        setError('')
      },
    ).catch((next: unknown) => {
      if (!controller.signal.aborted) {
        setError(next instanceof Error ? next.message : String(next))
      }
    })
    return () => { controller.abort() }
  }, [cwd, path, scope?.sessionId])

  if (cwd === undefined || path === undefined) {
    return <div className="oh-dsh-side-empty">{t('files.select-workspace')}</div>
  }
  if (error !== '') return <div className="oh-dsh-side-error" role="alert">{error}</div>
  if (snapshot === null) return <div className="oh-dsh-side-muted">{t('files.loading')}</div>
  if (snapshot.kind !== 'file') {
    return <div className="oh-dsh-side-muted">{t('files.not-file')}</div>
  }
  const head = snapshot.binary
    ? new Uint8Array([0])
    : new TextEncoder().encode((snapshot.content ?? '').slice(0, 512))
  const viewer = sidebar.matchViewer(path, head)
  if (viewer?.render !== undefined) {
    return <>{viewer.render({
      ...(snapshot.content !== null ? { content: snapshot.content } : {}),
      path,
      title: tab.title,
    })}</>
  }
  return (
    <div className="oh-dsh-file-preview">
      <div>
        <strong>{tab.title}</strong>
        <button type="button" onClick={() => { void onOpenPath(path) }}>
          {t('files.open')}
        </button>
      </div>
      <div className="oh-dsh-side-muted">
        {t('files.no-viewer', { size: formatSize(snapshot.size) })}
      </div>
    </div>
  )
}

function OrphanedTab({ title, t }: {
  t: Translate<WorkspaceMessage>
  title: string
}): JSX.Element {
  return (
    <div className="oh-dsh-side-empty">
      <strong>{title}</strong>
      <p>{t('side.orphaned-tab')}</p>
    </div>
  )
}

function TabStrip({ sidebar, t }: {
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
}): JSX.Element | null {
  const snapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot)
  if (snapshot.tabs.length < 2) return null
  return (
    <div className="oh-dsh-side-tabs" role="tablist">
      {snapshot.tabs.map(tab => (
        <div key={tab.id} data-active={tab.id === snapshot.activeId || undefined}>
          <button
            type="button"
            role="tab"
            aria-selected={tab.id === snapshot.activeId}
            title={tab.title}
            onClick={() => { sidebar.activateTab(tab.id) }}
          >{tab.title}</button>
          <button
            type="button"
            aria-label={t('side.close-named-tab', { title: tab.title })}
            onClick={() => { sidebar.closeTab(tab.id) }}
          >×</button>
        </div>
      ))}
    </div>
  )
}

export function SideToolsPanel(props: SideToolsPanelProps): JSX.Element {
  const snapshot = useSyncExternalStore(
    props.sidebar.subscribe,
    props.sidebar.getSnapshot,
  )
  const activeTab = snapshot.tabs.find(tab => tab.id === snapshot.activeId)
  const descriptor = activeTab === undefined
    ? undefined
    : props.sidebar.getTab(activeTab.type)
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = props.width
    const move = (next: PointerEvent): void => {
      props.onResize(startWidth + startX - next.clientX)
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  // The floating toolbar lives above this panel, so it has to stand clear of
  // it while the panel is open. Publish the footprint on the root element:
  // the toolbar is mounted outside the panel's own subtree.
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const root = document.documentElement
    if (props.open && props.maximized) root.dataset.ohDshSidePanelMaximized = 'true'
    else delete root.dataset.ohDshSidePanelMaximized
    return () => { delete root.dataset.ohDshSidePanelMaximized }
  }, [props.open, props.maximized])
  useEffect(() => {
    const root = document.documentElement
    const element = panelRef.current
    if (!props.open || element === null) {
      root.style.setProperty('--oh-dsh-workspace-panel-inset', '0px')
      return
    }
    const publish = (): void => {
      // The panel squeezes the conversation column, so its whole footprint
      // (width plus any offset from the right edge) shifts the session top bar.
      const { width, right } = element.getBoundingClientRect()
      root.style.setProperty(
        '--oh-dsh-workspace-panel-inset',
        `${Math.round(width + (globalThis.innerWidth - right))}px`,
      )
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(element)
    return () => {
      observer.disconnect()
      root.style.setProperty('--oh-dsh-workspace-panel-inset', '0px')
    }
  }, [props.open, props.maximized, props.width])
  const title = activeTab?.title ?? props.t('side.title')
  const renderProps: DesktopSidebarRenderProps | undefined = activeTab === undefined
    ? undefined
    : {
      active: props.open,
      close: () => { props.sidebar.closeTab(activeTab.id) },
      patch: patch => { props.sidebar.patchTab(activeTab.id, patch) },
      tab: activeTab,
    }
  const content: ReactNode = activeTab === undefined
    ? <SideMenu {...props} />
    : descriptor?.render === undefined || renderProps === undefined
      ? <OrphanedTab title={title} t={props.t} />
      : descriptor.render(renderProps)
  return (
    <aside
      ref={panelRef}
      className="oh-dsh-workspace-panel oh-dsh-side-panel"
      data-open={String(props.open)}
      data-maximized={String(props.maximized)}
      aria-hidden={!props.open}
      aria-label={title}
      style={{ width: '100%' }}
    >
      {!props.maximized && (
        <div
          className="oh-dsh-workspace-resize"
          onPointerDown={beginResize}
          aria-hidden="true"
        />
      )}
      <TabStrip sidebar={props.sidebar} t={props.t} />
      {activeTab !== undefined && descriptor?.chrome !== 'custom' && (
        <header className="oh-dsh-workspace-header oh-dsh-side-header">
          <div>
            <button
              type="button"
              aria-label={props.t('side.back')}
              onClick={() => { props.sidebar.activateTab(null) }}
            >‹</button>
            <strong>{title}</strong>
          </div>
          <div>
            <button
              type="button"
              aria-label={props.t('side.close-tab')}
              onClick={() => { props.sidebar.closeTab(activeTab.id) }}
            >−</button>
            <button
              type="button"
              aria-label={props.t('side.close')}
              onClick={props.onClose}
            >×</button>
          </div>
        </header>
      )}
      {content}
    </aside>
  )
}
