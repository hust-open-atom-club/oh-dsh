import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadSidebarPreferences } from '../plugins/sidebar/src/preferences-server.ts'
import {
  DesktopSidebarService,
  type DesktopSidebarTabDescriptor,
} from '../plugins/sidebar/src/client/sidebar-service.ts'
import type { SidebarPreferencesStorage } from '../plugins/sidebar/src/client/sidebar-storage.ts'
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  parseSidebarPreferences,
  type DesktopSidebarPreferences,
} from '../plugins/sidebar/src/sidebar-preferences.ts'

class MemorySidebarStorage implements SidebarPreferencesStorage {
  writes: DesktopSidebarPreferences[] = []
  value: DesktopSidebarPreferences

  constructor(value?: DesktopSidebarPreferences) {
    this.value = value ?? {
      ...DEFAULT_SIDEBAR_PREFERENCES,
      sessions: {},
      tabsEnabled: {},
      viewersEnabled: {},
    }
  }

  async load(): Promise<DesktopSidebarPreferences> {
    return structuredClone(this.value)
  }

  async save(preferences: DesktopSidebarPreferences): Promise<void> {
    this.value = structuredClone(preferences)
    this.writes.push(structuredClone(preferences))
  }
}

function tab(
  id: string,
  input: Partial<DesktopSidebarTabDescriptor> = {},
): DesktopSidebarTabDescriptor {
  return {
    id,
    render: () => null,
    title: id,
    ...input,
  }
}

test('desktop sidebar validates the durable preference envelope', () => {
  const valid = {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    sessions: {
      session: {
        activeId: 'file:a',
        lastUsed: 42,
        tabs: [{ id: 'file:a', type: 'file', title: 'a', resource: '/a' }],
      },
    },
    tabsEnabled: { browser: false },
    viewersEnabled: { image: true },
  }
  assert.deepEqual(parseSidebarPreferences(valid), valid)
  assert.equal(parseSidebarPreferences({ ...valid, defaultWidth: 100 }), undefined)
  assert.equal(
    parseSidebarPreferences({ ...valid, defaultWidth: 720 })?.defaultWidth,
    480,
  )
  assert.equal(parseSidebarPreferences({
    ...valid,
    sessions: {
      session: { ...valid.sessions.session, activeId: 'missing' },
    },
  }), undefined)
})

test('desktop sidebar restores sessions and deduplicates registered tabs', async () => {
  const storage = new MemorySidebarStorage({
    ...DEFAULT_SIDEBAR_PREFERENCES,
    sessions: {
      first: {
        activeId: 'file:readme',
        lastUsed: 1,
        tabs: [{
          id: 'file:readme',
          resource: '/workspace/README.md',
          title: 'README.md',
          type: 'file',
        }],
      },
    },
    tabsEnabled: {},
    viewersEnabled: {},
  })
  const sidebar = new DesktopSidebarService(storage)
  sidebar.setSession('first')
  await sidebar.start()
  const removeFile = sidebar.registerTab(tab('file', {
    dedupeKey: candidate => candidate.resource,
  }))

  assert.equal(sidebar.getSnapshot().activeId, 'file:readme')
  assert.equal(sidebar.openTab({
    resource: '/workspace/README.md',
    title: 'README.md',
    type: 'file',
  }).kind, 'focused')
  assert.equal(sidebar.getSnapshot().tabs.length, 1)

  sidebar.registerTab(tab('review', { single: true }))
  sidebar.openTab({ type: 'review' })
  sidebar.openTab({ id: 'another-review', type: 'review' })
  assert.equal(
    sidebar.getSnapshot().tabs.filter(candidate => candidate.type === 'review').length,
    1,
  )

  removeFile()
  assert.equal(sidebar.getTab('file'), undefined)
  assert.equal(sidebar.getSnapshot().tabs[0]?.type, 'file')
})

