import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DesktopBridge } from '../../../../src/contracts.ts'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import {
  createMarketplaceHttpBridge,
  waitForMarketplaceRestart,
} from './http.ts'
import { localeTag } from '../../../shared/i18n.ts'
import { useTranslate } from '../../../shared/use-i18n.ts'
import type {
  MarketplaceCommand,
  MarketplaceConfirmation,
  MarketplacePlugin,
  MarketplaceRiskReason,
  MarketplaceSnapshot,
  PluginMarketplaceBridge,
  MarketplaceSurfaceSupport,
} from '../protocol.ts'
import { MARKETPLACE_MESSAGES, type MarketplaceMessage } from './i18n.ts'
import {
  formatMarketplaceDate,
  marketplaceRepositoryStats,
} from './repository-metadata.ts'
import marketplaceCss from './marketplace.css'
import {
  initialSessionNavigationState,
  transitionSessionNavigation,
  type SessionListSnapshot,
  type SessionNavigationState,
} from './session-navigation.ts'

const BUILTIN_CATEGORY_FILTER = '__oh_dsh_builtin__'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

/** A synchronously reserved tab that can navigate once a preview is ready. */
interface MarketplacePreviewReservation {
  navigate(url: string): void
}

/** Browser UI carrier: Electron IPC on desktop, HTTP on the Web shell. */
interface MarketplaceClientBridge {
  kind: 'desktop' | 'web'
  openExternal(url: string): Promise<void> | void
  pluginMarketplace: PluginMarketplaceBridge
  reservePreview(): MarketplacePreviewReservation | null
}

function httpMarketplaceBridge(): PluginMarketplaceBridge {
  return createMarketplaceHttpBridge('/oh-dsh/plugin-marketplace')
}

/** Keep preview runtimes free of their own nested marketplace transaction. */
function isMarketplacePreviewWindow(): boolean {
  return new URLSearchParams(window.location.search).has('oh-dsh-marketplace-preview')
}

function resolveClientBridge(): MarketplaceClientBridge | null {
  if (isMarketplacePreviewWindow()) return null
  const desktop = window.dshDesktop
  if (desktop?.pluginMarketplace !== undefined) {
    return {
      kind: 'desktop',
      openExternal: url => desktop.openExternal(url),
      pluginMarketplace: desktop.pluginMarketplace,
      reservePreview: () => null,
    }
  }
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return {
      kind: 'web',
      openExternal: (url) => {
        window.open(url, '_blank', 'noopener,noreferrer')
      },
      pluginMarketplace: httpMarketplaceBridge(),
      reservePreview: () => {
        const tab = window.open('about:blank', '_blank', 'noopener,noreferrer')
        if (tab === null) return null
        return {
          navigate: url => {
            if (tab.closed) window.open(url, '_blank', 'noopener,noreferrer')
            else tab.location.replace(url)
          },
        }
      },
    }
  }
  return null
}

function surfaceSupportLabel(
  plugin: MarketplacePlugin,
  t: Translate<MarketplaceMessage>,
): string {
  const surfaces: MarketplaceSurfaceSupport = plugin.surfaces
  if (surfaces.declared === false) return t('surfaces.assumed-all')
  const names = (['desktop', 'web', 'tui'] as const)
    .filter(kind => surfaces[kind])
    .map(kind => t(`surfaces.${kind}`))
  if (names.length === 3) return t('surfaces.all')
  if (names.length === 0) return t('surfaces.none')
  return names.join(' · ')
}

interface MarketplaceViewState {
  available: boolean
  open: boolean
}

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionsService {
  list: ObservableSnapshot<SessionListSnapshot>
}

interface MarketplaceNavigationProps {
  locale: LocaleService
  t: Translate<MarketplaceMessage>
  view: PluginMarketplaceView
  wide: boolean
}

interface SlotsService {
  inject(name: string, register: () => unknown): void
  register(options: {
    id: string
    inject(): Omit<MarketplaceNavigationProps, 'wide'>
    locale: string
    name: string
    order: number
  }, component: (props: MarketplaceNavigationProps) => JSX.Element | null): unknown
}

export interface PluginMarketplaceView {
  getSnapshot(): MarketplaceViewState
  isOpen(): boolean
  setOpen(open: boolean): void
  subscribe(listener: () => void): () => void
  toggle(): void
}

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}

export const inject = ['locale', 'sessions', 'slots']

const OPEN_KEY = 'oh-dsh-desktop.plugin-marketplace.open'

const FOOTER_STACK_ATTRIBUTE = 'data-oh-dsh-marketplace-footer-stack'

function readOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === 'true' } catch { return false }
}

function persistOpen(open: boolean): void {
  try { localStorage.setItem(OPEN_KEY, String(open)) } catch { /* best effort */ }
}

