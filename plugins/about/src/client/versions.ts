/**
 * Build-time facts injected by scripts/build.mjs via esbuild `define`. The
 * packaged client never reads repository files; each `declare const` is
 * replaced with an array literal at bundle time.
 */

/** Pinned upstream DeepSeek Harness release version from dsh-source.json. */
declare const __OH_DSH_SOURCE_VERSION__: string

/** npm identity of the pinned upstream release from dsh-source.json. */
declare const __OH_DSH_SOURCE_PACKAGE__: string

/** Bundled plugin identities and versions from every plugin manifest. */
declare const __OH_DSH_PLUGIN_VERSIONS__: unknown

/** Key toolchain dependency versions from the root package.json. */
declare const __OH_DSH_DEPENDENCY_VERSIONS__: unknown

export interface VersionEntry {
  id: string
  version: string
}

/** Validate an injected literal without assuming its runtime shape. */
function parseEntries(raw: unknown): VersionEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is VersionEntry => {
    return typeof entry === 'object' && entry !== null
      && typeof (entry as VersionEntry).id === 'string'
      && typeof (entry as VersionEntry).version === 'string'
  })
}

export interface AboutVersions {
  dependencies: VersionEntry[]
  plugins: VersionEntry[]
  sourceVersion: string
  sourcePackage: string
}

export function aboutVersions(): AboutVersions {
  return {
    dependencies: parseEntries(__OH_DSH_DEPENDENCY_VERSIONS__),
    plugins: parseEntries(__OH_DSH_PLUGIN_VERSIONS__),
    sourceVersion: typeof __OH_DSH_SOURCE_VERSION__ === 'string'
      ? __OH_DSH_SOURCE_VERSION__
      : '0.0.0',
    sourcePackage: typeof __OH_DSH_SOURCE_PACKAGE__ === 'string'
      ? __OH_DSH_SOURCE_PACKAGE__
      : '',
  }
}