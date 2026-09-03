/** Browser face for the native Oh-DSH Desktop bridge. */

import { DESKTOP_TITLEBAR_HEIGHT, type DesktopBridge, type DesktopCommand } from './contracts.ts'
import type { DesktopPanels } from '../plugins/panel-controls/src/client.ts'
import type { PinnedSummary } from '../plugins/pinned-summary/src/client.ts'
import type { WorkspaceTools } from '../plugins/sidebar/src/client.ts'
import type {
  LocaleMessages,
  LocaleService,
  Translate,
} from '../plugins/shared/i18n.ts'
import {
  OH_DSH_SURFACE_VIEW_SERVICE,
  type OhDshSurfaceView,
} from '../plugins/shared/surface.ts'

interface WorkspaceView {
  workspaceId: string
}

interface WorkspacesService {
  create(input: { path: string }): Promise<WorkspaceView>
  startSession(workspaceId?: string): void
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: { provide(name: string, value: unknown, options?: unknown): void }
}

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}

const DESKTOP_CHROME_CSS = `
/* Every desktop surface publishes the chrome row height. macOS and Windows
   spend it on the in-page title bar; framed platforms spend it inside the
   frame, where the floating panel toolbar lives. */
html[data-oh-dsh-desktop='true'] {
  --oh-dsh-titlebar-height: ${DESKTOP_TITLEBAR_HEIGHT}px;
}

html[data-oh-dsh-desktop-platform='darwin'] body,
html[data-oh-dsh-desktop-platform='win32'] body {
  box-sizing: border-box;
  padding-top: var(--oh-dsh-titlebar-height);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  overflow: hidden;
}

html[data-oh-dsh-desktop-platform='darwin'] body::before,
html[data-oh-dsh-desktop-platform='win32'] body::before {
  content: '';
  position: fixed;
  z-index: 2147483645;
  top: 0;
  right: 0;
  left: 0;
  height: var(--oh-dsh-titlebar-height);
  background: var(--dsw-specific-sidebar-fill);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  pointer-events: none;
  user-select: none;
}

html[data-oh-dsh-desktop-platform='darwin'] .oh-dsh-titlebar-drag-region {
  position: fixed;
  z-index: 2147483646;
  top: 0;
  left: 88px;
  right: 112px;
  height: var(--oh-dsh-titlebar-height);
  user-select: none;
  -webkit-app-region: drag;
}

html[data-oh-dsh-desktop-platform='darwin'] .oh-dsh-panel-toolbar,
html[data-oh-dsh-desktop-platform='win32'] .oh-dsh-panel-toolbar {
  z-index: 2147483647;
  top: 4px;
  padding: 1px;
  -webkit-app-region: no-drag;
}

html[data-oh-dsh-desktop-platform='darwin'] .oh-dsh-panel-toolbar button,
html[data-oh-dsh-desktop-platform='win32'] .oh-dsh-panel-toolbar button {
  width: 28px;
  height: 28px;
}

html[data-oh-dsh-desktop-platform='darwin'] .oh-dsh-panel-toolbar {
  right: 8px;
}

/* Keep the panel toolbar clear of the Windows window actions. */
html[data-oh-dsh-desktop-platform='win32'] .oh-dsh-panel-toolbar {
  right: 154px;
}

/* In-page menu bar: fills the blank strip corner on Windows with the real
   application menu, popped up natively at the button. */
html[data-oh-dsh-desktop='true'] .oh-dsh-menubar {
  position: fixed;
  z-index: 2147483646;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  align-items: stretch;
  height: var(--oh-dsh-titlebar-height);
  padding-left: 12px;
  box-sizing: border-box;
  -webkit-app-region: no-drag;
}

html[data-oh-dsh-desktop='true'] .oh-dsh-menubar::before {
  content: '';
  position: absolute;
  z-index: 0;
  top: 0;
  right: 270px;
  bottom: 0;
  left: 0;
  -webkit-app-region: drag;
}

html[data-oh-dsh-desktop='true'] .oh-dsh-menubar button {
  -webkit-app-region: no-drag;
  height: calc(var(--oh-dsh-titlebar-height) - 10px);
  margin: 5px 0;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #1f2328);
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: 13px;
  font-weight: 450;
  letter-spacing: 0;
  line-height: calc(var(--oh-dsh-titlebar-height) - 10px);
}

html[data-oh-dsh-desktop='true'] .oh-dsh-menubar button:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 6%));
}

html[data-oh-dsh-desktop='true'] .oh-dsh-menubar-items {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: stretch;
  gap: 3px;
  height: var(--oh-dsh-titlebar-height);
}

html[data-oh-dsh-desktop='true'] .oh-dsh-menubar-brand {
  display: grid;
  place-items: center;
  width: 40px;
  height: var(--oh-dsh-titlebar-height);
  margin: 0 10px 0 0;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
}

html[data-oh-dsh-desktop='true'] .oh-dsh-menubar-brand img {
  width: 20px;
  height: 20px;
  object-fit: contain;
  filter: brightness(0);
  opacity: 0.72;
}

/* Match the app logo's resolved theme instead of forcing the whale to black. */
html[data-oh-dsh-desktop='true'] body[data-ds-dark-theme] .oh-dsh-menubar-brand img {
  filter: brightness(0) invert(1);
  opacity: 0.9;
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: stretch;
  height: var(--oh-dsh-titlebar-height);
  margin-left: auto;
  -webkit-app-region: no-drag;
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button {
  position: relative;
  width: 46px;
  height: var(--oh-dsh-titlebar-height);
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button[data-action='close']:hover {
  background: #c42b3c;
  color: #fff;
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button::before,
html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button::after {
  position: absolute;
  content: '';
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button[data-action='minimize']::before {
  top: 50%;
  left: 18px;
  width: 10px;
  border-top: 1.7px solid currentColor;
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button[data-action='maximize']::before {
  top: calc(50% - 5px);
  left: 18px;
  width: 10px;
  height: 10px;
  border: 1.7px solid currentColor;
  border-radius: 2px;
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button[data-action='maximize'][data-maximized='true']::before {
  top: calc(50% - 6px);
  left: 19px;
  width: 8px;
  height: 8px;
  border: 1.7px solid currentColor;
  border-radius: 2px;
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button[data-action='maximize']::after {
  display: none;
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button[data-action='maximize'][data-maximized='true']::after {
  top: calc(50% - 3px);
  left: 16px;
  display: block;
  width: 8px;
  height: 8px;
  border: 1.7px solid currentColor;
  border-radius: 1px;
  background: var(--dsw-specific-sidebar-fill);
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button[data-action='close']::before,
html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button[data-action='close']::after {
  top: 50%;
  left: 18px;
  width: 10px;
  border-top: 1.7px solid currentColor;
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button[data-action='close']::before {
  transform: rotate(45deg);
}

html[data-oh-dsh-desktop='true'] .oh-dsh-window-actions button[data-action='close']::after {
  transform: rotate(-45deg);
}

html[data-oh-dsh-preview='true'] body::after {
  content: attr(data-oh-dsh-preview-label);
  position: fixed;
  z-index: 2147483647;
  top: 7px;
  left: 50%;
  max-width: 52vw;
  padding: 4px 11px;
  overflow: hidden;
  border: 1px solid #a9c2f5;
  border-radius: 999px;
  background: #edf3ff;
  color: #28549f;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  pointer-events: none;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  white-space: nowrap;
}

html[data-oh-dsh-desktop='true'] #root:has(
  [role='presentation'] > [role='dialog']
) {
  z-index: 1000 !important;
  overflow: visible !important;
}

html[data-oh-dsh-desktop='true'] #root [role='presentation']:has(
  > [role='dialog']
) {
  z-index: 1000 !important;
  background: rgb(0 0 0 / 22%) !important;
  -webkit-backdrop-filter: blur(6px) saturate(0.9);
  backdrop-filter: blur(6px) saturate(0.9);
}

html[data-oh-dsh-desktop='true']:has(
  #root [role='presentation'] > [role='dialog']
) body::before,
html[data-oh-dsh-desktop='true']:has(
  #root [role='presentation'] > [role='dialog']
) body::after,
html[data-oh-dsh-desktop='true']:has(
  #root [role='presentation'] > [role='dialog']
) .oh-dsh-panel-toolbar,
html[data-oh-dsh-desktop='true']:has(
  #root [role='presentation'] > [role='dialog']
) #oh-dsh-sidebar-root,
html[data-oh-dsh-desktop='true']:has(
  #root [role='presentation'] > [role='dialog']
) [data-oh-dsh-pinned-summary],
html[data-oh-dsh-desktop='true']:has(
  #root [role='presentation'] > [role='dialog']
) #oh-dsh-plugin-marketplace-root {
  z-index: 999 !important;
}

html[data-oh-dsh-desktop='true']:has(
  #root [role='presentation'] > [role='dialog']
) #oh-dsh-plugin-marketplace-root {
  position: relative;
}

/* Portal overlays that hand the document a bare top-level dialog own their
   own fixed chrome, and pinned upstream UI parks its lightbox close button
   20px below the viewport top — inside the in-page titlebar row this surface
   reserves on macOS and Windows, where the opaque strip paints over anything
   below its z-index and half the control disappears. Structure, not classes:
   the pinned runtime is hashed per build, so the contract is "a body-level
   modal dialog's direct close button". macOS shares the reserved row; Linux
   keeps its native frame and Web never loads the chrome stylesheet.

   The lightbox backdrop keeps upstream's 40px gutter width but restores
   its symmetry below the reserved row: uniform 40px on all four sides,
   laid out inside the region under the strip (the strip replaces the top
   gutter the viewport used to provide), and the image's own 100vh-based
   ceiling shrinks by the titlebar and the gutters so tall previews never
   re-overflow behind the strip. The close button rides the same gutter
   grid at its corner. Upstream styles load after this sheet and win ties
   at equal specificity, so the rules carry !important — the same
   authority the sheet's dialog demotion rules already rely on. */
html[data-oh-dsh-desktop-platform='darwin'] body > [role='dialog'][aria-modal='true'],
html[data-oh-dsh-desktop-platform='win32'] body > [role='dialog'][aria-modal='true'] {
  top: var(--oh-dsh-titlebar-height, 40px) !important;
  padding: 40px !important;
}

html[data-oh-dsh-desktop-platform='darwin'] body > [role='dialog'][aria-modal='true'] > img,
html[data-oh-dsh-desktop-platform='win32'] body > [role='dialog'][aria-modal='true'] > img {
  max-height: calc(100vh - var(--oh-dsh-titlebar-height, 40px) - 80px) !important;
}

html[data-oh-dsh-desktop-platform='darwin'] body > [role='dialog'][aria-modal='true'] > button,
html[data-oh-dsh-desktop-platform='win32'] body > [role='dialog'][aria-modal='true'] > button {
  top: calc(var(--oh-dsh-titlebar-height, 40px) + 8px) !important;
  right: 8px !important;
}

`

