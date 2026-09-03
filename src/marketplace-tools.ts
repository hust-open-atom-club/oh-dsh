import type {
  MarketplaceAction,
  MarketplaceCommand,
  MarketplaceConfirmation,
  MarketplacePlugin,
  MarketplaceSnapshot,
} from '../plugins/plugin-marketplace/src/protocol.ts'
import {
  MARKETPLACE_AGENT_TOKEN_ENV,
  MARKETPLACE_AGENT_URL_ENV,
} from '../plugins/plugin-marketplace/src/host/agent-gateway.ts'

interface ToolRunContext {
  concludeTurn(): void
}

interface ToolDefinition {
  description: string
  execute(args: Record<string, unknown>, exec: ToolRunContext): Promise<unknown>
  name: string
  output: {
    render(args: Record<string, unknown>, value: AgentToolResult): Array<{
      text: string
      type: 'text'
    }>
    schema: Record<string, unknown>
  }
  parameters: Record<string, unknown>
}

export interface MarketplaceToolContext {
  on(
    name: 'tools/pre-execute',
    listener: (
      exec: { name: string },
      next: () => Promise<{ kind: 'allow' | 'ask' | 'deny'; reason?: string }>,
    ) => Promise<{ kind: 'allow' | 'ask' | 'deny'; reason?: string }>,
  ): unknown
  tools: {
    register(definition: ToolDefinition): unknown
  }
}

interface AgentToolResult {
  data: string
  summary: string
}

interface GatewayResponse {
  accepted?: boolean
  deferred?: boolean
  error?: string
  snapshot?: MarketplaceSnapshot
}

interface GatewayCredentials {
  token: string
  url: string
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    data: { type: 'string' },
  },
  required: ['summary', 'data'],
} as const

function output() {
  return {
    schema: RESULT_SCHEMA,
    render: (_args: Record<string, unknown>, value: AgentToolResult) => [{
      type: 'text' as const,
      text: value.data === '' ? value.summary : `${value.summary}\n${value.data}`,
    }],
  }
}

function result(summary: string, value?: unknown): AgentToolResult {
  return {
    data: value === undefined ? '' : JSON.stringify(value, undefined, 2),
    summary,
  }
}

function requireString(args: Record<string, unknown>, name: string): string {
  const value = args[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function pluginView(plugin: MarketplacePlugin): Record<string, unknown> {
  return {
    category: plugin.category,
    description: plugin.description,
    enabled: plugin.enabled,
    id: plugin.id,
    installed: plugin.installed,
    mechanism: plugin.mechanism,
    protected: plugin.protected,
    repository: plugin.repository,
    risk: plugin.runtimeRisk,
    surfaces: plugin.surfaces,
    trust: plugin.trust,
    updateAvailable: plugin.updateAvailable,
    url: plugin.url,
  }
}

function credentialsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): GatewayCredentials | null {
  const url = environment[MARKETPLACE_AGENT_URL_ENV]
  const token = environment[MARKETPLACE_AGENT_TOKEN_ENV]
  delete environment[MARKETPLACE_AGENT_URL_ENV]
  delete environment[MARKETPLACE_AGENT_TOKEN_ENV]
  if (url === undefined || token === undefined) return null
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
    || parsed.pathname !== '/v1/marketplace') {
    throw new Error('desktop plugin marketplace gateway must use its loopback endpoint')
  }
  return { token, url: parsed.href }
}

