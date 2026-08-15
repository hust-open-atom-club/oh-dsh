import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import type { Stats } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Environment variable overriding the shared Oh-DSH state root. */
export const OH_DSH_HOME_ENV = 'OH_DSH_HOME'

/** Default directory shared by the Desktop, Web, and TUI surfaces. */
export const DEFAULT_OH_DSH_HOME_DIRECTORY = '.ohdsh'

/** Legacy desktop user-data directory used before the shared state root. */
export const LEGACY_DESKTOP_DATA_DIRECTORY = 'Oh-DSH-Desktop'

/** Legacy Web data directory used before the shared state root. */
export const LEGACY_WEB_DATA_DIRECTORY = '.oh-dsh-web'

const MIGRATIONS_DIRECTORY = '.migrations'
const DESKTOP_MIGRATION = 'desktop-state-v1.complete'
const WEB_DEFAULT_MIGRATION = 'web-default-v1.complete'
const WEB_FLAT_MIGRATION = 'web-flat-v1.complete'
const DESKTOP_SHARED_ENTRIES = new Set([
  'desktop-sidebar.json',
  'desktop-skins.json',
  'dsh',
  'logs',
  'plugin-marketplace',
  'sidebar.json',
  'skins.json',
])
const WEB_SHARED_ENTRIES = new Set([
  'desktop-sidebar.json',
  'desktop-skins.json',
  'sidebar.json',
  'skins.json',
])

/** Resolve the default Oh-DSH state root for one user account. */
export function defaultOhDshHome(userHome: string = homedir()): string {
  return join(userHome, DEFAULT_OH_DSH_HOME_DIRECTORY)
}

/** Resolve the shared state root, honoring the cross-surface override. */
export function resolveOhDshHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
): string {
  const configured = env[OH_DSH_HOME_ENV]
  return resolve(configured === undefined || configured === ''
    ? defaultOhDshHome(userHome)
    : configured)
}

/** Whether a caller explicitly selected a shared state root. */
export function hasOhDshHomeOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = env[OH_DSH_HOME_ENV]
  return configured !== undefined && configured !== ''
}

/** Keep Electron's Chromium data contained below the shared state root. */
export function desktopElectronDataRoot(ohDshHome: string): string {
  return join(ohDshHome, 'desktop')
}

/** Resolve the legacy Web data root for one user account. */
export function legacyWebDataRoot(userHome: string = homedir()): string {
  return join(userHome, LEGACY_WEB_DATA_DIRECTORY)
}

function migrationMarker(root: string, name: string): string {
  return join(root, MIGRATIONS_DIRECTORY, name)
}

