import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseDocument } from 'yaml'

export const AGENT_PRESET_ID = /^[a-z0-9][a-z0-9-]*$/
export const AGENT_PRESET_MANIFEST = 'manifest.yml'
export const AGENT_PRESET_SURFACES = ['desktop', 'web', 'tui']
export const AGENT_PRESET_PACKAGE_ROLES = ['agent', 'host', 'client']

const RESERVED_AGENT_PRESET_IDS = new Set(['standard', 'code', 'minimal', 'cordis'])
const MANIFEST_KEYS = new Set(['schema', 'id', 'surfaces', 'packages'])
const PACKAGE_KEYS = new Set(['path', 'role', 'surfaces'])
const JS_TAG = {
  tag: 'tag:yaml.org,2002:js',
  resolve: value => value,
}

function fail(path, message) {
  throw new Error(`agent-presets: ${path}: ${message}`)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readYaml(path) {
  let source
  try {
    source = readFileSync(path, 'utf8')
  } catch (error) {
    fail(path, `cannot read YAML: ${String(error)}`)
  }
  const document = parseDocument(source, { customTags: [JS_TAG] })
  if (document.errors.length > 0) {
    fail(path, document.errors[0].message)
  }
  return document.toJS()
}

function requireFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) fail(path, `${label} is required`)
}

function requireDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) fail(path, `${label} is required`)
}

function validateSurfaceMap(value, path, label) {
  if (!isRecord(value)) fail(path, `${label} must be a map of surface booleans`)
  for (const key of Object.keys(value)) {
    if (!AGENT_PRESET_SURFACES.includes(key)) fail(path, `${label} contains unsupported surface ${key}`)
  }
  const result = {}
  for (const surface of AGENT_PRESET_SURFACES) {
    if (typeof value[surface] !== 'boolean') {
      fail(path, `${label}.${surface} must be boolean`)
    }
    result[surface] = value[surface]
  }
  if (!Object.values(result).some(Boolean)) fail(path, `${label} must support at least one surface`)
  return result
}

function isWithin(root, candidate) {
  const fromRoot = relative(root, candidate)
  return fromRoot === ''
    || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

function resolvePackagePath(repoRoot, value, path) {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'package path must be a non-empty string')
  const segments = value.split('/')
  if (value !== value.trim()
    || value.includes('\\')
    || isAbsolute(value)
    || value.includes('\0')
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    fail(path, 'package path must be a normalized repository-relative POSIX path')
  }
  const candidate = resolve(repoRoot, value)
  const realRepoRoot = realpathSync(repoRoot)
  let realCandidate
  try {
    realCandidate = realpathSync(candidate)
  } catch {
    fail(path, `package path does not exist: ${value}`)
  }
  if (!isWithin(realRepoRoot, realCandidate)) fail(path, 'package path escapes the repository')
  requireDirectory(realCandidate, 'package directory')
  requireFile(join(realCandidate, 'package.json'), 'package.json')
  return { path: value, directory: realCandidate }
}

function packageName(directory, path) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  } catch (error) {
    fail(path, `package.json is not valid JSON: ${String(error)}`)
  }
  if (!isRecord(manifest) || typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    fail(path, 'package.json must declare a non-empty name')
  }
  return manifest.name
}

function collectPluginNames(rows, names) {
  for (const row of rows) {
    if (!isRecord(row)) continue
    if (typeof row.name === 'string') names.add(row.name)
    if (row.group === true && Array.isArray(row.config)) collectPluginNames(row.config, names)
  }
}

function compositionPluginNames(path) {
  const value = readYaml(path)
  if (!Array.isArray(value)) fail(path, 'composition must be a top-level list')
  const names = new Set()
  collectPluginNames(value, names)
  return names
}

function validatePackages(value, repoRoot, modeSurfaces, manifestPath) {
  if (!Array.isArray(value)) fail(manifestPath, 'packages must be a list')
  const paths = new Set()
  const names = new Set()
  const packages = []
  for (const [index, entry] of value.entries()) {
    const path = `${manifestPath}: packages[${String(index)}]`
    if (!isRecord(entry)) fail(path, 'package entry must be a map')
    for (const key of Object.keys(entry)) {
      if (!PACKAGE_KEYS.has(key)) fail(path, `unsupported package field ${key}`)
    }
    const packagePath = resolvePackagePath(repoRoot, entry.path, path)
    if (paths.has(packagePath.directory)) fail(path, `duplicate package path ${packagePath.path}`)
    paths.add(packagePath.directory)
    if (typeof entry.role !== 'string' || !AGENT_PRESET_PACKAGE_ROLES.includes(entry.role)) {
      fail(path, `role must be one of ${AGENT_PRESET_PACKAGE_ROLES.join(', ')}`)
    }
    const name = packageName(packagePath.directory, path)
    if (names.has(name)) fail(path, `duplicate package name ${name}`)
    names.add(name)
    let surfaces
    if (entry.surfaces === undefined) {
      surfaces = AGENT_PRESET_SURFACES.filter(surface => modeSurfaces[surface])
    } else {
      if (!Array.isArray(entry.surfaces) || entry.surfaces.length === 0) {
        fail(path, 'surfaces must be a non-empty list when provided')
      }
      const seen = new Set()
      surfaces = []
      for (const surface of entry.surfaces) {
        if (typeof surface !== 'string' || !AGENT_PRESET_SURFACES.includes(surface)) {
          fail(path, `surfaces contains unsupported value ${String(surface)}`)
        }
        if (seen.has(surface)) fail(path, `surfaces contains duplicate value ${surface}`)
        if (!modeSurfaces[surface]) fail(path, `surface ${surface} is disabled for this preset`)
        seen.add(surface)
        surfaces.push(surface)
      }
    }
    packages.push({
      directory: packagePath.directory,
      name,
      path: packagePath.path,
      role: entry.role,
      surfaces,
    })
  }
  return { names, packages }
}

