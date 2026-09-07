import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import desktopSkinsCss from './skins.css'
import {
  DESKTOP_SKINS_MESSAGES,
  type DesktopSkinsMessage,
} from './i18n.ts'
import {
  DesktopSkinsController,
  type DesktopSkinsSnapshot,
  type ThemeService,
  type ThemeSnapshot,
} from './skin-controller.ts'
import { SkinDomPresenter } from './skin-dom.ts'
import {
  DesktopSkinPreferencesStorage,
  type PreferencesFetch,
} from './preferences-storage.ts'
import { DESKTOP_SKINS, type DesktopSkin } from './skins.ts'

interface BoundSkinActions {
  sync(activeId: string, ready: boolean, revision: number): void
}

interface SkinRowState {
  activeId: string
  ready: boolean
  revision: number
}

interface SkinRowProps {
  setSkin(id: string | null): void
  t: Translate<DesktopSkinsMessage>
  useStore<T>(selector: (state: SkinRowState) => T): T
}

interface SlotsService {
  inject(name: string, register: () => unknown): void
  register(options: {
    id: string
    inject(actions: BoundSkinActions): { setSkin(id: string | null): void }
    locale: string
    name: string
    order: number
    store: unknown
  }, component: (props: SkinRowProps) => JSX.Element): unknown
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): (() => void) | void
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

interface SkinOption {
  id: string | null
  label: DesktopSkinsMessage
  mode: DesktopSkinsMessage
  preview: string
  accent: string
}

export const inject = ['locale', 'slots', 'theme']

const SETTINGS_NAMESPACE = 'oh-dsh.skins'
const SETTINGS_STYLE_ATTRIBUTE = 'data-oh-dsh-skins'

const DEFAULT_OPTION: SkinOption = {
  id: null,
  label: 'skins.name.default',
  mode: 'skins.mode.system',
  preview: 'linear-gradient(135deg, #fafafa 0 49%, #30343b 50% 100%)',
  accent: '#80868f',
}

function optionFor(skin: DesktopSkin): SkinOption {
  return {
    id: skin.id,
    label: skin.label,
    mode: skin.colorScheme === 'light' ? 'skins.mode.light' : 'skins.mode.dark',
    preview: skin.preview,
    accent: skin.accent,
  }
}

const OPTIONS = [DEFAULT_OPTION, ...DESKTOP_SKINS.map(optionFor)]

function SkinSettingsRow({ setSkin, t, useStore }: SkinRowProps): JSX.Element {
  const activeId = useStore(state => state.activeId)
  const ready = useStore(state => state.ready)
  return (
    <div className="oh-dsh-skins-group">
      <div className="oh-dsh-skins-heading">
        <div className="oh-dsh-skins-title">{t('skins.title')}</div>
        <div className="oh-dsh-skins-description">{t('skins.description')}</div>
      </div>
      <div className="oh-dsh-skins-grid">
        {OPTIONS.map(option => {
          const selected = activeId === (option.id ?? '')
          return (
            <button
              key={option.id ?? 'default'}
              type="button"
              className="oh-dsh-skins-tile"
              data-selected={selected}
              aria-label={t(option.label)}
              aria-pressed={selected}
              disabled={!ready}
              onClick={() => { setSkin(option.id) }}
            >
              <span
                className="oh-dsh-skins-preview"
                style={{ background: option.preview }}
              />
              <span className="oh-dsh-skins-meta">
                <span className="oh-dsh-skins-swatch" style={{ background: option.accent }} />
                <span className="oh-dsh-skins-copy">
                  <span className="oh-dsh-skins-name">{t(option.label)}</span>
                  <span className="oh-dsh-skins-mode">{t(option.mode)}</span>
                </span>
                {selected && (
                  <span className="oh-dsh-skins-check" title={t('skins.selected')}>✓</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function installSettingsStyles(): () => void {
  const style = document.createElement('style')
  style.setAttribute(SETTINGS_STYLE_ATTRIBUTE, 'true')
  style.textContent = desktopSkinsCss
  document.head.append(style)
  return () => { style.remove() }
}

function syncActions(
  actions: BoundSkinActions | undefined,
  snapshot: DesktopSkinsSnapshot,
  ready: boolean,
): void {
  actions?.sync(snapshot.activeId ?? '', ready, snapshot.revision)
}

export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const slots = ctx.get('slots') as SlotsService
  const theme = ctx.get('theme') as ThemeService

  ctx.effect(
    () => locale.register('oh-dsh.skins', DESKTOP_SKINS_MESSAGES),
    'oh-dsh-skins: dictionaries',
  )
  ctx.effect(
    () => typeof document === 'undefined' ? undefined : installSettingsStyles(),
    'oh-dsh-skins: settings styles',
  )

  const storage = typeof fetch === 'undefined'
    ? memoryStorage()
    : new DesktopSkinPreferencesStorage(fetch.bind(globalThis) as PreferencesFetch)
  const controller = new DesktopSkinsController(
    theme,
    storage,
    new SkinDomPresenter(typeof document === 'undefined' ? undefined : document),
  )
  const store = defineStore<SkinRowState>({
    init: () => ({ activeId: '', ready: false, revision: -1 }),
    actions: {
      sync: (draft, activeId: string, ready: boolean, revision: number) => {
        if (revision < draft.revision) return
        draft.activeId = activeId
        draft.ready = ready
        draft.revision = revision
      },
    },
  })
  let bound: BoundSkinActions | undefined
  let ready = false

  ctx.effect(() => {
    let disposed = false
    let started = false
    let stopTheme: (() => void) | void
    let stopController: (() => void) | undefined
    let removeService: (() => Promise<void> | void) | void
    const boot = async (): Promise<void> => {
      if (storage instanceof DesktopSkinPreferencesStorage) {
        try {
          await storage.load()
        } catch (error) {
          console.error('skins: failed to load preferences', error)
        }
      }
      if (disposed) return
      controller.start()
      started = true
      ready = true
      stopTheme = ctx.on('theme/change', snapshot => { controller.adopt(snapshot) })
      stopController = controller.subscribe(() => {
        syncActions(bound, controller.getSnapshot(), true)
      })
      removeService = ctx.reflect.provide('desktopSkins', controller, undefined)
      syncActions(bound, controller.getSnapshot(), true)
    }
    void boot()
    return () => {
      disposed = true
      ready = false
      stopTheme?.()
      stopController?.()
      if (started) controller.dispose()
      void removeService?.()
    }
  }, 'oh-dsh-skins: controller')

  slots.inject('settings.general.item', () => slots.register({
    name: 'settings.general.item',
    id: 'oh-dsh-skins',
    order: 20,
    store,
    locale: SETTINGS_NAMESPACE,
    inject: actions => {
      bound = actions
      syncActions(bound, controller.getSnapshot(), ready)
      return { setSkin: id => { if (ready) controller.setSkin(id) } }
    },
  }, SkinSettingsRow))
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => { values.clear() },
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}
