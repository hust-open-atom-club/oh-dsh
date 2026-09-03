import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { parseMarketplaceCommand, type MarketplaceCommand } from '../protocol.ts'
import type { PluginMarketplaceManager } from './transaction-manager.ts'

const MAX_REQUEST_BYTES = 32 * 1024
const DEFAULT_DEFER_MS = 900

export const MARKETPLACE_AGENT_URL_ENV = 'OH_DSH_MARKETPLACE_AGENT_URL'
export const MARKETPLACE_AGENT_TOKEN_ENV = 'OH_DSH_MARKETPLACE_AGENT_TOKEN'

export interface MarketplaceAgentGateway {
  close(): Promise<void>
  token: string
  url: string
}

export interface MarketplaceAgentGatewayOptions {
  deferMs?: number
  onError?(error: unknown): void
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(body)
}

function authorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization
  if (header === undefined || !header.startsWith('Bearer ')) return false
  const supplied = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(token)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new Error('marketplace agent request is too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(text) as unknown
}

function isDeferred(command: MarketplaceCommand): command is Extract<
  MarketplaceCommand,
  { type: 'apply' | 'undo' }
> {
  return command.type === 'apply' || command.type === 'undo'
}

/**
 * Publish the single marketplace transaction owner to the live DSH runtime.
 * Applying or recovering is deferred until the tool result reaches the model,
 * because either action restarts the process that invoked it.
 */
export async function startMarketplaceAgentGateway(
  manager: PluginMarketplaceManager,
  options: MarketplaceAgentGatewayOptions = {},
): Promise<MarketplaceAgentGateway> {
  const token = randomBytes(32).toString('hex')
  let deferredPending = false
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/v1/marketplace') {
        json(response, 404, { error: 'not found' })
        return
      }
      if (!authorized(request, token)) {
        json(response, 401, { error: 'unauthorized' })
        return
      }
      const raw = await readBody(request)
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('marketplace agent request must be an object')
      }
      const record = raw as Record<string, unknown>
      if (record.type === 'snapshot') {
        json(response, 200, { snapshot: manager.getSnapshot() })
        return
      }
      if (record.type !== 'dispatch') {
        throw new Error('unsupported marketplace agent request')
      }
      const command = parseMarketplaceCommand(record.command)
      if (!isDeferred(command)) {
        const snapshot = await manager.dispatch(command, 'agent')
        json(response, 200, { accepted: true, deferred: false, snapshot })
        return
      }
      if (deferredPending) throw new Error('a marketplace restart action is already pending')
      const snapshot = manager.getSnapshot()
      if (command.type === 'apply' && snapshot.preview === null) {
        throw new Error('there is no isolated preview to apply')
      }
      if (command.type === 'undo' && !snapshot.undoAvailable) {
        throw new Error('there is no previous profile to recover')
      }
      deferredPending = true
      json(response, 202, { accepted: true, deferred: true, snapshot })
      setTimeout(() => {
        void manager.dispatch(command, 'agent')
          .then(result => {
            if (result.error !== null) options.onError?.(new Error(result.error))
          })
          .catch(options.onError ?? (() => {}))
          .finally(() => { deferredPending = false })
      }, options.deferMs ?? DEFAULT_DEFER_MS)
    })().catch(error => {
      if (!response.headersSent) json(response, 400, { error: message(error) })
      else response.destroy(error instanceof Error ? error : new Error(message(error)))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close(error => { if (error === undefined) resolve(); else reject(error) })
      })
    },
    token,
    url: `http://127.0.0.1:${String(address.port)}/v1/marketplace`,
  }
}
