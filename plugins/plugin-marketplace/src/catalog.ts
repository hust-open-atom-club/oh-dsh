import type {
  MarketplaceInstalledPlugin,
  MarketplaceMechanism,
  MarketplacePlugin,
  MarketplaceRepositoryStats,
  MarketplaceSurfaceKind,
  MarketplaceSurfaceSupport,
} from './protocol.ts'
import {
  isProtectedMarketplacePlugin,
} from './protocol.ts'

export interface MarketplaceCatalog {
  generatedAt: string | null
  plugins: MarketplacePlugin[]
}

interface CatalogRepository {
  bundle?: unknown
  surfaces?: unknown
  category?: unknown
  description?: unknown
  empty?: unknown
  hide?: unknown
  name?: unknown
  note?: unknown
  pushedAt?: unknown
  repository?: unknown
  repo?: unknown
  url?: unknown
  stats?: unknown
  language?: unknown
  license?: unknown
  updatedAt?: unknown
  tags?: unknown
}

interface NormalizedCatalogRow {
  category: string
  surfaces: MarketplaceSurfaceSupport
  description: string
  id: string
  mechanism: MarketplaceMechanism
  pushedAt: string | null
  repository: string
  tags: string[]
  title: string
  trust: MarketplacePlugin['trust']
  url: string
  stats: MarketplaceRepositoryStats | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null
}

function repositoryStats(value: unknown): MarketplaceRepositoryStats | null {
  if (!isRecord(value)) return null
  const forks = nonNegativeInteger(value.forks)
  const openIssues = nonNegativeInteger(value.openIssues)
  const stars = nonNegativeInteger(value.stars)
  if (forks === null || openIssues === null || stars === null) return null
  return {
    forks,
    language: cleanString(value.language),
    license: cleanString(value.license),
    openIssues,
    stars,
    updatedAt: cleanString(value.updatedAt),
  }
}

function mechanism(row: CatalogRepository): MarketplaceMechanism {
  if (row.bundle === true) return 'bundle'
  if (row.repository === true) return 'repository'
  return 'unsupported'
}

function runtimeRisk(value: MarketplaceMechanism): MarketplacePlugin['runtimeRisk'] {
  if (value === 'bundle') return 'profile-bundle'
  if (value === 'repository' || value === 'discover') return 'trusted-host'
  return 'guided'
}

function validRepositoryPart(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(value)
}

function repositoryName(value: unknown): string | null {
  const text = cleanString(value)
  if (text === null) return null
  const match = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(text)
  if (match === null || !validRepositoryPart(match[1] ?? '') || !validRepositoryPart(match[2] ?? '')) {
    return null
  }
  return `${match[1]}/${match[2]}`
}

function tags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap(tag => cleanString(tag) === null ? [] : [cleanString(tag) as string]).slice(0, 16)
    : []
}

const SURFACE_KINDS = new Set<MarketplaceSurfaceKind>(['desktop', 'web', 'tui'])

/**
 * Normalize a catalog `surfaces` declaration. Array entries and object
 * booleans are accepted; undeclared entries default to every surface with
 * `declared: false` so callers can render the assumed/unverified state.
 */
function surfaces(value: unknown): MarketplaceSurfaceSupport {
  const support: MarketplaceSurfaceSupport = {
    declared: false,
    desktop: true,
    web: true,
    tui: true,
  }
  if (Array.isArray(value)) {
    const listed = value.filter((entry): entry is string => typeof entry === 'string')
    if (listed.length === 0) return support
    support.declared = true
    support.desktop = false
    support.web = false
    support.tui = false
    for (const entry of listed) {
      const kind = entry.trim().toLowerCase() as MarketplaceSurfaceKind
      if (SURFACE_KINDS.has(kind)) support[kind] = true
    }
    return support
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter((entry): entry is [MarketplaceSurfaceKind, boolean] =>
      SURFACE_KINDS.has(entry[0] as MarketplaceSurfaceKind)
      && typeof entry[1] === 'boolean')
    if (entries.length === 0) return support
    support.declared = true
    support.desktop = false
    support.web = false
    support.tui = false
    for (const [kind, enabled] of entries) support[kind] = enabled
    return support
  }
  return support
}

function legacyRows(value: Record<string, unknown>): NormalizedCatalogRow[] | null {
  if (value.schema !== 'dsh-external-hub/v0.1' || !Array.isArray(value.repos)) return null
  return value.repos.flatMap(candidate => {
    if (!isRecord(candidate)) return []
    const row = candidate as CatalogRepository
    const id = cleanString(row.name)
    if (id === null || !validRepositoryPart(id) || row.hide === true || row.empty === true) return []
    const repository = repositoryName(row.repo) ?? repositoryName(row.url) ?? `dsh-external/${id}`
    return [{
      category: cleanString(row.category) ?? 'other',
      surfaces: surfaces(row.surfaces),
      description: cleanString(row.note) ?? cleanString(row.description) ?? 'No description provided.',
      id,
      mechanism: mechanism(row),
      pushedAt: cleanString(row.pushedAt),
      repository,
      tags: tags(row.tags),
      title: id,
      stats: repositoryStats(row.stats),
      trust: repository.startsWith('dsh-external/') ? 'organization' : 'community',
      url: `https://github.com/${repository}`,
    }]
  })
}

