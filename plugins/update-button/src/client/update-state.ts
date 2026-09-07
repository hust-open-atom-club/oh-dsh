/**
 * Update UI state for the sidebar entry: a tiny store bridging the About-style
 * update snapshots (DesktopBridge.aboutUpdate) to the two icon instances.
 * The entry stays 'hidden' unless the snapshot reports an installable update —
 * it then turns 'available' and shows the badge. An 'unsupported' manager
 * (dev / non-packaged runs and unsupported platforms) reports nothing
 * installable, so it stays hidden like any up-to-date packaged run —
 * packaged and dev surfaces behave alike, with no dev-only affordance.
 */
import type { AboutUpdateSnapshot } from '../../../../src/contracts.ts'

export type UpdateUiState = 'hidden' | 'available'

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
