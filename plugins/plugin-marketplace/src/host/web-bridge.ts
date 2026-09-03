import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseMarketplaceCommand, type MarketplaceCommand } from '../protocol.ts'
import type { PluginMarketplaceManager } from './transaction-manager.ts'

export const MARKETPLACE_WEB_BRIDGE_PATH = '/oh-dsh/plugin-marketplace'

export interface MarketplaceWebBridgeContext {
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (
        request: IncomingMessage,
        response: ServerResponse,
      ) => void | Promise<void>
    }): () => void
  }
  logger: { warn(message: string): void }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(body)
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readCommand(request: IncomingMessage): Promise<MarketplaceCommand> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 32 * 1024) throw new Error('marketplace command is too large')
    chunks.push(buffer)
  }
  return parseMarketplaceCommand(
    JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
  )
}

/** Mount the same-origin HTTP bridge consumed by the browser client. */
export function mountMarketplaceWebBridge(
  ctx: MarketplaceWebBridgeContext,
  manager: PluginMarketplaceManager,
): () => void {
  return ctx.webServer.register({
    kind: 'exact',
    path: MARKETPLACE_WEB_BRIDGE_PATH,
    handler: async (request, response) => {
      try {
        if (request.method === 'GET') {
          sendJson(response, 200, manager.getSnapshot())
          return
        }
        if (request.method === 'POST') {
          if (sameOrigin(request) === false) {
            sendJson(response, 403, { error: 'untrusted marketplace origin' })
            return
          }
          sendJson(response, 200, await manager.dispatch(await readCommand(request), 'human-ui'))
          return
        }
        response.writeHead(405, { allow: 'GET, POST' })
        response.end()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`[marketplace] ${message}`)
        sendJson(response, 400, { error: message })
      }
    },
  })
}
