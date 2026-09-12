/**
 * Update state for the Settings update section: a tiny store bridging the
 * About-style update snapshots (DesktopBridge.aboutUpdate) to the section's
 * status row. An 'unsupported' manager (dev / non-packaged runs and
 * unsupported platforms) reports nothing installable and reads like any
 * up-to-date run — packaged and dev surfaces behave alike.
 */
import type { AboutUpdateSnapshot } from '../../../../src/contracts.ts'

export interface UpdateSnapshotStore {
  get(): AboutUpdateSnapshot | undefined
  subscribe(listener: () => void): () => void
  set(snapshot: AboutUpdateSnapshot): void
}

export function createUpdateSnapshotStore(): UpdateSnapshotStore {
  let snapshot: AboutUpdateSnapshot | undefined
  const listeners = new Set<() => void>()
  return {
    get: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

/** Whether a snapshot reports something the update window would act on. */
export function updateIsActionable(snapshot: AboutUpdateSnapshot | undefined): boolean {
  return snapshot !== undefined
    && (snapshot.status === 'available'
      || snapshot.status === 'downloading'
      || snapshot.status === 'downloaded')
}
