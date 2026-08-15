import {
  MUTATING_TOOLS,
  RoutingInjector,
  type Loader,
} from '../../routing-injector/src/index.ts'

interface HostContext {
  loader: Loader
  on(
    event: 'tools/pre-execute',
    listener: (
      execution: { name: string },
      next: () => Promise<{ kind: 'allow' | 'ask' | 'deny'; reason?: string }>,
    ) => Promise<{ kind: 'allow' | 'ask' | 'deny'; reason?: string }>,
  ): unknown
  provide(name: string, value: unknown): void
}

/** Stable Host service name for browser-profile routing injection. */
export const name = 'oh-dsh-routing-injector-host'

/** Loader is available only in Desktop/Web profiles. */
export const inject = ['loader']

export function apply(ctx: HostContext): void {
  const injector = new RoutingInjector(ctx.loader)
  ctx.provide('routingInjector', injector)

  // Keep the approval fence in the Host plane so Agent tools cannot bypass it.
  ctx.on('tools/pre-execute', async (execution, next) => {
    if (!MUTATING_TOOLS.has(execution.name)) return await next()
    return {
      kind: 'ask',
      reason: `Approve ${execution.name} to change the current Oh-DSH profile?`,
    }
  })
}
