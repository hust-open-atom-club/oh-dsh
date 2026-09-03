import type {
  WorkspaceChange,
  WorkspaceFilesResponse,
} from '../protocol.ts'

export interface BetterSidebarScope {
  sessionId: string
  cwd?: string
}

export interface BetterSidebarFsEntry {
  hidden: boolean
  isDir: boolean
  name: string
  path: string
}

export interface BetterSidebarFsTree {
  entries: BetterSidebarFsEntry[]
  path: string
  truncated: boolean
}

export interface BetterSidebarGitStatusEntry {
  path: string
  xy: string
}

export interface BetterSidebarGitStatus {
  isRepo: boolean
  branch?: string
  entries: BetterSidebarGitStatusEntry[]
}

export interface BetterSidebarGitBranch {
  current: string
  names: string[]
}

export interface BetterSidebarGitLogEntry {
  hash: string
  hashFull: string
  subject: string
  author: string
  date: string
  refs: string
}

export interface BetterSidebarSettingsView {
  revision?: number
  value?: unknown
}

export type BetterSidebarFsRead = {
  kind: 'text'
  content: string
  truncated: boolean
} | {
  kind: 'binary'
  head?: string
  size: number
  truncated: boolean
}

interface BetterSidebarEnvelope<T> {
  error?: { code?: string; message?: string }
  ok?: boolean
  value?: T
}

function scopePayload(
  scope: BetterSidebarScope,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    sessionId: scope.sessionId,
    ...(scope.cwd === undefined || scope.cwd === '' ? {} : { cwd: scope.cwd }),
    ...extra,
  }
}

async function call<T>(
  method: string,
  scope: BetterSidebarScope,
  extra: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/sidebar/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(scopePayload(scope, extra)),
    ...(signal === undefined ? {} : { signal }),
  })
  const envelope = await response.json() as BetterSidebarEnvelope<T>
  if (!response.ok || envelope.ok !== true || envelope.value === undefined) {
    throw new Error(envelope.error?.message ?? `HTTP ${String(response.status)}`)
  }
  return envelope.value
}

async function callGlobal<T>(
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
  fsRead: (
    scope: BetterSidebarScope,
    path: string,
    signal?: AbortSignal,
  ): Promise<BetterSidebarFsRead> => call('fs.read', scope, { path }, signal),
  fsTree: (
    scope: BetterSidebarScope,
    path: string,
    signal?: AbortSignal,
  ): Promise<BetterSidebarFsTree> => call('fs.tree', scope, { path }, signal),
  gitBranch: (
    scope: BetterSidebarScope,
    signal?: AbortSignal,
  ): Promise<BetterSidebarGitBranch> => call('git.branch', scope, {}, signal),
  gitCheckout: (
    scope: BetterSidebarScope,
    branch: string,
  ): Promise<{ ok: true }> => call('git.checkout', scope, { branch }),
  gitCommit: (
    scope: BetterSidebarScope,
    message: string,
  ): Promise<{ ok: true }> => call('git.commit', scope, { message }),
  gitCommitDiff: (
    scope: BetterSidebarScope,
    hash: string,
    signal?: AbortSignal,
  ): Promise<{ diff: string }> => call(
    'git.commit-diff',
    scope,
    { hash },
    signal,
  ),
  gitDiff: (
    scope: BetterSidebarScope,
    path: string | undefined,
    staged: boolean,
    signal?: AbortSignal,
  ): Promise<{ diff: string }> => call('git.diff', scope, {
    ...(path === undefined ? {} : { path }),
    staged,
  }, signal),
  gitLog: (
    scope: BetterSidebarScope,
    count = 30,
    skip = 0,
    signal?: AbortSignal,
  ): Promise<BetterSidebarGitLogEntry[]> => call('git.log', scope, {
    count,
    skip,
  }, signal),
  gitStage: (
    scope: BetterSidebarScope,
    path?: string,
  ): Promise<{ ok: true }> => call('git.stage', scope, {
    ...(path === undefined ? {} : { path }),
  }),
  gitStatus: (
    scope: BetterSidebarScope,
    signal?: AbortSignal,
  ): Promise<BetterSidebarGitStatus> => call('git.status', scope, {}, signal),
  settingsGet: (
    signal?: AbortSignal,
  ): Promise<BetterSidebarSettingsView> => callGlobal(
    'settings.get',
    {},
    signal,
  ),
  settingsUpdate: (
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<BetterSidebarSettingsView> => callGlobal('settings.update', {
    patch,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  }),
}

function statusFromCode(code: string): WorkspaceChange['status'] {
  if (code === '??') return 'untracked'
  if (code.includes('U') || code === 'AA' || code === 'DD') {
    return 'conflicted'
  }
  if (code.includes('R')) return 'renamed'
  if (code.includes('C')) return 'copied'
  if (code.includes('D')) return 'deleted'
  if (code.includes('A')) return 'added'
  return 'modified'
}

export function workspaceChangesFromBetterSidebar(
  entries: readonly BetterSidebarGitStatusEntry[],
): WorkspaceChange[] {
  return entries.map(entry => ({
    path: entry.path,
    oldPath: null,
    status: statusFromCode(entry.xy),
    staged: entry.xy[0] !== ' ' && entry.xy[0] !== '?',
    unstaged: entry.xy === '??' || (entry.xy[1] !== ' ' && entry.xy[1] !== '?'),
  })).sort((left, right) => left.path.localeCompare(right.path))
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/$/, '')
}

function workspaceParent(cwd: string, path: string): string | null {
  const root = normalizedPath(cwd)
  const current = normalizedPath(path)
  if (current === root || !current.startsWith(`${root}/`)) return null
  const parent = current.slice(0, current.lastIndexOf('/'))
  return parent.length >= root.length ? parent : null
}

export function mapBetterSidebarTree(
  cwd: string,
  listing: BetterSidebarFsTree,
): WorkspaceFilesResponse {
  return {
    kind: 'directory',
    cwd,
    path: listing.path,
    parent: workspaceParent(cwd, listing.path),
    entries: listing.entries.map(entry => ({
      kind: entry.isDir ? 'directory' : 'file',
      name: entry.name,
      path: entry.path,
      size: null,
    })),
    truncated: listing.truncated,
  }
}

export function mapBetterSidebarFile(
  cwd: string,
  path: string,
  result: BetterSidebarFsRead,
): WorkspaceFilesResponse {
  if (result.kind === 'binary') {
    return {
      kind: 'file',
      cwd,
      path,
      parent: workspaceParent(cwd, path) ?? cwd,
      content: null,
      binary: true,
      size: result.size,
      truncated: result.truncated,
    }
  }
  return {
    kind: 'file',
    cwd,
    path,
    parent: workspaceParent(cwd, path) ?? cwd,
    content: result.content,
    binary: false,
    size: new TextEncoder().encode(result.content).byteLength,
    truncated: result.truncated,
  }
}
