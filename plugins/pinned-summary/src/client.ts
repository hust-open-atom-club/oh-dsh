/** Floating pinned summary derived from the active DSH session. */

import type { LocaleService, Translate } from '../../shared/i18n.ts'
import { localeTag } from '../../shared/i18n.ts'
import {
  PINNED_SUMMARY_MESSAGES,
  type PinnedSummaryMessage,
} from './i18n.ts'

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface SessionListSummary {
  id: string
  displayTitle: string
  cwd?: string
  agentPreset?: string
  model?: string
  running: boolean
  pendingInteraction?: unknown
  completed?: boolean
  blank: boolean
  updatedAt: number
}

interface SessionListState {
  current?: string
  byId: Record<string, SessionListSummary>
}

interface SessionBinding {
  session: ObservableSnapshot<unknown>
}

interface SessionsService {
  list: ObservableSnapshot<SessionListState>
  binding(id: string): SessionBinding | undefined
  open(id: string): void
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): () => Promise<void> | void
  }
}

/** Public toggle face consumed by the unified desktop client. */
export interface PinnedSummary {
  isOpen(): boolean
  setOpen(open: boolean): void
  subscribe(listener: () => void): () => void
  toggle(): void
}

export const inject = ['locale', 'sessions']

const OPEN_KEY = 'oh-dsh-desktop.pinned-summary.open'
export const SUMMARY_PREVIEW_LIMIT = 480

export type SummaryKind = 'context' | 'assistant'

export interface SummaryRecord {
  kind: SummaryKind
  text: string
}

export type SummaryState =
  | 'no-session'
  | 'loading'
  | 'blank'
  | 'running'
  | 'waiting'
  | 'ready'
  | 'unavailable'
  | 'error'

export interface TruncatedSummary {
  text: string
  truncated: boolean
}

export interface SummaryMetadata {
  provider?: string
  model?: string
  toolCount: number
  toolNames: readonly string[]
  startedAt?: number
  completedAt?: number
}

