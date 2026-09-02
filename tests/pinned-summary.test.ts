import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  latestSummary,
  summaryMetadata,
  summaryState,
  truncateSummary,
} from '../plugins/pinned-summary/src/client.ts'

test('selects the latest usable summary', () => {
  assert.deepEqual(
    latestSummary([
      { kind: 'assistant', blocks: [{ kind: 'text', text: 'older answer' }] },
      { kind: 'compaction', summary: '  durable context summary  ' },
      { kind: 'assistant', blocks: [{ kind: 'text', text: 'newer answer' }] },
    ]),
    { kind: 'context', text: 'durable context summary' },
  )

  assert.deepEqual(
    latestSummary([{
      kind: 'assistant',
      blocks: [
        { kind: 'reasoning', text: 'internal reasoning' },
        { kind: 'text', text: 'first part' },
        { kind: 'tool-call', name: 'shell', callId: 'call-1', argsRaw: '{}' },
        { kind: 'text', text: 'second part' },
      ],
    }]),
    { kind: 'assistant', text: 'first part\nsecond part' },
  )
  assert.equal(latestSummary([{ kind: 'assistant', blocks: [] }]), undefined)
})

test('truncates long previews while preserving short summaries', () => {
  assert.deepEqual(truncateSummary('  short summary  ', 32), {
    text: 'short summary',
    truncated: false,
  })
  assert.deepEqual(truncateSummary('0123456789abcdef', 12), {
    text: '0123456789a\u2026',
    truncated: true,
  })
})

test('extracts model, tools, and time range from conversation nodes', () => {
  assert.deepEqual(
    summaryMetadata([
      {
        kind: 'assistant',
        time: 220,
        provenance: { provider: 'deepseek', model: 'deepseek-v4' },
        timing: { stepStartTime: 100, completedTime: 220 },
      },
      {
        kind: 'assistant',
        provenance: { provider: 'deepseek', model: 'deepseek-v5' },
      },
      {
        kind: 'tool-result',
        time: 240,
        call: { name: 'read_file' },
      },
      {
        kind: 'tool-result',
        time: 260,
        call: { name: 'read_file' },
      },
    ]),
    {
      provider: 'deepseek',
      model: 'deepseek-v5',
      toolCount: 2,
      toolNames: ['read_file'],
      startedAt: 100,
      completedAt: 260,
    },
  )
})

test('maps session data to the visible summary lifecycle state', () => {
  const session = {
    id: 'session-1',
    displayTitle: 'Session 1',
    running: false,
    pendingInteraction: undefined,
    completed: false,
    blank: false,
    updatedAt: 1,
  }
  const snapshot = {
    openState: 'open',
    openError: null,
    nodes: [],
    running: false,
    pending: [],
    blank: false,
  }
  const cases = [
    { expected: 'no-session', session: undefined, snapshot: undefined },
    { expected: 'loading', session, snapshot: { ...snapshot, openState: 'loading' } },
    { expected: 'error', session, snapshot: { ...snapshot, openState: 'error', openError: new Error('offline') } },
    { expected: 'blank', session: { ...session, blank: true }, snapshot: { ...snapshot, blank: true } },
    { expected: 'running', session: { ...session, running: true }, snapshot },
    { expected: 'waiting', session, snapshot: { ...snapshot, pending: [{ kind: 'question' }] } },
    { expected: 'unavailable', session, snapshot },
    {
      expected: 'ready',
      session,
      snapshot: {
        ...snapshot,
        nodes: [{ kind: 'assistant', blocks: [{ kind: 'text', text: 'ready' }] }],
      },
    },
  ] as const

  for (const scenario of cases) {
    assert.equal(summaryState(scenario.session, scenario.snapshot), scenario.expected)
  }
})
