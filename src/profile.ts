import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Profile name reserved for the packaged desktop surface. */
export const DESKTOP_PROFILE = 'desktop'

/** Profile name reserved for the packaged Oh-DSH Web browser surface. */
export const WEB_PROFILE = 'web'

/** Profile name reserved for the packaged Oh-DSH terminal surface. */
export const TUI_PROFILE = 'tui'

/** Plugins that enroll a browser-side entry in the desktop client graph. */
export const BUNDLED_DESKTOP_CLIENT_PLUGINS = [
  '@oh-dsh/desktop',
  '@oh-dsh/desktop-frame',
  '@oh-dsh/about',
  '@oh-dsh/skins',
  '@oh-dsh/sidebar',
  '@oh-dsh/panel-controls',
  '@oh-dsh/pinned-summary',
  '@oh-dsh/plugin-marketplace',
  '@oh-dsh/vision',
  // Pinned upstream plugin (upstream/dsh-context) staged under its npm name.
  'dsh-context',
] as const

/** Host-only capability providers shipped inside the desktop runtime. */
export const BUNDLED_DESKTOP_HOST_PLUGINS = [
  '@oh-dsh/better-sidebar-runtime',
  '@oh-dsh/liangshen',
  // Pinned upstream host plugin (upstream/dsh-TUI/dsh-auth): no browser
  // half; the /auth command interacts through the user-questions seam.
  '@deepseek-harness-tui/dsh-auth',
] as const

/** Every protected plugin shipped inside the desktop distribution. */
export const BUNDLED_DESKTOP_PLUGINS = [
  ...BUNDLED_DESKTOP_CLIENT_PLUGINS,
  ...BUNDLED_DESKTOP_HOST_PLUGINS,
] as const

/** Bundle order owned by the desktop distribution. */
export const DESKTOP_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@oh-dsh/desktop',
] as const

/** Bundle order owned by the Oh-DSH Web browser distribution. */
export const WEB_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@oh-dsh/web',
] as const

/** Bundle order owned by the Oh-DSH terminal distribution. */
export const TUI_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-harness-tui/dsh-tui',
  '@oh-dsh/tui',
] as const

/** Bundles that were owned by the TUI profile and are retired on upgrade. */
const TUI_SUPERSEDED_BUNDLES = ['dsh-cc-tui'] as const

interface ProfileManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
  [key: string]: unknown
}

/** Paths created for one desktop profile. */
export interface DesktopProfilePaths {
  dshHome: string
  profileDir: string
}

const PNPM_WORKSPACE = `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n`

function rootConfig(spec: ProfileSpec): string {
  return `# Oh-DSH ${spec.name} profile root. Composition lives in bundle patch layers.\n[]\n`
}

function userPatch(spec: ProfileSpec): string {
  return `# User patch layer for Oh-DSH ${spec.name}. It is applied after the packaged bundles.\n[]\n`
}

function readManifest(path: string): ProfileManifest {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`desktop profile manifest ${path} must contain an object`)
  }
  return parsed as ProfileManifest
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.desktop-tmp-${String(process.pid)}`
  writeFileSync(temporary, JSON.stringify(value, undefined, 2) + '\n', { mode: 0o600 })
  renameSync(temporary, path)
}

function requiredBundles(
  existing: readonly string[],
  owned: readonly string[],
  superseded: readonly string[] = [],
): string[] {
  const required = new Set<string>(owned)
  const retired = new Set<string>(superseded)
  return [...owned, ...existing.filter(bundle => !required.has(bundle) && !retired.has(bundle))]
}

/** One packaged distribution surface: its profile name, bundles, and manifest identity. */
export interface ProfileSpec {
  bundles: readonly string[]
  manifestName: string
  name: string
  supersededBundles?: readonly string[]
}

/** Profile facts for the packaged desktop surface. */
export const DESKTOP_PROFILE_SPEC: ProfileSpec = Object.freeze({
  bundles: DESKTOP_BUNDLES,
  manifestName: 'dsh-profile-desktop',
  name: DESKTOP_PROFILE,
})

/** Profile facts for the packaged Oh-DSH Web browser surface. */
export const WEB_PROFILE_SPEC: ProfileSpec = Object.freeze({
  bundles: WEB_BUNDLES,
  manifestName: 'dsh-profile-web',
  name: WEB_PROFILE,
})

/** Profile facts for the packaged Oh-DSH terminal surface. */
export const TUI_PROFILE_SPEC: ProfileSpec = Object.freeze({
  bundles: TUI_BUNDLES,
  manifestName: 'dsh-profile-tui',
  name: TUI_PROFILE,
  supersededBundles: TUI_SUPERSEDED_BUNDLES,
})

/**
 * Initialize or upgrade a writable distribution profile without replacing
 * user patches or third-party bundle entries.
 * @param spec - the surface's profile facts.
 * @param dshHome - application-owned DSH home directory.
 * @returns resolved profile paths.
 */
export function ensureProfile(spec: ProfileSpec, dshHome: string): DesktopProfilePaths {
  const profileDir = join(dshHome, 'profiles', spec.name)
  mkdirSync(profileDir, { recursive: true, mode: 0o700 })
  const manifestPath = join(profileDir, 'package.json')
  const manifest = existsSync(manifestPath)
    ? readManifest(manifestPath)
    : { name: spec.manifestName, private: true, dependencies: {} }
  const currentBundles = manifest.dsh?.profile?.bundles ?? []
  const next: ProfileManifest = {
    ...manifest,
    name: manifest.name ?? spec.manifestName,
    private: true,
    dependencies: manifest.dependencies ?? {},
    dsh: {
      ...manifest.dsh,
      profile: {
        ...manifest.dsh?.profile,
        bundles: requiredBundles(currentBundles, spec.bundles, spec.supersededBundles),
      },
    },
  }
  if (!existsSync(manifestPath) || JSON.stringify(next) !== JSON.stringify(manifest)) {
    writeJsonAtomic(manifestPath, next)
  }

  const defaults: ReadonlyArray<readonly [string, string]> = [
    ['cordis.yml', rootConfig(spec)],
    ['cordis.patch.yml', userPatch(spec)],
    ['pnpm-workspace.yaml', PNPM_WORKSPACE],
  ]
  for (const [name, contents] of defaults) {
    const path = join(profileDir, name)
    if (!existsSync(path)) writeFileSync(path, contents, { mode: 0o600 })
  }
  mkdirSync(dirname(join(dshHome, 'sessions', '.keep')), { recursive: true, mode: 0o700 })
  return { dshHome, profileDir }
}

/**
 * Initialize or upgrade the writable desktop profile without replacing user
 * patches or third-party bundle entries.
 * @param dshHome - application-owned DSH home directory.
 * @returns resolved profile paths.
 */
export function ensureDesktopProfile(dshHome: string): DesktopProfilePaths {
  return ensureProfile(DESKTOP_PROFILE_SPEC, dshHome)
}

/**
 * Initialize or upgrade the writable Oh-DSH Web profile without replacing
 * user patches or third-party bundle entries.
 * @param dshHome - application-owned DSH home directory.
 * @returns resolved profile paths.
 */
export function ensureWebProfile(dshHome: string): DesktopProfilePaths {
  return ensureProfile(WEB_PROFILE_SPEC, dshHome)
}

/**
 * Initialize or upgrade the writable Oh-DSH TUI profile without replacing
 * user patches or third-party bundle entries.
 * @param dshHome - application-owned DSH home directory.
 * @returns resolved profile paths.
 */
export function ensureTuiProfile(dshHome: string): DesktopProfilePaths {
  return ensureProfile(TUI_PROFILE_SPEC, dshHome)
}