/** Wait for the DSH services used by native menu commands. */
export const inject = ['locale', 'workspaces', 'desktopPanels', 'pinnedSummary', 'workspaceTools']

type DesktopShellMessage =
  | 'menubar.label'
  | 'preview.label'
  | 'window.close'
  | 'window.maximize'
  | 'window.minimize'
  | 'window.restore'

const DESKTOP_SHELL_MESSAGES: LocaleMessages<DesktopShellMessage> = {
  en: {
    'menubar.label': 'Application menu',
    'preview.label': 'Isolated plugin preview · {plugin}',
    'window.close': 'Close window',
    'window.maximize': 'Maximize window',
    'window.minimize': 'Minimize window',
    'window.restore': 'Restore window',
  },
  zh: {
    'menubar.label': '应用菜单',
    'preview.label': '隔离插件预览 · {plugin}',
    'window.close': '关闭窗口',
    'window.maximize': '最大化窗口',
    'window.minimize': '最小化窗口',
    'window.restore': '还原窗口',
  },
}

function installDesktopChrome(platform: NodeJS.Platform): () => void {
  const originalTitle = document.title
  const style = document.createElement('style')
  style.dataset.ohDshDesktopChrome = 'true'
  style.textContent = DESKTOP_CHROME_CSS
  document.head.append(style)
  document.documentElement.dataset.ohDshDesktop = 'true'
  document.documentElement.dataset.ohDshDesktopPlatform = platform
  let dragRegion: HTMLDivElement | undefined
  if (platform === 'darwin') {
    dragRegion = document.createElement('div')
    dragRegion.className = 'oh-dsh-titlebar-drag-region'
    dragRegion.setAttribute('aria-hidden', 'true')
    document.body.append(dragRegion)
  }
  document.title = 'Oh-DSH Desktop'
  return () => {
    dragRegion?.remove()
    style.remove()
    delete document.documentElement.dataset.ohDshDesktop
    delete document.documentElement.dataset.ohDshDesktopPlatform
    document.title = originalTitle
  }
}

