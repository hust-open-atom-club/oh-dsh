import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  createStageRuntime,
} from '../scripts/stage-runtime-lib.mjs'

function writeManifest(directory: string, manifest: object): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
}

function buildStaging(nodeRuntime: string, isWindowsNode: boolean) {
  const staging = createStageRuntime({
    root: nodeRuntime,
    stage: join(nodeRuntime, '.stage'),
    runtime: nodeRuntime,
    nodeRuntime,
    dshSource: nodeRuntime,
    isWindowsNode,
    nodePlatform: isWindowsNode ? 'win' : 'linux',
    nodeArch: 'x64',
    npmRelease: true,
    run: () => {
      throw new Error('unexpected run')
    },
  })
  return { staging, translateNpmInvocation: staging.translateNpmInvocation }
}

function translation() {
  const { staging: { translateNpmInvocation } } = buildStaging(join(tmpdir(), 'oh-dsh-npm-forward-standalone'), false)
  return translateNpmInvocation
}

test('translateNpmInvocation maps common npm subcommands onto pnpm', () => {
  const translateNpmInvocation = translation()
  assert.deepEqual(translateNpmInvocation(['run', 'build']), ['run', 'build'])
  assert.deepEqual(translateNpmInvocation(['run', 'build', '--', '--watch']), [
    'run', 'build', '--', '--watch',
  ])
  assert.deepEqual(translateNpmInvocation(['install']), ['install'])
  assert.deepEqual(translateNpmInvocation(['ci']), ['install', '--frozen-lockfile'])
  assert.deepEqual(translateNpmInvocation(['ci', '--omit=dev']), [
    'install', '--frozen-lockfile', '--omit=dev',
  ])
  assert.deepEqual(translateNpmInvocation(['test']), ['test'])
  assert.deepEqual(translateNpmInvocation(['i', 'left-pad']), ['install', 'left-pad'])
  assert.deepEqual(translateNpmInvocation(['t']), ['test'])
  assert.deepEqual(translateNpmInvocation(['uninstall', 'left-pad']), ['remove', 'left-pad'])
  assert.deepEqual(translateNpmInvocation(['rm', 'left-pad']), ['remove', 'left-pad'])
  assert.deepEqual(translateNpmInvocation(['run-script', 'build']), ['run', 'build'])
  assert.deepEqual(translateNpmInvocation(['exec', '--', 'tsc']), ['exec', '--', 'tsc'])
  assert.deepEqual(translateNpmInvocation(['--version']), ['--version'])
  assert.deepEqual(translateNpmInvocation(['publish']), ['publish'])
})

test('translateNpmInvocation translates --prefix into pnpm --dir', () => {
  const translateNpmInvocation = translation()
  assert.deepEqual(translateNpmInvocation(['--prefix', './pkg', 'run', 'build']), [
    '--dir', './pkg', 'run', 'build',
  ])
  assert.deepEqual(translateNpmInvocation(['install', '--prefix=/target']), [
    '--dir=/target', 'install',
  ])
})

test('translateNpmInvocation forwards npx invocations as pnpm exec', () => {
  const translateNpmInvocation = translation()
  assert.deepEqual(translateNpmInvocation(['tsc', '--noEmit'], 'npx'), [
    'exec', 'tsc', '--noEmit',
  ])
  assert.deepEqual(translateNpmInvocation(['-y', 'tsc'], 'npx'), ['exec', 'tsc'])
  assert.deepEqual(translateNpmInvocation(['--yes', 'tsc'], 'npx'), ['exec', 'tsc'])
})

test('translateNpmInvocation fails with guidance for npm-only invocations', () => {
  const translateNpmInvocation = translation()
  assert.throws(() => translateNpmInvocation([]), /without a subcommand/)
  assert.throws(() => translateNpmInvocation(['config', 'set', 'foo', 'bar']), /no bundled translation/)
  assert.throws(() => translateNpmInvocation(['dist-tag']), /no bundled translation/)
})

test('stageNpmForwardingShims installs Windows launchers beside node.exe', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'oh-dsh-npm-forward-'))
  const nodeRuntime = join(fixture, 'node-runtime')
  try {
    mkdirSync(nodeRuntime, { recursive: true })
    const { staging, translateNpmInvocation } = buildStaging(nodeRuntime, true)
    staging.stageNpmForwardingShims()

    const forwarder = join(nodeRuntime, 'node_modules', 'npm-forward.mjs')
    assert.equal(existsSync(forwarder), true, 'forwarder staged')
    const source = readFileSync(forwarder, 'utf8')
    assert.match(source, /import \{ spawn \} from 'node:child_process'/)
    assert.match(source, /pnpm\.mjs/)
    // The staged forwarder embeds the same translation the library exports,
    // so the tested logic is the shipped logic.
    const embedded = /const translateNpmInvocation = ([\s\S]*?)\n\nconst \[invocation/.exec(source)
    assert.ok(embedded !== null, 'translation function embedded')
    assert.ok(embedded[1] !== undefined)
    assert.equal(embedded[1].trim(), translateNpmInvocation.toString().trim())
    // The embedded function must not reference module scope: it executes
    // standalone inside the staged runtime.
    assert.doesNotMatch(embedded[1], /\bNPM_PASSTHROUGH_SUBCOMMANDS\b/)

    for (const name of ['npm', 'npx']) {
      const cmd = readFileSync(join(nodeRuntime, `${name}.cmd`), 'utf8')
      assert.match(cmd, new RegExp(`node_modules\\\\npm-forward\\.mjs" ${name} %\\*`))
      assert.equal(existsSync(join(nodeRuntime, `${name}.ps1`)), true, `${name}.ps1 staged`)
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('stageNpmForwardingShims installs POSIX launchers in bin', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'oh-dsh-npm-forward-'))
  const nodeRuntime = join(fixture, 'node-runtime')
  try {
    mkdirSync(nodeRuntime, { recursive: true })
    buildStaging(nodeRuntime, false).staging.stageNpmForwardingShims()

    assert.equal(existsSync(join(nodeRuntime, 'lib', 'node_modules', 'npm-forward.mjs')), true)
    for (const name of ['npm', 'npx']) {
      const launcher = readFileSync(join(nodeRuntime, 'bin', name), 'utf8')
      assert.match(launcher, /^#!\/bin\/sh\n/)
      assert.match(launcher, new RegExp(`npm-forward\\.mjs" ${name} "\\$@"`))
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('stageNpmForwardingShims replaces a dangling stock Windows npm.cmd', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'oh-dsh-npm-forward-'))
  const nodeRuntime = join(fixture, 'node-runtime')
  try {
    mkdirSync(nodeRuntime, { recursive: true })
    writeFileSync(
      join(nodeRuntime, 'npm.cmd'),
      '@ECHO off\r\n"%~dp0\node_modules\\npm\\bin\\npm-cli.js" %*\r\n',
    )
    buildStaging(nodeRuntime, true).staging.stageNpmForwardingShims()
    const cmd = readFileSync(join(nodeRuntime, 'npm.cmd'), 'utf8')
    assert.doesNotMatch(cmd, /npm-cli\.js/)
    assert.match(cmd, /npm-forward\.mjs/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
