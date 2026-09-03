import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {
  delimiter,
  dirname,
  join,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DSH_SOURCE_SPEC,
  resolveDshSource,
  resolvePinnedPnpm,
} from './dsh-source.mjs'
import { createStageRuntime, parseStageSurface } from './stage-runtime-lib.mjs'
import { resolveNodeDistributionPlatform } from '../src/node-platform.ts'
import {
  adaptDshLiangshenOwnership,
  adaptDshLiangshenPresentation,
} from '../plugins/liangshen/src/upstream-adapter.mjs'
import { restoreSettingsBoundary } from './settings-boundary.mjs'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const npmRelease = DSH_SOURCE_SPEC.source === 'npm'
const dshSource = resolveDshSource()
const stage = join(root, '.stage')
const runtime = join(stage, 'dsh-runtime')
const nodeRuntime = join(stage, 'node-runtime')
const cache = join(root, '.cache')
const nodeVersion = process.env.DSH_DESKTOP_NODE_VERSION ?? '26.0.0'
// Node.js distribution triples use `linux`/`darwin`/`win` and `x64`/`arm64`.
// Stage a Node runtime for the current host unless an override asks for a
// specific platform (used for cross-packaging).
const nodePlatform = resolveNodeDistributionPlatform()
const nodeArch = process.env.DSH_DESKTOP_NODE_ARCH
  ?? { arm64: 'arm64', x64: 'x64' }[process.arch]
  ?? process.arch
const isWindowsNode = nodePlatform === 'win'
const nodeFolder = `node-v${nodeVersion}-${nodePlatform}-${nodeArch}`
const nodeArchiveName = `${nodeFolder}.${isWindowsNode ? 'zip' : 'tar.gz'}`
const nodeArchive = join(cache, nodeArchiveName)
const nodeCache = join(cache, nodeFolder)
const nodeExecutable = join(nodeCache, isWindowsNode ? 'node.exe' : join('bin', 'node'))

// Shared runtime staging operations. The release pipeline and the Nix
// package (nix/oh-dsh.nix) consume the same functions from
// scripts/stage-runtime-lib.mjs so packaged surface layouts cannot drift.
const staging = createStageRuntime({
  root,
  stage,
  runtime,
  nodeRuntime,
  dshSource,
  isWindowsNode,
  nodePlatform,
  nodeArch,
  npmRelease,
  run,
})

const stageSurface = parseStageSurface()
if (!npmRelease
  && (!existsSync(join(dshSource, 'apps', 'web', 'dist', 'index.html'))
    || !existsSync(join(dshSource, 'apps', 'cli', 'lib', 'bin.js')))) {
  throw new Error(`DSH build artifacts are missing at ${dshSource}; run pnpm run build:dsh first`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${String(result.status)}`)
  }
}

function download(url, target) {
  const temporary = `${target}.download-${String(process.pid)}`
  rmSync(temporary, { force: true })
  run('curl', ['--fail', '--location', '--silent', '--show-error', url, '--output', temporary])
  rmSync(target, { force: true })
  writeFileSync(target, readFileSync(temporary))
  rmSync(temporary, { force: true })
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function ensureNodeRuntime() {
  mkdirSync(cache, { recursive: true })
  const base = `https://nodejs.org/dist/v${nodeVersion}`
  const sumsPath = join(cache, `SHASUMS256-v${nodeVersion}.txt`)
  if (!existsSync(nodeArchive)) download(`${base}/${nodeArchiveName}`, nodeArchive)
  if (!existsSync(sumsPath)) download(`${base}/SHASUMS256.txt`, sumsPath)
  const expectedLine = readFileSync(sumsPath, 'utf8').split('\n')
    .find(line => line.endsWith(`  ${nodeArchiveName}`))
  if (expectedLine === undefined) throw new Error(`Node checksum entry missing for ${nodeArchiveName}`)
  const expected = expectedLine.split(/\s+/)[0]
  const actual = sha256(nodeArchive)
  if (actual !== expected) {
    throw new Error(`Node archive checksum mismatch: expected ${expected}, received ${actual}`)
  }
  if (!existsSync(nodeExecutable)) {
    const extraction = join(cache, `.node-extract-${String(process.pid)}`)
    rmSync(extraction, { recursive: true, force: true })
    mkdirSync(extraction, { recursive: true })
    if (isWindowsNode) {
      // bsdtar on the Windows runner unpacks zip archives.
      run('tar', ['-xf', nodeArchive, '-C', extraction])
    } else {
      run('tar', ['-xzf', nodeArchive, '-C', extraction])
    }
    rmSync(nodeCache, { recursive: true, force: true })
    cpSync(join(extraction, nodeFolder), nodeCache, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    })
    rmSync(extraction, { recursive: true, force: true })
  }
  if (!isWindowsNode) {
    for (const [name, target] of [
      ['npm', '../lib/node_modules/npm/bin/npm-cli.js'],
      ['npx', '../lib/node_modules/npm/bin/npx-cli.js'],
    ]) {
      const launcher = join(nodeCache, 'bin', name)
      rmSync(launcher, { force: true })
      symlinkSync(target, launcher)
    }
  }
  rmSync(nodeRuntime, { recursive: true, force: true })
  cpSync(nodeCache, nodeRuntime, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  })
  if (!isWindowsNode) chmodSync(join(nodeRuntime, 'bin', 'node'), 0o755)

  // Stage the workspace pnpm package beside the node runtime exactly as the
  // Nix package does; bundledRuntimePaths resolves the pnpm entry at
  // node-runtime/lib/node_modules/pnpm/bin/pnpm.mjs for isolated Marketplace
  // installs.
  staging.stagePnpmIntoNodeRuntime({ pnpmSource: join(root, 'node_modules', 'pnpm') })
}