function settingsButton(measure = true): HTMLButtonElement | null {
  const sidebar = document.querySelector<HTMLElement>('[data-slot="sidebar"]')
  const candidates = sidebar === null
    ? [...document.querySelectorAll<HTMLButtonElement>('button')]
      .filter(button => button.closest('#oh-dsh-plugin-marketplace-root') === null)
    : [...sidebar.querySelectorAll<HTMLButtonElement>('button')]
  const rects = new WeakMap<HTMLButtonElement, DOMRect>()
  const rectFor = (button: HTMLButtonElement): DOMRect => {
    const cached = rects.get(button)
    if (cached !== undefined) return cached
    const rect = button.getBoundingClientRect()
    rects.set(button, rect)
    return rect
  }
  const visible = (button: HTMLButtonElement): boolean => {
    if (!measure) return true
    const rect = rectFor(button)
    return rect.width > 0 && rect.height > 0
  }
  const byBottom = (left: HTMLButtonElement, right: HTMLButtonElement): number =>
    measure ? rectFor(right).bottom - rectFor(left).bottom : 0
  // rc.5 wraps the trigger content in a stable slot marker; the rail trigger
  // is the one inside the sidebar (the open settings panel may render a copy).
  const slotted = candidates
    .find(button => button.querySelector('[data-slot="settings.trigger"]') !== null
      && button.closest('[data-slot="sidebar"]') !== null
      && visible(button))
  if (slotted !== undefined) return slotted
  const labeled = candidates
    .filter(button => {
      if (!visible(button)) return false
      const label = [
        button.textContent,
        button.getAttribute('aria-label'),
        button.getAttribute('title'),
      ].filter(Boolean).join(' ').trim().toLowerCase()
      return label.includes('settings') || label.includes('设置')
    })
  if (labeled.length > 0) return labeled.sort(byBottom)[0] ?? null
  // rc.5's collapsed rail renders the settings trigger as an icon-only
  // dialog-opener at the rail foot, with no accessible settings label.
  const railTriggers = candidates
    .filter(button => button.getAttribute('aria-haspopup') === 'dialog' && visible(button))
  return railTriggers.sort(byBottom)[0] ?? null
}

function settingsDialogOpen(): boolean {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
    .some(dialog => {
      const labelledBy = dialog.getAttribute('aria-labelledby')
      const label = [
        dialog.getAttribute('aria-label'),
        labelledBy === null ? null : document.getElementById(labelledBy)?.textContent,
        dialog.textContent?.slice(0, 80),
      ].filter(Boolean).join(' ').trim().toLowerCase()
      return label.includes('settings') || label.includes('设置')
    })
}

function marketplaceFooter(settings: HTMLElement): HTMLElement | null {
  const navigation = document.querySelector<HTMLElement>('.oh-marketplace-nav')
  if (navigation === null) return null
  let candidate = navigation.parentElement
  while (candidate !== null && candidate !== document.body) {
    if (candidate.contains(settings)) return candidate
    candidate = candidate.parentElement
  }
  return null
}

function sidebarFor(settings: HTMLElement): HTMLElement | null {
  const declared = document.querySelector<HTMLElement>('[data-slot="sidebar"]')
  if (declared !== null) return declared
  const aside = settings.closest<HTMLElement>('aside')
  if (aside !== null) return aside
  let candidate: HTMLElement | null = settings.parentElement
  let best: HTMLElement | null = candidate
  while (candidate !== null && candidate !== document.body) {
    const rect = candidate.getBoundingClientRect()
    if (rect.left <= 8 && rect.height > window.innerHeight * 0.55 && rect.width < window.innerWidth * 0.5) {
      best = candidate
    }
    candidate = candidate.parentElement
  }
  return best
}

/**
 * First descendant of the sidebar slot with a real box. rc.5 renders the
 * `[data-slot="sidebar"]` wrapper as `display: contents`, whose own rect is
 * always empty; the rail state must be read from the boxed child instead.
 */
function sidebarBox(sidebar: HTMLElement): HTMLElement | null {
  const stack: HTMLElement[] = [sidebar]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === undefined) break
    if (node !== sidebar) {
      const rect = node.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) return node
    }
    for (const child of [...node.children].reverse()) stack.push(child as HTMLElement)
  }
  return null
}

function PluginIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 5.3a7.5 7.5 0 1 0 9.9 2.1" />
      <path d="M15.7 3.4v4.8h4.8" />
      <circle cx="10" cy="11" r="1.7" />
      <path d="M11.5 12.2l2.8 2.3M7.8 15.8l2.3-2.9" />
    </svg>
  )
}

function MarketplaceNavigationEntry({
  locale,
  t,
  view,
  wide,
}: MarketplaceNavigationProps): JSX.Element | null {
  const state = useSyncExternalStore(view.subscribe, view.getSnapshot)
  const translate = useTranslate(locale, t)
  if (!state.available) return null
  const label = translate('plugins')
  return (
    <button
      aria-label={label}
      className="oh-marketplace-nav"
      data-active={String(state.open)}
      data-collapsed={String(!wide)}
      onClick={() => { view.toggle() }}
      type="button"
    >
      <PluginIcon />
      {wide && <span>{label}</span>}
    </button>
  )
}

class PluginMarketplaceViewService implements PluginMarketplaceView {
  readonly #bridge: MarketplaceClientBridge
  readonly #locale: LocaleService
  readonly #t: Translate<MarketplaceMessage>
  readonly #sessions: SessionsService
  readonly #listeners = new Set<() => void>()
  #state: MarketplaceViewState = { available: false, open: readOpen() }
  #element: HTMLDivElement | null = null
  #style: HTMLStyleElement | null = null
  #root: Root | null = null
  #observer: MutationObserver | null = null
  #resizeObserver: ResizeObserver | null = null
  #geometryFrame: number | null = null
  #footerStack: HTMLElement | null = null
  #unsubscribeSessions: (() => void) | null = null
  #sessionNavigationState: SessionNavigationState = initialSessionNavigationState()
  readonly #handleResize = (): void => { this.scheduleGeometry() }
  readonly #handleDocumentClick = (event: MouseEvent): void => {
    if (!this.#state.open || !(event.target instanceof Element)) return
    const button = event.target.closest('button')
    if (button !== null && button === settingsButton()) this.setOpen(false)
  }

