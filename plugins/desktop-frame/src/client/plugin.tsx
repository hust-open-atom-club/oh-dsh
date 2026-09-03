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
  setDetails(width: number): void
  toggleSidebar(): void
  setNarrow(narrow: boolean): void
  openDetails(): void
  closeDetails(): void
}

interface DesktopFrameProps {
  useStore<T>(selector: (state: LayoutState) => T): T
  useSessions<T>(selector: (state: SessionState) => T): T
  actions: DesktopLayoutActions
  renderSlot(name: string, owner: Record<string, unknown>): ReactNode
  // Standard share since the 0.1.2 slot system: strict session-scoped child
  // slots (details) only render inside this current-session binding.
  SessionProvider: (props: { children?: ReactNode }) => JSX.Element
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
  }
  theme: {
    getTheme(): ThemeSnapshot
  }
}

const SIDEBAR_MIN = 264
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 280
const SIDEBAR_COLLAPSED = 56
const SIDEBAR_AUTO_COLLAPSE = 1024
const DETAILS_MIN = 300
const DETAILS_MAX = 520
const DETAILS_DEFAULT = 360
const CENTER_MIN = 640

type LayoutState = {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
}

type LayoutActions = {
  setSidebar(draft: LayoutState, width: number): void
  setDetails(draft: LayoutState, width: number): void
  toggleSidebar(draft: LayoutState): void
  setNarrow(draft: LayoutState, narrow: boolean): void
  openDetails(draft: LayoutState): void
  closeDetails(draft: LayoutState): void
}

function clampWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)))
}

function computeColumns(viewport: number, sidebar: number, details: number): {
  sidebar: number
  center: number
  details: number
} {
  const resolvedSidebar = sidebar === 0
    ? SIDEBAR_COLLAPSED
    : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const preferredDetails = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX)
  if (resolvedSidebar + preferredDetails + CENTER_MIN <= viewport) {
    return {
      sidebar: resolvedSidebar,
      center: viewport - resolvedSidebar - preferredDetails,
      details: preferredDetails,
    }
  }
  const resolvedDetails = preferredDetails === 0
    ? 0
    : Math.max(DETAILS_MIN, viewport - resolvedSidebar - CENTER_MIN)
  if (resolvedSidebar + resolvedDetails + CENTER_MIN <= viewport) {
    return {
      sidebar: resolvedSidebar,
      center: CENTER_MIN,
      details: resolvedDetails,
    }
  }
  return {
    sidebar: resolvedSidebar,
    center: Math.max(0, viewport - resolvedSidebar),
    details: 0,
  }
}

function createDesktopLayoutStore() {
  return defineStore<LayoutState>({
    init: () => ({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      narrow: false,
      narrowExpanded: false,
    }),
    actions: {
      setSidebar: (draft, width) => { draft.sidebar = clampWidth(width, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (draft, width) => { draft.details = clampWidth(width, DETAILS_MIN, DETAILS_MAX) },
      toggleSidebar: draft => {
        if (draft.narrow) draft.narrowExpanded = !draft.narrowExpanded
        else draft.sidebar = draft.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      setNarrow: (draft, narrow) => {
        if (draft.narrow === narrow) return
        draft.narrow = narrow
        draft.narrowExpanded = false
      },
      openDetails: draft => { if (draft.details === 0) draft.details = DETAILS_DEFAULT },
      closeDetails: draft => { draft.details = 0 },
    },
  })
}

interface LayoutService {
  toggleSidebar(): void
  openDetails(): void
  closeDetails(): void
}

class DesktopLayoutController implements LayoutService {
  private actions: DesktopLayoutActions | undefined

  attach(actions: DesktopLayoutActions): void {
    this.actions = actions
  }

  toggleSidebar(): void { this.require().toggleSidebar() }
  openDetails(): void { this.require().openDetails() }
  closeDetails(): void { this.require().closeDetails() }

  private require(): DesktopLayoutActions {
    if (this.actions === undefined) throw new Error('desktop-frame: layout actions are not attached')
    return this.actions
  }
}

function DragHandle(props: {
  left: number
  side: 'sidebar' | 'details'
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
  const detailsSession = props.useSessions(state => {
    const current = state.current
    return current !== undefined && state.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [dragging, setDragging] = useState(false)
  const lastSession = useRef(detailsSession)
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  const cols = computeColumns(
    viewport,
    viewport < SIDEBAR_AUTO_COLLAPSE
      ? (!panels.narrowExpanded ? 0 : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar)
      : panels.sidebar,
    detailsSession === undefined ? 0 : panels.details,
  )
  const sidebarCollapsed = viewport < SIDEBAR_AUTO_COLLAPSE
    ? !panels.narrowExpanded
    : panels.sidebar === 0
  const colsRef = useRef(cols)
  colsRef.current = cols
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      props.actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [detailsSession, props.actions])
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
  return (
    <div
      ref={frameRef}
      className="oh-dsh-desktop-frame"
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-dragging={dragging || undefined}
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` }}
    >
      <div className="oh-dsh-desktop-frame-sidebar">
        <div className="oh-dsh-desktop-frame-sidebar-content">
          {props.renderSlot('sidebar', { collapsed: sidebarCollapsed, width: cols.sidebar })}
        </div>
      </div>
      <div className="oh-dsh-desktop-frame-center">{props.renderSlot('conversation', {})}</div>
      <div className="oh-dsh-desktop-frame-details">
        <props.SessionProvider>{props.renderSlot('details', {})}</props.SessionProvider>
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
      {cols.details > 0 && (
        <DragHandle
          side="details"
          left={viewport - cols.details}
          onStart={() => { detailsBase.current = colsRef.current.details; setDragging(true) }}
          onDrag={delta => { props.actions.setDetails(detailsBase.current - delta) }}
          onEnd={() => { setDragging(false) }}
        />
      )}
    </div>
  )
}

export const inject = ['slots', 'theme']

export function apply(ctx: ClientContext): void {
  const layout = new DesktopLayoutController()
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.ohDshDesktopFrame = 'true'
    style.textContent = frameCss
    document.head.append(style)
    const presenter = new DesktopFrameThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const offTheme = ctx.on('theme/change', (snapshot: ThemeSnapshot) => { presenter.apply(snapshot) })
    const disposeLayout = ctx.reflect.provide('layout', layout)
    const disposeRoot = ctx.slots.register({
      name: 'root',
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        conversation: { kind: 'single', scope: 'session-maybe' },
        details: { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      store: createDesktopLayoutStore,
      inject: (actions: DesktopLayoutActions) => {
        layout.attach(actions)
        return {}
      },
    }, DesktopFrame)
    return () => {
      disposeRoot()
      if (typeof disposeLayout === 'function') void disposeLayout()
      offTheme()
      presenter.dispose()
      style.remove()
    }
  }, 'oh-dsh-desktop-frame: root layout')
}
