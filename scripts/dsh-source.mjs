import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  throw new Error(`dsh-source.json: ${message}`)
}

function readSourceSpec() {
  const value = JSON.parse(readFileSync(join(root, 'dsh-source.json'), 'utf8'))
  if (value.source === 'npm') {
    for (const field of ['package', 'version', 'integrity', 'tarball', 'packageManager']) {
      if (typeof value[field] !== 'string' || value[field] === '') {
        fail(`${field} must be a non-empty string`)
      }
    }
    if (/^sha512-[A-Za-z0-9+/=]+$/.test(value.integrity) === false) {
      fail('integrity must be an npm sha512 integrity value')
    }
    if (value.tarball.startsWith('https://registry.npmjs.org/') === false) {
      fail('tarball must point at registry.npmjs.org')
    }
    if (value.packageManager.startsWith('pnpm@') === false) {
      fail('packageManager must pin a pnpm version')
    }
    return Object.freeze({
      source: 'npm',
      package: value.package,
      version: value.version,
      integrity: value.integrity,
      tarball: value.tarball,
      packageManager: value.packageManager,
    })
  }
  for (const field of ['repository', 'ref', 'revision', 'version']) {
    if (typeof value[field] !== 'string' || value[field] === '') {
      fail(`${field} must be a non-empty string`)
    }
  }
  if (/^[0-9a-f]{40}$/.test(value.revision) === false) {
    fail('revision must be a full Git commit')
  }
  if (value.ref !== value.revision) {
    fail('ref must equal revision')
  }
  return Object.freeze({
    source: 'git',
    repository: value.repository,
    ref: value.ref,
    revision: value.revision,
    version: value.version,
  })
}

/** Reproducible DSH release source used by release builds. */
export const DSH_SOURCE_SPEC = readSourceSpec()

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${String(result.status)}`)
  }
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

function sha512(path) {
  return createHash('sha512').update(readFileSync(path)).digest('base64')
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
 * Resolve a pnpm CLI matching the pinned release. Git checkouts declare
 * their own `packageManager`; npm release assemblies do not, so they fall
 * back to the version recorded in `dsh-source.json`.
 */
export function resolvePinnedPnpm(source) {
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  const reference = typeof manifest.packageManager === 'string' && manifest.packageManager !== ''
    ? manifest.packageManager
    : DSH_SOURCE_SPEC.source === 'npm'
      ? DSH_SOURCE_SPEC.packageManager
      : ''
  const separator = reference.lastIndexOf('@')
  const name = reference.slice(0, separator)
  const version = reference.slice(separator + 1)
  if (name !== 'pnpm' || version === '') {
    throw new Error(`pinned DSH source declares an unsupported packageManager: ${String(reference)}`)
  }
  const cache = join(root, '.cache', 'pnpm-cli')
  const installRoot = join(cache, `pnpm-${version}`)
  const cliRoot = join(installRoot, 'package')
  const cliEntry = join(cliRoot, 'bin', 'pnpm.cjs')
  if (!existsSync(cliEntry)) {
    mkdirSync(cache, { recursive: true })
    const archive = join(cache, `pnpm-${version}.tgz`)
    rmSync(archive, { force: true })
    run('curl', ['--fail', '--location', '--silent', '--show-error', '--output', archive,
      `https://registry.npmjs.org/pnpm/-/pnpm-${version}.tgz`])
    const extraction = join(cache, `.pnpm-extract-${String(process.pid)}`)
    rmSync(extraction, { recursive: true, force: true })
    mkdirSync(extraction, { recursive: true })
    run('tar', ['-xzf', archive, '-C', extraction])
    rmSync(installRoot, { recursive: true, force: true })
    mkdirSync(dirname(cliRoot), { recursive: true })
    renameSync(join(extraction, 'package'), cliRoot)
    rmSync(extraction, { recursive: true, force: true })
  }
  if (!existsSync(cliEntry)) {
    throw new Error(`pnpm ${version} CLI did not unpack to ${cliEntry}`)
  }
  const binDir = join(installRoot, 'bin')
  mkdirSync(binDir, { recursive: true })
  if (process.platform === 'win32') {
    writeFileSync(join(binDir, 'pnpm.cmd'),
      `@"${process.execPath}" "${cliEntry}" %*\r\n`)
  } else {
    const launcher = join(binDir, 'pnpm')
    writeFileSync(launcher,
      `#!/bin/sh\nexec "${process.execPath}" "${cliEntry}" "$@"\n`)
    chmodSync(launcher, 0o755)
  }
  return { binDir, cliEntry }
}

