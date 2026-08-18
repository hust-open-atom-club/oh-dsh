/** Native Plugins settings card for the built-in Vision host plugin. */

import type { ConnectionHandle, IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { Context } from '@deepseek-ai/cordis'
import * as clientRuntime from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopBridge } from '../../../../src/contracts.ts'
// These imports contribute only Cordis/client type merges. Runtime
// collaboration remains through the native settings, locale, connection, and
// slot services provided by DSH.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { useState, type CSSProperties } from 'react'

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

const SETTINGS_NAMESPACE = 'oh-dsh-vision'
const DEFAULT_CLOUD_KEY_REF = 'ZHIPUAI_API_KEY'
const LEGACY_CLOUD_KEY_REF = 'VISION_API_KEY'
const ZHIPU_CONSOLE_URL = 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys'

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}

/** Settings that are safe to edit through the redacted native settings API. */
interface VisionSettings {
  apiKeyEnv?: string
  baseURL?: string
  fallbackModels?: string[]
  localApiKeyEnv?: string
  localBaseURL?: string
  localFallbackModels?: string[]
  localModel?: string
  maxImageBytes?: number
  maxTokens?: number
  model?: string
  retryAttempts?: number
  retryBackoffMs?: number
  timeoutMs?: number
}

/**
 * The rc.6 runtime barrel currently publishes `.ts` re-exports without the
 * matching source files, so NodeNext drops those names during type checking.
 * Keep the client-facing contracts structural while runtime behavior still
 * comes from DSH's native services and store implementation.
 */
interface SettingsScopeSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  base: unknown
  user: unknown
  writable: boolean
}

interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
  set(next: T): void
}

const clientRuntimeApi = clientRuntime as unknown as {
  createSnapshotStore<T>(initial: T): SnapshotStore<T>
}

/** The card intentionally exposes only the two settings most users need. */
type VisionFieldName = 'baseURL' | 'model'

type VisionLocaleKey =
  | 'title' | 'description' | 'apiKey' | 'apiKeyHint' | 'apiKeySet' | 'apiKeyUnset'
  | 'baseURL' | 'baseURLHint' | 'openConsole' | 'model' | 'modelHint'
  | 'localFallbackHint' | 'credentialReadOnly'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse' | 'save' | 'saving'
  | 'discard' | 'unsaved' | 'saveFailed' | 'invalidValue'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'oh-dsh-vision': VisionLocaleKey
  }
}

interface FieldWrite {
  kind: 'set' | 'clear'
  value?: unknown
}

interface FieldSpec {
  format(value: unknown): string
  parse(text: string): FieldWrite | undefined
}

interface CardFieldState {
  text: string
  overridden: boolean
  invalid: boolean
}

interface CardState {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  fields: Record<VisionFieldName, CardFieldState>
  cloudKeyText: string
  cloudKeyConfigured: boolean
  cloudKeyWritable: boolean
}

interface CardFace {
  hooks: { visionCard: SnapshotStore<CardState> }
  edit(field: string, text: string): void
  resetField(field: string): void
  save(): void
  discard(): void
}

interface StagedEdit {
  text: string
  clear: boolean
}

interface PlannedWrite {
  run: (() => Promise<boolean>) | undefined
}

const FIELD_ORDER: readonly VisionFieldName[] = [
  'baseURL',
  'model',
]

function textSpec(): FieldSpec {
  return {
    format: value => typeof value === 'string' ? value : '',
    parse: text => text.trim() === ''
      ? { kind: 'clear' }
      : { kind: 'set', value: text.trim() },
  }
}

const FIELD_SPECS: Record<VisionFieldName, FieldSpec> = {
  baseURL: textSpec(),
  model: textSpec(),
}

function snapshotValue(snapshot: SettingsScopeSnapshot<VisionSettings>, field: keyof VisionSettings): unknown {
  return (snapshot.value as Record<string, unknown> | undefined)?.[field]
}

function baseValue(snapshot: SettingsScopeSnapshot<VisionSettings>, field: keyof VisionSettings): unknown {
  return (snapshot.base as Record<string, unknown> | undefined)?.[field]
}

