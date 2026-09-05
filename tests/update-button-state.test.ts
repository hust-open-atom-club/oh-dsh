import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AboutUpdateSnapshot } from '../src/contracts.ts'
import {
  createUpdateUiStore,
  updateUiFromSnapshot,
  type UpdateUiState,
} from '../plugins/update-button/src/client/update-state.ts'

test('updateUiFromSnapshot keeps the update entry hidden unless an installable state is reported', () => {
  const cases: Array<[AboutUpdateSnapshot, UpdateUiState]> = [
    // Nothing to act on: the entry must not render a misleading affordance.
    [{ status: 'idle', currentVersion: '0.1.11' }, 'hidden'],
    [{ status: 'checking' }, 'hidden'],
    [{ status: 'not-available', latestVersion: '0.1.11' }, 'hidden'],
    [{ status: 'error' }, 'hidden'],
    // An update exists and can be downloaded/installed: show the badge.
    [{ status: 'available', latestVersion: '0.1.12' }, 'available'],
    [{ status: 'downloading', percent: 42, transferred: 4, total: 10, bytesPerSecond: 1 }, 'available'],
    [{ status: 'downloaded', latestVersion: '0.1.12' }, 'available'],
  ]
  for (const [snapshot, expected] of cases) {
    assert.equal(updateUiFromSnapshot(snapshot), expected, `snapshot ${snapshot.status}`)
  }
})

test('updateUiFromSnapshot surfaces unsupported as a badge-free interactive entry', () => {
  // Dev / non-packaged runs and unsupported platforms report 'unsupported'
  // after a check: keep the entry visible (no red badge — nothing is
  // installable) instead of hiding it.
  assert.equal(updateUiFromSnapshot({ status: 'unsupported' }), 'visible')
})

test('updateUiFromSnapshot never claims an update exists for idle or failed states', () => {
  for (const snapshot of [
    { status: 'idle', currentVersion: '0.1.11' },
    { status: 'checking' },
    { status: 'not-available', latestVersion: '0.1.11' },
    { status: 'error' },
  ] as AboutUpdateSnapshot[]) {
    assert.notEqual(updateUiFromSnapshot(snapshot), 'available', `snapshot ${snapshot.status}`)
  }
})

test('update store notifies listeners only on real changes', () => {
  const store = createUpdateUiStore('hidden')
  const seen: UpdateUiState[] = []
  const unsubscribe = store.subscribe(() => { seen.push(store.get()) })

  assert.equal(store.get(), 'hidden')
  store.set('hidden')        // no-op: same state
  store.set('available')
  store.set('available')     // no-op: duplicate
  store.set('hidden')
  assert.deepEqual(seen, ['available', 'hidden'])

  unsubscribe()
  store.set('available')     // listener removed: no notification, state still updates
  assert.deepEqual(seen, ['available', 'hidden'])
  assert.equal(store.get(), 'available')
})

test('update store starts from an explicit initial state', () => {
  const store = createUpdateUiStore('available')
  assert.equal(store.get(), 'available')
})
