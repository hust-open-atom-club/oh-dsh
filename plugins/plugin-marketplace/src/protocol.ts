export const MARKETPLACE_CATALOG_REPOSITORY = 'whyihaveyou/dsh-suite'

export const MARKETPLACE_CATALOG_PATH = 'data/plugins.json'

export type MarketplaceAuthStatus = 'ready' | 'missing-cli' | 'signed-out' | 'error'

export type MarketplaceMechanism = 'bundle' | 'repository' | 'discover' | 'unsupported'

export type MarketplaceInstallMechanism = 'bundle' | 'repository'

export type MarketplaceAction = 'install' | 'update' | 'enable' | 'disable' | 'uninstall'

export type MarketplaceRuntimeRisk = 'profile-bundle' | 'trusted-host' | 'guided'

export type MarketplaceSurfaceKind = 'desktop' | 'web' | 'tui'

/** Where a catalog entry is expected to take effect after installation. */
export interface MarketplaceSurfaceSupport {
  declared: boolean
  desktop: boolean
  web: boolean
  tui: boolean
}

export type MarketplaceTrust = 'organization' | 'community' | 'untrusted'

export type MarketplaceRiskLevel = 'low' | 'elevated' | 'high' | 'blocked'

export type MarketplaceRiskReason =
  | 'install-scripts'
  | 'trusted-host-code'
  | 'source-change'
  | 'protected-plugin'

export type MarketplaceSourceReview = 'first-use' | 'matched' | 'changed'

export type MarketplaceConfirmation =
  | 'allow-build-scripts'
  | 'accept-unsandboxed-build'
  | 'accept-high-risk'
  | 'accept-source-change'

const PROTECTED_PLUGIN_IDS = new Set([
  'better-sidebar-runtime',
  'desktop',
  'desktop-sidebar',
  'dsh-better-sidebar',
  'dsh-context',
  'dsh-auth',
  'sidebar',
  'oh-dsh-desktop',
  'panel-controls',
  'pinned-summary',
  'plugin-marketplace',
  'tui',
  'tui-marketplace',
  'workspace-tools',
])

const PROTECTED_PLUGIN_PACKAGES = new Set([
  '@oh-dsh/better-sidebar-runtime',
  '@oh-dsh/desktop',
  '@oh-dsh/desktop-sidebar',
  '@oh-dsh/panel-controls',
  '@oh-dsh/sidebar',
  '@oh-dsh/tui',
  '@oh-dsh/tui-marketplace',
  '@deepseek-harness-tui/dsh-tui',
  'dsh-better-sidebar',
  'dsh-cc-tui',
  'dsh-context',
  '@deepseek-harness-tui/dsh-auth',
])

const PROTECTED_PLUGIN_REPOSITORIES = new Set([
  'dsh-external/dsh-better-sidebar',
  'omdsh-dev/dsh-better-sidebar',
  'bowenliang123/dsh-context',
  'ccch1mneyyy/dsh-auth',
])

/** Marketplace code cannot replace a shell or its transaction owner. */
export function isProtectedMarketplacePlugin(
  pluginId: string,
  repository?: string,
  packageName?: string,
): boolean {
  return PROTECTED_PLUGIN_IDS.has(pluginId.toLowerCase())
    || (repository !== undefined
      && PROTECTED_PLUGIN_REPOSITORIES.has(repository.toLowerCase()))
    || (packageName !== undefined
      && PROTECTED_PLUGIN_PACKAGES.has(packageName.toLowerCase()))
}

export interface MarketplaceRepositoryStats {
  forks: number
  language: string | null
  license: string | null
  openIssues: number
  stars: number
  updatedAt: string | null
}

export interface MarketplacePlugin {
  builtin: boolean
  category: string
  description: string
  currentCommit: string | null
  enabled: boolean
  id: string
  installed: boolean
  latestCommit: string | null
  mechanism: MarketplaceMechanism
  protected: boolean
  pushedAt: string | null
  repository: string
  runtimeRisk: MarketplaceRuntimeRisk
  stats: MarketplaceRepositoryStats | null
  surfaces: MarketplaceSurfaceSupport
  tags: string[]
  title: string
  trust: MarketplaceTrust
  updateAvailable: boolean
  url: string
}

export interface MarketplaceInstalledPlugin {
  installedAt: string
  mechanism: MarketplaceInstallMechanism
  packageName: string | null
  pluginId: string
  resolvedCommit: string
  source: string
}

