import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  nearestVersionTag,
  normalizeVersionTag,
  resolveProductVersion,
} from '../src/version.ts'

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' })
}

test('product version follows the nearest reachable release tag', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-version-'))
  try {
    git(root, 'init', '--quiet')
    git(root, 'config', 'user.name', 'Oh-DSH Test')
    git(root, 'config', 'user.email', 'test@example.com')
    writeFileSync(join(root, 'package.json'), '{"version":"9.9.9"}\n')
    git(root, 'add', 'package.json')
    git(root, 'commit', '--quiet', '-m', 'initial')
    git(root, 'tag', 'v1.2.3')
    writeFileSync(join(root, 'next.txt'), 'next\n')
    git(root, 'add', 'next.txt')
    git(root, 'commit', '--quiet', '-m', 'next')

    assert.equal(nearestVersionTag(root), '1.2.3')
    assert.equal(resolveProductVersion(root), '1.2.3')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release tag normalization preserves prerelease versions', () => {
  assert.equal(normalizeVersionTag('v0.2.0-rc.3\n'), '0.2.0-rc.3')
  assert.equal(normalizeVersionTag('release-0.2.0'), undefined)
})

test('product version falls back to the manifest without a git repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-version-manifest-'))
  try {
    writeFileSync(join(root, 'package.json'), '{"version":"v0.5.2"}\n')
    assert.equal(resolveProductVersion(root), '0.5.2')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('product version falls back to the lib layout when the root manifest is invalid', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-version-lib-'))
  try {
    writeFileSync(join(root, 'package.json'), '{"version":"not-a-version"}\n')
    mkdirSync(join(root, 'lib', 'oh-dsh'), { recursive: true })
    writeFileSync(join(root, 'lib', 'oh-dsh', 'package.json'), '{"version":"0.4.1"}\n')
    assert.equal(resolveProductVersion(root), '0.4.1')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('product version resolves to 0.0.0 when nothing else is available', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-version-none-'))
  try {
    assert.equal(resolveProductVersion(root), '0.0.0')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release tag normalization handles build metadata, bare prefixes, and whitespace', () => {
  assert.equal(normalizeVersionTag('1.2.3+build.1'), '1.2.3+build.1')
  assert.equal(normalizeVersionTag('v1.2.3+build.1'), '1.2.3+build.1')
  assert.equal(normalizeVersionTag('v'), undefined)
  assert.equal(normalizeVersionTag('   '), undefined)
  assert.equal(normalizeVersionTag(''), undefined)
})