const SUMMARY_CSS = `
html {
  --oh-dsh-pinned-summary-width: 360px;
}

[data-oh-dsh-pinned-summary] {
  position: fixed;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  top: calc(var(--oh-dsh-titlebar-height, 40px) + 8px);
  /* Follow the panel toolbar: stay clear of an open session details column. */
  right: calc(14px + var(--oh-dsh-details-width, 0px));
  width: min(var(--oh-dsh-pinned-summary-width), calc(100vw - 28px));
  height: auto;
  max-height: min(500px, calc(100vh - var(--oh-dsh-titlebar-height, 40px) - 20px));
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 16px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-shadow:
    0 18px 48px rgb(0 0 0 / 14%),
    0 2px 10px rgb(0 0 0 / 6%);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-8px) scale(0.98);
  transform-origin: top right;
  visibility: hidden;
  transition:
    opacity 140ms var(--ds-ease-in-out, ease),
    transform 180ms var(--ds-ease-in-out, ease),
    visibility 0s linear 180ms;
  -webkit-app-region: no-drag;
}

[data-oh-dsh-pinned-summary][data-open='true'] {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0) scale(1);
  visibility: visible;
  transition-delay: 0s;
}

[data-oh-dsh-summary-header] {
  display: flex;
  flex: 0 0 46px;
  align-items: center;
  height: 46px;
  padding: 0 10px 0 15px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  box-sizing: border-box;
  font-size: 13px;
  font-weight: 600;
}

[data-oh-dsh-summary-header] h2 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-oh-dsh-summary-close] {
  display: grid;
  place-items: center;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  margin-left: auto;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 18px;
}

[data-oh-dsh-summary-close]:hover,
[data-oh-dsh-summary-close]:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

[data-oh-dsh-summary-body] {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-height: 0;
  padding: 12px 15px 14px;
  box-sizing: border-box;
  overflow: hidden;
}

[data-oh-dsh-summary-session-title] {
  margin: 0;
  font-size: 15px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

[data-oh-dsh-summary-status] {
  display: inline-flex;
  margin-top: 7px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  font-weight: 650;
  line-height: 1.25;
}

[data-oh-dsh-summary-meta] {
  display: grid;
  gap: 2px;
  margin: 9px 0 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

[data-oh-dsh-summary-source] {
  display: inline-flex;
  margin-bottom: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  font-weight: 600;
}

[data-oh-dsh-summary-content] {
  min-height: 0;
  max-height: 220px;
  overflow: auto;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

[data-oh-dsh-summary-content] > :first-child { margin-top: 0; }
[data-oh-dsh-summary-content] > :last-child { margin-bottom: 0; }
[data-oh-dsh-summary-content] p,
[data-oh-dsh-summary-content] blockquote,
[data-oh-dsh-summary-content] ul,
[data-oh-dsh-summary-content] ol,
[data-oh-dsh-summary-content] pre,
[data-oh-dsh-summary-content] h3,
[data-oh-dsh-summary-content] h4,
[data-oh-dsh-summary-content] h5,
[data-oh-dsh-summary-content] h6 {
  margin: 0 0 9px;
}

[data-oh-dsh-summary-content] p,
[data-oh-dsh-summary-content] blockquote { white-space: pre-wrap; }

[data-oh-dsh-summary-content] h3,
[data-oh-dsh-summary-content] h4,
[data-oh-dsh-summary-content] h5,
[data-oh-dsh-summary-content] h6 {
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}

[data-oh-dsh-summary-content] blockquote {
  padding-left: 10px;
  border-left: 2px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-tertiary);
}

[data-oh-dsh-summary-content] ul,
[data-oh-dsh-summary-content] ol { padding-left: 19px; }
[data-oh-dsh-summary-content] li { margin: 3px 0; }

[data-oh-dsh-summary-content] pre {
  max-width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base));
  overflow: auto;
  white-space: pre;
}

[data-oh-dsh-summary-content] code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--dsw-alias-interactive-bg-hover);
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 0.94em;
}

[data-oh-dsh-summary-content] pre code {
  padding: 0;
  background: transparent;
}

[data-oh-dsh-summary-actions] {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 13px;
}

[data-oh-dsh-summary-actions] button {
  min-height: 29px;
  padding: 5px 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}

[data-oh-dsh-summary-actions] button:hover:not(:disabled),
[data-oh-dsh-summary-actions] button:focus-visible:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

[data-oh-dsh-summary-actions] button:disabled {
  cursor: default;
  opacity: 0.45;
}

[data-oh-dsh-summary-feedback] {
  min-height: 18px;
  margin: 8px 0 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

@media (max-width: 900px) {
  [data-oh-dsh-pinned-summary] {
    right: calc(8px + var(--oh-dsh-details-width, 0px));
    width: min(var(--oh-dsh-pinned-summary-width), calc(100vw - 16px));
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-oh-dsh-pinned-summary] { transition: none; }
}
`

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, String(open))
  } catch {
    // Preferences are best-effort in restricted browser storage modes.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function conversationNodes(snapshot: unknown): readonly unknown[] {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.nodes)) return []
  return snapshot.nodes
}

/** Select the latest non-empty compaction summary, then assistant text. */
export function latestSummary(nodes: readonly unknown[]): SummaryRecord | undefined {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (!isRecord(node)) continue
    if (node.kind !== 'compaction') continue
    const text = readString(node.summary)
    if (text !== undefined) return { kind: 'context', text }
  }
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (!isRecord(node) || node.kind !== 'assistant' || !Array.isArray(node.blocks)) continue
    const text = node.blocks.flatMap(block => {
      if (!isRecord(block) || block.kind !== 'text') return []
      return typeof block.text === 'string' ? [block.text] : []
    }).join('\n').trim()
    if (text !== '') return { kind: 'assistant', text }
  }
  return undefined
}

