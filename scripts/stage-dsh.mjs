import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {
  basename,
  delimiter,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DSH_SOURCE_SPEC,
  resolveDshSource,
  resolvePinnedPnpm,
} from './dsh-source.mjs'
import {
  landlockLauncherPackageName,
  restoreLandlockLauncher,
} from './landlock-launcher.mjs'
import { resolveNodeDistributionPlatform } from '../src/node-platform.ts'
import { adaptTuiRendererPackage } from './tui-upstream-adapter.mjs'

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

/** Create a portable link without allowing directory links in a Windows stage. */
function portableSymlink(target, link) {
  rmSync(link, { recursive: true, force: true })
  if (!isWindowsNode) {
    symlinkSync(target, link)
    return
  }
  const resolved = realpathSync(resolve(dirname(link), target))
  if (!lstatSync(resolved).isDirectory()) {
    copyFileSync(resolved, link)
    return
  }
  throw new Error(`Windows runtime contains an unexpected directory link: ${link} -> ${target}`)
}

function download(url, target) {
  const temporary = `${target}.download-${String(process.pid)}`
  rmSync(temporary, { force: true })
  run('curl', ['--fail', '--location', '--silent', '--show-error', url, '--output', temporary])
  rmSync(target, { force: true })
  writeFileSync(target, readFileSync(temporary))
  rmSync(temporary, { force: true })
}

/**
 * Legacy `pnpm deploy` hoists peer packages under
 * `node_modules/.pnpm/node_modules` but does not create top-level links for
 * every package. `healProfilesModuleFallback` resolves profiles through the
 * installation's top-level `node_modules`, so re-export that hoisted graph
 * one level up.
 */
function exposeHoistedPackages() {
  const hoist = join(runtime, 'node_modules', '.pnpm', 'node_modules')
  const prefix = join(runtime, 'node_modules')
  if (!existsSync(hoist)) return
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = join(prefix, relative(hoist, source))
        if (existsSync(target)) continue
        mkdirSync(dirname(target), { recursive: true })
        const logical = resolve(dirname(source), readlinkSync(source))
        portableSymlink(relative(realpathSync(dirname(target)), logical), target)
      } else if (entry.isDirectory()) {
        visit(source)
      }
    }
  }
  visit(hoist)
}

/**
 * Record every exposed package as a direct runtime dependency so the
 * profile-module fallback links the complete boot graph into each writable
 * profile (`healProfilesModuleFallback` walks this manifest).
 */
function recordExposedDependencies() {
  const manifestPath = join(runtime, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const dependencies = { ...manifest.dependencies }
  const prefix = join(runtime, 'node_modules')
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const real = realpathSync(path)
        const packagePath = join(real, 'package.json')
        if (!existsSync(packagePath)) continue
        const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8'))
        if (typeof packageManifest.name !== 'string' || typeof packageManifest.version !== 'string') continue
        dependencies[packageManifest.name] = packageManifest.version
      } else if (entry.isDirectory()) {
        const packagePath = join(path, 'package.json')
        if (existsSync(packagePath)) {
          const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8'))
          if (typeof packageManifest.name === 'string' && typeof packageManifest.version === 'string') {
            dependencies[packageManifest.name] = packageManifest.version
          }
          continue
        }
        visit(path)
      }
    }
  }
  visit(prefix)
  manifest.dependencies = dependencies
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
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

  const pnpmSource = join(root, 'node_modules', 'pnpm')
  if (!existsSync(join(pnpmSource, 'dist', 'pnpm.mjs'))) {
    throw new Error('pnpm package is missing; run pnpm install before staging')
  }
  const pnpmTarget = join(
    nodeRuntime,
    isWindowsNode ? join('node_modules', 'pnpm') : join('lib', 'node_modules', 'pnpm'),
  )
  rmSync(pnpmTarget, { recursive: true, force: true })
  mkdirSync(pnpmTarget, { recursive: true })
  for (const name of ['bin', 'dist']) {
    cpSync(join(pnpmSource, name), join(pnpmTarget, name), {
      recursive: true,
      preserveTimestamps: true,
    })
  }
  for (const name of ['LICENSE', 'package.json']) {
    copyFileSync(join(pnpmSource, name), join(pnpmTarget, name))
  }
  if (isWindowsNode) {
    writeFileSync(
      join(nodeRuntime, 'pnpm.cmd'),
      '@ECHO off\r\n"%~dp0node.exe" "%~dp0node_modules\\pnpm\\bin\\pnpm.mjs" %*\r\n',
    )
  } else {
    const pnpmBinary = join(nodeRuntime, 'bin', 'pnpm')
    rmSync(pnpmBinary, { force: true })
    symlinkSync('../lib/node_modules/pnpm/bin/pnpm.mjs', pnpmBinary)
    chmodSync(join(pnpmTarget, 'bin', 'pnpm.mjs'), 0o755)
  }
}

function shouldCopyWorkspaceEntry(sourceRoot, source) {
  const rel = relative(sourceRoot, source)
  if (rel === '') return true
  const top = rel.split(sep)[0]
  return !new Set([
    '.git', '.agents', '.claude', 'node_modules', 'src', 'test', 'tests',
    'coverage', 'docs', 'website',
  ]).has(top)
}

