import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import {
  mutateWorkspace,
  readWorkspaceFacts,
} from '../plugins/sidebar/src/git-workspace.ts'
import {
  mapBetterSidebarFile,
  mapBetterSidebarTree,
  workspaceChangesFromBetterSidebar,
} from '../plugins/sidebar/src/client/better-sidebar-api.ts'

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

test('workspace extension provides repository facts and branch creation', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'oh-dsh-workspace-tools-'))
  try {
    git(workspace, ['init', '-b', 'main'])
    git(workspace, ['config', 'user.name', 'Oh DSH Test'])
    git(workspace, ['config', 'user.email', 'oh-dsh@example.test'])
    writeFileSync(join(workspace, 'README.md'), 'first\n')
    git(workspace, ['add', 'README.md'])
    git(workspace, ['commit', '-m', 'initial'])
    const facts = await readWorkspaceFacts(workspace)
    assert.equal(facts.kind, 'repository')
    assert.equal(facts.name, basename(workspace))
    assert.equal(facts.hasRemote, false)

    const branched = await mutateWorkspace(workspace, { action: 'create-branch', branch: 'panel-test' })
    assert.equal(branched.facts.kind, 'repository')
    assert.equal(git(workspace, ['branch', '--show-current']).trim(), 'panel-test')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Better Sidebar status maps into the Oh-DSH workspace model', () => {
  assert.deepEqual(workspaceChangesFromBetterSidebar([
    { path: 'staged.ts', xy: 'M ' },
    { path: 'renamed.ts', xy: 'R ' },
    { path: 'loose.txt', xy: '??' },
  ]), [
    { path: 'loose.txt', oldPath: null, status: 'untracked', staged: false, unstaged: true },
    { path: 'renamed.ts', oldPath: null, status: 'renamed', staged: true, unstaged: false },
    { path: 'staged.ts', oldPath: null, status: 'modified', staged: true, unstaged: false },
  ])
})

test('workspace files adapt Better Sidebar responses to the Oh-DSH UI', () => {
  const root = mapBetterSidebarTree('/workspace', {
    path: '/workspace/src',
    entries: [
      { name: 'nested', path: '/workspace/src/nested', isDir: true, hidden: false },
      { name: 'index.ts', path: '/workspace/src/index.ts', isDir: false, hidden: false },
    ],
    truncated: false,
  })
  assert.equal(root.kind, 'directory')
  if (root.kind !== 'directory') return
  assert.equal(root.parent, '/workspace')
  assert.deepEqual(root.entries.map(entry => [entry.name, entry.kind]), [
    ['nested', 'directory'],
    ['index.ts', 'file'],
  ])
  const preview = mapBetterSidebarFile('/workspace', '/workspace/src/index.ts', {
    kind: 'text',
    content: 'export const ready = true\n',
    truncated: false,
  })
  assert.equal(preview.kind, 'file')
  if (preview.kind === 'file') assert.match(preview.content ?? '', /ready = true/)
})

test('Better Sidebar status preserves both staged and unstaged sides', () => {
  assert.deepEqual(workspaceChangesFromBetterSidebar([
    { path: 'mixed.ts', xy: 'MM' },
  ]), [
    { path: 'mixed.ts', oldPath: null, status: 'modified', staged: true, unstaged: true },
  ])
})