/**
 * Windows only: render the application menu's top-level labels inside the
 * merged titlebar row. Buttons pop up the native submenu, so menu items,
 * roles, and accelerators keep their single owner in the main process.
 */
function installMenuBar(
  bridge: DesktopBridge,
  locale: LocaleService,
  t: Translate<DesktopShellMessage>,
  includeMenu: boolean,
): () => void {
  const bar = document.createElement('nav')
  bar.className = 'oh-dsh-menubar'
  bar.setAttribute('aria-label', t('menubar.label'))
  const items = document.createElement('div')
  items.className = 'oh-dsh-menubar-items'
  const actions = document.createElement('div')
  actions.className = 'oh-dsh-window-actions'
  bar.append(items, actions)
  document.body.append(bar)

  const addAction = (action: string, label: string, callback: () => void): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.action = action
    button.setAttribute('aria-label', label)
    button.title = label
    button.addEventListener('click', callback)
    actions.append(button)
    return button
  }
  const minimize = addAction('minimize', t('window.minimize'), () => { void bridge.minimizeWindow() })
  const maximize = addAction('maximize', t('window.maximize'), () => {
    void bridge.toggleMaximizeWindow().then(value => {
      updateMaximizedState(value)
    })
  })
  const close = addAction('close', t('window.close'), () => { void bridge.closeWindow() })
  const updateWindowActionLabels = (): void => {
    minimize.title = t('window.minimize')
    minimize.setAttribute('aria-label', t('window.minimize'))
    const maximizeLabel = maximize.dataset.maximized === 'true' ? t('window.restore') : t('window.maximize')
    maximize.title = maximizeLabel
    maximize.setAttribute('aria-label', maximizeLabel)
    close.title = t('window.close')
    close.setAttribute('aria-label', t('window.close'))
  }
  let windowStateVersion = 0
  const updateMaximizedState = (value: boolean): void => {
    maximize.dataset.maximized = String(value)
    updateWindowActionLabels()
  }
  const unsubscribeWindowState = bridge.onWindowState(state => {
    windowStateVersion += 1
    updateMaximizedState(state.maximized)
  })
  const initialWindowStateVersion = windowStateVersion
  updateWindowActionLabels()
  void bridge.isWindowMaximized().then(value => {
    if (windowStateVersion !== initialWindowStateVersion) return
    updateMaximizedState(value)
  })
  bar.addEventListener('dblclick', event => {
    if (event.target instanceof HTMLButtonElement) return
    void bridge.toggleMaximizeWindow().then(value => {
      maximize.dataset.maximized = String(value)
      updateWindowActionLabels()
    })
  })

  let menuLabels: string[] = []
  let brand: HTMLButtonElement | undefined
  const renderMenuBar = (): void => {
    if (!bar.isConnected) return
    items.replaceChildren()
    if (brand !== undefined) {
      const productLabel = menuLabels[0]
      if (productLabel !== undefined) {
        brand.setAttribute('aria-label', productLabel)
        brand.title = productLabel
      }
      items.append(brand)
    }
    for (const [index, label] of menuLabels.entries()) {
      if (index === 0) continue
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.addEventListener('click', () => {
        const rect = button.getBoundingClientRect()
        void bridge.popupMenuBarMenu(index, rect.left, rect.bottom)
      })
      items.append(button)
    }
  }
  if (includeMenu) {
    void bridge.brandIconDataUrl().then(icon => {
      if (icon === null || !bar.isConnected) return
      brand = document.createElement('button')
      brand.className = 'oh-dsh-menubar-brand'
      brand.type = 'button'
      const image = document.createElement('img')
      image.alt = ''
      image.src = icon
      image.draggable = false
      brand.append(image)
      brand.addEventListener('click', () => {
        const rect = brand?.getBoundingClientRect()
        if (rect === undefined) return
        void bridge.popupMenuBarMenu(0, rect.left, rect.bottom)
      })
      renderMenuBar()
    })
  }
  let refreshToken = 0
  const refreshMenuBar = (): void => {
    const token = ++refreshToken
    updateWindowActionLabels()
    if (!includeMenu) return
    void bridge.setMenuLocale(locale.getSnapshot().active).then(labels => {
      if (token !== refreshToken || !bar.isConnected) return
      menuLabels = labels
      renderMenuBar()
    }).catch((error: unknown) => {
      console.error('oh-dsh-desktop: failed to synchronize menu locale', error)
    })
  }
  const unsubscribeLocale = locale.subscribe(refreshMenuBar)
  refreshMenuBar()
  return () => {
    unsubscribeWindowState()
    unsubscribeLocale()
    bar.remove()
  }
}