async function gateway(
  credentials: GatewayCredentials,
  request: unknown,
): Promise<GatewayResponse> {
  const response = await fetch(credentials.url, {
    body: JSON.stringify(request),
    headers: {
      authorization: `Bearer ${credentials.token}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(35_000),
  })
  const value = await response.json() as GatewayResponse
  if (!response.ok || value.error !== undefined) {
    throw new Error(value.error ?? `marketplace gateway failed with HTTP ${String(response.status)}`)
  }
  return value
}

async function snapshot(
  credentials: GatewayCredentials,
  command?: MarketplaceCommand,
): Promise<MarketplaceSnapshot> {
  const response = await gateway(credentials, command === undefined
    ? { type: 'snapshot' }
    : { type: 'dispatch', command })
  if (response.snapshot === undefined) throw new Error('marketplace gateway omitted its snapshot')
  return requireHealthyMarketplaceSnapshot(response.snapshot)
}

/** Preserve the distinction between an unavailable catalog and a valid empty search. */
export function requireHealthyMarketplaceSnapshot(
  value: MarketplaceSnapshot,
): MarketplaceSnapshot {
  if (value.error !== null) throw new Error(value.error)
  return value
}

function marketplaceTool(
  definition: Omit<ToolDefinition, 'output'>,
): ToolDefinition {
  const required: string[] = []
  const properties = Object.fromEntries(Object.entries(definition.parameters).map(([name, raw]) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [name, raw]
    const property = { ...raw as Record<string, unknown> }
    if (property.required === true) required.push(name)
    delete property.required
    return [name, property]
  }))
  return {
    ...definition,
    output: output(),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  }
}

/** Register Agent tools that call the same transaction owner as the UI. */
export function mountMarketplaceAgentTools(
  ctx: MarketplaceToolContext,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const credentials = credentialsFromEnvironment(environment)
  if (credentials === null) return

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'desktop_plugin_apply') {
      return {
        kind: 'ask',
        reason: 'Apply the tested plugin preview to Oh-DSH Desktop?',
      }
    }
    if (exec.name === 'desktop_plugin_recover') {
      return {
        kind: 'ask',
        reason: 'Restore the previous Oh-DSH Desktop plugin profile?',
      }
    }
    return await next()
  })

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_search',
    description: 'Search public DSH plugins visible to Oh-DSH Desktop. Filter by install state or category. This is read-only.',
    parameters: {
      query: { type: 'string', description: 'Case-insensitive plugin name, description, category, or tag query.' },
      status: {
        type: 'string',
        enum: ['all', 'installed', 'not-installed', 'updates', 'disabled'],
        description: 'Optional lifecycle classification.',
      },
      category: { type: 'string', description: 'Optional exact catalog category.' },
      refresh: { type: 'boolean', description: 'Refresh the GitHub catalog before searching.' },
    },
    async execute(args) {
      const info = await snapshot(credentials, args.refresh === true
        ? { type: 'refresh', force: true }
        : undefined)
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
      const status = typeof args.status === 'string' ? args.status : 'all'
      const category = typeof args.category === 'string' ? args.category : null
      const plugins = info.catalog.filter(plugin => {
        if (status === 'installed' && !plugin.installed) return false
        if (status === 'not-installed' && plugin.installed) return false
        if (status === 'updates' && !plugin.updateAvailable) return false
        if (status === 'disabled' && (!plugin.installed || plugin.enabled)) return false
        if (category !== null && plugin.category !== category) return false
        return query === '' || [plugin.id, plugin.description, plugin.category, ...plugin.tags]
          .some(value => value.toLowerCase().includes(query))
      }).slice(0, 50).map(pluginView)
      return result(`Found ${String(plugins.length)} matching desktop plugins.`, plugins)
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_status',
    description: 'Inspect installed, enabled, update, preview, source-lock, and recovery state for desktop plugins. This is read-only.',
    parameters: {
      pluginId: { type: 'string', description: 'Optional exact marketplace plugin id.' },
    },
    async execute(args) {
      const info = await snapshot(credentials)
      const pluginId = typeof args.pluginId === 'string' ? args.pluginId.trim() : ''
      const plugins = info.catalog
        .filter(plugin => pluginId === '' || plugin.id === pluginId)
        .map(pluginView)
      return result(
        pluginId === '' ? 'Desktop plugin lifecycle state.' : `Desktop plugin state for ${pluginId}.`,
        {
          lifecycle: info.lifecycle,
          plugins,
          sourceLocks: info.sourceLocks.filter(lock => pluginId === '' || lock.pluginId === pluginId),
        },
      )
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_prepare',
    description: 'Prepare install, update, enable, disable, or uninstall through the desktop transaction manager. Safe actions open an isolated preview immediately; risky actions return confirmations that must be reviewed first.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['install', 'update', 'enable', 'disable', 'uninstall'],
      },
      pluginId: { type: 'string', required: true, description: 'Exact marketplace plugin id.' },
    },
    async execute(args) {
      const pluginId = requireString(args, 'pluginId')
      const action = requireString(args, 'action') as MarketplaceAction
      const info = await snapshot(credentials, { type: 'prepare', action, pluginId })
      return result(
        info.preview === null
          ? `Review the ${action} plan for ${pluginId} before previewing.`
          : `Isolated ${action} preview started for ${pluginId}.`,
        { lifecycle: info.lifecycle, plan: info.plan },
      )
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_preview',
    description: 'Launch the prepared action in the isolated desktop preview. Build scripts require direct human approval; Agents cannot approve unsandboxed execution.',
    parameters: {
      confirmations: {
        type: 'array',
        required: true,
        items: {
          type: 'string',
          enum: ['allow-build-scripts', 'accept-high-risk', 'accept-source-change'],
        },
      },
    },
    async execute(args) {
      const confirmations = Array.isArray(args.confirmations)
        ? args.confirmations as MarketplaceConfirmation[]
        : []
      const info = await snapshot(credentials, { type: 'preview', confirmations })
      return result(
        `Isolated preview started for ${info.preview?.pluginId ?? 'the prepared plugin'}.`,
        { lifecycle: info.lifecycle, plan: info.plan },
      )
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_discard',
    description: 'Discard the active isolated plugin preview without changing the live desktop profile.',
    parameters: {},
    async execute() {
      const info = await snapshot(credentials, { type: 'discard' })
      return result('Discarded the isolated plugin preview.', info.lifecycle)
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_apply',
    description: 'After human approval, atomically apply the active isolated preview and keep the previous profile recoverable. This restarts the live DSH runtime.',
    parameters: {},
    async execute(_args, exec) {
      const response = await gateway(credentials, {
        type: 'dispatch',
        command: { type: 'apply' },
      })
      if (response.deferred !== true) throw new Error('desktop apply was not scheduled')
      exec.concludeTurn()
      return result('Plugin apply accepted. The desktop runtime will restart now.')
    },
  }))

  ctx.tools.register(marketplaceTool({
    name: 'desktop_plugin_recover',
    description: 'After human approval, restore the previous plugin profile and restart the live DSH runtime.',
    parameters: {},
    async execute(_args, exec) {
      const response = await gateway(credentials, {
        type: 'dispatch',
        command: { type: 'undo' },
      })
      if (response.deferred !== true) throw new Error('desktop recovery was not scheduled')
      exec.concludeTurn()
      return result('Plugin recovery accepted. The desktop runtime will restart now.')
    },
  }))
}