test('desktop sidebar matches viewers by priority, sniffing, and enablement', async () => {
  const sidebar = new DesktopSidebarService(new MemorySidebarStorage())
  await sidebar.start()
  sidebar.registerViewer({
    extensions: [],
    fetchStrategy: 'text',
    id: 'text',
    order: -100,
    title: 'Text',
  })
  sidebar.registerViewer({
    extensions: ['png'],
    fetchStrategy: 'media-url',
    id: 'image',
    title: 'Image',
  })
  sidebar.registerViewer({
    detect: (_path, head) => head.includes(0),
    extensions: [],
    fetchStrategy: 'binary-download',
    id: 'binary',
    order: 100,
    title: 'Binary',
  })

  assert.equal(sidebar.matchViewer('photo.PNG')?.id, 'image')
  assert.equal(
    sidebar.matchViewer('blob.data', new Uint8Array([1, 0, 2]))?.id,
    'binary',
  )
  sidebar.setViewerEnabled('image', false)
  assert.equal(sidebar.matchViewer('photo.png')?.id, 'text')
})

test('desktop sidebar persists bounded per-session state outside Web storage', async () => {
  const storage = new MemorySidebarStorage()
  const sidebar = new DesktopSidebarService(storage)
  await sidebar.start()
  sidebar.registerTab(tab('browser'))
  sidebar.registerViewer({
    extensions: [],
    fetchStrategy: 'text',
    id: 'text',
    title: 'Text',
  })
  sidebar.setSession('conversation-1')
  sidebar.openTab({
    resource: 'https://example.com',
    title: 'example.com',
    type: 'browser',
  })
  sidebar.setWidth(512)
  sidebar.setOpenByDefault(true)
  sidebar.setTabEnabled('browser', false)
  sidebar.setViewerEnabled('text', false)
  await sidebar.settle()

  assert.equal(storage.value.defaultWidth, 480)
  assert.equal(storage.value.openByDefault, true)
  assert.equal(storage.value.tabsEnabled.browser, false)
  assert.equal(storage.value.viewersEnabled.text, false)
  assert.equal(storage.value.sessions['conversation-1']?.tabs.length, 1)
  assert.equal(storage.writes.length, 1)
})

test('desktop sidebar preferences migrate from the pre-rename durable file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oh-dsh-sidebar-legacy-'))
  const path = join(directory, 'sidebar.json')
  const legacy = join(directory, 'desktop-sidebar.json')
  const preferences: DesktopSidebarPreferences = {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    defaultWidth: 400,
    openByDefault: true,
  }
  try {
    await writeFile(legacy, `${JSON.stringify(preferences, undefined, 2)}\n`)
    assert.deepEqual(await loadSidebarPreferences(path), preferences)
    assert.deepEqual(
      JSON.parse(await readFile(path, 'utf8')) as DesktopSidebarPreferences,
      preferences,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})


test('workspace review uses one SVG icon language', async () => {
  const sourceText = await readFile(join(process.cwd(), 'plugins/sidebar/src/client/plugin.tsx'), 'utf8')
  assert.match(sourceText, /function WorkspaceIcon\(/)
  for (const glyph of ['▣', '◷', '▱', '⑂', '—◯—', '›_']) {
    assert.doesNotMatch(sourceText, new RegExp(glyph))
  }
  assert.match(sourceText, /<WorkspaceIcon name="changes" \/>/)
  assert.match(sourceText, /const \[changesOpen, setChangesOpen\] = useState\(false\)/)
  assert.match(sourceText, /aria-expanded=\{changesOpen\}/)
  assert.match(sourceText, /const \[historyOpen, setHistoryOpen\] = useState\(false\)/)
  assert.match(sourceText, /aria-expanded=\{historyOpen\}/)
  assert.match(sourceText, /oh-dsh-review-history-toggle/)
  assert.match(sourceText, /from '\.\/diff-stats\.ts'/)
  assert.match(sourceText, /const \[changeStats, setChangeStats\]/)
  assert.match(sourceText, /prepareDiffSummaryRefresh/)
  assert.match(sourceText, /<WorkspaceIcon name="chevron" \/>/)
  assert.match(sourceText, /<WorkspaceIcon name="branch" \/>/)
  assert.match(sourceText, /<WorkspaceIcon name="commit" \/>/)
  assert.match(sourceText, /function WorkspaceDropdown\(/)
  assert.match(sourceText, /role="listbox"/)
  assert.doesNotMatch(sourceText, /<select/)
})