function installHeroBranding(): () => void {
  const headlineCopy = new Set(['Into the Unknown', '探索未知之境', '探索未至之境'])
  const originalHeadlines = new Map<HTMLElement, string>()
  const synchronize = (): void => {
    for (const element of document.querySelectorAll<HTMLElement>('span')) {
      const text = element.textContent?.trim() ?? ''
      if (!headlineCopy.has(text)) continue
      if (!originalHeadlines.has(element)) originalHeadlines.set(element, text)
      element.textContent = 'Oh-DSH Desktop'
      element.dataset.ohDshHeroHeadline = 'true'
    }
  }
  const observer = new MutationObserver(synchronize)
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })
  synchronize()
  return () => {
    observer.disconnect()
    for (const [element, original] of originalHeadlines) {
      if (element.isConnected && element.textContent === 'Oh-DSH Desktop') element.textContent = original
      delete element.dataset.ohDshHeroHeadline
    }
  }
}

function focusComposer(): void {
  document.querySelector<HTMLTextAreaElement>('textarea')?.focus()
}

function findSettingsButton(): HTMLButtonElement | undefined {
  // rc.5 wraps the settings trigger content in a stable slot marker; the rail
  // trigger is the one inside the sidebar (the settings panel may render one).
  const slotted = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.querySelector('[data-slot="settings.trigger"]') !== null
      && button.closest('[data-slot="sidebar"]') !== null)
  if (slotted !== undefined) return slotted
  const labeled = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => /settings|设置/i.test([
      button.textContent,
      button.getAttribute('aria-label'),
      button.getAttribute('title'),
    ].filter(Boolean).join(' ')))
  if (labeled !== undefined) return labeled
  // rc.5 collapsed rail: the settings trigger is an icon-only dialog opener.
  return [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')]
    .filter(button => button.closest('[data-slot="sidebar"]') !== null)
    .sort((left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom)[0]
}

function showSettings(): void {
  findSettingsButton()?.click()
}

/** Select the settings nav entry whose label matches, e.g. the About page. */
function selectSettingsSection(pattern: RegExp): boolean {
  const dialog = document.querySelector<HTMLDivElement>('[role="dialog"][aria-modal="true"]')
  const nav = dialog?.querySelector('nav')
  if (nav === null || nav === undefined) return false
  const cell = [...nav.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => pattern.test([
      button.textContent,
      button.getAttribute('aria-label'),
      button.getAttribute('title'),
    ].filter(Boolean).join(' ')))
  if (cell === undefined) return false
  cell.click()
  return true
}

function showAbout(): void {
  // The About nav lives inside the settings panel, so open the dialog first.
  // Clicking the trigger when the dialog is already open would close it, so
  // only click while it is closed.
  const dialogOpen = () => document.querySelector('[role="dialog"][aria-modal="true"]') !== null
  if (!dialogOpen()) {
    findSettingsButton()?.click()
  }
  // The panel and its nav mount on React's next commit after the trigger
  // click (or after the settings plugin boots), so poll across frames until
  // the nav renders, then select About. A timeout keeps an early menu click
  // from looping forever if the settings trigger never appears.
  const started = performance.now()
  const attempt = (): void => {
    if (selectSettingsSection(/about|关于/i)) return
    if (performance.now() - started < 2_000) {
      requestAnimationFrame(attempt)
    }
  }
  attempt()
}

async function openPaths(workspaces: WorkspacesService, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const workspace = await workspaces.create({ path })
    workspaces.startSession(workspace.workspaceId)
  }
}

