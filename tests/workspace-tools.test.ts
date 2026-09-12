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