function stripNodeBinary() {
  if (isWindowsNode) return
  const executable = join(nodeRuntime, 'bin', 'node')
  const result = spawnSync('strip', ['-x', executable], { stdio: 'ignore' })
  if (result.error !== undefined || result.status !== 0) {
    console.log('Skipping Node binary symbol stripping: strip is unavailable')
    return
  }
  console.log(`Stripped Node binary: ${executable}`)
  // Stripping invalidates the mandatory arm64 code signature; without an
  // ad-hoc re-sign macOS kills the staged Node on every launch.
  if (process.platform === 'darwin') {
    const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', executable], { stdio: 'ignore' })
    if (signed.error !== undefined || signed.status !== 0) {
      console.log('Warning: codesign failed; the staged Node may be killed by macOS Gatekeeper')
    } else {
      console.log(`Re-signed stripped Node binary: ${executable}`)
    }
  }
}

function pruneNodeRuntime() {
  const removable = [
    join(nodeRuntime, 'include'),
    join(nodeRuntime, 'share'),
    join(nodeRuntime, 'lib', 'node_modules', 'npm'),
    join(nodeRuntime, 'node_modules', 'npm'),
  ]
  for (const path of removable) rmSync(path, { recursive: true, force: true })
  for (const name of ['corepack', 'npm', 'npx']) {
    rmSync(join(nodeRuntime, 'bin', name), { recursive: true, force: true })
  }
  console.log('Pruned Node runtime development files and npm')
}

if (!npmRelease && !existsSync(join(dshSource, 'apps', 'cli', 'package.json'))) {
  throw new Error(`DSH source checkout not found: ${dshSource}`)
}
for (const required of [
  'plugin.js',
  'client.js',
  'client.js.map',
  'cordis.patch.yml',
  'web/index.js',
  'web/client.js',
  'web/client.js.map',
  'web/cordis.patch.yml',
  'plugins/better-sidebar-runtime/index.js',
  'plugins/about/index.js',
  'plugins/about/client.js',
  'plugins/about/client.js.map',
  'plugins/desktop-frame/index.js',
  'plugins/desktop-frame/client.js',
  'plugins/desktop-frame/client.js.map',
  'plugins/vision/index.js',
  'plugins/vision/client.js',
  'plugins/vision/client.js.map',
  'plugins/vision/LICENSE',
  'plugins/skins/index.js',
  'plugins/skins/client.js',
  'plugins/sidebar/index.js',
  'plugins/sidebar/client.js',
  'plugins/panel-controls/index.js',
  'plugins/panel-controls/client.js',
  'plugins/pinned-summary/index.js',
  'plugins/pinned-summary/client.js',
  'plugins/plugin-marketplace/index.js',
  'plugins/plugin-marketplace/client.js',
  'plugins/tui/index.js',
  'plugins/tui/cordis.patch.yml',
  'plugins/tui-marketplace/index.js',
]) {
  if (!existsSync(join(root, 'dist', required))) {
    throw new Error(`desktop artifact missing: dist/${required}; run pnpm run build first`)
  }
}

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
const pnpm = resolvePinnedPnpm(dshSource)
if (npmRelease) {
  const releaseLockfile = join(root, 'scripts', `dsh-runtime-${DSH_SOURCE_SPEC.version}-lock.yaml`)
  const assemblyLockfile = join(dshSource, 'pnpm-lock.yaml')
  if (existsSync(releaseLockfile)) copyFileSync(releaseLockfile, assemblyLockfile)
  console.log('Installing pinned DSH npm release assembly')
  run(process.execPath, [
    pnpm.cliEntry,
    '--reporter=silent',
    '--ignore-scripts',
    'install',
    ...existsSync(releaseLockfile) ? ['--frozen-lockfile'] : [],
  ], {
    cwd: dshSource,
    env: {
      ...process.env,
      PATH: `${pnpm.binDir}${delimiter}${process.env.PATH ?? ''}`,
    },
  })
}
console.log(`Deploying pinned DSH runtime (${isWindowsNode ? 'hoisted copy' : 'copy import'} mode)`)
run(process.execPath, [
  pnpm.cliEntry,
  '--reporter=silent',
  '--config.package-import-method=copy',
  ...(isWindowsNode ? [
    '--config.node-linker=hoisted',
    '--config.inject-workspace-packages=true',
  ] : []),
  '--ignore-scripts',
  '--filter', '@deepseek-ai/dsh',
  'deploy', '--prod', ...(isWindowsNode ? [] : ['--legacy']), runtime,
], {
  cwd: dshSource,
  env: {
    ...process.env,
    PATH: `${pnpm.binDir}${delimiter}${process.env.PATH ?? ''}`,
  },
})