const copiedTargets = new Map()
const deployedPackageTargets = new Map()
let sourcePackages

function isWithin(parent, candidate) {
  return candidate === parent || candidate.startsWith(parent + sep)
}

function discoverSourcePackages() {
  if (sourcePackages !== undefined) return sourcePackages
  const packages = new Map()
  const ignored = new Set([
    '.cache', '.git', '.pnpm-store', 'coverage', 'dist', 'docs', 'lib',
    'node_modules', 'src', 'test', 'tests', 'website',
  ])
  const visit = directory => {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (typeof manifest.name === 'string') packages.set(manifest.name, directory)
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || ignored.has(entry.name) || entry.name.startsWith('.')
        || entry.name.startsWith('staging-')) continue
      visit(join(directory, entry.name))
    }
  }
  visit(dshSource)
  sourcePackages = packages
  return packages
}

function dependencyNames(manifest) {
  return new Map([
    ...Object.keys(manifest.peerDependencies ?? {}).map(name => [name, true]),
    ...Object.keys(manifest.optionalDependencies ?? {}).map(name => [name, true]),
    ...Object.keys(manifest.dependencies ?? {}).map(name => [name, false]),
  ])
}

function ensureWindowsWorkspacePackages() {
  const packages = discoverSourcePackages()
  const visited = new Set()
  const materialized = []

  const ensurePackage = name => {
    if (visited.has(name)) return
    visited.add(name)
    const source = packages.get(name)
    if (source === undefined) return
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    const target = runtimePackageDirectory(name)
    if (!packageMatches(target, manifest)) {
      const vendor = isWithin(join(dshSource, 'vendor'), source)
      rmSync(target, { recursive: true, force: true })
      mkdirSync(dirname(target), { recursive: true })
      cpSync(source, target, {
        recursive: true,
        preserveTimestamps: true,
        filter: candidate => {
          const rel = relative(source, candidate)
          if (rel === '') return true
          if (rel.split(sep)[0] === 'node_modules') return false
          return vendor || shouldCopyWorkspaceEntry(source, candidate)
        },
      })
      materialized.push(name)
    }
    for (const dependency of dependencyNames(manifest).keys()) {
      if (packages.has(dependency)) ensurePackage(dependency)
    }
  }

  const rootManifest = JSON.parse(readFileSync(join(dshSource, 'package.json'), 'utf8'))
  for (const dependency of dependencyNames(rootManifest).keys()) {
    if (packages.has(dependency)) ensurePackage(dependency)
  }
  for (const name of packages.keys()) {
    if (existsSync(runtimePackageDirectory(name))) ensurePackage(name)
  }
  console.log(`Windows workspace audit: materialized ${String(materialized.length)} missing packages`)
}

function findDeployedPackage(sourceTarget) {
  const manifestPath = join(sourceTarget, 'package.json')
  if (!existsSync(manifestPath)) return undefined
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return undefined
  const key = `${manifest.name}@${manifest.version}`
  if (deployedPackageTargets.has(key)) return deployedPackageTargets.get(key)
  const store = join(runtime, 'node_modules', '.pnpm')
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = join(store, entry.name, 'node_modules', ...manifest.name.split('/'))
    const candidateManifest = join(candidate, 'package.json')
    if (!existsSync(candidateManifest)) continue
    const deployed = JSON.parse(readFileSync(candidateManifest, 'utf8'))
    if (deployed.name === manifest.name && deployed.version === manifest.version) {
      deployedPackageTargets.set(key, candidate)
      return candidate
    }
  }
  deployedPackageTargets.set(key, undefined)
  return undefined
}

function stageDependencyTarget(sourceTarget) {
  const sourceStore = join(dshSource, 'node_modules', '.pnpm')
  if (isWithin(sourceStore, sourceTarget)) {
    const target = join(runtime, 'node_modules', '.pnpm', relative(sourceStore, sourceTarget))
    if (existsSync(target)) return target
    const equivalent = findDeployedPackage(sourceTarget)
    if (equivalent !== undefined) return equivalent
    throw new Error(`deployed pnpm store is missing runtime dependency: ${sourceTarget}`)
  }
  if (isWithin(dshSource, sourceTarget)) return stageWorkspaceTarget(sourceTarget)
  throw new Error(`DSH package dependency points outside the source checkout: ${sourceTarget}`)
}

function mirrorPackageDependencies(sourcePackage, targetPackage) {
  const manifestPath = join(sourcePackage, 'package.json')
  if (!existsSync(manifestPath)) return
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const [dependency, optional] of dependencyNames(manifest)) {
    const sourceLink = join(sourcePackage, 'node_modules', ...dependency.split('/'))
    if (!existsSync(sourceLink)) {
      if (optional) continue
      throw new Error(`${manifest.name ?? sourcePackage} is missing installed dependency ${dependency}`)
    }
    const stat = lstatSync(sourceLink)
    if (!stat.isSymbolicLink()) {
      throw new Error(`${manifest.name ?? sourcePackage} dependency is not a pnpm link: ${sourceLink}`)
    }
    const sourceTarget = resolve(dirname(sourceLink), readlinkSync(sourceLink))
    const target = stageDependencyTarget(sourceTarget)
    const targetLink = join(targetPackage, 'node_modules', ...dependency.split('/'))
    mkdirSync(dirname(targetLink), { recursive: true })
    portableSymlink(relative(dirname(targetLink), target), targetLink)
  }
}