function dispatch(
  command: DesktopCommand,
  workspaces: WorkspacesService,
  panels: DesktopPanels,
  pinnedSummary: PinnedSummary,
  workspaceTools: WorkspaceTools,
): void {
  switch (command.type) {
    case 'focus-composer':
      focusComposer()
      return
    case 'new-session':
      workspaces.startSession()
      return
    case 'open-paths':
      void openPaths(workspaces, command.paths).catch((error: unknown) => {
        console.error('oh-dsh-desktop: failed to open workspace', error)
      })
      return
    case 'show-settings':
      showSettings()
      return
    case 'show-about':
      showAbout()
      return
    case 'toggle-sidebar':
      panels.toggleSidebar()
      return
    case 'toggle-bottom-panel':
      panels.toggleBottomPanel()
      return
    case 'toggle-panel-maximized':
      workspaceTools.togglePanelMaximized()
      return
    case 'toggle-pinned-summary':
      workspaceTools.setOpen(false)
      pinnedSummary.toggle()
      return
    case 'toggle-workspace-panel':
      workspaceTools.toggle()
      return
    case 'toggle-side-panel':
      workspaceTools.toggleSidePanel()
      return
    case 'open-browser':
      workspaceTools.openBrowser()
      return
    case 'open-files':
      workspaceTools.openFiles()
      return
    case 'open-review':
      workspaceTools.openReview()
      return
    case 'open-side-chat':
      void workspaceTools.openSideChat().catch((error: unknown) => {
        console.error('oh-dsh-desktop: failed to open side chat', error)
      })
      return
    case 'open-trajectory':
      workspaceTools.openTrajectory()
      return
    default:
      command satisfies never
  }
}

