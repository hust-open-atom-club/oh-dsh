import type { MarketplacePlugin } from '../protocol.ts'

/** Format a catalog timestamp without leaking "Invalid Date" into a surface. */
export function formatMarketplaceDate(
  value: string | null,
  locale: string,
  unknown: string,
): string {
  if (value === null) return unknown
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return unknown
  return date.toLocaleString(locale)
}

/** Compact GitHub counts consistently across the browser and terminal surfaces. */
export function formatMarketplaceCount(value: number | null, locale = 'en'): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    notation: 'compact',
  }).format(value)
}

/** Omit missing values while retaining a stable, compact GitHub summary. */
export function marketplaceRepositoryStats(
  plugin: MarketplacePlugin,
  locale = 'en',
): string[] {
  const stars = formatMarketplaceCount(plugin.stats?.stars ?? null, locale)
  const forks = formatMarketplaceCount(plugin.stats?.forks ?? null, locale)
  const issues = formatMarketplaceCount(plugin.stats?.openIssues ?? null, locale)
  return [
    stars === null ? null : `★ ${stars}`,
    forks === null ? null : `⑂ ${forks}`,
    issues === null ? null : `● ${issues}`,
    plugin.stats?.language ?? null,
  ].filter((value): value is string => value !== null)
}

/** Format all repository fields shown in a marketplace detail view. */
export function marketplaceRepositoryDetails(
  plugin: MarketplacePlugin,
  locale = 'en-US',
  unknown = 'unknown',
): string[] {
  if (plugin.stats === null) return []
  return [
    `GitHub: ★ ${plugin.stats.stars} · forks ${plugin.stats.forks} · issues + PRs ${plugin.stats.openIssues}`,
    `language: ${plugin.stats.language ?? unknown}`,
    `license: ${plugin.stats.license ?? unknown}`,
    `updated: ${formatMarketplaceDate(plugin.stats.updatedAt, locale, unknown)}`,
  ]
}