function stageWorkspaceTarget(source) {
  const rel = relative(dshSource, source)
  if (rel.startsWith(`..${sep}`) || rel === '..' || rel === '') {
    throw new Error(`cannot stage external DSH workspace target: ${source}`)
  }
  const existing = copiedTargets.get(source)
  if (existing !== undefined) return existing
  const target = join(runtime, 'workspace', rel)
  mkdirSync(dirname(target), { recursive: true })
  const stat = lstatSync(source)
  if (stat.isDirectory()) {
    cpSync(source, target, {
      recursive: true,
      preserveTimestamps: true,
      filter: candidate => shouldCopyWorkspaceEntry(source, candidate),
    })
  } else {
    copyFileSync(source, target)
  }
  copiedTargets.set(source, target)
  if (stat.isDirectory()) mirrorPackageDependencies(source, target)
  return target
}

const stagedVendorTargets = new Map()

/**
 * Copy one full vendored source directory once, mirroring how POSIX pnpm
 * deploy dereferences link: dependencies into real directories. The staged
 * layout must keep `src/` because vendored packages expose `./src/*` exports.
 */
function stageVendorTarget(source) {
  const existing = stagedVendorTargets.get(source)
  if (existing !== undefined) return existing
  const rel = relative(dshSource, source)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`cannot stage external vendor target: ${source}`)
  }
  const target = join(runtime, 'workspace', rel)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
    filter: candidate => {
      const candidateRel = relative(source, candidate)
      return candidateRel === '' || candidateRel.split(sep)[0] !== 'node_modules'
    },
  })
  stagedVendorTargets.set(source, target)
  if (existsSync(join(source, 'node_modules'))) {
    mirrorPackageDependencies(source, target)
  }
  return target
}

/**
 * Recover a deployed link whose target is outside the source checkout.
 * pnpm's legacy deploy can leave link: overrides as junctions with stale
 * absolute targets on Windows; the source checkout keeps the same relative
 * entry, and vendored packages also exist under `vendor/<basename>`.
 */
function stageSourceCounterpart(link) {
  const sourceLink = join(dshSource, relative(runtime, link))
  let source = sourceLink
  if (existsSync(sourceLink)) {
    const stat = lstatSync(sourceLink)
    if (stat.isSymbolicLink()) {
      source = resolve(dirname(sourceLink), readlinkSync(sourceLink))
    }
  }
  if (!existsSync(source)) {
    source = join(dshSource, 'vendor', basename(link))
  }
  if (!existsSync(source)) {
    throw new Error(`staged runtime link has no usable source: ${link}`)
  }
  if (!isWithin(dshSource, source)) {
    // Global-store content has no dependency links of its own; copy it
    // straight into the link location.
    rmSync(link, { recursive: true, force: true })
    cpSync(source, link, { recursive: true, dereference: true, preserveTimestamps: true })
    return undefined
  }
  return stageVendorTarget(source)
}

function walk(rootPath, visit) {
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const path = join(rootPath, entry.name)
    if (entry.isSymbolicLink()) visit(path)
    else if (entry.isDirectory()) walk(path, visit)
  }
}

/**
 * fetch-blob 3 imports the deprecated node-domexception shim for Node 12.
 * Oh-DSH ships Node 26 and supports Node 24+, both of which expose the same
 * Web-standard DOMException globally. Patch only this reviewed import, then
 * remove the now-unreferenced shim from the portable runtime.
 */
function replaceDeprecatedDomExceptionShim() {
  const store = join(runtime, 'node_modules', '.pnpm')
  const dependency = 'node-domexception'
  const importPattern = /^import DOMException from ['"]node-domexception['"]\r?\n/m
  const packageDirs = isWindowsNode
    ? [runtimePackageDirectory('fetch-blob')]
    : readdirSync(store, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith('fetch-blob@'))
      .map(entry => join(store, entry.name, 'node_modules', 'fetch-blob'))

  for (const packageDir of packageDirs) {
    const sourcePath = join(packageDir, 'from.js')
    const manifestPath = join(packageDir, 'package.json')
    if (!existsSync(sourcePath) || !existsSync(manifestPath)) continue

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.dependencies?.[dependency] === undefined) continue
    const source = readFileSync(sourcePath, 'utf8')
    if (!importPattern.test(source)) {
      throw new Error('fetch-blob still depends on node-domexception through an unknown import')
    }
    writeFileSync(sourcePath, source.replace(importPattern, ''))
    delete manifest.dependencies[dependency]
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    rmSync(join(dirname(packageDir), dependency), {
      recursive: true,
      force: true,
    })
  }

  const hoisted = isWindowsNode
    ? runtimePackageDirectory(dependency)
    : join(store, 'node_modules', dependency)
  const consumers = []
  walk(runtime, path => {
    if (basename(path) === dependency && path !== hoisted) consumers.push(path)
  })
  if (consumers.length > 0) {
    throw new Error(`cannot remove ${dependency}; staged consumers remain:\n${consumers.join('\n')}`)
  }
  rmSync(hoisted, { recursive: true, force: true })
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(`${dependency}@`)) {
      rmSync(join(store, entry.name), { recursive: true, force: true })
    }
  }
}