/** Enroll the isolated Electron bridge and map native actions to DSH services. */
export function apply(ctx: ClientContext): void {
  const bridge = window.dshDesktop
  if (bridge === undefined) {
    throw new Error('oh-dsh-desktop: preload bridge is unavailable outside Oh-DSH Desktop')
  }
  const workspaces = ctx.get('workspaces') as WorkspacesService
  const locale = ctx.get('locale') as LocaleService
  const t: Translate<DesktopShellMessage> = locale.bind('oh-dsh.desktop')
  const panels = ctx.get('desktopPanels') as DesktopPanels
  const pinnedSummary = ctx.get('pinnedSummary') as PinnedSummary
  const workspaceTools = ctx.get('workspaceTools') as WorkspaceTools
  ctx.effect(
    () => locale.register('oh-dsh.desktop', DESKTOP_SHELL_MESSAGES),
    'oh-dsh-desktop: shell dictionaries',
  )
  ctx.reflect.provide('desktopShell', bridge, undefined)
  // The unified three-surface contract, client plane: the desktop shell.
  ctx.reflect.provide(OH_DSH_SURFACE_VIEW_SERVICE, Object.freeze({
    kind: 'desktop',
  } satisfies OhDshSurfaceView), undefined)
  ctx.effect(() => {
    let disposed = false
    let previewPluginId: string | null = null
    const renderPreviewLabel = (): void => {
      if (previewPluginId === null) return
      document.body.dataset.ohDshPreviewLabel = t('preview.label', {
        plugin: previewPluginId,
      })
    }
    const removeDesktopChrome = installDesktopChrome(bridge.platform)
    const removeHeroBranding = installHeroBranding()
    const unsubscribeLocale = locale.subscribe(renderPreviewLabel)
    let removeMenuBar: (() => void) | undefined
    void bridge.getInfo().then(info => {
      if (disposed) return
      if (info.platform === 'win32') removeMenuBar = installMenuBar(bridge, locale, t, info.preview === null)
      if (info.preview === null) return
      previewPluginId = info.preview.pluginId
      document.documentElement.dataset.ohDshPreview = 'true'
      renderPreviewLabel()
    }).catch((error: unknown) => {
      console.error('oh-dsh-desktop: failed to read desktop info', error)
    })
    const unsubscribe = bridge.onCommand((command) => {
      dispatch(command, workspaces, panels, pinnedSummary, workspaceTools)
    })
    return () => {
      disposed = true
      unsubscribe()
      removeMenuBar?.()
      unsubscribeLocale()
      removeHeroBranding()
      removeDesktopChrome()
      delete document.documentElement.dataset.ohDshPreview
      delete document.body.dataset.ohDshPreviewLabel
    }
  }, 'oh-dsh-desktop: native command bridge')
}
