/**
 * Settings update section for Oh-DSH Desktop.
 *
 * The update affordance lives in Settings — not the sidebar's brand row —
 * so the compact traffic-light line stays clean. The section shows the
 * live About-style update state and drives the existing flows through the
 * DesktopBridge: `aboutUpdate.check()` for a quick check, `openUpdater()`
 * for the full update window (check, download, install). Copy is localized
 * through the `oh-dsh.update-button` dictionary.
 */
import { useSyncExternalStore } from 'react'
import updateSectionCss from './update-section.css'
import { UPDATE_BUTTON_MESSAGES, type UpdateButtonMessage } from './i18n.ts'
import {
  createUpdateSnapshotStore,
  updateIsActionable,
  type UpdateSnapshotStore,
} from './update-state.ts'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import type { AboutUpdateSnapshot, DesktopBridge } from '../../../../src/contracts.ts'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
}

interface UpdateSectionProps {
  t: Translate<UpdateButtonMessage>
  useStore<T>(selector: (snapshot: AboutUpdateSnapshot | undefined) => T): T
}

function statusText(
  t: Translate<UpdateButtonMessage>,
  snapshot: AboutUpdateSnapshot | undefined,
): string {
  if (snapshot === undefined) return t('statusUnknown')
  switch (snapshot.status) {
    case 'idle': return t('statusIdle', { version: snapshot.currentVersion })
    case 'checking': return t('checking')
    case 'not-available': return t('statusNotAvailable', { version: snapshot.latestVersion })
    case 'available': return t('statusAvailable', { version: snapshot.latestVersion })
    case 'downloading': return t('statusDownloading', { percent: String(Math.round(snapshot.percent)) })
    case 'downloaded': return t('statusDownloaded', { version: snapshot.latestVersion })
    case 'unsupported': return t('statusUnsupported')
    case 'error': return t('statusError')
  }
}

function UpdateSettingsSection({ t, useStore }: UpdateSectionProps): JSX.Element {
  const snapshot = useStore(state => state)
  const checking = snapshot?.status === 'checking'
  const actionable = updateIsActionable(snapshot)
  const bridge = (window as unknown as { dshDesktop?: DesktopBridge }).dshDesktop
  return (
    <div className="oh-dsh-update-section">
      <div className="oh-dsh-update-heading">
        <div className="oh-dsh-update-title">{t('sectionTitle')}</div>
        <div className="oh-dsh-update-description">{t('sectionDescription')}</div>
      </div>
      <div className="oh-dsh-update-row">
        <span
          className="oh-dsh-update-status"
          data-update-mode={snapshot?.status ?? 'unknown'}
          role="status"
        >{statusText(t, snapshot)}</span>
        <div className="oh-dsh-update-actions">
          <button
            type="button"
            className="oh-dsh-update-secondary"
            disabled={checking || bridge?.aboutUpdate === undefined}
            onClick={() => { void bridge?.aboutUpdate?.check().catch(() => {}) }}
          >{checking ? t('checking') : t('checkForUpdates')}</button>
          <button
            type="button"
            className="oh-dsh-update-primary"
            data-update-actionable={actionable || undefined}
            onClick={() => { void bridge?.openUpdater() }}
          >{t('openUpdater')}</button>
        </div>
      </div>
    </div>
  )
}

interface SlotsService {
  inject(name: string, register: () => unknown): () => void
  register(options: Record<string, unknown>, component: (props: unknown) => JSX.Element): () => void
}

/** Bind the snapshot store into a React hook the section component calls. */
function bindUseStore(ui: UpdateSnapshotStore) {
  return function useStore<T>(selector: (snapshot: AboutUpdateSnapshot | undefined) => T): T {
    return useSyncExternalStore(ui.subscribe, () => selector(ui.get()))
  }
}

export const inject = ['locale', 'slots']

export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const slots = ctx.get('slots') as SlotsService
  const t: Translate<UpdateButtonMessage> = locale.bind('oh-dsh.update-button')
  ctx.effect(
    () => locale.register('oh-dsh.update-button', UPDATE_BUTTON_MESSAGES),
    'oh-dsh-update-button: dictionaries',
  )
  ctx.effect(
    () => typeof document === 'undefined' ? undefined : (() => {
      const style = document.createElement('style')
      style.dataset.ohDshUpdateSection = 'true'
      style.textContent = updateSectionCss
      document.head.append(style)
      return () => { style.remove() }
    })(),
    'oh-dsh-update-button: section styles',
  )
  ctx.effect(() => {
    const ui = createUpdateSnapshotStore()
    const bridge = (window as unknown as { dshDesktop?: DesktopBridge }).dshDesktop
    let stopBridge: (() => void) | undefined
    if (bridge !== undefined && bridge.aboutUpdate !== undefined) {
      const applySnapshot = (snapshot: AboutUpdateSnapshot): void => { ui.set(snapshot) }
      stopBridge = bridge.aboutUpdate.onState(applySnapshot)
      void bridge.aboutUpdate.getSnapshot().then(applySnapshot).catch(() => {})
    }
    const disposeSection = slots.inject('settings.section', () => slots.register({
      name: 'settings.section',
      id: 'oh-dsh-update-button',
      order: 110,
      label: () => t('sectionNav'),
      inject: () => ({ t, useStore: bindUseStore(ui) }),
    }, UpdateSettingsSection as (props: unknown) => JSX.Element))
    return () => {
      disposeSection()
      stopBridge?.()
    }
  }, 'oh-dsh-update-button: settings section')
}