function assertDeprecatedLockBranchesAreNotShipped() {
  const store = join(runtime, 'node_modules', '.pnpm')
  const forbidden = [
    ['glob', '10.5.0'],
    ['glob', '11.1.0'],
    ['node-domexception', '1.0.0'],
    ['tsconfck', '3.1.6'],
  ]
  const identities = new Set(forbidden.map(([name, version]) => `${name}@${version}`))
  const shipped = new Set(readdirSync(store, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && identities.has(entry.name))
    .map(entry => entry.name))
  for (const [name, version] of forbidden) {
    const manifestPath = join(runtimePackageDirectory(name), 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.name === name && manifest.version === version) shipped.add(`${name}@${version}`)
  }
  if (shipped.size > 0) {
    throw new Error(`deprecated dependencies remain in the staged runtime: ${[...shipped].join(', ')}`)
  }
  console.log('Dependency audit: deprecated packages from the shared lock are not shipped')
}

/**
 * Make the staged tree portable: re-create absolute internal links as
 * relative ones and dereference any link still pointing outside the runtime
 * (Windows junctions the `.pnpm` entries to the global store). Dangling
 * links were already repaired against the source checkout above.
 */
function normalizeRuntimeLinks() {
  const links = []
  walk(runtime, path => { links.push(path) })
  for (const link of links) {
    const raw = readlinkSync(link)
    const logical = resolve(dirname(link), raw)
    if (logical === runtime || logical.startsWith(runtime + sep)) {
      // Canonicalize every internal link, not only absolute ones: relative
      // targets that over-walk past the runtime root resolve back into this
      // build's `.stage` once the tree is copied into a package.
      const canonical = relative(dirname(link), logical)
      if (raw !== canonical || isWindowsNode) portableSymlink(canonical, link)
      continue
    }
    if (!existsSync(logical)) continue
    const real = realpathSync(link)
    rmSync(link, { recursive: true, force: true })
    if (lstatSync(real).isDirectory()) {
      cpSync(real, link, {
        recursive: true,
        dereference: true,
        preserveTimestamps: true,
      })
    } else {
      copyFileSync(real, link)
    }
  }
}

function rewriteWorkspaceLinks() {
  const links = []
  walk(runtime, path => { links.push(path) })
  for (const link of links) {
    const raw = readlinkSync(link)
    const logicalTarget = resolve(dirname(link), raw)
    if (logicalTarget === runtime || logicalTarget.startsWith(runtime + sep)) {
      const canonical = relative(dirname(link), logicalTarget)
      if (raw !== canonical || isWindowsNode) portableSymlink(canonical, link)
      continue
    }
    if (logicalTarget === dshSource || logicalTarget.startsWith(dshSource + sep)) {
      const stagedTarget = stageWorkspaceTarget(logicalTarget)
      portableSymlink(relative(dirname(link), stagedTarget), link)
      continue
    }
    const stagedTarget = stageSourceCounterpart(link)
    if (stagedTarget !== undefined) {
      portableSymlink(relative(dirname(link), stagedTarget), link)
    }
  }
}

function relinkInstallationWorkspacePackages() {
  for (const [packageName, source] of discoverSourcePackages()) {
    if (source === dshSource) continue
    const link = join(runtime, 'node_modules', ...packageName.split('/'))
    const stat = existsSync(link) ? lstatSync(link) : undefined
    if (stat !== undefined && !stat.isSymbolicLink()) continue
    if (stat === undefined && findDeployedPackage(source) === undefined) continue
    const stagedTarget = stageWorkspaceTarget(source)
    mkdirSync(dirname(link), { recursive: true })
    portableSymlink(relative(dirname(link), stagedTarget), link)
  }
}

function assertSelfContained(rootPath, label) {
  const failures = []
  walk(rootPath, link => {
    if (isWindowsNode) {
      failures.push(`${link} -> ${readlinkSync(link)} (link in Windows stage)`)
      return
    }
    const target = resolve(dirname(link), readlinkSync(link))
    if (!existsSync(target)) {
      failures.push(`${link} -> ${readlinkSync(link)} (dangling)`)
      return
    }
    if (target !== rootPath && !target.startsWith(rootPath + sep)) {
      failures.push(`${link} -> ${readlinkSync(link)} (outside stage)`)
    }
  })
  if (failures.length > 0) {
    throw new Error(`${label} contains non-portable symlinks:\n${failures.slice(0, 40).join('\n')}`)
  }
}

function runtimePackageDirectory(name) {
  return join(runtime, 'node_modules', ...name.split('/'))
}

function resolveDependencyManifest(requireFromPackage, dependency) {
  try {
    return requireFromPackage.resolve(`${dependency}/package.json`)
  } catch (packageJsonError) {
    let directory = dirname(requireFromPackage.resolve(dependency))
    for (;;) {
      const manifestPath = join(directory, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (manifest.name === dependency) return manifestPath
      }
      const parent = dirname(directory)
      if (parent === directory) throw packageJsonError
      directory = parent
    }
  }
}

