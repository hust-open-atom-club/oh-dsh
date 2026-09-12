import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { defineStore } from '@deepseek-ai/dsh-client-store'
import frameCss from './frame.css'
import { DesktopFrameThemePresenter } from './theme-presenter.ts'

interface ThemeSnapshot {
  active: {
    colorScheme: 'light' | 'dark'
    tokens: Readonly<Record<string, string>>
  }
}

interface SessionState {
  current?: string
  byId: Record<string, { blank?: boolean }>
}

interface DesktopLayoutActions {
  setSidebar(width: number): void
  setRightbar(width: number): void
  toggleSidebar(): void
  setNarrow(narrow: boolean): void
  openRightbar(fullscreen?: boolean): void
  closeRightbar(): void
  selectPanel(panelId: string): void
  beginNavigation(): void
  retainMainPanels(panelIds: readonly string[]): void
}

/** The panel-info face the 0.1.5 shell and slot entries read through provideRoot. */
interface PanelInfo {
  activePanelId: string
}

interface DesktopFrameProps {
  useStore<T>(selector: (state: LayoutState) => T): T
  useSessions<T>(selector: (state: SessionState) => T): T
  usePanelInfo<T>(selector: (info: PanelInfo) => T): T
  actions: DesktopLayoutActions
  renderSlot(name: string, owner: Record<string, unknown>, options?: { entryKey?: string }): ReactNode
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  on(event: string, listener: (snapshot: ThemeSnapshot) => void): () => void
  reflect: {
    provide(name: string, value: unknown): (() => Promise<void> | void) | void
  }
  slots: {
    register(options: Record<string, unknown>, component: unknown): () => void
    provideRoot(options: Record<string, unknown>): () => void
    entries(name: string): Array<{ options: { key?: string } }>
    subscribe(name: string, listener: () => void): () => void
  }
  theme: {
    getTheme(): ThemeSnapshot
  }
}

// Codex-like proportions: a compact sidebar (~1/6 of a 1440 canvas) and a
// review-weight right column; the center keeps its generous floor.
const SIDEBAR_MIN = 232
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 260
const SIDEBAR_COLLAPSED = 56
const SIDEBAR_AUTO_COLLAPSE = 1024
const RIGHTBAR_MIN = 300
const RIGHTBAR_MAX = 560
const RIGHTBAR_DEFAULT = 420
const RIGHTBAR_FULLSCREEN = RIGHTBAR_MAX
const CENTER_MIN = 640

type LayoutState = {
  sidebar: number
  rightbar: number
  activePanelId: string | undefined
  narrow: boolean
  narrowExpanded: boolean
}

type LayoutActions = {
  setSidebar(draft: LayoutState, width: number): void
  setRightbar(draft: LayoutState, width: number): void
  toggleSidebar(draft: LayoutState): void
  setNarrow(draft: LayoutState, narrow: boolean): void
  openRightbar(draft: LayoutState, fullscreen?: boolean): void
  closeRightbar(draft: LayoutState): void
  selectPanel(draft: LayoutState, panelId: string): void
  beginNavigation(draft: LayoutState): void
  retainMainPanels(draft: LayoutState, panelIds: readonly string[]): void
}

function clampWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)))
}

function computeColumns(viewport: number, sidebar: number, rightbar: number): {
  sidebar: number
  center: number
  rightbar: number
} {
  const resolvedSidebar = sidebar === 0
    ? SIDEBAR_COLLAPSED
    : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const preferredRightbar = rightbar === 0 ? 0 : clampWidth(rightbar, RIGHTBAR_MIN, RIGHTBAR_MAX)
  if (resolvedSidebar + preferredRightbar + CENTER_MIN <= viewport) {
    return {
      sidebar: resolvedSidebar,
      center: viewport - resolvedSidebar - preferredRightbar,
      rightbar: preferredRightbar,
    }
  }
  const resolvedRightbar = preferredRightbar === 0
    ? 0
    : Math.max(RIGHTBAR_MIN, viewport - resolvedSidebar - CENTER_MIN)
  if (resolvedSidebar + resolvedRightbar + CENTER_MIN <= viewport) {
    return {
      sidebar: resolvedSidebar,
      center: CENTER_MIN,
      rightbar: resolvedRightbar,
    }
  }
  return {
    sidebar: resolvedSidebar,
    center: Math.max(0, viewport - resolvedSidebar),
    rightbar: 0,
  }
}

