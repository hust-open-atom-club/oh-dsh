/**
 * Update UI state for the sidebar entry: a tiny store bridging the About-style
 * update snapshots (DesktopBridge.aboutUpdate) to the two icon instances.
 * 'hidden' means nothing to update — the entry must not mislead; 'visible' is
 * an idle/up-to-date but interactive fallback and the projection for an
 * 'unsupported' manager (dev / non-packaged runs and unsupported platforms),
 * so the entry stays reachable without pretending an update exists;
 * 'available' adds the badge.
 */
import type { AboutUpdateSnapshot } from '../../../../src/contracts.ts'

export type UpdateUiState = 'hidden' | 'visible' | 'available'

export function updateUiFromSnapshot(snapshot: AboutUpdateSnapshot): UpdateUiState {
  return snapshot.status === 'available'
    || snapshot.status === 'downloading'
    || snapshot.status === 'downloaded'
    ? 'available'
    : 'hidden'
}

export interface UpdateUiStore {
  get(): UpdateUiState
  subscribe(listener: () => void): () => void
  set(state: UpdateUiState): void
}

export function createUpdateUiStore(initial: UpdateUiState = 'hidden'): UpdateUiStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      if (next === state) return
      state = next
      for (const listener of listeners) listener()
    },
  }
}