  constructor(
    bridge: MarketplaceClientBridge,
    locale: LocaleService,
    t: Translate<MarketplaceMessage>,
    sessions: SessionsService,
  ) {
    this.#bridge = bridge
    this.#locale = locale
    this.#t = t
    this.#sessions = sessions
  }

  getSnapshot = (): MarketplaceViewState => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  isOpen(): boolean { return this.#state.open }

  setOpen(open: boolean): void {
    if (this.#state.open === open) return
    this.#state = { ...this.#state, open }
    persistOpen(open)
    this.applyOpenState()
    if (open) this.scheduleGeometry()
    for (const listener of this.#listeners) listener()
  }

  toggle(): void { this.setOpen(!this.#state.open) }

  mount(): void {
    this.#sessionNavigationState = initialSessionNavigationState()
    this.#style = document.createElement('style')
    this.#style.dataset.ohDshPluginMarketplaceStyles = 'true'
    this.#style.textContent = marketplaceCss
    document.head.append(this.#style)

    this.#element = document.createElement('div')
    this.#element.id = 'oh-dsh-plugin-marketplace-root'
    document.body.append(this.#element)
    this.#root = createRoot(this.#element)
    this.#root.render(
      <MarketplaceSurface
        bridge={this.#bridge}
        locale={this.#locale}
        translate={this.#t}
        view={this}
      />,
    )

    this.#state = { ...this.#state, available: true }
    for (const listener of this.#listeners) listener()

    this.#observer = new MutationObserver(() => {
      this.synchronizeFooterStack()
      if (this.#state.open && settingsDialogOpen()) this.setOpen(false)
      this.scheduleGeometry()
    })
    this.#observer.observe(document.body, { childList: true, subtree: true })
    this.#resizeObserver = new ResizeObserver(() => { this.scheduleGeometry() })
    document.addEventListener('click', this.#handleDocumentClick, true)
    window.addEventListener('resize', this.#handleResize)
    const syncSessionNavigation = (): void => {
      const transition = transitionSessionNavigation(
        this.#sessionNavigationState,
        this.#sessions.list.getSnapshot(),
      )
      this.#sessionNavigationState = transition.state
      if (transition.close) this.setOpen(false)
    }
    this.#unsubscribeSessions = this.#sessions.list.subscribe(syncSessionNavigation)
    syncSessionNavigation()
    this.applyOpenState()
    this.scheduleGeometry()
  }

  dispose(): void {
    document.removeEventListener('click', this.#handleDocumentClick, true)
    window.removeEventListener('resize', this.#handleResize)
    this.#unsubscribeSessions?.()
    this.#unsubscribeSessions = null
    if (this.#geometryFrame !== null) cancelAnimationFrame(this.#geometryFrame)
    this.#observer?.disconnect()
    this.#resizeObserver?.disconnect()
    this.#root?.unmount()
    this.#footerStack?.removeAttribute(FOOTER_STACK_ATTRIBUTE)
    this.#footerStack = null
    this.#element?.remove()
    this.#style?.remove()
    this.#state = { available: false, open: false }
    for (const listener of this.#listeners) listener()
    delete document.documentElement.dataset.ohDshMarketplaceOpen
    document.documentElement.style.removeProperty('--oh-marketplace-left')
  }

  private applyOpenState(): void {
    if (this.#state.open) document.documentElement.dataset.ohDshMarketplaceOpen = 'true'
    else delete document.documentElement.dataset.ohDshMarketplaceOpen
  }

  private scheduleGeometry(): void {
    if (!this.#state.open) return
    if (this.#geometryFrame !== null) return
    this.#geometryFrame = requestAnimationFrame(() => {
      this.#geometryFrame = null
      if (!this.#state.open) return
      this.synchronizeGeometry()
    })
  }

  private synchronizeGeometry(): void {
    const declared = document.querySelector<HTMLElement>('[data-slot="sidebar"]')
    this.synchronizeFooterStack()
    const settings = settingsButton()
    const sidebar = declared ?? (settings === null ? null : sidebarFor(settings))
    if (sidebar === null) {
      document.documentElement.style.setProperty('--oh-marketplace-left', '0px')
      return
    }
    const box = sidebarBox(sidebar) ?? sidebar
    this.#resizeObserver?.disconnect()
    this.#resizeObserver?.observe(box)
    const rect = box.getBoundingClientRect()
    const left = rect.right > 0 && rect.right < window.innerWidth * 0.55 ? rect.right : 0
    document.documentElement.style.setProperty('--oh-marketplace-left', `${String(Math.round(left))}px`)
  }

  private synchronizeFooterStack(): void {
    const settings = settingsButton(false)
    const footerStack = settings === null ? null : marketplaceFooter(settings)
    if (footerStack === this.#footerStack) return
    this.#footerStack?.removeAttribute(FOOTER_STACK_ATTRIBUTE)
    footerStack?.setAttribute(FOOTER_STACK_ATTRIBUTE, 'true')
    this.#footerStack = footerStack
  }
}

function SearchIcon(): JSX.Element {
  return <svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
}

function shortCommit(commit: string): string {
  return commit.slice(0, 10)
}

function mechanismLabel(
  plugin: MarketplacePlugin,
  t: Translate<MarketplaceMessage>,
): string {
  return t(`mechanism.${plugin.mechanism}`)
}

function presentationInstalled(plugin: MarketplacePlugin): boolean {
  return plugin.installed || plugin.builtin
}

function runtimeRiskLabel(
  plugin: MarketplacePlugin,
  t: Translate<MarketplaceMessage>,
): string {
  return t(`risk.${plugin.runtimeRisk}`)
}

function riskReasonLabel(
  reason: MarketplaceRiskReason,
  t: Translate<MarketplaceMessage>,
): string {
  return t(`risk-reason.${reason}`)
}

function confirmationLabel(
  confirmation: MarketplaceConfirmation,
  t: Translate<MarketplaceMessage>,
): string {
  if (confirmation === 'allow-build-scripts') return t('allow-scripts')
  if (confirmation === 'accept-unsandboxed-build') return t('accept-unsandboxed-build')
  if (confirmation === 'accept-high-risk') return t('accept-high-risk')
  return t('accept-source-change')
}

function PluginCard({
  plugin,
  selected,
  select,
  t,
}: {
  plugin: MarketplacePlugin
  selected: boolean
  select(): void
  t: Translate<MarketplaceMessage>
}): JSX.Element {
  const installed = presentationInstalled(plugin)
  return (
    <button
      className="oh-marketplace-card"
      data-selected={String(selected)}
      onClick={select}
      type="button"
    >
      <div className="oh-marketplace-card-top">
        <span className="oh-marketplace-card-icon">{plugin.title.slice(0, 1)}</span>
        <div style={{ minWidth: 0 }}>
          <h2>{plugin.title}</h2>
          <div className="oh-marketplace-card-category">{plugin.category}</div>
        </div>
      </div>
      <p className="oh-marketplace-card-description">{plugin.description}</p>
      {plugin.stats !== null && (
        <div className="oh-marketplace-card-stats" aria-label={t('github-stats')}>
          {marketplaceRepositoryStats(plugin).map(stat => <span key={stat}>{stat}</span>)}
        </div>
      )}
      <div className="oh-marketplace-card-footer">
        <span
          className="oh-marketplace-pill"
          data-unsupported={String(plugin.mechanism === 'unsupported')}
        >
          {mechanismLabel(plugin, t)}
        </span>
        {installed && (
          <span className="oh-marketplace-pill" data-installed="true">
            {t('installed')}
          </span>
        )}
        {plugin.installed && !plugin.builtin && (
          <span className="oh-marketplace-pill" data-installed={String(plugin.enabled)}>
            {plugin.enabled ? t('enabled') : t('disabled')}
          </span>
        )}
        {!plugin.builtin && plugin.updateAvailable && (
          <span className="oh-marketplace-pill" data-update="true">
            {t('update-available')}
          </span>
        )}
        {plugin.protected && (
          <span className="oh-marketplace-pill" data-protected="true">
            {t('managed')}
          </span>
        )}
        <span className="oh-marketplace-pill" data-surfaces="true">
          {surfaceSupportLabel(plugin, t)}
        </span>
      </div>
    </button>
  )
}

function PluginDetail({
  bridge,
  pending,
  plugin,
  snapshot,
  locale,
  t,
  close,
  reservePreview,
  run,
}: {
  bridge: MarketplaceClientBridge
  pending: boolean
  plugin: MarketplacePlugin
  snapshot: MarketplaceSnapshot
  locale: LocaleService
  t: Translate<MarketplaceMessage>
  close(): void
  reservePreview?(): void
  run(command: MarketplaceCommand): Promise<void>
}): JSX.Element {
  const [confirmations, setConfirmations] = useState<MarketplaceConfirmation[]>([])
  const plan = snapshot.plan?.pluginId === plugin.id ? snapshot.plan : null
  const hasScripts = plan !== null && Object.keys(plan.buildScripts).length > 0
  const readyToPreview = plan !== null
    && plan.requirements.every(requirement => confirmations.includes(requirement))
  useEffect(() => {
    setConfirmations([])
  }, [plugin.id, plan?.resolvedCommit, plan?.manifestHash, plan?.action])
  const setConfirmed = (
    confirmation: MarketplaceConfirmation,
    confirmed: boolean,
  ): void => {
    setConfirmations(current => confirmed
      ? [...new Set([...current, confirmation])]
      : current.filter(entry => entry !== confirmation))
  }
  return (
    <aside
      className="oh-marketplace-detail"
      aria-label={t('details', { plugin: plugin.title })}
    >
      <div className="oh-marketplace-detail-inner">
        <button className="oh-marketplace-icon-button oh-marketplace-detail-close" onClick={close} type="button">×</button>
        <h2>{plugin.title}</h2>
        <span className="oh-marketplace-pill" data-installed={String(presentationInstalled(plugin))}>
          {plugin.builtin ? t('builtin') : plugin.installed ? t('installed') : mechanismLabel(plugin, t)}
        </span>
        <p className="oh-marketplace-detail-description">{plugin.description}</p>
        <dl className="oh-marketplace-facts">
          <dt>{t('category')}</dt><dd>{plugin.category}</dd>
          <dt>{t('mechanism')}</dt><dd>{mechanismLabel(plugin, t)}</dd>
          <dt>{t('updated')}</dt>
          <dd>{formatMarketplaceDate(plugin.stats?.updatedAt ?? plugin.pushedAt, localeTag(locale), t('unknown'))}</dd>
          <dt>{t('stars')}</dt><dd>{plugin.stats?.stars ?? t('unknown')}</dd>
          <dt>{t('forks')}</dt><dd>{plugin.stats?.forks ?? t('unknown')}</dd>
          <dt>{t('open-issues')}</dt><dd>{plugin.stats?.openIssues ?? t('unknown')}</dd>
          <dt>{t('language')}</dt><dd>{plugin.stats?.language ?? t('unknown')}</dd>
          <dt>{t('license')}</dt><dd>{plugin.stats?.license ?? t('unknown')}</dd>
          <dt>{t('surfaces')}</dt><dd>{surfaceSupportLabel(plugin, t)}</dd>
          <dt>{t('repository')}</dt><dd>{plugin.url.replace('https://github.com/', '')}</dd>
          <dt>{t('trust')}</dt><dd>{t(`trust.${plugin.trust}`)}</dd>
          <dt>{t('runtime-boundary')}</dt><dd>{runtimeRiskLabel(plugin, t)}</dd>
          {plugin.currentCommit !== null && (
            <><dt>{t('current-commit')}</dt><dd>{shortCommit(plugin.currentCommit)}</dd></>
          )}
          {plugin.latestCommit !== null && (
            <><dt>{t('latest-commit')}</dt><dd>{shortCommit(plugin.latestCommit)}</dd></>
          )}
        </dl>

        {plan !== null && (
          <section className="oh-marketplace-plan">
            <div className="oh-marketplace-flow" aria-label={t('prepared-plan', { action: t(`action.${plan.action}`) })}>
              <span data-active="true">1 · {t('flow.review')}</span>
              <span data-active={String(snapshot.preview !== null)}>2 · {t('flow.preview')}</span>
              <span>3 · {t('flow.apply')}</span>
            </div>
            <h3>{t('prepared-plan', { action: t(`action.${plan.action}`) })}</h3>
            <div className="oh-marketplace-plan-risk" data-risk={plan.riskLevel}>
              <strong>{t('risk-level')}: {t(`risk-level.${plan.riskLevel}`)}</strong>
              <span>{t('source-review')}: {t(`source-review.${plan.sourceReview}`)}</span>
            </div>
            {plan.riskReasons.length > 0 && (
              <ul className="oh-marketplace-risk-reasons">
                {plan.riskReasons.map(reason => (
                  <li key={reason}>{riskReasonLabel(reason, t)}</li>
                ))}
              </ul>
            )}
            <code>{plan.source}</code>
            <code>{t('commit', { commit: shortCommit(plan.resolvedCommit) })}</code>
            {plan.packageName !== null && (
              <code>{t('package', { package: plan.packageName })}</code>
            )}
            {hasScripts && (
              <code>{Object.entries(plan.buildScripts).map(([name, script]) => `${name}: ${script}`).join('\n')}</code>
            )}
            {plan.requirements.map(requirement => (
              <label className="oh-marketplace-confirm" key={requirement}>
                  <input
                    checked={confirmations.includes(requirement)}
                    onChange={event => { setConfirmed(requirement, event.target.checked) }}
                    type="checkbox"
                  />
                  <span>{confirmationLabel(requirement, t)}</span>
              </label>
            ))}
            <p className="oh-marketplace-recovery-note">{t('recovery-note')}</p>
          </section>
        )}

        <div className="oh-marketplace-detail-actions">
          {plugin.mechanism === 'unsupported' || plugin.protected ? (
            <button className="oh-marketplace-button" onClick={() => { void bridge.openExternal(plugin.url) }} type="button">
              {t('open-repository')}
            </button>
          ) : plan === null ? (
            <>
              {!plugin.installed && (
                <button
                  className="oh-marketplace-button"
                  data-primary="true"
                  disabled={pending}
                  onClick={() => { void run({
                    type: 'prepare',
                    action: 'install',
                    pluginId: plugin.id,
                  }) }}
                  type="button"
                >
                  {t('preview.install')}
                </button>
              )}
              {plugin.installed && plugin.updateAvailable && (
                <button
                  className="oh-marketplace-button"
                  data-primary="true"
                  disabled={pending}
                  onClick={() => { void run({
                    type: 'prepare',
                    action: 'update',
                    pluginId: plugin.id,
                  }) }}
                  type="button"
                >
                  {t('preview.update')}
                </button>
              )}
              {plugin.installed && (
                <button
                  className="oh-marketplace-button"
                  disabled={pending}
                  onClick={() => { void run({
                    type: 'prepare',
                    action: plugin.enabled ? 'disable' : 'enable',
                    pluginId: plugin.id,
                  }) }}
                  type="button"
                >
                  {plugin.enabled ? t('preview.disable') : t('preview.enable')}
                </button>
              )}
              {plugin.installed && (
                <button
                  className="oh-marketplace-button"
                  data-danger="true"
                  disabled={pending}
                  onClick={() => { void run({
                    type: 'prepare',
                    action: 'uninstall',
                    pluginId: plugin.id,
                  }) }}
                  type="button"
                >
                  {t('preview.uninstall')}
                </button>
              )}
            </>
          ) : snapshot.preview === null ? (
            <button
              className="oh-marketplace-button"
              data-primary="true"
              disabled={pending || !readyToPreview}
              onClick={() => {
                reservePreview?.()
                void run({ type: 'preview', confirmations })
              }}
              type="button"
            >
              {t('preview.launch')}
            </button>
          ) : null}
          <button className="oh-marketplace-button" onClick={() => { void bridge.openExternal(plugin.url) }} type="button">
            {t('view-source')}
          </button>
        </div>
      </div>
    </aside>
  )
}

function localizedAuthDetail(
  detail: string,
  t: Translate<MarketplaceMessage>,
): string {
  if (detail.startsWith('Install GitHub CLI')) return t('auth.install-gh')
  if (detail === 'Authenticated with GitHub CLI.') return t('auth.ready')
  if (detail === 'Plugin catalog has not been refreshed yet.') {
    return t('auth.not-refreshed')
  }
  return detail
}

function localizedHostMessage(
  message: string,
  t: Translate<MarketplaceMessage>,
): string {
  let match = /^Loaded (\d+) catalog plugins\.$/.exec(message)
  if (match !== null) return t('notice.loaded', { count: match[1] })
  match = /^Isolated (install|update|enable|disable|uninstall) preview is ready for (.+)\.$/.exec(message)
  if (match !== null) {
    const action = t(`action.${match[1] as 'install' | 'update' | 'enable' | 'disable' | 'uninstall'}`)
    return t('notice.preview-ready', { action, plugin: match[2] })
  }
  match = /^(install|update|enable|disable|uninstall) preview is ready for (.+) without process isolation\.$/.exec(message)
  if (match !== null) {
    const action = t(`action.${match[1] as 'install' | 'update' | 'enable' | 'disable' | 'uninstall'}`)
    return t('notice.preview-ready-unisolated', { action, plugin: match[2] })
  }
  match = /^Discarded the (.+) preview without changing the profile\.$/.exec(message)
  if (match !== null) return t('notice.discarded', { plugin: match[1] })
  match = /^Applied (.+); the previous profile remains available for Undo\.$/.exec(message)
  if (match !== null) return t('notice.applied', { plugin: match[1] })
  match = /^Restored the profile from before (.+) was applied\.$/.exec(message)
  if (match !== null) return t('notice.restored', { plugin: match[1] })
  return message
}

function MarketplaceSurface({ bridge, locale, translate, view }: {
  bridge: MarketplaceClientBridge
  locale: LocaleService
  translate: Translate<MarketplaceMessage>
  view: PluginMarketplaceViewService
}): JSX.Element {
  const t = useTranslate(locale, translate)
  const viewState = useSyncExternalStore(view.subscribe, view.getSnapshot)
  const [snapshot, setSnapshot] = useState<MarketplaceSnapshot | null>(null)
  const [pending, setPending] = useState(true)
  const [localError, setLocalError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'installed' | 'available' | 'updates' | 'disabled'
  >('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [showBuiltins, setShowBuiltins] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const openedPreviewRef = useRef<string | null>(null)
  const previewReservationRef = useRef<MarketplacePreviewReservation | null>(null)
  const requestedStatsRef = useRef(new Set<string>())

  const run = useCallback(async (command: MarketplaceCommand): Promise<void> => {
    setPending(true)
    setLocalError(null)
    try {
      const snapshot = await bridge.pluginMarketplace.dispatch(command)
      setSnapshot(snapshot)
      if (bridge.kind === 'web' && command.type === 'preview') {
        const previewUrl = snapshot.preview?.previewUrl
        if (previewUrl !== null && previewUrl !== undefined) {
          openedPreviewRef.current = snapshot.preview?.transactionId ?? openedPreviewRef.current
          const reservation = previewReservationRef.current ?? bridge.reservePreview()
          previewReservationRef.current = null
          if (reservation === null) {
            window.open(previewUrl, '_blank', 'noopener,noreferrer')
          } else {
            reservation.navigate(previewUrl)
          }
        }
      }
      if (bridge.kind === 'web' && (command.type === 'apply' || command.type === 'undo')) {
        void waitForMarketplaceRestart('/oh-dsh/plugin-marketplace').then(() => {
          window.location.reload()
        })
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }, [bridge])

  useEffect(() => {
    let alive = true
    setPending(true)
    setLocalError(null)
    void bridge.pluginMarketplace.getSnapshot().then(initial => {
      if (!alive) return
      setSnapshot(initial)
      return bridge.pluginMarketplace.dispatch({ type: 'refresh' })
    }).then(refreshed => {
      if (alive && refreshed !== undefined) setSnapshot(refreshed)
    }).catch((error: unknown) => {
      if (alive) setLocalError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (alive) setPending(false)
    })
    return () => { alive = false }
  }, [bridge])

  const visibleCatalog = useMemo(
    () => (snapshot?.catalog ?? []).filter(plugin => showBuiltins || !plugin.builtin),
    [showBuiltins, snapshot?.catalog],
  )
  const categories = useMemo(() => {
    return [...new Set(visibleCatalog.map(plugin => plugin.category))].sort()
  }, [visibleCatalog])
  const statusCounts = useMemo(() => {
    const installed = visibleCatalog.filter(presentationInstalled).length
    return {
      all: visibleCatalog.length,
      available: visibleCatalog.length - installed,
      disabled: visibleCatalog.filter(plugin => !plugin.builtin
        && plugin.installed && !plugin.enabled).length,
      installed,
      updates: visibleCatalog.filter(plugin => !plugin.builtin && plugin.updateAvailable).length,
    }
  }, [visibleCatalog])
  const plugins = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return visibleCatalog.filter(plugin => {
      const installed = presentationInstalled(plugin)
      if (statusFilter === 'installed' && !installed) return false
      if (statusFilter === 'available' && installed) return false
      if (statusFilter === 'updates' && (plugin.builtin || !plugin.updateAvailable)) return false
      if (statusFilter === 'disabled'
        && (plugin.builtin || !plugin.installed || plugin.enabled)) return false
      if (categoryFilter === BUILTIN_CATEGORY_FILTER && !plugin.builtin) return false
      if (categoryFilter !== 'all'
        && categoryFilter !== BUILTIN_CATEGORY_FILTER
        && plugin.category !== categoryFilter) return false
      return needle === '' || [plugin.title, plugin.description, plugin.category, ...plugin.tags]
        .some(value => value.toLowerCase().includes(needle))
    })
  }, [categoryFilter, search, statusFilter, visibleCatalog])
  const selected = plugins.find(plugin => plugin.id === selectedId) ?? null
  const error = localError ?? snapshot?.error ?? null

  useEffect(() => {
    if (selectedId === null || snapshot === null) return
    const plugin = snapshot.catalog.find(candidate => candidate.id === selectedId)
    if (plugin === undefined || plugin.stats !== null || requestedStatsRef.current.has(selectedId)) return
    requestedStatsRef.current.add(selectedId)
    void run({ type: 'load-repository-stats', pluginId: selectedId })
  }, [run, selectedId, snapshot?.catalog])
  const resetView = (): void => {
    setSearch('')
    setStatusFilter('all')
    setCategoryFilter('all')
    setSelectedId(null)
  }
  useEffect(() => {
    if (viewState.open) {
      requestedStatsRef.current.clear()
      resetView()
    }
  }, [viewState.open])

  useEffect(() => {
    const preview = snapshot?.preview
    if (preview === null || preview === undefined || preview.previewUrl === null) return
    if (openedPreviewRef.current === preview.transactionId) return
    openedPreviewRef.current = preview.transactionId
    if (bridge.kind === 'web') {
      bridge.reservePreview()?.navigate(preview.previewUrl)
    }
  }, [bridge, snapshot?.preview])

  return (
    <div className="oh-marketplace-surface" data-open={String(viewState.open)} aria-hidden={!viewState.open}>
      <div className="oh-marketplace-app">
        <div>
          <header className="oh-marketplace-header">
            <div className="oh-marketplace-heading">
              <h1>{t('plugins')}</h1>
              <p>{t('subtitle')}</p>
            </div>
            <div className="oh-marketplace-header-actions">
              {snapshot?.undoAvailable === true && (
                <button className="oh-marketplace-button" disabled={pending} onClick={() => { void run({ type: 'undo' }) }} type="button">
                  {t('undo-last-apply')}
                </button>
              )}
              <button className="oh-marketplace-button" disabled={pending} onClick={() => { void run({ type: 'refresh', force: true }) }} type="button">
                {pending ? t('working') : t('refresh')}
              </button>
              <button
                className="oh-marketplace-icon-button"
                onClick={() => { view.setOpen(false) }}
                title={t('close')}
                type="button"
              >×</button>
            </div>
          </header>
          {snapshot?.preview !== null && snapshot?.preview !== undefined && (
            <div className="oh-marketplace-preview-banner">
              <strong>{t(snapshot.preview.isolated === false ? 'preview.running-unisolated' : 'preview.running', { plugin: snapshot.preview.pluginId })}</strong>
              <button className="oh-marketplace-button" disabled={pending} onClick={() => { void run({ type: 'discard' }) }} type="button">
                {t('discard')}
              </button>
              <button className="oh-marketplace-button" data-primary="true" disabled={pending} onClick={() => { void run({ type: 'apply' }) }} type="button">
                {t('apply-action', { action: t(`action.${snapshot.preview.action}`) })}
              </button>
            </div>
          )}
          {error !== null && (
            <div className="oh-marketplace-error">
              <span>{error}</span>
              <button
                className="oh-marketplace-button"
                disabled={pending}
                onClick={() => { resetView(); void run({ type: 'refresh', force: true }) }}
                type="button"
              >
                {t('reset-and-reload')}
              </button>
            </div>
          )}
          {snapshot?.lastAction !== null && snapshot?.lastAction !== undefined && error === null && (
            <div className="oh-marketplace-notice">
              {localizedHostMessage(snapshot.lastAction, t)}
            </div>
          )}
        </div>
        <div className="oh-marketplace-layout" data-detail={String(selected !== null)}>
          <main className="oh-marketplace-main">
            <div className="oh-marketplace-toolbar">
              <div className="oh-marketplace-search">
                <SearchIcon />
                <input
                  aria-label={t('search.label')}
                  onChange={event => { setSearch(event.target.value) }}
                  placeholder={t('search.placeholder')}
                  value={search}
                />
                {search !== '' && (
                  <button aria-label={t('search.clear')} onClick={() => { setSearch('') }} type="button">×</button>
                )}
              </div>
              <div className="oh-marketplace-status-tabs" role="group" aria-label={t('installation-status')}>
                {([
                  ['all', t('all')],
                  ['installed', t('installed')],
                  ['available', t('not-installed')],
                  ['updates', t('updates')],
                  ['disabled', t('disabled')],
                ] as const).map(([value, label]) => (
                  <button
                    data-active={String(statusFilter === value)}
                    key={value}
                    onClick={() => { setStatusFilter(value) }}
                    type="button"
                  >
                    {label}<span>{statusCounts[value]}</span>
                  </button>
                ))}
              </div>
              <select
                aria-label={t('plugin-category')}
                className="oh-marketplace-filter"
                onChange={event => { setCategoryFilter(event.target.value) }}
                value={categoryFilter}
              >
                <option value="all">{t('all-categories')}</option>
                {showBuiltins && visibleCatalog.some(plugin => plugin.builtin) && (
                  <option value={BUILTIN_CATEGORY_FILTER}>{t('builtin')}</option>
                )}
                {categories.map(category => <option key={category} value={category}>{category}</option>)}
              </select>
              <label className="oh-marketplace-filter oh-marketplace-builtin-toggle">
                <input
                  aria-label={t('show-builtins')}
                  checked={showBuiltins}
                  onChange={event => {
                    const checked = event.target.checked
                    setShowBuiltins(checked)
                    if (!checked) {
                      const remainingCategories = new Set((snapshot?.catalog ?? [])
                        .filter(plugin => !plugin.builtin)
                        .map(plugin => plugin.category))
                      if (categoryFilter !== 'all' && !remainingCategories.has(categoryFilter)) {
                        setCategoryFilter('all')
                      }
                      if (snapshot?.catalog.some(plugin => (
                        plugin.id === selectedId && plugin.builtin
                      )) === true) setSelectedId(null)
                    }
                  }}
                  type="checkbox"
                />
                <span>{t('show-builtins')}</span>
              </label>
              <span className="oh-marketplace-count">
                {t('plugin-count', { count: plugins.length })}
              </span>
            </div>
            {snapshot === null || pending && snapshot.catalog.length === 0 ? (
              <div className="oh-marketplace-empty">{t('loading-catalog')}</div>
            ) : snapshot.auth.status !== 'ready' && snapshot.catalog.length === 0 ? (
              <div className="oh-marketplace-empty">
                <div>
                  <strong>{t('github-auth-required')}</strong><br />
                  {localizedAuthDetail(snapshot.auth.detail, t)}
                </div>
              </div>
            ) : plugins.length === 0 ? (
              <div className="oh-marketplace-empty">{t('no-match')}</div>
            ) : (
              <div className="oh-marketplace-grid">
                {plugins.map(plugin => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    selected={selectedId === plugin.id}
                    select={() => { setSelectedId(plugin.id) }}
                    t={t}
                  />
                ))}
              </div>
            )}
          </main>
          {selected !== null && snapshot !== null && (
            <PluginDetail
              bridge={bridge}
              pending={pending}
              plugin={selected}
              snapshot={snapshot}
              locale={locale}
              t={t}
              close={() => { setSelectedId(null) }}
              reservePreview={() => {
                previewReservationRef.current = bridge.reservePreview()
              }}
              run={run}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  const bridge = resolveClientBridge()
  if (bridge === null) {
    console.info('plugin-marketplace: skipped, no desktop or web bridge is available')
    return
  }
  const locale = ctx.get('locale') as LocaleService
  const sessions = ctx.get('sessions') as SessionsService
  const slots = ctx.get('slots') as SlotsService
  const t: Translate<MarketplaceMessage> = locale.bind('oh-dsh.plugin-marketplace')
  const view = new PluginMarketplaceViewService(bridge, locale, t, sessions)
  ctx.effect(
    () => locale.register('oh-dsh.plugin-marketplace', MARKETPLACE_MESSAGES),
    'oh-dsh-plugin-marketplace: dictionaries',
  )
  slots.inject('sidebar.footer.action', () => slots.register({
    name: 'sidebar.footer.action',
    id: 'oh-dsh-plugin-marketplace',
    order: 80,
    locale: 'oh-dsh.plugin-marketplace',
    inject: () => ({ locale, t, view }),
  }, MarketplaceNavigationEntry))
  ctx.effect(() => {
    let disposed = false
    let disposeProvider: (() => Promise<void> | void) | void
    const mount = (): void => {
      if (disposed) return
      view.mount()
      disposeProvider = ctx.reflect.provide('pluginMarketplace', view, undefined)
    }
    if (bridge.kind === 'web') {
      mount()
    } else {
      void window.dshDesktop?.getInfo().then(info => {
        if (disposed || info.preview !== null) return
        mount()
      }).catch((error: unknown) => {
        console.error('plugin-marketplace: failed to inspect the desktop window', error)
      })
    }
    return () => {
      disposed = true
      view.dispose()
      if (typeof disposeProvider === 'function') void disposeProvider()
    }
  }, 'oh-dsh-plugin-marketplace: client surface')
}
