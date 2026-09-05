/**
 * Sidebar update entry for Oh-DSH Desktop.
 *
 * Two independent, unrelated icon instances, one per fold state, in the
 * upstream style of stacking one control per row:
 *   - wide instance: inside the ui-sidebar shell's logo row, immediately left
 *     of the collapse toggle (download glyph, 28px) — visible while expanded;
 *   - rail instance: its own 36px row directly below the whale, like the
 *     upstream New Session row (update/refresh glyph) — visible while
 *     collapsed.
 *
 * Which instance is displayed follows the desktop frame's
 * `data-sidebar-collapsed` attribute through CSS; both hosts are loaded once
 * and never moved (no fold choreography). The wide host is loaded only after
 * the brand button is present so it lands between the brand and the collapse
 * toggle; the rail host never touches the logo row, so the whale is never
 * displaced. The upstream logo row declares no slot and upstream/ is pinned,
 * hence the DOM anchoring.
 *
 * Clicking opens the existing update window through the DesktopBridge
 * (`openUpdater`); the window always starts an update check. Copy is localized
 * through the `oh-dsh.update-button` dictionary.
 */
import { useEffect, useRef, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import updateButtonCss from './update-button.css'
import { UPDATE_BUTTON_MESSAGES, type UpdateButtonMessage } from './i18n.ts'
import type { UpdateUiStore } from './update-state.ts'
import { createUpdateUiStore, updateUiFromSnapshot } from './update-state.ts'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import type { AboutUpdateSnapshot, DesktopBridge } from '../../../../src/contracts.ts'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
}

const TOOLTIP_DELAY_MS = 500

interface SidebarUpdateButtonProps {
  t: Translate<UpdateButtonMessage>
  ui: UpdateUiStore
}

function SidebarUpdateButton({ t, ui }: SidebarUpdateButtonProps): JSX.Element | null {
  const state = useSyncExternalStore(ui.subscribe, ui.get)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const tooltipRef = useRef<HTMLSpanElement | null>(null)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openRef = useRef(false)

  const openUpdater = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    hideTooltip()
    const bridge = (window as unknown as { dshDesktop?: DesktopBridge }).dshDesktop
    void bridge?.openUpdater()
  }

  const label = (): string => t('checkForUpdates')

  const showBubble = (): void => {
    const target = buttonRef.current
    if (target === null) return
    const element = document.createElement('span')
    element.className = 'oh-dsh-sidebar-update-tooltip'
    element.setAttribute('role', 'tooltip')
    element.textContent = label()
    const rect = target.getBoundingClientRect()
    element.style.left = `${Math.round(rect.right + 10)}px`
    element.style.top = `${Math.round(rect.top + rect.height / 2)}px`
    document.body.append(element)
    target.setAttribute('aria-label', label())
    tooltipRef.current = element
    openRef.current = true
  }

  const showTooltip = (): void => {
    if (showTimerRef.current !== null) return
    showTimerRef.current = setTimeout(() => {
      showTimerRef.current = null
      if (openRef.current) return
      showBubble()
    }, TOOLTIP_DELAY_MS)
  }

  const showTooltipImmediately = (): void => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
    if (!openRef.current) showBubble()
  }

  const hideTooltip = (): void => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
    openRef.current = false
    tooltipRef.current?.remove()
    tooltipRef.current = null
  }

  useEffect(() => {
    const reposition = (): void => {
      if (!openRef.current) return
      const element = tooltipRef.current
      const target = buttonRef.current
      if (element === null || target === null) return
      const rect = target.getBoundingClientRect()
      element.style.left = `${Math.round(rect.right + 10)}px`
      element.style.top = `${Math.round(rect.top + rect.height / 2)}px`
    }
    const guard = (): void => {
      if (!openRef.current) return
      const target = buttonRef.current
      if (target === null || target.getClientRects().length === 0) hideTooltip()
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    document.addEventListener('pointerdown', hideTooltip, true)
    window.addEventListener('blur', hideTooltip)
    const guardTimer = window.setInterval(guard, 200)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      document.removeEventListener('pointerdown', hideTooltip, true)
      window.removeEventListener('blur', hideTooltip)
      window.clearInterval(guardTimer)
      if (showTimerRef.current !== null) clearTimeout(showTimerRef.current)
      tooltipRef.current?.remove()
      tooltipRef.current = null
    }
  }, [])

  // One identical download glyph for both instances; only the seat size
  // differs (28px wide / 36px rail).
  const icon = (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2.25v7.5" />
      <path d="m4.75 6.75 3.25 3.25 3.25-3.25" />
      <path d="M2.5 11.75v1.5a.75.75 0 0 0 .75.75h9.5a.75.75 0 0 0 .75-.75v-1.5" />
    </svg>
  )

  console.log('SidebarUpdateButton state:', state)
  // Nothing to update: do not render a misleading affordance.
  if (state === 'hidden') return null

  return (
    <button
      ref={buttonRef}
      type="button"
      className="oh-dsh-sidebar-update-entry"
      data-oh-dsh-sidebar-update="true"
      data-update-mode={state}
      aria-label={label()}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltipImmediately}
      onBlur={hideTooltip}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }}
      onClick={openUpdater}
    >
      {icon}
    </button>
  )
}