function hasUserValue(snapshot: SettingsScopeSnapshot<VisionSettings>, field: keyof VisionSettings): boolean {
  const user = snapshot.user as Record<string, unknown> | undefined
  return user !== undefined && Object.hasOwn(user, field)
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function credentialRef(
  snapshot: SettingsScopeSnapshot<VisionSettings>,
  field: 'apiKeyEnv' | 'localApiKeyEnv',
  fallback: string,
): string {
  const value = snapshotValue(snapshot, field)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

interface CredentialState {
  ref: string
  configured: boolean
  writable: boolean
}

class VisionCardController {
  private readonly staged = new Map<string, StagedEdit>()
  private readonly store: SnapshotStore<CardState>
  private cloudCredential: CredentialState = {
    ref: '', configured: false, writable: true,
  }
  private saving = false
  private failed = false

  constructor(
    private readonly scope: SettingsScope<VisionSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.store = clientRuntimeApi.createSnapshotStore(this.project())
    scope.subscribe(() => {
      this.publish()
      void this.refreshCredentials()
    })
    void this.refreshCredentials()
  }

  inject(): CardFace {
    return {
      hooks: { visionCard: this.store },
      edit: (field, text) => { this.edit(field, text) },
      resetField: field => { this.resetField(field) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  refreshCredential(ref: string): void {
    const snapshot = this.scope.getSnapshot()
    const cloudRef = credentialRef(snapshot, 'apiKeyEnv', DEFAULT_CLOUD_KEY_REF)
    if (ref === cloudRef || ref === LEGACY_CLOUD_KEY_REF) void this.refreshCredentials()
  }

  private project(): CardState {
    const snapshot = this.scope.getSnapshot()
    const fields = {} as Record<VisionFieldName, CardFieldState>
    let invalid = false
    for (const field of FIELD_ORDER) {
      const staged = this.staged.get(field)
      const spec = FIELD_SPECS[field]
      if (staged === undefined) {
        fields[field] = {
          text: spec.format(snapshotValue(snapshot, field)),
          overridden: hasUserValue(snapshot, field),
          invalid: false,
        }
        continue
      }
      const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
      fields[field] = {
        text: staged.text,
        overridden: write?.kind === 'set',
        invalid: write === undefined,
      }
      invalid = invalid || write === undefined
    }
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid,
      saving: this.saving,
      failed: this.failed,
      fields,
      cloudKeyText: this.staged.get('cloudApiKey')?.text ?? '',
      cloudKeyConfigured: this.cloudCredential.configured,
      cloudKeyWritable: this.cloudCredential.writable,
    }
  }

  private edit(field: string, text: string): void {
    if (field !== 'cloudApiKey' && !(field in FIELD_SPECS)) return
    this.staged.set(field, { text, clear: false })
    this.failed = false
    this.publish()
  }

  private resetField(field: string): void {
    if (!(field in FIELD_SPECS)) return
    const name = field as VisionFieldName
    const snapshot = this.scope.getSnapshot()
    this.staged.set(field, {
      text: FIELD_SPECS[name].format(baseValue(snapshot, name)),
      clear: true,
    })
    this.failed = false
    this.publish()
  }

  private discard(): void {
    this.staged.clear()
    this.failed = false
    this.publish()
  }

  private plan(): PlannedWrite[] {
    const snapshot = this.scope.getSnapshot()
    const writes: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      if (field === 'cloudApiKey') {
        if (staged.text.trim() !== '') {
          writes.push({ run: () => this.writeCredential(field, staged.text.trim()) })
        }
        continue
      }
      const name = field as VisionFieldName
      const spec = FIELD_SPECS[name]
      if (staged.clear) {
        if (hasUserValue(snapshot, name)) writes.push({ run: () => this.clear(name) })
        continue
      }
      const write = spec.parse(staged.text)
      if (write === undefined) {
        writes.push({ run: undefined })
        continue
      }
      if (write.kind === 'clear') {
        if (hasUserValue(snapshot, name)) writes.push({ run: () => this.clear(name) })
      } else if (!hasUserValue(snapshot, name) || !sameValue(snapshotValue(snapshot, name), write.value)) {
        writes.push({ run: () => this.storeValue(name, write.value) })
      }
    }
    return writes
  }

  private async save(): Promise<void> {
    const plan = this.plan()
    if (plan.length === 0 || plan.some(item => item.run === undefined) || this.saving) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    try {
      for (const write of plan) landed = await write.run!() && landed
    } catch {
      landed = false
    } finally {
      if (landed) this.staged.clear()
      this.saving = false
      this.failed = !landed
      this.publish()
    }
  }

  private async storeValue(field: VisionFieldName, value: unknown): Promise<boolean> {
    await this.scope.set(field, value)
    const snapshot = this.scope.getSnapshot()
    return hasUserValue(snapshot, field) && sameValue(snapshotValue(snapshot, field), value)
  }

  private async clear(field: VisionFieldName): Promise<boolean> {
    await this.scope.unset(field)
    return !hasUserValue(this.scope.getSnapshot(), field)
  }

  private async writeCredential(field: string, value: string): Promise<boolean> {
    const snapshot = this.scope.getSnapshot()
    if (field !== 'cloudApiKey') return false
    const ref = credentialRef(snapshot, 'apiKeyEnv', DEFAULT_CLOUD_KEY_REF)
    try {
      const response = await this.api.credentials.set({ ref, value })
      if (!response.result.ok) return false
    } catch {
      return false
    }
    await this.refreshCredentials()
    return this.cloudCredential.configured
  }

  private async refreshCredentials(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    const cloudRef = credentialRef(snapshot, 'apiKeyEnv', DEFAULT_CLOUD_KEY_REF)
    this.cloudCredential = { ...this.cloudCredential, ref: cloudRef, configured: false }
    this.publish()
    try {
      const refs = cloudRef === LEGACY_CLOUD_KEY_REF
        ? [cloudRef]
        : [cloudRef, LEGACY_CLOUD_KEY_REF]
      const response = await this.api.credentials.describe({ refs })
      if (!response.result.ok) return
      const current = this.scope.getSnapshot()
      if (credentialRef(current, 'apiKeyEnv', DEFAULT_CLOUD_KEY_REF) !== cloudRef) return
      const cloud = response.result.value.credentials[cloudRef]
      const legacy = response.result.value.credentials[LEGACY_CLOUD_KEY_REF]
      this.cloudCredential = {
        ref: cloudRef,
        configured: cloud?.configured === true || legacy?.configured === true,
        writable: cloud?.writable ?? true,
      }
      this.publish()
    } catch {
      // The card remains usable when the credentials transport is unavailable.
    }
  }

  private publish(): void {
    this.store.set(this.project())
  }
}

const en: Record<VisionLocaleKey, string> = {
  title: 'Vision',
  description: 'Use the native image input with DeepSeek V4 and other text-only models.',
  apiKey: 'Zhipu Cloud API key',
  apiKeyHint: 'Stored as ZHIPUAI_API_KEY in the DSH credential store and hidden after saving.',
  apiKeySet: 'Configured',
  apiKeyUnset: 'Not configured',
  baseURL: 'Cloud endpoint',
  baseURLHint: 'Defaults to Zhipu. /chat/completions is appended automatically.',
  openConsole: 'Get a Zhipu key',
  model: 'Cloud model',
  modelHint: 'Primary cloud multimodal model.',
  localFallbackHint: 'Local OCR/VLM fallback is optional. The Agent can configure its model and endpoint when needed; no second key is required here.',
  credentialReadOnly: 'This key is supplied by the environment and cannot be replaced here.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidValue: 'Enter a valid value, or leave blank to use the default.',
}

const zh: Record<VisionLocaleKey, string> = {
  title: 'Vision',
  description: '让 DeepSeek V4 等文本模型使用 DSH 原生图片输入。',
  apiKey: '智谱云端 API Key',
  apiKeyHint: '保存为 DSH 凭据中的 ZHIPUAI_API_KEY，保存后始终以星号隐藏。',
  apiKeySet: '已配置',
  apiKeyUnset: '未配置',
  baseURL: '云端接口地址',
  baseURLHint: '默认使用智谱接口，会自动追加 /chat/completions。',
  openConsole: '获取智谱 Key',
  model: '云端模型',
  modelHint: '首选云端多模态模型。',
  localFallbackHint: '本地 OCR/VLM 是可选回退。需要时由 Agent 自动配置模型和接口，这里不再重复配置第二个 Key。',
  credentialReadOnly: '这个 Key 来自环境变量，无法在此处覆盖。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  expand: '展开设置',
  collapse: '收起设置',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  unsaved: '未保存',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidValue: '请输入有效值；留空表示使用默认值。',
}

const cardStyle: CSSProperties = {
  listStyle: 'none',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-3)',
  overflow: 'hidden',
}

const inputStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  height: 34,
  padding: '0 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-3)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 13,
}

function Field(props: {
  id: string
  label: string
  hint: string
  state: CardFieldState
  disabled: boolean
  onEdit(text: string): void
  onReset(): void
  t: (key: VisionLocaleKey) => string
  actionLabel?: string
  onAction?(): void
}) {
  const { state } = props
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label htmlFor={props.id} style={{ flex: 1, color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 500 }}>
          {props.label}
        </label>
        {state.overridden ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--dsw-alias-label-secondary)', fontSize: 11 }}>
            <span>{props.t('overridden')}</span>
            <button type="button" style={linkButtonStyle} disabled={props.disabled} onClick={props.onReset}>
              {props.t('reset')}
            </button>
          </span>
        ) : null}
        {props.actionLabel !== undefined && props.onAction !== undefined ? (
          <button type="button" style={linkButtonStyle} onClick={props.onAction}>
            {props.actionLabel}
          </button>
        ) : null}
      </div>
      <input
        id={props.id}
        type="text"
        value={state.text}
        disabled={props.disabled}
        aria-invalid={state.invalid || undefined}
        style={state.invalid ? { ...inputStyle, borderColor: 'var(--dsw-alias-label-error)' } : inputStyle}
        onChange={event => { props.onEdit(event.target.value) }}
      />
      <p style={{ margin: '6px 0 0', color: state.invalid ? 'var(--dsw-alias-label-error)' : 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: 1.5 }}>
        {state.invalid ? props.t('invalidValue') : props.hint}
      </p>
    </div>
  )
}

