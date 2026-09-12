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
            onClick={() => { void open(descriptor) }}
        />
      ))}
      {error !== '' && <div className="oh-dsh-side-error" role="alert">{error}</div>}
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
  const content: ReactNode = activeTab === undefined || descriptor?.render === undefined || renderProps === undefined
    ? <SideMenu {...props} />
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