/** Validate one downstream Agent preset and return its build metadata. */
export function readAgentPresetManifest(repoRoot, directory) {
  const rootPath = resolve(repoRoot)
  const presetDirectoryPath = resolve(directory)
  requireDirectory(rootPath, 'repository root')
  requireDirectory(presetDirectoryPath, 'preset directory')
  const root = realpathSync(rootPath)
  const presetDirectory = realpathSync(presetDirectoryPath)
  if (!isWithin(root, presetDirectory)) fail(directory, 'preset directory escapes the repository')
  const id = basename(presetDirectory)
  if (!AGENT_PRESET_ID.test(id)) fail(presetDirectory, `invalid preset id ${id}`)
  if (RESERVED_AGENT_PRESET_IDS.has(id)) fail(presetDirectory, `preset id ${id} is reserved by the pinned DSH runtime`)

  const manifestPath = join(presetDirectory, AGENT_PRESET_MANIFEST)
  const presetPath = join(presetDirectory, 'preset.yml')
  const compositionPath = join(presetDirectory, 'agent.cordis.yml')
  requireFile(manifestPath, AGENT_PRESET_MANIFEST)
  requireFile(presetPath, 'preset.yml')
  requireFile(compositionPath, 'agent.cordis.yml')

  const value = readYaml(manifestPath)
  if (!isRecord(value)) fail(manifestPath, 'manifest must be a map')
  for (const key of Object.keys(value)) {
    if (!MANIFEST_KEYS.has(key)) fail(manifestPath, `unsupported manifest field ${key}`)
  }
  if (value.schema !== 1) fail(manifestPath, 'schema must be 1')
  if (value.id !== id) fail(manifestPath, `id must match directory name ${id}`)
  const surfaces = validateSurfaceMap(value.surfaces, manifestPath, 'surfaces')
  const packageInfo = validatePackages(value.packages, root, surfaces, manifestPath)
  const compositionNames = compositionPluginNames(compositionPath)
  const localNames = [...compositionNames].filter(name => name.startsWith('@oh-dsh/'))
  for (const name of localNames) {
    if (!packageInfo.names.has(name)) {
      fail(compositionPath, `local plugin ${name} is not declared in manifest packages`)
    }
  }
  for (const entry of packageInfo.packages) {
    if (entry.role === 'agent' && !compositionNames.has(entry.name)) {
      fail(manifestPath, `agent package ${entry.name} is not referenced by agent.cordis.yml`)
    }
  }
  return {
    compositionPath,
    directory: presetDirectory,
    id,
    manifestPath,
    packages: packageInfo.packages,
    presetPath,
    surfaces,
  }
}

/** Discover and validate every downstream preset below the repository root. */
export function discoverAgentPresetManifests(repoRoot, sourceRoot = join(repoRoot, 'agent-presets')) {
  const rootPath = resolve(repoRoot)
  const sourcePath = resolve(sourceRoot)
  requireDirectory(rootPath, 'repository root')
  requireDirectory(sourcePath, 'preset source root')
  const root = realpathSync(rootPath)
  const source = realpathSync(sourcePath)
  if (!isWithin(root, source)) fail(sourceRoot, 'preset source root escapes the repository')
  const manifests = []
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    manifests.push(readAgentPresetManifest(root, join(source, entry.name)))
  }
  return manifests.sort((left, right) => left.id.localeCompare(right.id))
}

/** Return the unique package sources declared across all downstream presets. */
export function discoverAgentPresetPackages(repoRoot, sourceRoot = join(repoRoot, 'agent-presets')) {
  const packages = new Map()
  const pathsByName = new Map()
  for (const manifest of discoverAgentPresetManifests(repoRoot, sourceRoot)) {
    for (const packageInfo of manifest.packages) {
      const previousPath = pathsByName.get(packageInfo.name)
      if (previousPath !== undefined && previousPath !== packageInfo.directory) {
        fail(manifest.manifestPath, `package ${packageInfo.name} is declared from multiple paths`)
      }
      pathsByName.set(packageInfo.name, packageInfo.directory)
      packages.set(packageInfo.directory, packageInfo)
    }
  }
  return [...packages.values()].sort((left, right) => left.path.localeCompare(right.path))
}

if (process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
  const manifests = discoverAgentPresetManifests(repoRoot)
  console.log(`Validated ${String(manifests.length)} downstream Agent preset(s).`)
}