function packageMatches(directory, expected) {
  const manifestPath = join(directory, 'package.json')
  if (!existsSync(manifestPath)) return false
  const actual = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return actual.name === expected.name && actual.version === expected.version
}

function installWindowsPackageDependencies(sourceManifestPath, packageDir) {
  const manifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'))
  if (dependencyNames(manifest).size === 0) return
  const deployment = join(
    stage,
    'windows-dependencies',
    manifest.name.replace(/[^A-Za-z0-9._-]/g, '_'),
  )
  rmSync(deployment, { recursive: true, force: true })
  run(process.execPath, [
    join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    '--reporter=silent',
    '--config.package-import-method=copy',
    '--config.node-linker=hoisted',
    '--config.inject-workspace-packages=true',
    '--ignore-scripts',
    '--filter', manifest.name,
    'deploy', '--prod', deployment,
  ], { cwd: root, env: process.env })

  const source = join(deployment, 'node_modules')
  if (!existsSync(source)) {
    throw new Error(`pnpm did not deploy runtime dependencies for ${manifest.name}`)
  }
  const target = join(packageDir, 'node_modules')
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.bin' || entry.name === '.pnpm' || entry.name === '.modules.yaml') continue
    cpSync(join(source, entry.name), join(target, entry.name), {
      dereference: true,
      preserveTimestamps: true,
      recursive: true,
    })
  }
  rmSync(deployment, { recursive: true, force: true })
}

function installCompiledPackageDependencies(sourceManifestPath, packageDir) {
  if (isWindowsNode) {
    installWindowsPackageDependencies(sourceManifestPath, packageDir)
    return
  }
  const installRoot = join(packageDir, 'node_modules')
  const storeRoot = join(installRoot, '.oh-dsh-store')
  const installed = new Map()

  const instanceName = (manifestPath, manifest) => {
    const parts = resolve(manifestPath).split(sep)
    const storeIndex = parts.lastIndexOf('.pnpm')
    const identity = storeIndex >= 0 && parts[storeIndex + 1] !== undefined
      ? parts[storeIndex + 1]
      : `${manifest.name}@${manifest.version}`
    return identity.replace(/[^A-Za-z0-9._-]/g, '_')
  }

  const linkDependency = (parent, dependency, target) => {
    const link = join(parent, 'node_modules', ...dependency.split('/'))
    mkdirSync(dirname(link), { recursive: true })
    portableSymlink(relative(dirname(link), target), link)
  }

  const installManifest = manifestPath => {
    const canonicalManifest = realpathSync(manifestPath)
    const existing = installed.get(canonicalManifest)
    if (existing !== undefined) return existing
    const source = dirname(canonicalManifest)
    const manifest = JSON.parse(readFileSync(canonicalManifest, 'utf8'))
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`invalid runtime dependency manifest: ${canonicalManifest}`)
    }
    const target = join(
      storeRoot,
      instanceName(canonicalManifest, manifest),
      'node_modules',
      ...manifest.name.split('/'),
    )
    installed.set(canonicalManifest, target)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, {
      dereference: true,
      preserveTimestamps: true,
      recursive: true,
      filter: candidate => {
        const rel = relative(source, candidate)
        return rel === '' || rel.split(sep)[0] !== 'node_modules'
      },
    })

    const requireFromPackage = createRequire(canonicalManifest)
    for (const [dependency, optional] of dependencyNames(manifest)) {
      try {
        const dependencyTarget = installManifest(
          resolveDependencyManifest(requireFromPackage, dependency),
        )
        linkDependency(target, dependency, dependencyTarget)
      } catch (error) {
        if (optional) continue
        throw new Error(`${manifest.name} is missing runtime dependency ${dependency}`, { cause: error })
      }
    }
    return target
  }

  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'))
  const requireFromSource = createRequire(sourceManifestPath)
  for (const [dependency, optional] of dependencyNames(sourceManifest)) {
    try {
      const dependencyTarget = installManifest(
        resolveDependencyManifest(requireFromSource, dependency),
      )
      const link = join(installRoot, ...dependency.split('/'))
      mkdirSync(dirname(link), { recursive: true })
      portableSymlink(relative(dirname(link), dependencyTarget), link)
    } catch (error) {
      if (optional) continue
      throw new Error(`${sourceManifest.name} is missing runtime dependency ${dependency}`, { cause: error })
    }
  }
}

