import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import {
  landlockLauncherPackageName,
  restoreLandlockLauncher,
} from '../scripts/landlock-launcher.mjs'
import { landlockPreviewCommand, resolveLandlockLauncher } from '../src/landlock-launcher.ts'

const packageVersion = '0.1.1'

function writePackageManifest(packageRoot: string, version = packageVersion) {
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: landlockLauncherPackageName,
    version,
  }))
}

function writePrebuildManifest(packageRoot: string) {
  writeFileSync(join(packageRoot, 'prebuilds.json'), JSON.stringify({
    platform: 'linux-x64',
    binaries: [{
      tool: 'landlock-run',
      kind: 'static-musl',
      path: 'bin/landlock-run',
    }],
  }))
}

function packageRoot(runtimeRoot: string) {
  return join(runtimeRoot, 'node_modules', ...landlockLauncherPackageName.split('/'))
}

test('Linux staging restores the published Landlock launcher into the runtime package', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-landlock-'))
  const runtimeRoot = join(root, 'runtime')
  const sourcePackageRoot = join(root, 'published')
  const targetPackageRoot = packageRoot(runtimeRoot)
  const sourceLauncher = join(sourcePackageRoot, 'bin', 'landlock-run')
  try {
    writePackageManifest(sourcePackageRoot)
    writePackageManifest(targetPackageRoot)
    writePrebuildManifest(targetPackageRoot)
    mkdirSync(dirname(sourceLauncher), { recursive: true })
    writeFileSync(sourceLauncher, 'published launcher')

    const targetLauncher = restoreLandlockLauncher({ runtimeRoot, sourcePackageRoot })

    assert.equal(targetLauncher, join(targetPackageRoot, 'bin', 'landlock-run'))
    assert.equal(readFileSync(targetLauncher, 'utf8'), 'published launcher')
    if (process.platform !== 'win32') {
      assert.equal(statSync(targetLauncher).mode & 0o777, 0o755)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Linux staging fails when the published Landlock launcher is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-landlock-'))
  const runtimeRoot = join(root, 'runtime')
  const sourcePackageRoot = join(root, 'published')
  const targetPackageRoot = packageRoot(runtimeRoot)
  try {
    writePackageManifest(sourcePackageRoot)
    writePackageManifest(targetPackageRoot)
    writePrebuildManifest(targetPackageRoot)

    assert.throws(
      () => restoreLandlockLauncher({ runtimeRoot, sourcePackageRoot }),
      /published Landlock launcher is missing/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('desktop pins the published Linux x64 Landlock launcher package', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.optionalDependencies?.[landlockLauncherPackageName], packageVersion)
})

test('resolves and invokes the staged Linux x64 launcher', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-landlock-'))
  const launcher = join(root, 'node_modules', ...landlockLauncherPackageName.split('/'), 'bin', 'landlock-run')
  try {
    mkdirSync(dirname(launcher), { recursive: true })
    writeFileSync(launcher, 'launcher', { mode: 0o755 })
    const resolved = resolveLandlockLauncher(root, 'linux', 'x64')
    assert.equal(resolved, launcher)
    assert.deepEqual(landlockPreviewCommand({
      launcher,
      nodeBinary: '/runtime/node',
      nodeArguments: ['/runtime/cli.js', '--profile', 'desktop'],
      root,
    }), {
      command: launcher,
      args: ['--ro', '/', '--rw', root, '--rw', '/dev/null', '--', '/runtime/node', '/runtime/cli.js', '--profile', 'desktop'],
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Nix packaging pins and stages the Linux x64 Landlock launcher', () => {
  const nix = readFileSync(new URL('../nix/oh-dsh.nix', import.meta.url), 'utf8')
  assert.ok(nix.includes('node-addon-landlock-run-linux-x64-0.1.1.tgz'))
  assert.ok(nix.includes('sha512-OHAzPW2Coe/iYobAJAAA8CeVrBoKV4BnNHsgwvXwOfishxkUVSWSvdyxrZPiwYRXutpIGVrSo9zV3WOQy2euBA=='))
  assert.ok(nix.includes('system == "x86_64-linux"'))
  assert.ok(nix.includes('restoreLandlockLauncher'))
  assert.ok(nix.includes('test -x "$landlock_package/bin/landlock-run"'))
  assert.ok(nix.includes('$src/scripts/stage-runtime-lib.mjs stage-pnpm'))
  assert.ok(nix.includes('test -f "$out/node-runtime/lib/node_modules/pnpm/bin/pnpm.mjs"'))
  assert.ok(nix.includes('test -f "$out/node-runtime/bin/pnpm"'))
  assert.ok(nix.includes('install-packages'))
  assert.ok(nix.includes('--release-graph'))
  assert.ok(nix.includes('SURFACE_PACKAGE_NAMES'))
})

test('does not resolve Landlock for unsupported targets', () => {
  assert.equal(resolveLandlockLauncher('/missing', 'darwin', 'x64'), undefined)
  assert.equal(resolveLandlockLauncher('/missing', 'linux', 'arm64'), undefined)
})