function registryRows(value: Record<string, unknown>): NormalizedCatalogRow[] | null {
  if (value.schema !== 'omdsh-registry/v1' || !Array.isArray(value.entries)) return null
  return value.entries.flatMap(candidate => {
    if (!isRecord(candidate) || !isRecord(candidate.source)) return []
    const id = cleanString(candidate.id)
    const repository = repositoryName(candidate.source.repository)
    if (id === null || !validRepositoryPart(id) || repository === null) return []
    const install = isRecord(candidate.install) ? candidate.install : {}
    const mode = install.mode
    const installMechanism: MarketplaceMechanism = mode === 'profile-bundle'
      ? 'bundle'
      : mode === 'repository-plugin' ? 'repository' : 'unsupported'
    return [{
      category: cleanString(candidate.kind) ?? 'other',
      surfaces: surfaces(candidate.surfaces),
      description: cleanString(candidate.description) ?? 'No description provided.',
      id,
      mechanism: installMechanism,
      pushedAt: null,
      repository,
      tags: tags(candidate.tags),
      title: cleanString(candidate.displayName) ?? id,
      stats: repositoryStats(candidate.stats),
      trust: isRecord(candidate.listing) && candidate.listing.state === 'reviewed'
        ? 'organization'
        : 'community',
      url: `https://github.com/${repository}`,
    }]
  })
}

function communityRows(value: Record<string, unknown>): NormalizedCatalogRow[] | null {
  if (!isRecord(value._meta) || value._meta.schema_version !== '1.0' || !Array.isArray(value.plugins)) {
    return null
  }
  return value.plugins.flatMap(candidate => {
    if (!isRecord(candidate)) return []
    const id = cleanString(candidate.id)
    const repository = repositoryName(candidate.repo) ?? repositoryName(candidate.url)
    if (id === null || !validRepositoryPart(id) || repository === null) return []
    const description = isRecord(candidate.description)
      ? cleanString(candidate.description.en) ?? cleanString(candidate.description.zh)
      : cleanString(candidate.description)
    return [{
      category: cleanString(candidate.category) ?? 'other',
      surfaces: surfaces(candidate.surfaces),
      description: description ?? 'No description provided.',
      id,
      mechanism: 'discover',
      pushedAt: null,
      repository,
      tags: tags(candidate.tags),
      title: cleanString(candidate.name) ?? id,
      stats: repositoryStats(candidate.stats),
      trust: 'community',
      url: `https://github.com/${repository}`,
    }]
  })
}

/** Parse supported public catalog schemas without trusting their source paths. */
export function parseMarketplaceCatalog(
  value: unknown,
  installed: readonly MarketplaceInstalledPlugin[] = [],
): MarketplaceCatalog {
  if (!isRecord(value)) throw new Error('unsupported plugin catalog')
  const rows = legacyRows(value) ?? registryRows(value) ?? communityRows(value)
  if (rows === null) throw new Error('unsupported plugin catalog')
  const installedIds = new Set(installed.map(entry => entry.pluginId))
  const plugins: MarketplacePlugin[] = rows.map(row => {
    const protectedPlugin = isProtectedMarketplacePlugin(row.id, row.repository)
    return {
      builtin: protectedPlugin,
      category: row.category,
      currentCommit: null,
      description: row.description,
      surfaces: row.surfaces,
      enabled: false,
      id: row.id,
      installed: installedIds.has(row.id),
      latestCommit: null,
      mechanism: row.mechanism,
      protected: protectedPlugin,
      pushedAt: row.pushedAt,
      repository: row.repository,
      runtimeRisk: runtimeRisk(row.mechanism),
      stats: row.stats,
      tags: row.tags,
      title: row.title,
      trust: row.trust,
      updateAvailable: false,
      url: row.url,
    }
  })
  plugins.sort((left, right) => {
    if (left.installed !== right.installed) return left.installed ? -1 : 1
    if (left.mechanism === 'unsupported' && right.mechanism !== 'unsupported') return 1
    if (right.mechanism === 'unsupported' && left.mechanism !== 'unsupported') return -1
    return left.title.localeCompare(right.title)
  })
  return {
    generatedAt: cleanString(value.generated) ?? cleanString(value.generatedAt)
      ?? (isRecord(value._meta) ? cleanString(value._meta.generated_at) : null),
    plugins,
  }
}