function stat(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function followedStat(path: string): Stats | undefined {
  try {
    return statSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function containsPath(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate)
  return path !== ''
    && path !== '..'
    && !path.startsWith(`..${sep}`)
    && !isAbsolute(path)
}

interface CopyRoots {
  destination: string
  source: string
}

function relocatedLinkTarget(
  source: string,
  destination: string,
  roots: CopyRoots | undefined,
  targetStat: Stats | undefined,
): { absolute: string; posix: string } {
  const original = readlinkSync(source)
  const lexicalTarget = isAbsolute(original)
    ? resolve(original)
    : resolve(realpathSync(dirname(source)), original)
  const canonicalTarget = targetStat === undefined
    ? lexicalTarget
    : realpathSync(source)
  const movesWithTree = roots !== undefined
    && (canonicalTarget === roots.source
      || containsPath(roots.source, canonicalTarget))
  const absolute = movesWithTree
    ? join(roots.destination, relative(roots.source, canonicalTarget))
    : canonicalTarget
  const posix = !movesWithTree && isAbsolute(original)
    ? original
    : relative(realpathSync(dirname(destination)), absolute) || '.'
  return { absolute, posix }
}

function copyEntry(
  source: string,
  destination: string,
  roots?: CopyRoots,
): boolean {
  const sourceStat = stat(source)
  if (sourceStat === undefined) return true
  const destinationStat = stat(destination)

  if (sourceStat.isDirectory()) {
    if (destinationStat !== undefined && !destinationStat.isDirectory()) return true
    mkdirSync(destination, { recursive: true, mode: sourceStat.mode & 0o777 })
    const copyRoots = roots ?? {
      destination: realpathSync(destination),
      source: realpathSync(source),
    }
    let copied = true
    for (const entry of readdirSync(source)) {
      copied = copyEntry(
        join(source, entry),
        join(destination, entry),
        copyRoots,
      ) && copied
    }
    return copied
  }

  if (sourceStat.isFile()) {
    if (destinationStat !== undefined && !destinationStat.isFile()) return true
    if (destinationStat !== undefined) return true
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
    try {
      copyFileSync(source, destination, fsConstants.COPYFILE_EXCL)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    return true
  }

  if (!sourceStat.isSymbolicLink() || destinationStat !== undefined) return true
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
  const targetStat = followedStat(source)
  const linkTarget = relocatedLinkTarget(source, destination, roots, targetStat)
  if (process.platform === 'win32') {
    if (targetStat === undefined) return false
    if (targetStat?.isDirectory() === true) {
      symlinkSync(linkTarget.absolute, destination, 'junction')
    } else if (targetStat?.isFile() === true) {
      try {
        copyFileSync(source, destination, fsConstants.COPYFILE_EXCL)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    return true
  }
  try {
    symlinkSync(
      linkTarget.posix,
      destination,
      targetStat?.isDirectory() === true ? 'dir' : 'file',
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return true
}

function copyDirectoryContents(
  source: string,
  destination: string,
  options: { exclude?: ReadonlySet<string> } = {},
): boolean {
  const sourceStat = followedStat(source)
  if (sourceStat === undefined || !sourceStat.isDirectory()) return false
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  const sourceRoot = realpathSync(source)
  const destinationRoot = realpathSync(destination)
  if (sourceRoot === destinationRoot) return true
  if (containsPath(sourceRoot, destinationRoot)) return false
  const roots = { destination: destinationRoot, source: sourceRoot }
  let copied = true
  for (const entry of readdirSync(source)) {
    if (options.exclude?.has(entry) === true) continue
    copied = copyEntry(
      join(source, entry),
      join(destination, entry),
      roots,
    ) && copied
  }
  return copied
}

function completeMigration(root: string, name: string): void {
  const marker = migrationMarker(root, name)
  mkdirSync(dirname(marker), { recursive: true, mode: 0o700 })
  if (!existsSync(marker)) writeFileSync(marker, 'complete\n', { mode: 0o600 })
}

/**
 * Copy the pre-shared Desktop state into the new layout once.
 *
 * Existing shared state wins over every legacy entry. On a direct upgrade the
 * Electron-only directory is absent, so its Chromium state is still imported.
 */
export function migrateLegacyDesktopState(input: {
  appDataRoot: string
  env?: NodeJS.ProcessEnv
  ohDshHome: string
}): boolean {
  if (hasOhDshHomeOverride(input.env ?? process.env)) return false
  if (existsSync(migrationMarker(input.ohDshHome, DESKTOP_MIGRATION))) return false

  const legacyRoot = join(input.appDataRoot, LEGACY_DESKTOP_DATA_DIRECTORY)
  const legacyStat = followedStat(legacyRoot)
  if (legacyStat === undefined || !legacyStat.isDirectory()) return false

  const legacyDshHome = join(legacyRoot, 'dsh')
  if (stat(legacyDshHome) !== undefined
    && !copyDirectoryContents(legacyDshHome, input.ohDshHome)) return false
  let copiedSharedEntries = true
  for (const entry of DESKTOP_SHARED_ENTRIES) {
    if (entry === 'dsh') continue
    copiedSharedEntries = copyEntry(
      join(legacyRoot, entry),
      join(input.ohDshHome, entry),
    ) && copiedSharedEntries
  }
  if (!copiedSharedEntries) return false
  if (!copyDirectoryContents(
    legacyRoot,
    desktopElectronDataRoot(input.ohDshHome),
    { exclude: DESKTOP_SHARED_ENTRIES },
  )) return false
  completeMigration(input.ohDshHome, DESKTOP_MIGRATION)
  return true
}

/**
 * Flatten legacy Web DSH homes and import the former default Web directory.
 * Legacy directories stay in place so users can still roll back safely.
 */
export function migrateLegacyWebState(input: {
  dataRoot: string
  legacyDefaultDataRoot?: string
}): boolean {
  let migrated = false
  const flatMarker = migrationMarker(input.dataRoot, WEB_FLAT_MIGRATION)
  if (!existsSync(flatMarker)
    && copyDirectoryContents(join(input.dataRoot, 'dsh'), input.dataRoot)) {
    completeMigration(input.dataRoot, WEB_FLAT_MIGRATION)
    migrated = true
  }

  const legacyDefault = input.legacyDefaultDataRoot
  const defaultMarker = migrationMarker(input.dataRoot, WEB_DEFAULT_MIGRATION)
  if (legacyDefault !== undefined
    && resolve(legacyDefault) !== resolve(input.dataRoot)
    && !existsSync(defaultMarker)) {
    const legacyDshHome = join(legacyDefault, 'dsh')
    const hasLegacyDshHome = stat(legacyDshHome) !== undefined
    const copiedLegacyDshHome = !hasLegacyDshHome
      || copyDirectoryContents(legacyDshHome, input.dataRoot)
    let foundLegacyState = hasLegacyDshHome
    let copiedSharedEntries = true
    for (const entry of WEB_SHARED_ENTRIES) {
      const source = join(legacyDefault, entry)
      if (stat(source) === undefined) continue
      foundLegacyState = true
      copiedSharedEntries = copyEntry(
        source,
        join(input.dataRoot, entry),
      ) && copiedSharedEntries
    }
    if (foundLegacyState && copiedLegacyDshHome && copiedSharedEntries) {
      completeMigration(input.dataRoot, WEB_DEFAULT_MIGRATION)
      migrated = true
    }
  }
  return migrated
}