/** Return a stable bounded preview while retaining the exact source elsewhere. */
export function truncateSummary(
  text: string,
  limit = SUMMARY_PREVIEW_LIMIT,
): TruncatedSummary {
  const normalized = text.trim()
  if (!Number.isFinite(limit) || limit < 1 || normalized.length <= Math.floor(limit)) {
    return { text: normalized, truncated: false }
  }
  const boundary = Math.max(1, Math.floor(limit))
  if (boundary === 1) return { text: '…', truncated: true }
  return {
    text: `${normalized.slice(0, boundary - 1).trimEnd()}…`,
    truncated: true,
  }
}

function assistantConfig(node: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(node.requestConfig) ? node.requestConfig : undefined
}

function assistantProvenance(node: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(node.provenance) ? node.provenance : undefined
}

/** Extract optional provider/model, tool, and time-range context from nodes. */
export function summaryMetadata(nodes: readonly unknown[]): SummaryMetadata {
  let provider: string | undefined
  let model: string | undefined
  let startedAt: number | undefined
  let completedAt: number | undefined
  let toolCount = 0
  const toolNames: string[] = []
  const toolIds = new Set<string>()
  const recordTime = (value: unknown): void => {
    const time = readNumber(value)
    if (time === undefined) return
    startedAt = startedAt === undefined ? time : Math.min(startedAt, time)
    completedAt = completedAt === undefined ? time : Math.max(completedAt, time)
  }

  for (const value of nodes) {
    if (!isRecord(value)) continue
    recordTime(value.time)
    if (value.kind === 'assistant' && isRecord(value.timing)) {
      recordTime(value.timing.stepStartTime)
      recordTime(value.timing.firstTokenTime)
      recordTime(value.timing.completedTime)
    }
    if (value.kind === 'assistant') {
      const provenance = assistantProvenance(value)
      const config = assistantConfig(value)
      provider = readString(provenance?.provider) ?? readString(config?.provider) ?? provider
      model = readString(provenance?.model) ?? readString(config?.model) ?? model
      if (Array.isArray(value.blocks)) {
        for (const block of value.blocks) {
          if (!isRecord(block) || block.kind !== 'tool-call') continue
          const callId = readString(block.callId)
          if (callId !== undefined) {
            if (toolIds.has(callId)) continue
            toolIds.add(callId)
          }
          toolCount += 1
          const name = readString(block.name)
          if (name !== undefined && !toolNames.includes(name)) toolNames.push(name)
        }
      }
    }
    if (value.kind === 'tool-result') {
      recordTime(value.callTime)
      const callId = readString(value.callId)
      if (callId !== undefined) {
        if (toolIds.has(callId)) continue
        toolIds.add(callId)
      }
      toolCount += 1
      const call = isRecord(value.call) ? value.call : undefined
      const name = readString(call?.name)
      if (name !== undefined && !toolNames.includes(name)) toolNames.push(name)
    }
  }

  const result: SummaryMetadata = { toolCount, toolNames }
  if (provider !== undefined) result.provider = provider
  if (model !== undefined) result.model = model
  if (startedAt !== undefined) result.startedAt = startedAt
  if (completedAt !== undefined) result.completedAt = completedAt
  return result
}

function snapshotHasPending(snapshot: unknown): boolean {
  return isRecord(snapshot) && Array.isArray(snapshot.pending) && snapshot.pending.length > 0
}

function snapshotOpenState(snapshot: unknown): string | undefined {
  return isRecord(snapshot) && typeof snapshot.openState === 'string' ? snapshot.openState : undefined
}

function snapshotHasError(snapshot: unknown): boolean {
  if (!isRecord(snapshot)) return false
  if (snapshot.openError !== null && snapshot.openError !== undefined) return true
  return readString(snapshot.lastAgentError) !== undefined
}