function createDesktopLayoutStore() {
  return defineStore<LayoutState>({
    init: () => ({
      sidebar: SIDEBAR_DEFAULT,
      rightbar: 0,
      activePanelId: undefined,
      narrow: false,
      narrowExpanded: false,
    }),
    actions: {
      setSidebar: (draft, width) => { draft.sidebar = clampWidth(width, SIDEBAR_MIN, SIDEBAR_MAX) },
      setRightbar: (draft, width) => { draft.rightbar = clampWidth(width, RIGHTBAR_MIN, RIGHTBAR_MAX) },
      toggleSidebar: draft => {
        if (draft.narrow) draft.narrowExpanded = !draft.narrowExpanded
        else draft.sidebar = draft.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      setNarrow: (draft, narrow) => {
        if (draft.narrow === narrow) return
        draft.narrow = narrow
        draft.narrowExpanded = false
      },
      openRightbar: (draft, fullscreen) => {
        if (draft.rightbar === 0) draft.rightbar = fullscreen === true ? RIGHTBAR_FULLSCREEN : RIGHTBAR_DEFAULT
      },
      closeRightbar: draft => { draft.rightbar = 0 },
      selectPanel: (draft, panelId) => { draft.activePanelId = panelId },
      beginNavigation: _draft => {
        // The 0.1.5 layout face reserves this seam for navigation-time
        // panel handling; the Oh-DSH frame keeps a single selection.
      },
      retainMainPanels: (draft, panelIds) => {
        if (draft.activePanelId !== undefined && !panelIds.includes(draft.activePanelId)) {
          draft.activePanelId = undefined
        }
      },
    },
  })
}

interface LayoutService {
  toggleSidebar(): void
  openRightbar(track?: unknown, fullscreen?: boolean): void
  closeRightbar(): void
  selectPanel(panelId: string): void
  /** Returns the navigation signal the 0.1.5 callers race against. */
  beginNavigation(): AbortSignal
}

class DesktopLayoutController implements LayoutService {
  private actions: DesktopLayoutActions | undefined
  private readonly hasMainPanel: (panelId: string) => boolean

  constructor(hasMainPanel: (panelId: string) => boolean) {
    this.hasMainPanel = hasMainPanel
  }

  attach(actions: DesktopLayoutActions): void {
    this.actions = actions
  }

  toggleSidebar(): void { this.require().toggleSidebar() }
  openRightbar(_track?: unknown, fullscreen?: boolean): void { this.require().openRightbar(fullscreen) }
  closeRightbar(): void { this.require().closeRightbar() }
  /**
   * The 0.1.5 navigation seam: callers race in-flight work against the
   * returned signal (AbortSignal.any in uiWorkspace.startSession and the
   * upstream sidebar's fork), so it must be a real signal. The Oh-DSH frame
   * keeps a single selection and never aborts an in-flight navigation; a
   * fresh non-aborted signal per call expresses exactly that.
   */
  beginNavigation(): AbortSignal { this.require().beginNavigation(); return new AbortController().signal }

  selectPanel(panelId: string): void {
    if (panelId === 'conversation' || this.hasMainPanel(panelId)) {
      this.require().selectPanel(panelId)
    }
  }

  private require(): DesktopLayoutActions {
    if (this.actions === undefined) throw new Error('desktop-frame: layout actions are not attached')
    return this.actions
  }
}

function DragHandle(props: {
  left: number
  side: 'sidebar' | 'rightbar'
  onStart(): void
  onDrag(delta: number): void
  onEnd(): void
}): JSX.Element {
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const activePointerId = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }
  const [dragging, setDragging] = useState(false)
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointerId.current = event.pointerId
    origin.current = event.clientX
    latest.current = event.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerId.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    latest.current = event.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const pointerId = activePointerId.current
    if (pointerId === null || event.pointerId !== pointerId) return
    activePointerId.current = null
    if (event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId)
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    callbacks.current.onDrag(latest.current - origin.current)
    callbacks.current.onEnd()
    setDragging(false)
  }, [])
  return (
    <div
      className="oh-dsh-desktop-frame-handle"
      data-side={props.side}
      data-dragging={dragging || undefined}
      style={{ left: props.left }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    />
  )
}

