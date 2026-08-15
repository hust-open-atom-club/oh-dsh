export type RouterBand = 'spec' | 'weak' | 'react'

export interface SessionEventLike {
  data?: unknown
  type: string
}

export interface SessionLike {
  events: readonly SessionEventLike[]
  id: string
}

const REACT_RE = /(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|make a|new project)/gi
const SPEC_RE = /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi

const PERSONAS: Record<RouterBand, string> = {
  react: 'You are a hands-on software engineer. Work directly, verify your changes, and deliver a usable result.',
  spec: 'You are a helpful software engineer assistant. Inspect the problem carefully before changing code.',
  weak: 'You are a helpful software engineer assistant. Decide whether this task needs investigation or direct implementation, then act accordingly.',
}

const CORE_TOOLS: Record<RouterBand, readonly string[]> = {
  react: ['read', 'write', 'edit'],
  spec: ['read', 'edit', 'glob', 'grep'],
  weak: ['read', 'write', 'edit'],
}

function countMatches(expression: RegExp, text: string): number {
  return [...text.matchAll(expression)].length
}

export function extractText(data: unknown): string {
  if (data === null || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  const message = record.message
  const payload = message !== null && typeof message === 'object'
    ? message as Record<string, unknown>
    : record
  if (!Array.isArray(payload.content)) return ''
  return payload.content.map(block => {
    if (typeof block === 'string') return block
    if (block !== null && typeof block === 'object') {
      const text = (block as Record<string, unknown>).text
      return typeof text === 'string' ? text : ''
    }
    return ''
  }).join(' ')
}

function isRealUserMessage(event: SessionEventLike): boolean {
  if (event.type !== 'user/message' || event.data === null || typeof event.data !== 'object') {
    return false
  }
  const data = event.data as Record<string, unknown>
  const message = data.message
  const payload = message !== null && typeof message === 'object'
    ? message as Record<string, unknown>
    : data
  const source = payload.source
  return source !== null && typeof source === 'object'
    && (source as Record<string, unknown>).kind === 'user'
}

/**
 * Choose the first real user message. Older logs did not always include a
 * source marker, so they retain their historical first user-message fallback.
 */
export function firstUserMessage(session: SessionLike): SessionEventLike | undefined {
  const candidates = session.events.filter(event => event.type === 'user/message')
  return candidates.find(isRealUserMessage) ?? candidates[0]
}

export function classifyTask(text: string): RouterBand {
  const react = countMatches(REACT_RE, text)
  const spec = countMatches(SPEC_RE, text)
  if (react > spec) return 'react'
  if (spec > react) return 'spec'
  return 'weak'
}

export function classifySession(session: SessionLike): RouterBand | undefined {
  const message = firstUserMessage(session)
  if (message === undefined) return undefined
  return classifyTask(extractText(message.data))
}

export function coreToolsFor(band: RouterBand): readonly string[] {
  return CORE_TOOLS[band]
}

export function personaFor(band: RouterBand): string {
  return PERSONAS[band]
}

export function hasDurableToolCall(session: SessionLike): boolean {
  return session.events.some(event => event.type === 'tool/call')
}
