import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DesktopBridge } from '../../../../src/contracts.ts'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import { localeTag } from '../../../shared/i18n.ts'
import { useTranslate } from '../../../shared/use-i18n.ts'
import type {
  MarketplaceCommand,
  MarketplaceConfirmation,
  MarketplacePlugin,
  MarketplaceRiskReason,
  MarketplaceSnapshot,
} from '../protocol.ts'
import { MARKETPLACE_MESSAGES, type MarketplaceMessage } from './i18n.ts'
import marketplaceCss from './marketplace.css'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

interface MarketplaceViewState {
  open: boolean
}

export interface PluginMarketplaceView {
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

export const inject = ['locale']

const OPEN_KEY = 'oh-dsh-desktop.plugin-marketplace.open'
const SIDEBAR_BOTTOM_INSET = 8

function readOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === 'true' } catch { return false }
}

function persistOpen(open: boolean): void {
  try { localStorage.setItem(OPEN_KEY, String(open)) } catch { /* best effort */ }
}

function settingsButton(): HTMLButtonElement | null {
  const visible = (button: HTMLButtonElement): boolean => {
    const rect = button.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }
  const byBottom = (left: HTMLButtonElement, right: HTMLButtonElement): number =>
    right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom
  // rc.5 wraps the trigger content in a stable slot marker; the rail trigger
  // is the one inside the sidebar (the open settings panel may render a copy).
  const slotted = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.querySelector('[data-slot="settings.trigger"]') !== null
      && button.closest('[data-slot="sidebar"]') !== null
      && visible(button))
  if (slotted !== undefined) return slotted
  const labeled = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .filter(button => {
      if (button.closest('#oh-dsh-plugin-marketplace-root') !== null) return false
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
  const railTriggers = [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')]
    .filter(button => button.closest('[data-slot="sidebar"]') !== null && visible(button))
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

function pluginIcon(label: string): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 5.3a7.5 7.5 0 1 0 9.9 2.1" />
      <path d="M15.7 3.4v4.8h4.8" />
      <circle cx="10" cy="11" r="1.7" />
      <path d="M11.5 12.2l2.8 2.3M7.8 15.8l2.3-2.9" />
    </svg>
    <span>${label}</span>
  `
}

class PluginMarketplaceViewService implements PluginMarketplaceView {
  readonly #bridge: DesktopBridge
  readonly #locale: LocaleService
  readonly #t: Translate<MarketplaceMessage>
  readonly #listeners = new Set<() => void>()
  #state: MarketplaceViewState = { open: readOpen() }
  #element: HTMLDivElement | null = null
  #style: HTMLStyleElement | null = null
  #root: Root | null = null
  #entry: HTMLButtonElement | null = null
  #entrySeat: HTMLDivElement | null = null
  #observer: MutationObserver | null = null
  #resizeObserver: ResizeObserver | null = null
  #placementFrame: number | null = null
  #sidebarRoot: HTMLElement | null = null
  #unsubscribeLocale: (() => void) | null = null
  readonly #handleResize = (): void => { this.schedulePlacement() }
  readonly #handleDocumentClick = (event: MouseEvent): void => {
    if (!this.#state.open || !(event.target instanceof Element)) return
    const button = event.target.closest('button')
    if (button !== null && button === settingsButton()) this.setOpen(false)
  }

  constructor(
    bridge: DesktopBridge,
    locale: LocaleService,
    t: Translate<MarketplaceMessage>,
  ) {
    this.#bridge = bridge
    this.#locale = locale
    this.#t = t
  }

  getSnapshot = (): MarketplaceViewState => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  isOpen(): boolean { return this.#state.open }

  setOpen(open: boolean): void {
    if (this.#state.open === open) return
    this.#state = { open }
    persistOpen(open)
    this.applyOpenState()
    for (const listener of this.#listeners) listener()
  }

  toggle(): void { this.setOpen(!this.#state.open) }

  mount(): void {
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

    this.#observer = new MutationObserver(() => {
      if (this.#state.open && settingsDialogOpen()) this.setOpen(false)
      this.schedulePlacement()
    })
    this.#observer.observe(document.body, { childList: true, subtree: true })
    this.#resizeObserver = new ResizeObserver(() => { this.schedulePlacement() })
    document.addEventListener('click', this.#handleDocumentClick, true)
    window.addEventListener('resize', this.#handleResize)
    this.#unsubscribeLocale = this.#locale.subscribe(() => {
      this.renderEntryLabel()
    })
    this.applyOpenState()
    this.schedulePlacement()
  }

  dispose(): void {
    document.removeEventListener('click', this.#handleDocumentClick, true)
    window.removeEventListener('resize', this.#handleResize)
    this.#unsubscribeLocale?.()
    this.#unsubscribeLocale = null
    if (this.#placementFrame !== null) cancelAnimationFrame(this.#placementFrame)
    this.#observer?.disconnect()
    this.#resizeObserver?.disconnect()
    this.#entrySeat?.remove()
    this.#root?.unmount()
    this.#element?.remove()
    this.#style?.remove()
    this.#sidebarRoot?.removeAttribute('data-oh-dsh-marketplace-sidebar-root')
    this.#sidebarRoot?.style.removeProperty('--oh-marketplace-sidebar-top')
    this.#sidebarRoot?.style.removeProperty('--oh-marketplace-sidebar-height')
    delete document.documentElement.dataset.ohDshMarketplaceOpen
    document.documentElement.style.removeProperty('--oh-marketplace-left')
  }

  private applyOpenState(): void {
    if (this.#state.open) document.documentElement.dataset.ohDshMarketplaceOpen = 'true'
    else delete document.documentElement.dataset.ohDshMarketplaceOpen
    if (this.#entry !== null) this.#entry.dataset.active = String(this.#state.open)
  }

  private schedulePlacement(): void {
    if (this.#placementFrame !== null) return
    this.#placementFrame = requestAnimationFrame(() => {
      this.#placementFrame = null
      this.placeEntry()
    })
  }

  private placeEntry(): void {
    const settings = settingsButton()
    if (settings === null) return
    const settingsSeat = settings.parentElement
    if (settingsSeat === null) return
    const sidebarRoot = settingsSeat.parentElement
    if (sidebarRoot === null) return
    if (this.#entry === null) {
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.dataset.active = String(this.#state.open)
      entry.addEventListener('click', () => { this.toggle() })
      this.#entry = entry
      this.renderEntryLabel()
    }
    if (this.#entrySeat === null) {
      this.#entrySeat = document.createElement('div')
      this.#entrySeat.dataset.ohDshMarketplaceNavSeat = 'true'
      this.#entrySeat.append(this.#entry)
    }
    // Mirror the settings trigger's classes so the entry tracks the rail's
    // collapsed/expanded layout state (rc.5 restyles rail buttons in place).
    this.#entry.className = `${settings.className} oh-marketplace-nav`.trim()
    this.#entrySeat.className = settingsSeat.className
    if (this.#entrySeat.parentElement !== sidebarRoot
      || this.#entrySeat.nextElementSibling !== settingsSeat) {
      sidebarRoot.insertBefore(this.#entrySeat, settingsSeat)
    }
    if (this.#sidebarRoot !== sidebarRoot) {
      this.#sidebarRoot?.removeAttribute('data-oh-dsh-marketplace-sidebar-root')
      this.#sidebarRoot?.style.removeProperty('--oh-marketplace-sidebar-top')
      this.#sidebarRoot?.style.removeProperty('--oh-marketplace-sidebar-height')
      this.#sidebarRoot = sidebarRoot
    }
    if (sidebarRoot !== null) {
      const top = Math.max(0, Math.round(sidebarRoot.getBoundingClientRect().top))
      const height = Math.max(0, window.innerHeight - top - SIDEBAR_BOTTOM_INSET)
      sidebarRoot.dataset.ohDshMarketplaceSidebarRoot = 'true'
      sidebarRoot.style.setProperty('--oh-marketplace-sidebar-top', `${String(top)}px`)
      sidebarRoot.style.setProperty('--oh-marketplace-sidebar-height', `${String(height)}px`)
    }
    const sidebar = sidebarFor(settings)
    if (sidebar === null) return
    this.#resizeObserver?.disconnect()
    this.#resizeObserver?.observe(sidebar)
    const box = sidebarBox(sidebar)
    const rect = box === null ? { right: 0, width: 0 } : box.getBoundingClientRect()
    const left = rect.right > 0 && rect.right < window.innerWidth * 0.55 ? rect.right : 0
    document.documentElement.style.setProperty('--oh-marketplace-left', `${String(Math.round(left))}px`)
    this.#entry.dataset.collapsed = String(rect.width < 100)
  }

  private renderEntryLabel(): void {
    if (this.#entry === null) return
    const label = this.#t('plugins')
    this.#entry.setAttribute('aria-label', label)
    this.#entry.innerHTML = pluginIcon(label)
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
      <div className="oh-marketplace-card-footer">
        <span
          className="oh-marketplace-pill"
          data-unsupported={String(plugin.mechanism === 'unsupported')}
        >
          {mechanismLabel(plugin, t)}
        </span>
        {plugin.installed && (
          <span className="oh-marketplace-pill" data-installed="true">
            {t('installed')}
          </span>
        )}
        {plugin.installed && (
          <span className="oh-marketplace-pill" data-installed={String(plugin.enabled)}>
            {plugin.enabled ? t('enabled') : t('disabled')}
          </span>
        )}
        {plugin.updateAvailable && (
          <span className="oh-marketplace-pill" data-update="true">
            {t('update-available')}
          </span>
        )}
        {plugin.protected && (
          <span className="oh-marketplace-pill" data-protected="true">
            {t('managed')}
          </span>
        )}
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
  run,
}: {
  bridge: DesktopBridge
  pending: boolean
  plugin: MarketplacePlugin
  snapshot: MarketplaceSnapshot
  locale: LocaleService
  t: Translate<MarketplaceMessage>
  close(): void
  run(command: MarketplaceCommand): Promise<void>
}): JSX.Element {
  const [confirmations, setConfirmations] = useState<MarketplaceConfirmation[]>([])
  const plan = snapshot.plan?.pluginId === plugin.id ? snapshot.plan : null
  const hasScripts = plan !== null && Object.keys(plan.buildScripts).length > 0
  const readyToPreview = plan !== null
    && plan.requirements.every(requirement => confirmations.includes(requirement))
  useEffect(() => { setConfirmations([]) }, [plugin.id, plan?.resolvedCommit])
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
        <span className="oh-marketplace-pill" data-installed={String(plugin.installed)}>
          {plugin.installed ? t('installed') : mechanismLabel(plugin, t)}
        </span>
        <p className="oh-marketplace-detail-description">{plugin.description}</p>
        <dl className="oh-marketplace-facts">
          <dt>{t('category')}</dt><dd>{plugin.category}</dd>
          <dt>{t('mechanism')}</dt><dd>{mechanismLabel(plugin, t)}</dd>
          <dt>{t('updated')}</dt>
          <dd>
            {plugin.pushedAt === null
              ? t('unknown')
              : new Date(plugin.pushedAt).toLocaleString(localeTag(locale))}
          </dd>
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
              onClick={() => { void run({ type: 'preview', confirmations }) }}
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
  match = /^Discarded the (.+) preview without changing the desktop profile\.$/.exec(message)
  if (match !== null) return t('notice.discarded', { plugin: match[1] })
  match = /^Applied (.+); the previous profile remains available for Undo\.$/.exec(message)
  if (match !== null) return t('notice.applied', { plugin: match[1] })
  match = /^Restored the profile from before (.+) was applied\.$/.exec(message)
  if (match !== null) return t('notice.restored', { plugin: match[1] })
  return message
}

function MarketplaceSurface({ bridge, locale, translate, view }: {
  bridge: DesktopBridge
  locale: LocaleService
  translate: Translate<MarketplaceMessage>
  view: PluginMarketplaceViewService
}): JSX.Element {
  const t = useTranslate(locale, translate)
  const viewState = useSyncExternalStore(view.subscribe, view.getSnapshot)
  const [snapshot, setSnapshot] = useState<MarketplaceSnapshot | null>(null)
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'installed' | 'available' | 'updates' | 'disabled'
  >('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const run = useCallback(async (command: MarketplaceCommand): Promise<void> => {
    setPending(true)
    setLocalError(null)
    try {
      setSnapshot(await bridge.pluginMarketplace.dispatch(command))
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }, [bridge])

  useEffect(() => {
    let alive = true
    void bridge.pluginMarketplace.getSnapshot().then(initial => {
      if (!alive) return
      setSnapshot(initial)
      return bridge.pluginMarketplace.dispatch({ type: 'refresh' })
    }).then(refreshed => {
      if (alive && refreshed !== undefined) setSnapshot(refreshed)
    }).catch((error: unknown) => {
      if (alive) setLocalError(error instanceof Error ? error.message : String(error))
    })
    return () => { alive = false }
  }, [bridge])

  const categories = useMemo(() => {
    return [...new Set(snapshot?.catalog.map(plugin => plugin.category) ?? [])].sort()
  }, [snapshot?.catalog])
  const statusCounts = useMemo(() => {
    const catalog = snapshot?.catalog ?? []
    const installed = catalog.filter(plugin => plugin.installed).length
    return {
      all: catalog.length,
      available: catalog.length - installed,
      disabled: catalog.filter(plugin => plugin.installed && !plugin.enabled).length,
      installed,
      updates: catalog.filter(plugin => plugin.updateAvailable).length,
    }
  }, [snapshot?.catalog])
  const plugins = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (snapshot?.catalog ?? []).filter(plugin => {
      if (statusFilter === 'installed' && !plugin.installed) return false
      if (statusFilter === 'available' && plugin.installed) return false
      if (statusFilter === 'updates' && !plugin.updateAvailable) return false
      if (statusFilter === 'disabled' && (!plugin.installed || plugin.enabled)) return false
      if (categoryFilter !== 'all' && plugin.category !== categoryFilter) return false
      return needle === '' || [plugin.title, plugin.description, plugin.category, ...plugin.tags]
        .some(value => value.toLowerCase().includes(needle))
    })
  }, [categoryFilter, search, snapshot?.catalog, statusFilter])
  const selected = plugins.find(plugin => plugin.id === selectedId) ?? null
  const error = localError ?? snapshot?.error ?? null
  const resetView = (): void => {
    setSearch('')
    setStatusFilter('all')
    setCategoryFilter('all')
    setSelectedId(null)
  }

  useEffect(() => {
    if (viewState.open) resetView()
  }, [viewState.open])

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
              <button className="oh-marketplace-button" disabled={pending} onClick={() => { void run({ type: 'refresh' }) }} type="button">
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
              <strong>{t('preview.running', { plugin: snapshot.preview.pluginId })}</strong>
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
                onClick={() => { resetView(); void run({ type: 'refresh' }) }}
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
                {categories.map(category => <option key={category} value={category}>{category}</option>)}
              </select>
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
              run={run}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  const bridge = window.dshDesktop
  if (bridge === undefined) throw new Error('plugin-marketplace: Electron bridge is unavailable')
  const locale = ctx.get('locale') as LocaleService
  const t: Translate<MarketplaceMessage> = locale.bind('oh-dsh.plugin-marketplace')
  const view = new PluginMarketplaceViewService(bridge, locale, t)
  ctx.effect(
    () => locale.register('oh-dsh.plugin-marketplace', MARKETPLACE_MESSAGES),
    'oh-dsh-desktop: marketplace dictionaries',
  )
  ctx.effect(() => {
    let disposed = false
    let disposeProvider: (() => Promise<void> | void) | void
    void bridge.getInfo().then(info => {
      if (disposed || info.preview !== null) return
      view.mount()
      disposeProvider = ctx.reflect.provide('pluginMarketplace', view, undefined)
    }).catch((error: unknown) => {
      console.error('plugin-marketplace: failed to inspect the desktop window', error)
    })
    return () => {
      disposed = true
      view.dispose()
      if (typeof disposeProvider === 'function') void disposeProvider()
    }
  }, 'oh-dsh-desktop: plugin marketplace')
}
