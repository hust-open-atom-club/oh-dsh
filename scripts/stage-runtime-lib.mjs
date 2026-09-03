import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_SOURCE_SPEC } from './dsh-source.mjs'
import {
  landlockLauncherPackageName,
  restoreLandlockLauncher,
} from './landlock-launcher.mjs'
import { adaptTuiLiangshenPresentation as defaultAdaptTuiLiangshenPresentation } from '../plugins/liangshen/src/upstream-adapter.mjs'
import { adaptTuiRendererPackage as defaultAdaptTuiRendererPackage } from './tui-upstream-adapter.mjs'

export const STAGE_SURFACES = new Set(['all', 'desktop', 'web', 'tui'])


export function parseStageSurface(argv = process.argv.slice(2), env = process.env) {
  let value = env.DSH_STAGE_SURFACE ?? 'all'
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') {
      continue
    } else if (argument === '--surface') {
      value = argv[index + 1]
      index += 1
    } else if (argument.startsWith('--surface=')) {
      value = argument.slice('--surface='.length)
    } else {
      throw new Error(`unknown stage option: ${argument}`)
    }
  }
  if (!STAGE_SURFACES.has(value)) {
    throw new Error(`invalid stage surface: ${String(value)} (expected all, desktop, web, or tui)`)
  }
  return value
}


export const SURFACE_PACKAGE_NAMES = Object.freeze({
  desktop: new Set([
    '@oh-dsh/desktop',
    '@oh-dsh/liangshen',
    '@oh-dsh/better-sidebar-runtime',
    '@oh-dsh/vision',
    '@oh-dsh/desktop-frame',
    '@oh-dsh/about',
    '@oh-dsh/skins',
    '@oh-dsh/sidebar',
    '@oh-dsh/panel-controls',
    '@oh-dsh/pinned-summary',
    '@oh-dsh/plugin-marketplace',
    'dsh-context',
    '@deepseek-harness-tui/dsh-auth',
  ]),
  web: new Set([
    '@oh-dsh/web',
    '@oh-dsh/liangshen',
    '@oh-dsh/better-sidebar-runtime',
    '@oh-dsh/vision',
    '@oh-dsh/about',
    '@oh-dsh/skins',
    '@oh-dsh/pinned-summary',
    '@oh-dsh/sidebar',
    '@oh-dsh/panel-controls',
    '@oh-dsh/plugin-marketplace',
    'dsh-context',
    '@deepseek-harness-tui/dsh-auth',
  ]),
  tui: new Set([
    '@deepseek-harness-tui/dsh-tui',
    '@oh-dsh/tui',
    '@oh-dsh/tui-marketplace',
    '@oh-dsh/vision',
    '@oh-dsh/skins',
    '@oh-dsh/plugin-marketplace',
  ]),
})

export const ALL_SURFACE_PACKAGE_NAMES = new Set(
  [...SURFACE_PACKAGE_NAMES.desktop, ...SURFACE_PACKAGE_NAMES.web, ...SURFACE_PACKAGE_NAMES.tui],
)


/**
 * Build the shared DSH runtime staging operations for one staging context.
 *
 * The official release pipeline (scripts/stage-dsh.mjs) and the Nix package
 * (nix/oh-dsh.nix) construct the same context — repository root, staged
 * runtime/node-runtime roots, DSH source checkout, and target platform —
 * and consume the same functions, so the two packaged layouts cannot drift.
 * Network access (Node/DSH downloads, pnpm installs) stays outside this
 * module; callers resolve those inputs first.
 */
export function createStageRuntime(context) {
  const {
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
    adapters: {
      adaptTuiRendererPackage,
      adaptTuiLiangshenPresentation,
    } = {
      adaptTuiRendererPackage: defaultAdaptTuiRendererPackage,
      adaptTuiLiangshenPresentation: defaultAdaptTuiLiangshenPresentation,
    },
  } = context

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




function pruneRuntimeDevelopmentFiles() {
  const removable = ['.d.ts', '.map', '.ts', '.tsx']
  let count = 0
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
      } else if (entry.isFile() && removable.some(extension => entry.name.endsWith(extension))) {
        rmSync(path, { force: true })
        count += 1
      }
    }
  }
  visit(join(runtime, 'node_modules'))
  console.log(`Pruned ${count} DSH runtime development files`)
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