function SecretField(props: {
  id: string
  label: string
  hint: string
  text: string
  placeholder?: string
  configured: boolean
  disabled: boolean
  stateLabel: string
  onEdit(text: string): void
}) {
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label htmlFor={props.id} style={{ flex: 1, color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 500 }}>
          {props.label}
        </label>
        <span style={{ color: props.configured ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>
          {props.stateLabel}
        </span>
      </div>
      <input
        id={props.id}
        type="password"
        autoComplete="new-password"
        value={props.text}
        placeholder={props.placeholder}
        disabled={props.disabled}
        style={inputStyle}
        onChange={event => { props.onEdit(event.target.value) }}
      />
      <p style={{ margin: '6px 0 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: 1.5 }}>
        {props.hint}
      </p>
    </div>
  )
}

async function openExternal(url: string): Promise<void> {
  if (typeof window !== 'undefined' && window.dshDesktop !== undefined) {
    await window.dshDesktop.openExternal(url)
    return
  }
  const open = (globalThis as { open?: (target: string, name?: string, features?: string) => unknown }).open
  if (typeof open === 'function') open(url, '_blank', 'noopener,noreferrer')
}

const linkButtonStyle: CSSProperties = {
  border: 0,
  padding: 0,
  background: 'none',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
}

const footerButtonStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  padding: '5px 14px',
  background: 'none',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
}

type VisionCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'oh-dsh-vision'>
  & InjectFace<CardFace>

function VisionCard(props: VisionCardProps) {
  const state = props.useVisionCard(snapshot => snapshot as CardState)
  const [open, setOpen] = useState(false)
  if (!state.available) return null
  const disabled = !state.writable || state.saving
  const field = (name: VisionFieldName, label: VisionLocaleKey, hint: VisionLocaleKey, actionLabel?: VisionLocaleKey) => (
    <Field
      key={name}
      id={`plugin-config-vision-${name}`}
      label={props.t(label)}
      hint={props.t(hint)}
      state={state.fields[name]}
      disabled={disabled}
      t={props.t}
      onEdit={text => { props.edit(name, text) }}
      onReset={() => { props.resetField(name) }}
      {...(actionLabel === undefined
        ? {}
        : {
          actionLabel: props.t(actionLabel),
          onAction: () => { void openExternal(ZHIPU_CONSOLE_URL) },
        })}
    />
  )
  return (
    <li style={{ ...cardStyle, background: open ? 'var(--dsw-alias-bg-layer-2)' : cardStyle.background }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${props.t(open ? 'collapse' : 'expand')}: ${props.t('title')}`}
        onClick={() => { setOpen(value => !value) }}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', border: 0, background: 'none', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ color: 'var(--dsw-alias-label-primary)', fontSize: 15, fontWeight: 600 }}>{props.t('title')}</span>
          <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: 1.5 }}>{props.t('description')}</span>
        </span>
        {state.dirty ? <span style={{ color: 'var(--dsw-alias-label-secondary)', fontSize: 11 }}>{props.t('unsaved')}</span> : null}
        <span aria-hidden="true" style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 18, transform: open ? 'rotate(180deg)' : undefined }}>⌄</span>
      </button>
      {open ? (
        <div style={{ margin: '0 16px', paddingBottom: 8, borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
          {!state.writable ? <p role="status" style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>{props.t('readOnly')}</p> : null}
          {field('baseURL', 'baseURL', 'baseURLHint', 'openConsole')}
          <SecretField
            id="plugin-config-vision-cloud-key"
            label={props.t('apiKey')}
            hint={props.t(state.cloudKeyWritable ? 'apiKeyHint' : 'credentialReadOnly')}
            text={state.cloudKeyText}
            {...(state.cloudKeyConfigured ? { placeholder: '••••••••••••' } : {})}
            configured={state.cloudKeyConfigured}
            disabled={state.saving}
            stateLabel={props.t(state.cloudKeyConfigured ? 'apiKeySet' : 'apiKeyUnset')}
            onEdit={text => { props.edit('cloudApiKey', text) }}
          />
          {field('model', 'model', 'modelHint')}
          <p style={{ margin: '12px 0 4px', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: 1.5 }}>
            {props.t('localFallbackHint')}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
            {state.failed ? <p role="status" style={{ flex: 1, margin: 0, color: 'var(--dsw-alias-label-error)', fontSize: 12 }}>{props.t('saveFailed')}</p> : null}
            <button type="button" style={footerButtonStyle} disabled={!state.dirty || state.saving} onClick={props.discard}>{props.t('discard')}</button>
            <button type="button" style={{ ...footerButtonStyle, borderColor: 'transparent', background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)' }} disabled={!state.dirty || state.invalid || state.saving} onClick={props.save}>{props.t(state.saving ? 'saving' : 'save')}</button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

export function apply(ctx: Context): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind('oh-dsh-vision')
  ctx.effect(() => ctx.locale.register('oh-dsh-vision', { zh, en }), 'oh-dsh-vision: dictionaries')
  const controller = new VisionCardController(
    ctx.settingsScope.bind<VisionSettings>({ namespace: SETTINGS_NAMESPACE }),
    api,
  )
  ctx.effect(
    () => ctx.remote.$on('credentials/updated', (ref: string) => { controller.refreshCredential(ref) }),
    'oh-dsh-vision: credential invalidations',
  )
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'oh-dsh-vision',
    priority: 30,
    locale: 'oh-dsh-vision',
    inject: () => controller.inject(),
  }, VisionCard))
}