export interface MarketplaceSourceLock {
  canonicalSource: string
  firstSeenCommit: string
  manifestHash: string
  mechanism: MarketplaceInstallMechanism
  packageName: string
  pluginId: string
  recordedAt: string
  resolvedCommit: string
}

export interface MarketplacePlan {
  action: MarketplaceAction
  buildScripts: Record<string, string>
  description: string
  mechanism: MarketplaceInstallMechanism
  packageName: string | null
  pluginId: string
  manifestHash: string
  requirements: MarketplaceConfirmation[]
  repository: string
  resolvedCommit: string
  riskLevel: MarketplaceRiskLevel
  riskReasons: MarketplaceRiskReason[]
  source: string
  sourceReview: MarketplaceSourceReview
}

export interface MarketplacePreview {
  action: MarketplaceAction
  isolated: boolean
  pluginId: string
  previewUrl: string | null
  resolvedCommit: string
  startedAt: string
  transactionId: string
}

export interface MarketplaceRecoveryPoint {
  appliedAt: string
  pluginId: string
  transactionId: string
}

export interface MarketplaceLifecycle {
  candidate: MarketplacePreview | null
  current: {
    profile: string
    state: 'live'
  }
  previous: MarketplaceRecoveryPoint | null
}

export interface MarketplaceSnapshot {
  auth: {
    detail: string
    status: MarketplaceAuthStatus
  }
  busy: boolean
  catalog: MarketplacePlugin[]
  catalogGeneratedAt: string | null
  error: string | null
  installed: MarketplaceInstalledPlugin[]
  lastAction: string | null
  lifecycle: MarketplaceLifecycle
  plan: MarketplacePlan | null
  preview: MarketplacePreview | null
  sourceLocks: MarketplaceSourceLock[]
  undoAvailable: boolean
}

export type MarketplaceCommand =
  | { type: 'refresh'; force?: boolean }
  | { type: 'load-repository-stats'; pluginId: string }
  | { type: 'inspect'; action: MarketplaceAction; pluginId: string }
  | { type: 'prepare'; action: MarketplaceAction; pluginId: string }
  | {
    type: 'preview'
    confirmations?: MarketplaceConfirmation[]
  }
  | { type: 'discard' }
  | { type: 'apply' }
  | { type: 'undo' }

export interface PluginMarketplaceBridge {
  dispatch(command: MarketplaceCommand): Promise<MarketplaceSnapshot>
  getSnapshot(): Promise<MarketplaceSnapshot>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Validate untrusted renderer input before it reaches filesystem operations. */
export function parseMarketplaceCommand(value: unknown): MarketplaceCommand {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('marketplace command must be an object with a type')
  }
  if (value.type === 'refresh') {
    if (value.force !== undefined && typeof value.force !== 'boolean') {
      throw new Error('invalid marketplace refresh command')
    }
    return value.force === undefined
      ? { type: 'refresh' }
      : { type: 'refresh', force: value.force }
  }
  if (value.type === 'load-repository-stats') {
    if (typeof value.pluginId !== 'string' || value.pluginId === '') {
      throw new Error('invalid marketplace repository stats command')
    }
    return { type: 'load-repository-stats', pluginId: value.pluginId }
  }
  if (value.type === 'discard' || value.type === 'apply' || value.type === 'undo') {
    return { type: value.type }
  }
  if (value.type === 'inspect' || value.type === 'prepare') {
    if (!['install', 'update', 'enable', 'disable', 'uninstall'].includes(String(value.action))
      || typeof value.pluginId !== 'string') {
      throw new Error('invalid marketplace inspect command')
    }
    return {
      type: value.type,
      action: value.action as MarketplaceAction,
      pluginId: value.pluginId,
    }
  }
  if (value.type === 'preview') {
    const valid = new Set<MarketplaceConfirmation>([
      'allow-build-scripts',
      'accept-unsandboxed-build',
      'accept-high-risk',
      'accept-source-change',
    ])
    if (value.confirmations !== undefined
      && (!Array.isArray(value.confirmations)
        || value.confirmations.some(entry => typeof entry !== 'string'
          || !valid.has(entry as MarketplaceConfirmation)))) {
      throw new Error('invalid marketplace preview confirmations')
    }
    const confirmations = Array.isArray(value.confirmations)
      ? value.confirmations as MarketplaceConfirmation[]
      : [] satisfies MarketplaceConfirmation[]
    return { type: 'preview', confirmations }
  }
  throw new Error(`unsupported marketplace command: ${value.type}`)
}