function DesktopFrame(props: DesktopFrameProps): JSX.Element {
  const panels = props.useStore(state => state)
  const activePanelId = props.usePanelInfo(info => info.activePanelId) ?? 'conversation'
  const rightbarSession = props.useSessions(state => {
    const current = state.current
    return current !== undefined && state.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [dragging, setDragging] = useState(false)
  const sidebarBase = useRef(0)
  const rightbarBase = useRef(0)
  const cols = computeColumns(
    viewport,
    viewport < SIDEBAR_AUTO_COLLAPSE
      ? (!panels.narrowExpanded ? 0 : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar)
      : panels.sidebar,
    rightbarSession === undefined ? 0 : panels.rightbar,
  )
  const sidebarCollapsed = viewport < SIDEBAR_AUTO_COLLAPSE
    ? !panels.narrowExpanded
    : panels.sidebar === 0
  const colsRef = useRef(cols)
  colsRef.current = cols
  useLayoutEffect(() => {
    const element = frameRef.current
    if (element === null) return
    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      frame ??= requestAnimationFrame(() => {
        frame = null
        const width = element.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])
  useEffect(() => { props.actions.setNarrow(viewport < SIDEBAR_AUTO_COLLAPSE) }, [props.actions, viewport])
  // Publish the rightbar column width on the root element: floating chrome
  // lives outside the frame, so it can only inherit the value from there.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--oh-dsh-details-width', `${cols.rightbar}px`)
    return () => { root.style.removeProperty('--oh-dsh-details-width') }
  }, [cols.rightbar])
  // An active session puts the conversation top bar's own controls (Session
  // log) in the top-right corner; only then does floating chrome need to step
  // aside from it.
  useEffect(() => {
    const root = document.documentElement
    if (rightbarSession === undefined) delete root.dataset.ohDshSessionActive
    else root.dataset.ohDshSessionActive = 'true'
    return () => { delete root.dataset.ohDshSessionActive }
  }, [rightbarSession])
  return (
    <div
      ref={frameRef}
      className="oh-dsh-desktop-frame"
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.rightbar === 0 || undefined}
      data-dragging={dragging || undefined}
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.rightbar}px` }}
    >
      <div className="oh-dsh-desktop-frame-sidebar">
        <div className="oh-dsh-desktop-frame-sidebar-content">
          {props.renderSlot('sidebar', { collapsed: sidebarCollapsed, width: cols.sidebar })}
        </div>
      </div>
      <div className="oh-dsh-desktop-frame-center">
        {props.renderSlot('main', {}, { entryKey: activePanelId })}
      </div>
      <div className="oh-dsh-desktop-frame-details">
        {props.renderSlot('rightbar', {
          width: cols.rightbar,
          viewportWidth: viewport,
          canShow: cols.rightbar > 0,
        })}
      </div>
      <div className="oh-dsh-desktop-frame-overlay" data-shell-overlay>{props.renderSlot('shell.overlay', {})}</div>
      {!sidebarCollapsed && (
        <DragHandle
          side="sidebar"
          left={cols.sidebar}
          onStart={() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }}
          onDrag={delta => { props.actions.setSidebar(sidebarBase.current + delta) }}
          onEnd={() => { setDragging(false) }}
        />
      )}
      {cols.rightbar > 0 && (
        <DragHandle
          side="rightbar"
          left={viewport - cols.rightbar}
          onStart={() => { rightbarBase.current = colsRef.current.rightbar; setDragging(true) }}
          onDrag={delta => { props.actions.setRightbar(rightbarBase.current - delta) }}
          onEnd={() => { setDragging(false) }}
        />
      )}
    </div>
  )
}

export const inject = ['slots', 'theme']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.ohDshDesktopFrame = 'true'
    style.textContent = frameCss
    document.head.append(style)
    const presenter = new DesktopFrameThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const offTheme = ctx.on('theme/change', (snapshot: ThemeSnapshot) => { presenter.apply(snapshot) })
    // One root store instance for the whole frame; the slot system hands the
    // same handle its scoped `create` calls would get.
    const handle = createDesktopLayoutStore()
    const instance = handle.create()
    const store = { ...handle, create: () => instance }
    // The 0.1.5 shell reads panel info through the root hooks; without this
    // provider every slot entry calling usePanelInfo crashes.
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: {
      getSnapshot: (): PanelInfo => ({ activePanelId: instance.getSnapshot().activePanelId ?? 'conversation' }),
      subscribe: (listener: () => void) => instance.subscribe(listener),
    } } })
    const layout = new DesktopLayoutController(panelId =>
      ctx.slots.entries('main').some(entry => entry.options.key === panelId))
    const disposeLayout = ctx.reflect.provide('layout', layout)
    const disposeRoot = ctx.slots.register({
      name: 'root',
      locale: 'common',
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        main: { kind: 'keyed', scope: 'root' },
        rightbar: { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      store,
      inject: (actions: DesktopLayoutActions) => {
        layout.attach(actions)
        return {}
      },
    }, DesktopFrame)
    const disposeRetain = ctx.slots.subscribe('main', () => {
      void instance.actions.retainMainPanels?.(
        ctx.slots.entries('main')
          .flatMap(entry => entry.options.key === undefined ? [] : [entry.options.key]),
      )
    })
    return () => {
      disposeRetain()
      disposeRoot()
      if (typeof disposeLayout === 'function') void disposeLayout()
      disposePanelInfo()
      offTheme()
      presenter.dispose()
      style.remove()
    }
  }, 'oh-dsh-desktop-frame: root layout')
}