if (isWindowsNode && !npmRelease) staging.ensureWindowsWorkspacePackages()
staging.replaceDeprecatedDomExceptionShim()
staging.assertDeprecatedLockBranchesAreNotShipped()
if (npmRelease) {
  console.log('Exposing npm release packages for profile resolution')
  staging.exposeHoistedPackages()
  staging.recordExposedDependencies()
} else {
  console.log('Relinking workspace packages')
  staging.rewriteWorkspaceLinks()
  staging.relinkInstallationWorkspacePackages()
}
console.log(`Installing ${stageSurface} surface packages`)
staging.installDesktopPackages(stageSurface)
if (npmRelease) {
  // The npm assembly carries only the CLI package; install the packaged
  // DSH notices beside it. Oh-DSH notices are updated in this repository.
  copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(runtime, 'THIRD_PARTY_NOTICES.md'))
} else {
  copyFileSync(join(dshSource, 'THIRD_PARTY_NOTICES.md'), join(runtime, 'THIRD_PARTY_NOTICES.md'))
}
staging.restoreExecutableHelpers()
console.log('Normalizing runtime links')
staging.normalizeRuntimeLinks()
restoreSettingsBoundary(runtime)
adaptDshLiangshenOwnership(runtime)
if (stageSurface !== 'tui') adaptDshLiangshenPresentation(runtime)
staging.ensureLinuxLandlockLauncher()
staging.assertSelfContained(runtime, 'DSH runtime')
ensureNodeRuntime()
staging.assertSelfContained(nodeRuntime, 'Node runtime')
staging.ensureLinuxPtyBuild()
staging.pruneRuntimeDevelopmentFiles()
pruneNodeRuntime()
stripNodeBinary()
staging.assertSelfContained(runtime, 'pruned DSH runtime')
staging.assertSelfContained(nodeRuntime, 'pruned Node runtime')

const stagedNode = join(nodeRuntime, isWindowsNode ? 'node.exe' : join('bin', 'node'))
const hostPlatform = { darwin: 'darwin', linux: 'linux', win: 'win32' }[nodePlatform]
if (hostPlatform === process.platform) {
  run(stagedNode, [join(runtime, 'lib', 'bin.js'), '--version'], {
    cwd: runtime,
    env: { ...process.env, DSH_HOME: join(stage, 'smoke-home') },
  })
  if (isWindowsNode) {
    run(stagedNode, [join(nodeRuntime, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'), '--version'], {
      cwd: runtime,
      env: process.env,
    })
  } else {
    run(join(nodeRuntime, 'bin', 'pnpm'), ['--version'], { cwd: runtime, env: process.env })
  }
} else {
  console.log(`Skipping staged runtime launch checks: ${nodePlatform} binaries cannot run on ${process.platform}`)
}

console.log(`Staged DSH runtime: ${runtime}`)
console.log(`Staged Node ${nodeVersion}: ${nodeRuntime}`)