/** Resolve the display state from authoritative list and conversation fields. */
export function summaryState(
  session: SessionListSummary | undefined,
  snapshot: unknown,
  derived: SummaryRecord | undefined = snapshot === undefined
    ? undefined
    : latestSummary(conversationNodes(snapshot)),
): SummaryState {
  if (session === undefined) return 'no-session'
  if (snapshot === undefined) return 'loading'
  const openState = snapshotOpenState(snapshot)
  if (openState === 'loading' || openState === 'cold') return 'loading'
  if (openState === 'error' || snapshotHasError(snapshot)) return 'error'
  if (session.blank || (isRecord(snapshot) && snapshot.blank === true)) return 'blank'
  if (session.pendingInteraction != null || snapshotHasPending(snapshot)) return 'waiting'
  if (session.running || (isRecord(snapshot) && snapshot.running === true)) return 'running'
  if (derived !== undefined) return 'ready'
  return 'unavailable'
}

function makeElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  return node
}

/** Render a small, explicitly allow-listed Markdown subset without HTML injection. */
function appendInline(parent: HTMLElement, input: string): void {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^\s)]+\))/g
  let cursor = 0
  for (const match of input.matchAll(pattern)) {
    const token = match[0]
    const index = match.index ?? cursor
    if (index > cursor) parent.append(document.createTextNode(input.slice(cursor, index)))
    if (token.startsWith('`')) {
      parent.append(makeElement('code', token.slice(1, -1)))
    } else if (token.startsWith('**') || token.startsWith('__')) {
      parent.append(makeElement('strong', token.slice(2, -2)))
    } else if (token.startsWith('*') || token.startsWith('_')) {
      parent.append(makeElement('em', token.slice(1, -1)))
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(token)
      const url = linkMatch?.[2]
      if (linkMatch !== null && url !== undefined && /^https?:\/\//i.test(url)) {
        const link = makeElement('a', linkMatch[1])
        link.href = url
        link.target = '_blank'
        link.rel = 'noreferrer noopener'
        parent.append(link)
      } else {
        parent.append(document.createTextNode(token))
      }
    }
    cursor = index + token.length
  }
  if (cursor < input.length) parent.append(document.createTextNode(input.slice(cursor)))
}