function runtimeDependencyTarget(dependency) {
  const parts = dependency.split('/')
  const link = join(runtime, 'node_modules', ...parts)
  if (existsSync(join(link, 'package.json'))) return link
  const hoisted = join(runtime, 'node_modules', '.pnpm', 'node_modules', ...parts)
  if (existsSync(join(hoisted, 'package.json'))) return hoisted

  const store = join(runtime, 'node_modules', '.pnpm')
  const prefix = dependency.replace('/', '+')
  let fallback = null
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${prefix}@`)) continue
    const candidate = join(store, entry.name, 'node_modules', ...parts)
    const manifestPath = join(candidate, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.name !== dependency) continue
    // The release pins every DSH package to its own version, but a forked
    // peer (e.g. @deepseek-ai/schemastery) keeps its own version line.
    if (manifest.version === DSH_SOURCE_SPEC.version) return candidate
    fallback ??= candidate
  }
  if (fallback !== null) return fallback
  throw new Error(`DSH runtime is missing host dependency ${dependency}@${DSH_SOURCE_SPEC.version}`)
}

function installCompiledPackageHostDependencies(sourceManifestPath, packageDir) {
  const manifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'))
  for (const dependency of manifest.ohDsh?.hostDependencies ?? []) {
    if (npmRelease) {
      const target = runtimeDependencyTarget(dependency)
      if (isWindowsNode) {
        const expected = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
        if (!packageMatches(runtimePackageDirectory(dependency), expected)) {
          throw new Error(`${manifest.name} cannot resolve staged DSH peer ${dependency}`)
        }
        continue
      }
      const link = join(packageDir, 'node_modules', ...dependency.split('/'))
      mkdirSync(dirname(link), { recursive: true })
      portableSymlink(relative(dirname(link), target), link)
      continue
    }
    const source = discoverSourcePackages().get(dependency)
    if (source === undefined) {
      throw new Error(`${manifest.name} cannot resolve DSH peer ${dependency}`)
    }
    if (isWindowsNode) {
      const expected = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
      if (!packageMatches(runtimePackageDirectory(dependency), expected)) {
        throw new Error(`${manifest.name} cannot resolve staged DSH peer ${dependency}`)
      }
      continue
    }
    const target = stageWorkspaceTarget(source)
    const link = join(packageDir, 'node_modules', ...dependency.split('/'))
    mkdirSync(dirname(link), { recursive: true })
    portableSymlink(relative(dirname(link), target), link)
  }
}

function installDesktopPackages() {
  const packages = [
    {
      manifest: join(root, 'package.json'),
      files: [
        [join(root, 'dist', 'plugin.js'), 'dist/plugin.js'],
        [join(root, 'dist', 'client.js'), 'dist/client.js'],
        [join(root, 'dist', 'client.js.map'), 'dist/client.js.map'],
        [join(root, 'dist', 'cordis.patch.yml'), 'dist/cordis.patch.yml'],
      ],
    },
    {
      manifest: join(root, 'plugins', 'better-sidebar-runtime', 'package.json'),
      files: [
        [
          join(root, 'dist', 'plugins', 'better-sidebar-runtime', 'index.js'),
          'dist/index.js',
        ],
      ],
    },
    {
      manifest: join(root, 'plugins', 'vision', 'package.json'),
      files: [
        [join(root, 'dist', 'plugins', 'vision', 'index.js'), 'dist/index.js'],
        [join(root, 'dist', 'plugins', 'vision', 'client.js'), 'dist/client.js'],
        [join(root, 'dist', 'plugins', 'vision', 'client.js.map'), 'dist/client.js.map'],
        [join(root, 'dist', 'plugins', 'vision', 'LICENSE'), 'dist/LICENSE'],
      ],
    },
    ...[
      'skins',
      'sidebar',
      'panel-controls',
      'pinned-summary',
      'plugin-marketplace',
    ].map(directory => ({
      manifest: join(root, 'plugins', directory, 'package.json'),
      files: [
        [join(root, 'dist', 'plugins', directory, 'index.js'), 'dist/index.js'],
        [join(root, 'dist', 'plugins', directory, 'client.js'), 'dist/client.js'],
        [join(root, 'dist', 'plugins', directory, 'client.js.map'), 'dist/client.js.map'],
      ],
    })),
    {
      manifest: join(root, 'web', 'package.json'),
      files: [
        [join(root, 'dist', 'web', 'index.js'), 'dist/index.js'],
        [join(root, 'dist', 'web', 'client.js'), 'dist/client.js'],
        [join(root, 'dist', 'web', 'client.js.map'), 'dist/client.js.map'],
        [join(root, 'dist', 'web', 'cordis.patch.yml'), 'dist/cordis.patch.yml'],
      ],
    },
    {
      manifest: join(root, 'upstream', 'dsh-TUI', 'package.json'),
      files: [
        [join(root, 'upstream', 'dsh-TUI', 'lib'), 'lib'],
        [join(root, 'upstream', 'dsh-TUI', 'skills'), 'skills'],
        [join(root, 'upstream', 'dsh-TUI', 'cordis.patch.yml'), 'cordis.patch.yml'],
        [join(root, 'upstream', 'dsh-TUI', 'cordis.yml'), 'cordis.yml'],
        [join(root, 'upstream', 'dsh-TUI', 'LICENSE'), 'LICENSE'],
      ],
    },
    {
      manifest: join(root, 'plugins', 'tui', 'package.json'),
      files: [
        [join(root, 'dist', 'plugins', 'tui', 'index.js'), 'dist/index.js'],
        [join(root, 'dist', 'plugins', 'tui', 'cordis.patch.yml'), 'dist/cordis.patch.yml'],
      ],
    },
    {
      manifest: join(root, 'plugins', 'tui-marketplace', 'package.json'),
      files: [
        [join(root, 'dist', 'plugins', 'tui-marketplace', 'index.js'), 'dist/index.js'],
      ],
    },
  ]
  const installedVersions = {}
  for (const spec of packages) {
    const manifest = JSON.parse(readFileSync(spec.manifest, 'utf8'))
    delete manifest.build
    delete manifest.devDependencies
    delete manifest.scripts
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`invalid bundled plugin manifest: ${spec.manifest}`)
    }
    const packageDir = runtimePackageDirectory(manifest.name)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n')
    installCompiledPackageDependencies(spec.manifest, packageDir)
    installCompiledPackageHostDependencies(spec.manifest, packageDir)
    for (const [source, target] of spec.files) {
      const output = join(packageDir, target)
      mkdirSync(dirname(output), { recursive: true })
      if (lstatSync(source).isDirectory()) {
        cpSync(source, output, {
          dereference: true,
          preserveTimestamps: true,
          recursive: true,
        })
      } else {
        copyFileSync(source, output)
      }
    }
    if (manifest.name === 'dsh-cc-tui') adaptTuiRendererPackage(packageDir)
    installedVersions[manifest.name] = manifest.version
  }
  const cliManifestPath = join(runtime, 'package.json')
  const cliManifest = JSON.parse(readFileSync(cliManifestPath, 'utf8'))
  cliManifest.dependencies = {
    ...cliManifest.dependencies,
    ...installedVersions,
  }
  writeFileSync(cliManifestPath, JSON.stringify(cliManifest, undefined, 2) + '\n')
}

function restoreExecutableHelpers() {
  if (process.platform === 'win32') return
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name === 'spawn-helper' && !entry.isSymbolicLink()) chmodSync(path, 0o755)
    }
  }
  visit(runtime)
}

/**
 * node-pty publishes darwin/win32 prebuilds but no Linux ones, and the
 * `pnpm deploy` step reinstalls packages from the store, which drops the
 * `build/` output produced during `pnpm install`. Rebuild the native module
 * inside the staged runtime against the staged Node so the PTY host works on
 * Linux; macOS keeps using its published prebuild.
 */
function ensureLinuxPtyBuild() {
  if (process.platform !== 'linux') return
  const storeRoot = join(runtime, 'node_modules', '.pnpm')
  const ptyEntry = readdirSync(storeRoot, { withFileTypes: true })
    .find(entry => entry.isDirectory() && entry.name.startsWith('node-pty@'))
  if (ptyEntry === undefined) return
  const packageDir = join(storeRoot, ptyEntry.name, 'node_modules', 'node-pty')
  const prebuild = join(packageDir, 'prebuilds', `linux-${nodeArch}`)
  if (existsSync(join(packageDir, 'build', 'Release', 'pty.node')) || existsSync(join(prebuild, 'pty.node'))) return
  const addonEntry = readdirSync(storeRoot, { withFileTypes: true })
    .find(entry => entry.isDirectory() && entry.name.startsWith('node-addon-api@'))
  if (addonEntry === undefined) {
    throw new Error('staged runtime is missing node-addon-api; cannot compile node-pty')
  }
  const addonTarget = join(storeRoot, addonEntry.name, 'node_modules', 'node-addon-api')
  const dependencyDir = join(packageDir, 'node_modules')
  mkdirSync(dependencyDir, { recursive: true })
  const addonLink = join(dependencyDir, 'node-addon-api')
  rmSync(addonLink, { recursive: true, force: true })
  symlinkSync(relative(dependencyDir, addonTarget), addonLink)
  const nodeGyp = join(nodeRuntime, 'lib', 'node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
  if (!existsSync(nodeGyp)) {
    throw new Error('staged Node runtime is missing node-gyp; cannot compile node-pty')
  }
  try {
    run(join(nodeRuntime, 'bin', 'node'), [nodeGyp, 'rebuild'], { cwd: packageDir, env: process.env })
  } finally {
    rmSync(addonLink, { force: true })
    rmSync(dependencyDir, { recursive: true, force: true })
  }
  if (!existsSync(join(packageDir, 'build', 'Release', 'pty.node'))) {
    throw new Error('node-pty build did not produce build/Release/pty.node')
  }
}

function ensureLinuxLandlockLauncher() {
  if (nodePlatform !== 'linux') return
  if (nodeArch !== 'x64') {
    throw new Error(`unsupported Landlock launcher architecture: linux-${nodeArch}`)
  }

  const requireFromRoot = createRequire(join(root, 'package.json'))
  let sourceManifestPath
  try {
    sourceManifestPath = requireFromRoot.resolve(`${landlockLauncherPackageName}/package.json`)
  } catch (cause) {
    throw new Error(
      `${landlockLauncherPackageName} is missing; run pnpm install on linux-x64 before staging`,
      { cause },
    )
  }

  const launcher = restoreLandlockLauncher({
    runtimeRoot: runtime,
    sourcePackageRoot: dirname(sourceManifestPath),
  })
  console.log(`Restored Linux Landlock launcher: ${launcher}`)
}

/**
 * Restore the configuration-client boundary for the pinned rc.7 release.
 * rc7's dsh-host-apiproxy removed the fixed WEB_SETTINGS_NAMESPACES
 * allowlist and serves every registered settings namespace; Oh-DSH keeps
 * the explicit allowlist so a registering plugin cannot become remotely
 * readable or writable by default. Model-provider namespaces (the settingsNs
 * llm.providers lists) stay exposed, mirroring rc6's exposedNamespaces()
 * union; every other namespace answers `settings-not-exposed` on describe
 * and on each settings write. This extends the rc.6 npm-release patch
 * (exposeVisionSettingsNamespace) from one namespace to the whole boundary.
 */
function restoreSettingsBoundary() {
  const store = join(runtime, 'node_modules', '.pnpm')
  const entry = readdirSync(store, { withFileTypes: true })
    .find(candidate => candidate.isDirectory() && candidate.name.startsWith('@deepseek-ai+dsh-host-apiproxy@'))
  if (entry === undefined) {
    throw new Error('dsh-host-apiproxy is missing from the staged runtime')
  }
  const indexPath = join(store, entry.name, 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')
  const source = readFileSync(indexPath, 'utf8')
  if (source.includes('WEB_SETTINGS_NAMESPACES')) {
    throw new Error('dsh-host-apiproxy settings boundary has an unexpected shape; review needed')
  }
  const allowlist = [
    'agent-loop',
    'shell',
    'locale',
    'permission',
    'ui-conversation',
    'ui-theme',
    'web-search-deepseek',
    'ui-onboarding',
    'settings',
    'oh-dsh-vision',
  ]
  const constant = [
    '\n/**',
    ' * Downstream configuration-client boundary restored for the pinned rc.7',
    ' * release: settings.describe filters and every settings write refuse',
    ' * namespaces outside this allowlist with `settings-not-exposed`.',
    ' * Model-provider namespaces remain exposed.',
    ' */',
    'const WEB_SETTINGS_NAMESPACES = new Set([',
    ...allowlist.map((ns) => `\t"${ns}",`),
    ']);\n',
  ].join('\n')
  if (source.includes(constant)) {
    console.log('Settings namespace boundary already restored')
    return
  }
  const describeAnchor = 'namespaces: settings.describe({ redactSecrets: true }).map(namespaceView)'
  const describeReplacement = [
    'namespaces: settings.describe({ redactSecrets: true }).filter((descriptor) => {',
    '\t\t\t\t\tif (WEB_SETTINGS_NAMESPACES.has(String(descriptor.ns))) return true',
    '\t\t\t\t\tfor (const entry of ctx.llm.listConfigurableProviders()) {',
    '\t\t\t\t\t\tif (entry.settingsNs === String(descriptor.ns)) return true',
    '\t\t\t\t\t}',
    '\t\t\t\t\treturn false',
    '\t\t\t\t}).map(namespaceView)',
  ].join('\n')
  const writeAnchor = 'branded = settingsNamespace(ns);'
  const writeGuard = [
    '\t\tif (WEB_SETTINGS_NAMESPACES.has(ns) === false && ctx.llm.listConfigurableProviders().every((entry) => entry.settingsNs !== ns)) {',
    '\t\t\treturn err(request, {',
    '\t\t\t\tcode: "settings-not-exposed",',
    '\t\t\t\tmessage: `settings namespace "${ns}" is not exposed to configuration clients`,',
    '\t\t\t\tdetails: { ns },',
    '\t\t\t})',
    '\t\t}',
  ].join('\n')
  const constantAnchor = 'const DEFAULT_MAX_MESSAGES = 50;'
  for (const anchor of [constantAnchor, describeAnchor, writeAnchor]) {
    if (source.includes(anchor) === false) {
      throw new Error(`dsh-host-apiproxy settings boundary anchor missing: ${anchor}`)
    }
  }
  let next = source.replace(constantAnchor, constantAnchor + constant)
  next = next.replace(describeAnchor, describeReplacement)
  next = next.replace(writeAnchor, writeAnchor + '\n' + writeGuard)
  writeFileSync(indexPath, next)
  console.log('Restored the settings namespace boundary on the staged api-proxy')
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

if (isWindowsNode && !npmRelease) ensureWindowsWorkspacePackages()
replaceDeprecatedDomExceptionShim()
assertDeprecatedLockBranchesAreNotShipped()
if (npmRelease) {
  console.log('Exposing npm release packages for profile resolution')
  exposeHoistedPackages()
  recordExposedDependencies()
} else {
  console.log('Relinking workspace packages')
  rewriteWorkspaceLinks()
  relinkInstallationWorkspacePackages()
}
console.log('Installing desktop packages')
installDesktopPackages()
if (npmRelease) {
  // The npm assembly carries only the CLI package; install the packaged
  // DSH notices beside it. Oh-DSH notices are updated in this repository.
  copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(runtime, 'THIRD_PARTY_NOTICES.md'))
} else {
  copyFileSync(join(dshSource, 'THIRD_PARTY_NOTICES.md'), join(runtime, 'THIRD_PARTY_NOTICES.md'))
}
restoreExecutableHelpers()
console.log('Normalizing runtime links')
normalizeRuntimeLinks()
restoreSettingsBoundary()
ensureLinuxLandlockLauncher()
assertSelfContained(runtime, 'DSH runtime')
ensureNodeRuntime()
assertSelfContained(nodeRuntime, 'Node runtime')
ensureLinuxPtyBuild()

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
