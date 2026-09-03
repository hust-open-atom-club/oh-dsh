/** Added and deleted line counts for a unified diff. */
export interface DiffStats {
  additions: number
  deletions: number
}

/** Count added and deleted lines inside unified-diff hunks. */
export function diffStats(text: string): DiffStats {
  let additions = 0
  let deletions = 0
  let inHunk = false
  for (const line of text.split(/\r?\n/)) {
    if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line)) {
      inHunk = true
      continue
    }
    if (!inHunk || line.startsWith('\\')) continue
    if (line.startsWith('+')) additions += 1
    else if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

/** Count logical text lines without treating a final newline as an extra line. */
export function textLineCount(text: string): number {
  if (text === '') return 0
  const lines = text.split(/\r?\n/)
  return lines.at(-1) === '' ? lines.length - 1 : lines.length
}

/** Add multiple diff-count records without mutating any input record. */
export function addDiffStats(...stats: readonly DiffStats[]): DiffStats {
  return stats.reduce(
    (total, next) => ({
      additions: total.additions + next.additions,
      deletions: total.deletions + next.deletions,
    }),
    { additions: 0, deletions: 0 },
  )
}

/** Current scope and load state used by the diff-summary refresh policy. */
export interface DiffSummaryRefreshState {
  scopeKey: string | null
  hasSummary: boolean
}

/** Refresh decision for preserving or clearing the visible diff summary. */
export interface DiffSummaryRefreshPlan {
  state: DiffSummaryRefreshState
  clearSummary: boolean
  loading: boolean
}

/** Decide whether a refresh should keep the visible summary or show initial loading. */
export function prepareDiffSummaryRefresh(
  current: DiffSummaryRefreshState,
  nextScopeKey: string | null,
  enabled: boolean,
): DiffSummaryRefreshPlan {
  if (!enabled) {
    return {
      state: { scopeKey: nextScopeKey, hasSummary: false },
      clearSummary: true,
      loading: false,
    }
  }
  const scopeChanged = current.scopeKey !== nextScopeKey
  const state: DiffSummaryRefreshState = {
    scopeKey: nextScopeKey,
    hasSummary: !scopeChanged && current.hasSummary,
  }
  return {
    state,
    clearSummary: scopeChanged,
    loading: !state.hasSummary,
  }
}