function appendMarkdown(parent: HTMLElement, markdown: string): void {
  const lines = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (line.trim() === '') {
      index += 1
      continue
    }
    const fence = /^\s*```([^`]*)\s*$/.exec(line)
    if (fence !== null) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index]!)) {
        codeLines.push(lines[index]!)
        index += 1
      }
      if (index < lines.length) index += 1
      const pre = makeElement('pre')
      const code = makeElement('code', codeLines.join('\n'))
      const language = fence[1]?.trim()
      if (language !== undefined && language !== '') code.dataset.language = language
      pre.append(code)
      parent.append(pre)
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading !== null) {
      const level = Math.min(6, heading[1]!.length + 2) as 3 | 4 | 5 | 6
      const title = makeElement(`h${level}` as 'h3' | 'h4' | 'h5' | 'h6')
      appendInline(title, heading[2]!)
      parent.append(title)
      index += 1
      continue
    }
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index]!)) {
        quoteLines.push(lines[index]!.replace(/^\s*>\s?/, ''))
        index += 1
      }
      const quote = makeElement('blockquote')
      appendInline(quote, quoteLines.join('\n'))
      parent.append(quote)
      continue
    }
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (unordered !== null || ordered !== null) {
      const list = makeElement(ordered !== null ? 'ol' : 'ul')
      while (index < lines.length) {
        const item = (ordered !== null
          ? /^\s*\d+[.)]\s+(.+)$/
          : /^\s*[-*+]\s+(.+)$/).exec(lines[index]!)
        if (item === null) break
        const li = makeElement('li')
        appendInline(li, item[1]!)
        list.append(li)
        index += 1
      }
      parent.append(list)
      continue
    }
    const paragraphLines: string[] = []
    while (index < lines.length && lines[index]!.trim() !== '') {
      const candidate = lines[index]!
      if (paragraphLines.length > 0 && (
        /^\s*```/.test(candidate)
        || /^(#{1,6})\s+/.test(candidate)
        || /^\s*>/.test(candidate)
        || /^\s*[-*+]\s+/.test(candidate)
        || /^\s*\d+[.)]\s+/.test(candidate)
      )) break
      paragraphLines.push(candidate)
      index += 1
    }
    const paragraph = makeElement('p')
    appendInline(paragraph, paragraphLines.join('\n'))
    parent.append(paragraph)
  }
}

function errorText(snapshot: unknown): string | undefined {
  if (!isRecord(snapshot)) return undefined
  const error = snapshot.openError
  if (isRecord(error)) return readString(error.message) ?? readString(error.code)
  return readString(snapshot.lastAgentError)
}

class PinnedSummaryService implements PinnedSummary {
  readonly #sessions: SessionsService
  readonly #locale: LocaleService
  readonly #t: Translate<PinnedSummaryMessage>
  readonly #listeners = new Set<() => void>()
  #open = readOpen()
  #expanded = false
  #panel: HTMLElement | undefined
  #style: HTMLStyleElement | undefined
  #sessionTitle: HTMLElement | undefined
  #headerTitle: HTMLElement | undefined
  #close: HTMLButtonElement | undefined
  #status: HTMLElement | undefined
  #meta: HTMLElement | undefined
  #source: HTMLElement | undefined
  #content: HTMLElement | undefined
  #actions: HTMLElement | undefined
  #copy: HTMLButtonElement | undefined
  #openSession: HTMLButtonElement | undefined
  #expand: HTMLButtonElement | undefined
  #feedback: HTMLElement | undefined
  #currentId: string | undefined
  #boundSession: SessionBinding['session'] | undefined
  #currentText = ''
  #returnFocus: HTMLElement | null = null
  #unsubscribeList: (() => void) | undefined
  #unsubscribeSession: (() => void) | undefined
  #unsubscribeLocale: (() => void) | undefined
  readonly #handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.#open || this.#panel === undefined) return
    const target = event.target
    if (!(target instanceof Node) || this.#panel.contains(target)) return
    if (target instanceof Element
      && target.closest('[data-oh-dsh-summary-toggle]') !== null) return
    this.setOpenState(false, true)
  }
  readonly #handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!this.#open || this.#panel === undefined) return
    if (event.key === 'Escape') {
      event.preventDefault()
      this.setOpen(false)
      return
    }
  }

  constructor(
    sessions: SessionsService,
    locale: LocaleService,
    t: Translate<PinnedSummaryMessage>,
  ) {
    this.#sessions = sessions
    this.#locale = locale
    this.#t = t
  }

  mount(): void {
    this.#style = document.createElement('style')
    this.#style.dataset.ohDshPinnedSummaryStyles = 'true'
    this.#style.textContent = SUMMARY_CSS
    document.head.append(this.#style)

    const panel = document.createElement('aside')
    panel.dataset.ohDshPinnedSummary = 'true'
    panel.id = 'oh-dsh-pinned-summary'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-hidden', 'true')
    panel.setAttribute('aria-labelledby', 'oh-dsh-pinned-summary-heading')

    const header = document.createElement('header')
    header.dataset.ohDshSummaryHeader = ''
    const headerTitle = document.createElement('h2')
    headerTitle.id = 'oh-dsh-pinned-summary-heading'
    const close = document.createElement('button')
    close.dataset.ohDshSummaryClose = ''
    close.type = 'button'
    close.textContent = '×'
    header.append(headerTitle, close)

    const body = document.createElement('div')
    body.dataset.ohDshSummaryBody = ''
    const sessionTitle = document.createElement('h3')
    sessionTitle.dataset.ohDshSummarySessionTitle = ''
    const status = document.createElement('span')
    status.dataset.ohDshSummaryStatus = ''
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    status.setAttribute('aria-atomic', 'true')
    const meta = document.createElement('div')
    meta.dataset.ohDshSummaryMeta = ''
    const source = document.createElement('span')
    source.dataset.ohDshSummarySource = ''
    const content = document.createElement('article')
    content.dataset.ohDshSummaryContent = ''
    content.id = 'oh-dsh-pinned-summary-content'
    const actions = document.createElement('div')
    actions.dataset.ohDshSummaryActions = ''
    const copy = document.createElement('button')
    copy.dataset.ohDshSummaryCopy = ''
    copy.type = 'button'
    const openSession = document.createElement('button')
    openSession.dataset.ohDshSummaryOpenSession = ''
    openSession.type = 'button'
    const expand = document.createElement('button')
    expand.dataset.ohDshSummaryExpand = ''
    expand.type = 'button'
    expand.setAttribute('aria-controls', 'oh-dsh-pinned-summary-content')
    actions.append(copy, openSession, expand)
    const feedback = document.createElement('p')
    feedback.dataset.ohDshSummaryFeedback = ''
    feedback.setAttribute('aria-live', 'polite')
    body.append(sessionTitle, status, meta, source, content, actions, feedback)
    panel.append(header, body)
    document.body.append(panel)
    this.#panel = panel
    this.#sessionTitle = sessionTitle
    this.#headerTitle = headerTitle
    this.#close = close
    this.#status = status
    this.#meta = meta
    this.#source = source
    this.#content = content
    this.#actions = actions
    this.#copy = copy
    this.#openSession = openSession
    this.#expand = expand
    this.#feedback = feedback
    close.addEventListener('click', () => { this.setOpen(false) })
    copy.addEventListener('click', () => { void this.copySummary() })
    openSession.addEventListener('click', () => {
      const id = this.#currentId
      if (id !== undefined) this.#sessions.open(id)
      this.setOpen(false)
    })
    expand.addEventListener('click', () => {
      this.#expanded = !this.#expanded
      this.render()
    })
    document.addEventListener('pointerdown', this.#handleDocumentPointerDown)
    document.addEventListener('keydown', this.#handleDocumentKeyDown)
    this.#unsubscribeList = this.#sessions.list.subscribe(() => { this.bindAndRender() })
    this.#unsubscribeLocale = this.#locale.subscribe(() => {
      this.renderChrome()
      this.render()
    })
    this.renderChrome()
    this.applyState()
    this.bindAndRender()
  }

  dispose(): void {
    this.#unsubscribeList?.()
    this.#unsubscribeSession?.()
    this.#unsubscribeLocale?.()
    document.removeEventListener('pointerdown', this.#handleDocumentPointerDown)
    document.removeEventListener('keydown', this.#handleDocumentKeyDown)
    this.#panel?.remove()
    this.#style?.remove()
    delete document.documentElement.dataset.ohDshSummaryPinned
  }

  isOpen(): boolean {
    return this.#open
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  toggle(): void {
    this.setOpen(!this.#open)
  }

  setOpen(open: boolean): void {
    this.setOpenState(open, true)
  }

  private setOpenState(open: boolean, restoreFocus: boolean): void {
    if (this.#open === open) return
    if (open) {
      const active = document.activeElement
      this.#returnFocus = active instanceof HTMLElement && !this.#panel?.contains(active)
        ? active
        : null
    } else {
      const returnFocus = this.#returnFocus
      const fallback = document.querySelector<HTMLElement>('[data-oh-dsh-summary-toggle]')
      const active = document.activeElement
      const ownsFocus = active instanceof HTMLElement
        && (this.#panel?.contains(active)
          || active.closest('[data-oh-dsh-summary-toggle]') !== null)
      this.#returnFocus = null
      if (restoreFocus && ownsFocus && returnFocus?.isConnected === true) {
        returnFocus.focus()
      } else if (restoreFocus && ownsFocus) {
        fallback?.focus()
      }
    }
    this.#open = open
    writeOpen(open)
    this.applyState()
    if (open) {
      window.requestAnimationFrame(() => {
        if (this.#open) this.#close?.focus()
      })
    }
    for (const listener of this.#listeners) listener()
  }

  private applyState(): void {
    const html = document.documentElement
    if (this.#panel !== undefined) {
      this.#panel.dataset.open = String(this.#open)
      this.#panel.setAttribute('aria-hidden', String(!this.#open))
      this.#panel.toggleAttribute('inert', !this.#open)
    }
    if (this.#open) {
      html.dataset.ohDshSummaryPinned = 'true'
    } else {
      delete html.dataset.ohDshSummaryPinned
    }
  }

  private bindAndRender(): void {
    const list = this.#sessions.list.getSnapshot()
    const currentId = list.current
    const binding = currentId === undefined ? undefined : this.#sessions.binding(currentId)
    if (currentId !== this.#currentId || binding?.session !== this.#boundSession) {
      this.#unsubscribeSession?.()
      this.#unsubscribeSession = undefined
      this.#currentId = currentId
      this.#boundSession = binding?.session
      this.#expanded = false
      if (binding !== undefined) {
        this.#unsubscribeSession = binding.session.subscribe(() => { this.render() })
      }
    }
    this.render()
  }

  private renderChrome(): void {
    if (this.#headerTitle !== undefined) this.#headerTitle.textContent = this.#t('summary.title')
    if (this.#close !== undefined) {
      const label = this.#t('summary.close')
      this.#close.setAttribute('aria-label', label)
      this.#close.title = label
    }
    if (this.#copy !== undefined) this.#copy.textContent = this.#t('summary.copy')
    if (this.#openSession !== undefined) this.#openSession.textContent = this.#t('summary.open-session')
  }

  private async copySummary(): Promise<void> {
    if (this.#currentText === '') return
    try {
      if (navigator.clipboard?.writeText === undefined) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(this.#currentText)
      if (this.#feedback !== undefined) this.#feedback.textContent = this.#t('summary.copy-success')
    } catch {
      if (this.#feedback !== undefined) this.#feedback.textContent = this.#t('summary.copy-failure')
    }
  }

  private renderMeta(session: SessionListSummary, metadata: SummaryMetadata): void {
    if (this.#meta === undefined) return
    this.#meta.replaceChildren()
    const lines: string[] = []
    if (session.cwd !== undefined) lines.push(session.cwd)
    if (session.agentPreset !== undefined) lines.push(session.agentPreset)
    const model = metadata.model ?? session.model
    if (metadata.provider !== undefined || model !== undefined) {
      lines.push(this.#t('summary.metadata.model', {
        model: [metadata.provider, model].filter(Boolean).join(' / '),
      }))
    }
    if (metadata.toolCount > 0) {
      lines.push(this.#t('summary.metadata.tools', {
        count: metadata.toolCount,
        names: metadata.toolNames.join(', '),
      }))
    }
    const start = metadata.startedAt
    const end = metadata.completedAt
    if (start !== undefined || end !== undefined) {
      lines.push(this.#t('summary.metadata.time-range', {
        range: [start, end].filter(value => value !== undefined).map(value => {
          return new Date(value).toLocaleTimeString(localeTag(this.#locale))
        }).join(' - '),
      }))
    }
    lines.push(this.#t('summary.updated', {
      time: new Date(session.updatedAt).toLocaleString(localeTag(this.#locale)),
    }))
    for (const line of lines) {
      const item = document.createElement('span')
      item.textContent = line
      this.#meta.append(item)
    }
  }

  private render(): void {
    if (this.#sessionTitle === undefined || this.#status === undefined
      || this.#source === undefined || this.#content === undefined) return
    const list = this.#sessions.list.getSnapshot()
    const id = list.current
    const session = id === undefined ? undefined : list.byId[id]
    if (id === undefined || session === undefined) {
      this.#currentText = ''
      this.#expanded = false
      this.#panel?.setAttribute('data-state', 'no-session')
      this.#sessionTitle.textContent = this.#t('summary.no-active')
      this.#status.textContent = this.#t('summary.status.no-session')
      if (this.#meta !== undefined) this.#meta.textContent = this.#t('summary.select-session')
      this.#source.textContent = this.#t('summary.source.overview')
      this.#content.replaceChildren(document.createElement('p'))
      this.#content.firstElementChild!.textContent = this.#t('summary.empty-placeholder')
      if (this.#feedback !== undefined) this.#feedback.textContent = ''
      this.updateActions(false, false, false)
      return
    }
    const binding = this.#sessions.binding(id)
    const snapshot = binding?.session.getSnapshot()
    const nodes = conversationNodes(snapshot)
    const derived = latestSummary(nodes)
    const state = binding === undefined
      ? 'unavailable'
      : summaryState(session, snapshot, derived)
    if (derived === undefined || !truncateSummary(derived.text).truncated) this.#expanded = false
    const metadata = summaryMetadata(nodes)
    const stateLabel: Record<SummaryState, string> = {
      'no-session': this.#t('summary.status.no-session'),
      loading: this.#t('summary.status.loading'),
      blank: this.#t('summary.status.blank'),
      running: this.#t('summary.status.running'),
      waiting: this.#t('summary.status.waiting'),
      ready: this.#t('summary.status.ready'),
      unavailable: this.#t('summary.status.unavailable'),
      error: this.#t('summary.status.error'),
    }
    this.#panel?.setAttribute('data-state', state)
    this.#sessionTitle.textContent = session.displayTitle
    this.#status.textContent = stateLabel[state]
    this.renderMeta(session, metadata)
    this.#source.textContent = derived === undefined
      ? this.#t('summary.source.overview')
      : derived.kind === 'context'
        ? this.#t('summary.source.context')
        : this.#t('summary.source.assistant')

    const stateMessage = state === 'loading'
      ? this.#t('summary.loading')
      : state === 'error'
        ? [this.#t('summary.error'), errorText(snapshot)].filter(Boolean).join(' ')
        : state === 'blank'
          ? this.#t('summary.blank')
          : undefined
    if (stateMessage !== undefined) {
      this.#currentText = ''
      this.#expanded = false
      if (this.#feedback !== undefined) this.#feedback.textContent = ''
      const message = document.createElement('p')
      message.textContent = stateMessage
      this.#content.replaceChildren(message)
      this.updateActions(false, false)
      return
    }

    const text = derived?.text ?? this.#t('summary.unavailable')
    this.#currentText = derived?.text ?? ''
    const preview = this.#expanded ? { text, truncated: false } : truncateSummary(text)
    this.#content.replaceChildren()
    appendMarkdown(this.#content, preview.text)
    if (this.#feedback !== undefined) this.#feedback.textContent = ''
    this.updateActions(derived !== undefined, preview.truncated)
  }

  private updateActions(
    hasSummary: boolean,
    canExpand: boolean,
    canOpenSession = this.#currentId !== undefined,
  ): void {
    if (this.#actions === undefined || this.#copy === undefined
      || this.#openSession === undefined || this.#expand === undefined) return
    this.#actions.hidden = !hasSummary && !canOpenSession
    this.#copy.disabled = !hasSummary
    this.#openSession.disabled = !canOpenSession
    const canToggle = canExpand || this.#expanded
    this.#expand.hidden = !canToggle
    this.#expand.disabled = !canToggle
    this.#expand.textContent = this.#expanded
      ? this.#t('summary.show-less')
      : this.#t('summary.show-more')
    this.#expand.setAttribute('aria-expanded', String(this.#expanded))
  }
}

/** Provide the pinned-summary service and its floating DOM surface. */
export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const t: Translate<PinnedSummaryMessage> = locale.bind('oh-dsh.pinned-summary')
  ctx.effect(
    () => locale.register('oh-dsh.pinned-summary', PINNED_SUMMARY_MESSAGES),
    'oh-dsh-desktop: pinned summary dictionaries',
  )
  const service = new PinnedSummaryService(
    ctx.get('sessions') as SessionsService,
    locale,
    t,
  )
  ctx.effect(() => {
    service.mount()
    const disposeService = ctx.reflect.provide('pinnedSummary', service, undefined)
    return () => {
      service.dispose()
      void disposeService()
    }
  }, 'oh-dsh-desktop: pinned summary')
}