interface SidebarLogoRowAnchor {
  logoRow: HTMLElement
  toggleHost: HTMLElement
}

/**
 * Locate the upstream ui-sidebar shell's logo row inside the desktop frame's
 * sidebar content. The slot renderer may insert wrapper layers between the
 * content host and the shell column, so depth-based descent is unreliable;
 * scan instead for the logo row by shape: a small control row (never the
 * last row of its column) whose trailing element is — or contains — a button
 * (the collapse toggle). Document order makes the first match the top logo
 * row, which precedes the New Session / workspace / footer rows.
 */
function findSidebarLogoRow(content: HTMLElement): SidebarLogoRowAnchor | null {
  for (const row of content.querySelectorAll('div')) {
    const parent = row.parentElement
    if (parent === null || parent === content) continue
    if (parent.lastElementChild === row) continue
    const toggleHost = row.lastElementChild
    if (toggleHost === null) continue
    if (toggleHost.tagName !== 'BUTTON' && toggleHost.querySelector('button') === null) continue
    if (row.childElementCount > 3 || parent.childElementCount < 2) continue
    return { logoRow: row as HTMLElement, toggleHost: toggleHost as HTMLElement }
  }
  return null
}

function mountEntry(
  t: Translate<UpdateButtonMessage>,
  ui: UpdateUiStore,
): () => void {
  let style: HTMLStyleElement | null = null
  let content: HTMLElement | null = null
  let anchor: SidebarLogoRowAnchor | null = null
  let wideHost: HTMLDivElement | null = null
  let railHost: HTMLDivElement | null = null
  let wideRoot: Root | null = null
  let railRoot: Root | null = null
  let queued = false
  let disposed = false
  const FOLD_MS = 160
  const timers: Array<ReturnType<typeof setTimeout>> = []
  let prevCollapsed: boolean | null = null
  const createHost = (seat: 'wide' | 'rail'): { host: HTMLDivElement; root: Root } => {
    const host = document.createElement('div')
    host.className = `oh-dsh-sidebar-update-host oh-dsh-sidebar-update-host--${seat}`
    const root = createRoot(host)
    root.render(<SidebarUpdateButton t={t} ui={ui} />)
    return { host, root }
  }

  const wideEntry = (): Element | null => wideHost?.querySelector('[data-oh-dsh-sidebar-update]') ?? null
  const railEntry = (): Element | null => railHost?.querySelector('[data-oh-dsh-sidebar-update]') ?? null

  // On a live collapse the wide instance is hidden at once (the rail row fits
  // only the whale); an off-layout clone fades out at its old position so the
  // icon never disappears faster than the row content.
  const cloneFadeOut = (): void => {
    const entry = wideEntry()
    if (entry === null || wideHost === null) return
    const rect = entry.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const clone = document.createElement('div')
    clone.className = 'oh-dsh-sidebar-update-fade-clone'
    clone.style.left = `${Math.round(rect.left)}px`
    clone.style.top = `${Math.round(rect.top)}px`
    clone.style.width = `${Math.round(rect.width)}px`
    clone.style.height = `${Math.round(rect.height)}px`
    clone.style.color = getComputedStyle(entry).color
    clone.innerHTML = entry.innerHTML
    document.body.append(clone)
    requestAnimationFrame(() => { clone.style.opacity = '0' })
    timers.push(setTimeout(() => { clone.remove() }, FOLD_MS + 20))
  }

  const onFold = (collapsed: boolean): void => {
    if (prevCollapsed === collapsed) return
    prevCollapsed = collapsed
    // Ensure the rail instance exists for this state before animating it.
    load()
    if (collapsed) {
      cloneFadeOut()
      // Restart the rail slide-in (CSS delay + forwards fill handles the wait
      // and the hidden paint); the instance is never visible outside it.
      const entry = railEntry()
      if (entry !== null) {
        entry.setAttribute('style', '')
        entry.classList.remove('oh-dsh-sidebar-update-rail-enter')
      }
      timers.push(setTimeout(() => {
        if (disposed) return
        railEntry()?.classList.add('oh-dsh-sidebar-update-rail-enter')
      }, 0))
    } else {
      // Expanded: the rail instance is hidden by CSS; clear its entry class
      // so the next collapse restarts the slide-in cleanly.
      const entry = railEntry()
      if (entry !== null) {
        entry.setAttribute('style', '')
        entry.classList.remove('oh-dsh-sidebar-update-rail-enter')
      }
    }
  }

  const load = (): void => {
    content = document.querySelector<HTMLElement>('.oh-dsh-desktop-frame-sidebar-content')
    if (content === null) {
      anchor = null
      return
    }
    anchor = findSidebarLogoRow(content)
    if (anchor === null) return
    const column = anchor.logoRow.parentElement
    if (column === null) return
    // Rail host: its own row directly below the whale row (never inside it),
    // like the upstream New Session row.
    if (railHost === null || !railHost.isConnected) {
      if (railHost !== null) railRoot?.unmount()
      const created = createHost('rail')
      railHost = created.host
      railRoot = created.root
      column.insertBefore(railHost, anchor.logoRow.nextElementSibling)
      // A cold/late-mount while already collapsed must show statically (no
      // entry animation); a live fold clears this inline style right after.
      if (prevCollapsed === true) {
        railHost.querySelector('[data-oh-dsh-sidebar-update]')
          ?.setAttribute('style', 'opacity:1')
      }
    }
    // The brand button exists when the row contains a button that is neither
    // the collapse toggle (last child) nor our own loaded host — the row head
    // may be our host in the wrong order, so head-checking alone is unsafe.
    const rowAnchor = anchor
    const isBrandButton = (candidate: Element): boolean => {
      if (candidate.tagName !== 'BUTTON') return false
      if (candidate === rowAnchor.toggleHost || rowAnchor.toggleHost.contains(candidate)) return false
      if (wideHost !== null && wideHost.contains(candidate)) return false
      return true
    }
    const rowButtons = Array.from(rowAnchor.logoRow.querySelectorAll('button'))
    const brandPresent = rowButtons.some(isBrandButton)
    if (brandPresent && (wideHost === null || !wideHost.isConnected)) {
      if (wideHost !== null) wideRoot?.unmount()
      const created = createHost('wide')
      wideHost = created.host
      wideRoot = created.root
      rowAnchor.logoRow.insertBefore(wideHost, rowAnchor.toggleHost)
    }
    // Order guard: a fold that remounts the brand button around an already
    // loaded wide host can leave the icon at the head of the row (in front of
    // the logo). Only when the order is wrong do we move the host back
    // between brand and collapse; loaded hosts are otherwise never moved.
    if (wideHost !== null && wideHost.isConnected && brandPresent) {
      const row = rowAnchor.logoRow
      if (row.firstElementChild === wideHost) {
        row.insertBefore(wideHost, rowAnchor.toggleHost)
      }
    }
  }

  style = document.createElement('style')
  style.dataset.ohDshSidebarUpdateStyles = 'true'
  style.textContent = updateButtonCss
  document.head.append(style)

  load()
  const coldFrame = document.querySelector<HTMLElement>('.oh-dsh-desktop-frame')
  prevCollapsed = coldFrame?.hasAttribute('data-sidebar-collapsed') === true

  const observer = new MutationObserver(records => {
    const foldChanged = records.some(record => record.type === 'attributes')
    if (foldChanged) {
      const current = document.querySelector<HTMLElement>('.oh-dsh-desktop-frame')
      onFold(current?.hasAttribute('data-sidebar-collapsed') === true)
    }
    if (queued) return
    queued = true
    setTimeout(() => {
      queued = false
      if (!disposed) load()
    }, 0)
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-sidebar-collapsed'],
  })

  return () => {
    disposed = true
    observer.disconnect()
    for (const timer of timers) clearTimeout(timer)
    timers.length = 0
    wideRoot?.unmount()
    wideRoot = null
    wideHost?.remove()
    wideHost = null
    railRoot?.unmount()
    railRoot = null
    railHost?.remove()
    railHost = null
    style?.remove()
    style = null
  }
}

export const inject = ['locale']

export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const t: Translate<UpdateButtonMessage> = locale.bind('oh-dsh.update-button')
  const ui = createUpdateUiStore()
  ctx.effect(
    () => locale.register('oh-dsh.update-button', UPDATE_BUTTON_MESSAGES),
    'oh-dsh-update-button: dictionaries',
  )
  ctx.effect(() => {
    const bridge = (window as unknown as { dshDesktop?: DesktopBridge }).dshDesktop
    const stopMount = mountEntry(t, ui)
    let stopBridge: (() => void) | undefined
    const cleanup = (): void => {
      stopBridge?.()
      stopMount()
    }
    const applySnapshot = (snapshot: AboutUpdateSnapshot): void => {
      ui.set(updateUiFromSnapshot(snapshot))
    }
    if (bridge !== undefined && bridge.aboutUpdate !== undefined) {
      stopBridge = bridge.aboutUpdate.onState(applySnapshot)
      void bridge.aboutUpdate.getSnapshot().then(applySnapshot).catch(() => {})
    }
    return cleanup
  }, 'oh-dsh-update-button: entry and update state')
}
