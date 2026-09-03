import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diffStats, prepareDiffSummaryRefresh, textLineCount } from '../plugins/sidebar/src/client/diff-stats.ts'

test('diff stats count hunk content that resembles file headers', () => {
  assert.deepEqual(diffStats([
    'diff --git a/file.txt b/file.txt',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1 +1 @@',
    '---old-content',
    '+++new-content',
  ].join('\n')), { additions: 1, deletions: 1 })
})

test('text line count ignores only the final newline', () => {
  assert.equal(textLineCount('one\ntwo\n'), 2)
  assert.equal(textLineCount('one\ntwo'), 2)
  assert.equal(textLineCount(''), 0)
})

test('diff summary refresh keeps loaded counts during same-scope polling', () => {
  const scope = 'session-1\u0000C:/workspace'
  const first = prepareDiffSummaryRefresh(
    { scopeKey: null, hasSummary: false },
    scope,
    true,
  )
  assert.deepEqual(first, {
    state: { scopeKey: scope, hasSummary: false },
    clearSummary: true,
    loading: true,
  })

  const background = prepareDiffSummaryRefresh(
    { ...first.state, hasSummary: true },
    scope,
    true,
  )
  assert.deepEqual(background, {
    state: { scopeKey: scope, hasSummary: true },
    clearSummary: false,
    loading: false,
  })

  const switched = prepareDiffSummaryRefresh(background.state, 'session-2\u0000D:/other', true)
  assert.equal(switched.clearSummary, true)
  assert.equal(switched.loading, true)
})
