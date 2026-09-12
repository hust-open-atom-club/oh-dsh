import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { AboutUpdateSnapshot } from '../src/contracts.ts'
import {
  createUpdateSnapshotStore,
  updateIsActionable,
} from '../plugins/update-button/src/client/update-state.ts'

test('updateIsActionable flags only installable states', () => {
  const cases: Array<[AboutUpdateSnapshot, boolean]> = [
    [{ status: 'idle', currentVersion: '0.1.11' }, false],
    [{ status: 'checking' }, false],
    [{ status: 'not-available', latestVersion: '0.1.11' }, false],
    [{ status: 'error' }, false],
    [{ status: 'unsupported' }, false],
    [{ status: 'available', latestVersion: '0.1.12' }, true],
    [{ status: 'downloading', percent: 42, transferred: 4, total: 10, bytesPerSecond: 1 }, true],
    [{ status: 'downloaded', latestVersion: '0.1.12' }, true],
  ]
  for (const [snapshot, expected] of cases) {
    assert.equal(updateIsActionable(snapshot), expected, `snapshot ${snapshot.status}`)
  }
  assert.equal(updateIsActionable(undefined), false, 'no snapshot yet')
})

test('the snapshot store publishes bridge snapshots to subscribers', () => {
  const store = createUpdateSnapshotStore()
  assert.equal(store.get(), undefined)
  let seen: AboutUpdateSnapshot | undefined
  const stop = store.subscribe(() => { seen = store.get() })
  store.set({ status: 'checking' })
  assert.deepEqual(seen, { status: 'checking' })
  stop()
  store.set({ status: 'idle', currentVersion: '1.0.0' })
  assert.deepEqual(seen, { status: 'checking' }, 'unsubscribed listeners stop firing')
  assert.deepEqual(store.get(), { status: 'idle', currentVersion: '1.0.0' })
})

test('the update section registers through the settings.section contract', () => {
  const source = readFileSync(new URL('../plugins/update-button/src/client/plugin.tsx', import.meta.url), 'utf8')
  assert.match(source, /slots\.inject\('settings\.section', \(\) => slots\.register\(\{/)
  assert.match(source, /id: 'oh-dsh-update-button'/)
  assert.match(source, /openUpdater/)
  assert.doesNotMatch(source, /oh-dsh-sidebar-update-host/)
  assert.doesNotMatch(source, /findSidebarLogoRow/)
})
