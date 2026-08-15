import {
  classifySession,
  coreToolsFor,
  hasDurableToolCall,
  personaFor,
  type RouterBand,
  type SessionLike,
} from './core.ts'

interface AgentLike {
  session: SessionLike
}

interface ToolLike {
  name: string
}

interface PromptSection {
  name: string
  order: number
  text: string
}

interface PromptAssembly {
  contexts: unknown[]
  sections: PromptSection[]
  tools: ToolLike[]
}

interface ToolExecutionLike {
  agent?: AgentLike
}

interface RouterContext {
  effect(callback: () => (() => void) | void, label?: string): void
  on(event: string, callback: (...args: any[]) => unknown): (() => void) | void
  tools: {
    register(tool: Record<string, unknown>): () => void
  }
}

const RESULT_SCHEMA = {
  additionalProperties: false,
  properties: { message: { type: 'string' } },
  required: ['message'],
  type: 'object',
} as const

function toolOutput() {
  return {
    render: (_args: unknown, value: { message: string }) => [{
      text: value.message,
      type: 'text',
    }],
    schema: RESULT_SCHEMA,
  }
}

function output(message: string): { message: string } {
  return { message }
}

function replacePersona(sections: readonly PromptSection[], persona: string): PromptSection[] {
  return [
    ...sections.filter(section => section.name !== 'persona' && section.name !== 'router-persona'),
    { name: 'router-persona', order: 0, text: persona },
  ]
}

function formatMode(band: RouterBand): string {
  switch (band) {
    case 'spec': return 'spec (investigate first)'
    case 'react': return 'react (implement directly)'
    default: return 'weak (model chooses per task)'
  }
}

/** Stable Cordis plugin name for the Router Standard system preset. */
export const name = 'oh-dsh-routing'

/** Router Standard has no host-only dependencies and remains TUI-compatible. */
export const inject = ['systemPrompt', 'tools']

/**
 * Add first-turn routing to the Standard preset without replacing its tools,
 * session persistence, or approval boundary.
 */
export function apply(ctx: RouterContext): void {
  const modes = new Map<string, RouterBand>()
  const sessionForAgent = new Map<AgentLike, string>()

  const modeFor = (session: SessionLike): RouterBand => {
    const cached = modes.get(session.id)
    if (cached !== undefined) return cached
    const classified = classifySession(session)
    if (classified === undefined) return 'weak'
    modes.set(session.id, classified)
    return classified
  }

  ctx.on('system-prompt/assemble', async (
    _assembly: unknown,
    context: { agent?: AgentLike },
    next: () => Promise<PromptAssembly>,
  ) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined) return assembled
    const session = agent.session
    sessionForAgent.set(agent, session.id)
    const band = modeFor(session)
    const sections = replacePersona(assembled.sections, personaFor(band))
    if (hasDurableToolCall(session)) return { ...assembled, sections }

    const allowed = new Set(coreToolsFor(band))
    return {
      ...assembled,
      sections,
      tools: assembled.tools.filter(tool => allowed.has(tool.name)),
    }
  })

  // Agent disposal is the rc.5 lifecycle notification that owns a session's
  // live prompt assembly. Do not retain its mode or object identity afterward.
  ctx.on('agent/disposed', (event: { agent?: AgentLike }) => {
    const agent = event.agent
    if (agent === undefined) return
    const sessionId = sessionForAgent.get(agent) ?? agent.session.id
    sessionForAgent.delete(agent)
    modes.delete(sessionId)
  })

  ctx.effect(() => ctx.tools.register({
    description: 'Show Router Standard mode and first-turn tool behavior for this session.',
    execute: async (_args: unknown, execution: ToolExecutionLike) => {
      const session = execution.agent?.session
      if (session === undefined) return output('Router Standard has no active session.')
      const band = modeFor(session)
      const phase = hasDurableToolCall(session) ? 'full tool catalog' : 'first-turn core tools'
      return output(`${formatMode(band)}; ${phase}; core: ${coreToolsFor(band).join(', ')}`)
    },
    name: 'dev_router_status',
    output: toolOutput(),
    parameters: {
      additionalProperties: false,
      properties: {},
      type: 'object',
    },
  }), 'oh-dsh-routing-status')

  ctx.effect(() => ctx.tools.register({
    description: 'Set Router Standard mode for this session. Use auto to classify its first user message again.',
    execute: async (args: unknown, execution: ToolExecutionLike) => {
      const session = execution.agent?.session
      if (session === undefined) return output('Router Standard has no active session.')
      const mode = args !== null && typeof args === 'object'
        ? (args as Record<string, unknown>).mode
        : undefined
      if (mode === 'auto') {
        modes.delete(session.id)
        return output(`Router Standard reset to ${formatMode(modeFor(session))}.`)
      }
      if (mode !== 'spec' && mode !== 'weak' && mode !== 'react') {
        return output('Invalid mode. Use spec, weak, react, or auto.')
      }
      modes.set(session.id, mode)
      return output(`Router Standard set to ${formatMode(mode)}.`)
    },
    name: 'dev_router_mode',
    output: toolOutput(),
    parameters: {
      additionalProperties: false,
      properties: {
        mode: {
          description: 'spec, weak, react, or auto',
          enum: ['spec', 'weak', 'react', 'auto'],
          type: 'string',
        },
      },
      required: ['mode'],
      type: 'object',
    },
  }), 'oh-dsh-routing-mode')
}