function validateVersion(source) {
  const manifestPath = join(source, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`DSH source checkout not found: ${source}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.version !== DSH_SOURCE_SPEC.version) {
    throw new Error(
      `DSH ${DSH_SOURCE_SPEC.version} is required, received ${String(manifest.version)} at ${source}`,
    )
  }
  return manifest
}

function validateSource(source, expectedRevision) {
  const manifest = validateVersion(source)
  if (DSH_SOURCE_SPEC.source === 'npm') {
    if (manifest.name !== DSH_SOURCE_SPEC.package) {
      throw new Error(
        `DSH package ${DSH_SOURCE_SPEC.package} is required, received ${String(manifest.name)} at ${source}`,
      )
    }
    if (!existsSync(join(source, 'lib', 'bin.js'))) {
      throw new Error(`DSH npm assembly is missing lib/bin.js: ${source}`)
    }
    return
  }
  if (!existsSync(join(source, 'apps', 'cli', 'package.json'))) {
    throw new Error(`DSH source checkout not found: ${source}`)
  }
  if (expectedRevision !== undefined) {
    const actual = capture('git', ['rev-parse', 'HEAD'], source)
    if (actual !== expectedRevision) {
      throw new Error(`cached DSH revision mismatch: expected ${expectedRevision}, received ${actual}`)
    }
    const changes = capture('git', ['status', '--porcelain', '--untracked-files=no'], source)
    if (changes !== '') {
      throw new Error(`cached DSH source contains tracked changes: ${source}`)
    }
  }
}

function acquirePinnedSource(target) {
  const temporary = `${target}.clone-${String(process.pid)}`
  rmSync(temporary, { recursive: true, force: true })
  try {
    run('git', ['init', temporary])
    run('git', ['-C', temporary, 'remote', 'add', 'origin', DSH_SOURCE_SPEC.repository])
    run('git', [
      '-C', temporary,
      'fetch',
      '--depth=1',
      '--filter=blob:none',
      '--no-tags',
      'origin',
      DSH_SOURCE_SPEC.revision,
    ])
    run('git', ['-C', temporary, 'checkout', '--detach', DSH_SOURCE_SPEC.revision])
    const actual = capture('git', ['rev-parse', 'HEAD'], temporary)
    if (actual !== DSH_SOURCE_SPEC.revision) {
      throw new Error(
        `DSH ref moved: expected ${DSH_SOURCE_SPEC.revision}, received ${actual}`,
      )
    }
    try {
      renameSync(temporary, target)
    } catch (error) {
      if (!existsSync(join(target, '.git'))) throw error
      validateSource(target, DSH_SOURCE_SPEC.revision)
      rmSync(temporary, { recursive: true, force: true })
    }
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    throw error
  }
}

function acquireNpmAssembly(target, archive) {
  const extraction = join(dirname(target), `.npm-extract-${String(process.pid)}`)
  rmSync(extraction, { recursive: true, force: true })
  mkdirSync(extraction, { recursive: true })
  try {
    run('tar', ['-xzf', archive, '-C', extraction])
    const unpacked = join(extraction, 'package')
    if (!existsSync(unpacked)) {
      throw new Error(`DSH npm package did not unpack to ${unpacked}`)
    }
    rmSync(target, { recursive: true, force: true })
    renameSync(unpacked, target)
  } finally {
    rmSync(extraction, { recursive: true, force: true })
  }
}

function resolveNpmAssembly() {
  const parent = join(root, '.cache', 'dsh-source', `npm-${DSH_SOURCE_SPEC.version}`)
  const target = join(parent, 'assembly')
  const archive = join(parent, `${DSH_SOURCE_SPEC.version}.tgz`)
  mkdirSync(parent, { recursive: true })
  if (!existsSync(archive)) download(DSH_SOURCE_SPEC.tarball, archive)
  const actualIntegrity = `sha512-${sha512(archive)}`
  if (actualIntegrity !== DSH_SOURCE_SPEC.integrity) {
    throw new Error(
      `DSH npm archive integrity mismatch: expected ${DSH_SOURCE_SPEC.integrity}, received ${actualIntegrity}`,
    )
  }
  // The archive is integrity-checked above on every call, so the extraction
  // is always re-run: a later stage mutates this tree (e.g. `pnpm install`
  // into the assembly), and a reused cache would silently carry those
  // mutations — or any other corruption — into the next release build.
  acquireNpmAssembly(target, archive)
  writeFileSync(
    join(target, 'pnpm-workspace.yaml'),
    // Mirror the repository policy: freshly published rc releases sit inside
    // pnpm's minimumReleaseAge window, and the pinned assembly must install
    // them without waiting for the age cutoff.
    'packages:\n  - .\n\nminimumReleaseAgeExclude:\n  - \'@deepseek-ai/*\'\n',
  )
  validateSource(target)
  return target
}
/** Resolve an explicit development checkout or the pinned release source. */
export function resolveDshSource() {
  if (process.env.DSH_SOURCE !== undefined) {
    const source = resolve(process.env.DSH_SOURCE)
    validateSource(source)
    console.log(`Using DSH source override: ${source}`)
    return source
  }
  if (DSH_SOURCE_SPEC.source === 'npm') {
    const source = resolveNpmAssembly()
    console.log(`Using pinned DSH npm release ${DSH_SOURCE_SPEC.version} (${DSH_SOURCE_SPEC.integrity.slice(0, 24)}…)`)
    return source
  }

  const parent = join(root, '.cache', 'dsh-source')
  const target = join(parent, DSH_SOURCE_SPEC.revision.slice(0, 12))
  mkdirSync(parent, { recursive: true })
  if (!existsSync(join(target, '.git'))) acquirePinnedSource(target)
  validateSource(target, DSH_SOURCE_SPEC.revision)
  console.log(
    `Using pinned DSH ${DSH_SOURCE_SPEC.version} (${DSH_SOURCE_SPEC.revision.slice(0, 12)})`,
  )
  return target
}