function resolveDependencyManifest(requireFromPackage, dependency, fromDirectory) {
  try {
    return requireFromPackage.resolve(`${dependency}/package.json`)
  } catch (packageJsonError) {
    // A restricted exports map (e.g. @earendil-works/pi-ai) can hide both
    // ./package.json and the main entry from require.resolve; walk the
    // node_modules chain from the requiring package instead.
    let directory = fromDirectory
    for (;;) {
      for (const candidate of [
        join(directory, 'node_modules', ...dependency.split('/')),
        directory,
      ]) {
        const manifestPath = join(candidate, 'package.json')
        if (existsSync(manifestPath)) {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
          if (manifest.name === dependency) return manifestPath
        }
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

/**
 * Better Sidebar and DSH both consume node-pty, but the pinned runtime owns
 * the native binding that is rebuilt for the staged Node. Do not leave the
 * sidebar's source-workspace 1.1.x copy nested under the plugin: on Linux it
 * has no usable pty.node after deployment and the Web terminal degrades.
 */

function alignBetterSidebarPtyDependency(packageDir) {
  const runtimePty = runtimePackageDirectory('node-pty')
  const runtimeManifestPath = join(runtimePty, 'package.json')
  if (!existsSync(runtimeManifestPath)) {
    throw new Error('staged DSH runtime is missing its node-pty package')
  }
  const nestedPty = join(packageDir, 'node_modules', 'node-pty')
  rmSync(nestedPty, { recursive: true, force: true })
  mkdirSync(dirname(nestedPty), { recursive: true })
  if (isWindowsNode) {
    cpSync(runtimePty, nestedPty, { dereference: true, preserveTimestamps: true, recursive: true })
  } else {
    portableSymlink(relative(dirname(nestedPty), runtimePty), nestedPty)
    rmSync(join(packageDir, 'node_modules', '.oh-dsh-store', 'node-pty_1.1.0'), {
      recursive: true,
      force: true,
    })
  }

  const manifestPath = join(packageDir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const runtimeManifest = JSON.parse(readFileSync(runtimeManifestPath, 'utf8'))
  manifest.dependencies = {
    ...(manifest.dependencies ?? {}),
    'node-pty': runtimeManifest.version,
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
}


function installWindowsPackageDependencies(sourceManifestPath, packageDir) {
  const manifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'))
  // Peer dependencies resolve from the staged runtime's hoisted tree (the
  // dsh-context host imports zod and the scoped cordis/schemastery that way);
  // only runtime dependencies need a pnpm deploy closure, and the workspace
  // filter can never match an upstream-pinned package outside the workspace.
  const runtimeDependencies = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]
  if (runtimeDependencies.length === 0) return
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
          resolveDependencyManifest(requireFromPackage, dependency, source),
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
        resolveDependencyManifest(
          requireFromSource,
          dependency,
          dirname(sourceManifestPath),
        ),
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
  // Flat runtimes (the offline Nix DSH sources) have no pnpm store; fall
  // through to the descriptive error instead of crashing on a missing dir.
  if (existsSync(store)) {
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


function installDesktopPackages(surface = 'all') {
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
      manifest: join(root, 'plugins', 'liangshen', 'package.json'),
      files: [
        [join(root, 'dist', 'plugins', 'liangshen', 'index.js'), 'dist/index.js'],
        [join(root, 'upstream', 'dsh-TUI', 'presets', 'liangshen'), 'presets/liangshen'],
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
      'about',
      'desktop-frame',
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
      // The upstream subscription OAuth package is host-only (llm routes +
      // /auth command over the user-questions seam); Desktop and Web mount
      // it directly, the TUI loads it through the renderer's oauth row.
      manifest: join(root, 'upstream', 'dsh-TUI', 'dsh-auth', 'package.json'),
      files: [
        [join(root, 'upstream', 'dsh-TUI', 'dsh-auth', 'lib'), 'lib'],
        [join(root, 'upstream', 'dsh-TUI', 'dsh-auth', 'dsh-plugin.json'), 'dsh-plugin.json'],
        [join(root, 'upstream', 'dsh-TUI', 'dsh-auth', 'cordis.patch.yml'), 'cordis.patch.yml'],
        [join(root, 'upstream', 'dsh-TUI', 'dsh-auth', 'LICENSE'), 'LICENSE'],
      ],
    },
    {
      // dsh-context builds itself inside the submodule with its own tsdown
      // config (host ESM + browser client bundle with the DSH module-loader
      // banner); stage the prebuilt lib like the dsh-TUI renderer.
      manifest: join(root, 'upstream', 'dsh-context', 'package.json'),
      files: [
        [join(root, 'upstream', 'dsh-context', 'lib'), 'lib'],
        [join(root, 'upstream', 'dsh-context', 'cordis.patch.yml'), 'cordis.patch.yml'],
        [join(root, 'upstream', 'dsh-context', 'LICENSE'), 'LICENSE'],
      ],
    },
    {
      manifest: join(root, 'upstream', 'dsh-TUI', 'package.json'),
      files: [
        [join(root, 'upstream', 'dsh-TUI', 'lib'), 'lib'],
        [join(root, 'upstream', 'dsh-TUI', 'dsh-ecosystem-spec'), 'dsh-ecosystem-spec'],
        [join(root, 'upstream', 'dsh-TUI', 'presets'), 'presets'],
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
  const selected = surface === 'all' ? undefined : SURFACE_PACKAGE_NAMES[surface]
  for (const name of ALL_SURFACE_PACKAGE_NAMES) {
    if (selected?.has(name) !== false) continue
    rmSync(runtimePackageDirectory(name), { recursive: true, force: true })
  }

  const installedVersions = {}
  for (const spec of packages) {
    const manifest = JSON.parse(readFileSync(spec.manifest, 'utf8'))
    if (selected !== undefined && !selected.has(manifest.name)) continue
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
    if (manifest.name === '@oh-dsh/better-sidebar-runtime') {
      alignBetterSidebarPtyDependency(packageDir)
    }
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
    if (manifest.name === '@deepseek-harness-tui/dsh-tui') {
      adaptTuiRendererPackage(packageDir)
      adaptTuiLiangshenPresentation(packageDir)
    }
    installedVersions[manifest.name] = manifest.version
  }
  const cliManifestPath = join(runtime, 'package.json')
  const cliManifest = JSON.parse(readFileSync(cliManifestPath, 'utf8'))
  const dependencies = { ...(cliManifest.dependencies ?? {}) }
  for (const name of ALL_SURFACE_PACKAGE_NAMES) delete dependencies[name]
  cliManifest.dependencies = {
    ...dependencies,
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
 * Stage a complete, self-contained pnpm distribution beside the node
 * runtime. Scripted Marketplace previews resolve this entry through
 * bundledRuntimePaths and must find the published CLI layout:
 * node-runtime/lib/node_modules/pnpm/bin/pnpm.mjs (POSIX) plus a
 * node-runtime/bin/pnpm launcher link.
 */
function stagePnpmIntoNodeRuntime({ pnpmSource }) {
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

  return {
    portableSymlink,
    exposeHoistedPackages,
    recordExposedDependencies,
    ensureWindowsWorkspacePackages,
    findDeployedPackage,
    stageDependencyTarget,
    mirrorPackageDependencies,
    stageWorkspaceTarget,
    stageVendorTarget,
    stageSourceCounterpart,
    walk,
    replaceDeprecatedDomExceptionShim,
    assertDeprecatedLockBranchesAreNotShipped,
    normalizeRuntimeLinks,
    rewriteWorkspaceLinks,
    relinkInstallationWorkspacePackages,
    assertSelfContained,
    runtimePackageDirectory,
    resolveDependencyManifest,
    packageMatches,
    alignBetterSidebarPtyDependency,
    installWindowsPackageDependencies,
    installCompiledPackageDependencies,
    runtimeDependencyTarget,
    installCompiledPackageHostDependencies,
    installDesktopPackages,
    restoreExecutableHelpers,
    ensureLinuxPtyBuild,
    ensureLinuxLandlockLauncher,
    pruneRuntimeDevelopmentFiles,
    stagePnpmIntoNodeRuntime,
  }
}

const libPath = resolve(fileURLToPath(import.meta.url))

function cliRun(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${String(result.status)}`)
  }
}

function cliOption(args, name) {
  const index = args.indexOf(name)
  if (index < 0 || args[index + 1] === undefined) {
    throw new Error(`missing ${name} argument`)
  }
  return args[index + 1]
}

// Small command surface for offline consumers (nix/oh-dsh.nix): the staging
// library keeps its functions importable, and the subcommands below let a
// derivation invoke the same assembler without running stage-dsh.mjs (whose
// top-level flow downloads Node and the DSH npm tarball).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === libPath) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'install-packages') {
    const root = resolve(cliOption(args, '--root'))
    const runtime = resolve(cliOption(args, '--runtime'))
    createStageRuntime({
      root,
      stage: join(root, '.stage'),
      runtime,
      nodeRuntime: join(runtime, '..', 'node-runtime'),
      dshSource: root,
      isWindowsNode: args.includes('--is-windows'),
      nodePlatform: 'linux',
      nodeArch: 'x64',
      npmRelease: args.includes('--release-graph'),
      run: cliRun,
    }).installDesktopPackages(cliOption(args, '--surface'))
  } else if (command === 'stage-pnpm') {
    const source = resolve(cliOption(args, '--source'))
    const nodeRuntime = resolve(cliOption(args, '--target'))
    createStageRuntime({
      root: source,
      stage: join(source, '.stage'),
      runtime: nodeRuntime,
      nodeRuntime,
      dshSource: source,
      isWindowsNode: args.includes('--is-windows'),
      nodePlatform: 'linux',
      nodeArch: 'x64',
      npmRelease: true,
      run: cliRun,
    }).stagePnpmIntoNodeRuntime({ pnpmSource: source })
  } else if (command === 'restore-executable-helpers') {
    const runtime = resolve(cliOption(args, '--runtime'))
    createStageRuntime({
      root: runtime,
      stage: join(runtime, '.stage'),
      runtime,
      nodeRuntime: join(runtime, '..', 'node-runtime'),
      dshSource: runtime,
      isWindowsNode: false,
      nodePlatform: 'linux',
      nodeArch: 'x64',
      npmRelease: true,
      run: cliRun,
    }).restoreExecutableHelpers()
  } else {
    throw new Error(
      `unknown stage-runtime command: ${String(command)} (expected install-packages, stage-pnpm, or restore-executable-helpers)`,
    )
  }
}
