/**
 * Typed fetch wrapper for the upstream sidebar host's settings route.
 *
 * The file browser, git lens, and terminal the old wrapper served moved to
 * the upstream plugin's own native tabs; the Oh-DSH surface only reads and
 * writes the upstream plugin's runtime preferences (agent terminal tools,
 * bottom-panel auto terminal, link interception) through this seam.
 */

/** The upstream plugin's settings document (revision-fenced). */
export interface BetterSidebarSettingsView {
  revision?: number
  value?: unknown
}

interface BetterSidebarEnvelope<T> {
  error?: { code?: string; message?: string }
  ok?: boolean
  value?: T
}

async function call<T>(
  method: string,
  extra: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/sidebar/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(extra),
    ...(signal === undefined ? {} : { signal }),
  })
  const envelope = await response.json() as BetterSidebarEnvelope<T>
  if (!response.ok || envelope.ok !== true || envelope.value === undefined) {
    throw new Error(envelope.error?.message ?? `HTTP ${String(response.status)}`)
  }
  return envelope.value
}

export const betterSidebarApi = {
  settingsGet: (signal?: AbortSignal): Promise<BetterSidebarSettingsView> =>
    call('settings.get', {}, signal),
  settingsUpdate: (
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<BetterSidebarSettingsView> => call('settings.update', {
    patch,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  }),
}
