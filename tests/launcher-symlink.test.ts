import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const launcher = join(root, 'bin', 'ohdsh')

/**
 * The macOS install docs symlink bin/ohdsh into /usr/local/bin; the launcher
 * must resolve that link back to the installed application instead of
 * reporting "Oh-DSH is not built" (issue #116).
 */
test('bin/ohdsh resolves symlinks to the installed runtime', { skip: process.platform === 'win32' }, () => {
  const installRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-launcher-'))
  const linkDir = mkdtempSync(join(tmpdir(), 'oh-dsh-launcher-link-'))
  try {
    // Minimal installed layout: the packaged branch of bin/ohdsh only checks
    // that the staged node binary exists and the CLI entry is a file.
    const nodeBin = join(installRoot, 'node-runtime', 'bin')
    mkdirSync(nodeBin, { recursive: true })
    writeFileSync(join(nodeBin, 'node'), '#!/bin/sh\necho "fake-node $@"\n')
    chmodSync(join(nodeBin, 'node'), 0o755)
    const cliDir = join(installRoot, 'lib', 'oh-dsh')
    mkdirSync(cliDir, { recursive: true })
    writeFileSync(join(cliDir, 'cli.js'), '')

    const appBin = join(installRoot, 'bin')
    mkdirSync(appBin, { recursive: true })
    copyFileSync(launcher, join(appBin, 'ohdsh'))
    chmodSync(join(appBin, 'ohdsh'), 0o755)
    const link = join(linkDir, 'ohdsh')
    symlinkSync(join(appBin, 'ohdsh'), link)

    const output = execFileSync('sh', [link, 'tui'], { encoding: 'utf8' })
    assert.match(output, /fake-node .*lib\/oh-dsh\/cli\.js/)
  } finally {
    rmSync(installRoot, { recursive: true, force: true })
    rmSync(linkDir, { recursive: true, force: true })
  }
})
