import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { resolveProductVersion } from '../src/version.ts'
import './ensure-upstream-context.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const productVersion = resolveProductVersion(root)
const versionDefine = {
  __OH_DSH_BUILD_VERSION__: JSON.stringify(productVersion),
  ...aboutVersionDefines(root),
}

// The About settings page renders facts that only exist in the repository
// tree at build time: the pinned upstream DSH release, the bundled plugin
// versions, and the key toolchain dependencies. Inject them as literals so
// the packaged client never reads repository files at runtime. Upstream
// pinned plugin versions live in submodule manifests; a missing submodule
// checkout only drops that row instead of failing the build.
function aboutVersionDefines(root) {
  const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
  const sourceManifest = readJson(join(root, 'dsh-source.json'))
  const sourceVersion = sourceManifest.version ?? '0.0.0'
  const sourcePackage = String(sourceManifest.package ?? '')
  const plugins = readdirSync(join(root, 'plugins'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const manifest = readJson(join(root, 'plugins', entry.name, 'package.json'))
      return { id: String(manifest.name), version: String(manifest.version) }
    })
  for (const [id, manifestPath] of [
    ['dsh-context', join(root, 'upstream', 'dsh-context', 'package.json')],
    ['@deepseek-harness-tui/dsh-auth', join(root, 'upstream', 'dsh-TUI', 'dsh-auth', 'package.json')],
  ]) {
    try {
      const manifest = readJson(manifestPath)
      plugins.push({ id, version: String(manifest.version) })
    } catch {
      // A missing submodule checkout only omits its About row.
    }
  }
  plugins.sort((left, right) => left.id.localeCompare(right.id))
  const manifest = readJson(join(root, 'package.json'))
  const dependencies = [
    { id: 'electron', version: String(manifest.devDependencies.electron) },
    { id: 'electron-updater', version: String(manifest.dependencies['electron-updater']) },
    { id: 'semver', version: String(manifest.dependencies.semver) },
  ]
  return {
    __OH_DSH_SOURCE_VERSION__: JSON.stringify(sourceVersion),
    __OH_DSH_SOURCE_PACKAGE__: JSON.stringify(sourcePackage),
    __OH_DSH_PLUGIN_VERSIONS__: JSON.stringify(plugins),
    __OH_DSH_DEPENDENCY_VERSIONS__: JSON.stringify(dependencies),
  }
}
const nodeEsmRequireBanner = [
  "import { createRequire as __ohDshCreateRequire } from 'node:module';",
  'const require = __ohDshCreateRequire(import.meta.url);',
].join('\n')
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const pluginPackages = [
  { directory: 'about', id: '@oh-dsh/about' },
  { directory: 'liangshen', hostOnly: true },
  { directory: 'tui', hostOnly: true },
  { directory: 'tui-marketplace', hostOnly: true },
  { directory: 'desktop-frame', id: '@oh-dsh/desktop-frame' },
  { directory: 'update-button', id: '@oh-dsh/update-button' },
  { directory: 'skins', id: '@oh-dsh/skins' },
  { directory: 'sidebar', id: '@oh-dsh/sidebar' },
  { directory: 'panel-controls', id: '@oh-dsh/panel-controls' },
  { directory: 'pinned-summary', id: '@oh-dsh/pinned-summary' },
  { directory: 'plugin-marketplace', id: '@oh-dsh/plugin-marketplace' },
  {
    directory: 'save-as-image',
    id: '@oh-dsh/save-as-image',
    clientExternal: ['@deepseek-ai/*'],
  },
]

const shared = {
  bundle: true,
  define: versionDefine,
  logLevel: 'info',
  sourcemap: true,
  target: 'node24',
}

const builds = [
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'main.ts')],
    outfile: join(dist, 'main.js'),
    platform: 'node',
    format: 'esm',
    external: ['electron'],
    banner: { js: nodeEsmRequireBanner },
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'update-preload.ts')],
    outfile: join(dist, 'update-preload.cjs'),
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    bundle: true,
    entryPoints: [join(root, 'src', 'update-dialog.ts')],
    outfile: join(dist, 'update-dialog.js'),
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'info',
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'preload.ts')],
    outfile: join(dist, 'preload.cjs'),
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'plugin.ts')],
    outfile: join(dist, 'plugin.js'),
    platform: 'node',
    format: 'esm',
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'web-entry.ts')],
    outfile: join(dist, 'web.js'),
    platform: 'node',
    format: 'esm',
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'cli.ts')],
    outfile: join(dist, 'ohdsh.js'),
    platform: 'node',
    format: 'esm',
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'web', 'src', 'index.ts')],
    outfile: join(dist, 'web', 'index.js'),
    platform: 'node',
    format: 'esm',
  }),
  build({
    bundle: true,
    define: versionDefine,
    entryPoints: [join(root, 'web', 'src', 'client.ts')],
    outfile: join(dist, 'web', 'client.js'),
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'info',
    banner: {
      js: 'window.__ModuleLoader__.load({ id: "@oh-dsh/web", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
    },
    footer: { js: 'return module.exports; } });' },
  }),
  build({
    bundle: true,
    define: versionDefine,
    entryPoints: [join(root, 'src', 'client.ts')],
    outfile: join(dist, 'client.js'),
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'info',
    banner: {
      js: 'window.__ModuleLoader__.load({ id: "@oh-dsh/desktop", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
    },
    footer: { js: 'return module.exports; } });' },
  }),
]

for (const plugin of pluginPackages) {
  const source = join(root, 'plugins', plugin.directory, 'src')
  const output = join(dist, 'plugins', plugin.directory)
  const hostBuild = plugin.upstreamHostOnly === true
    ? undefined
    : {
      ...shared,
      entryPoints: [join(source, 'index.ts')],
      outfile: join(output, 'index.js'),
      platform: 'node',
      format: 'esm',
      external: plugin.external ?? [],
    }
  if (hostBuild !== undefined) builds.push(build(hostBuild))
  if (plugin.hostOnly !== true && plugin.upstreamHostOnly !== true) {
    builds.push(build({
      bundle: true,
      define: versionDefine,
      entryPoints: [join(source, 'client.ts')],
      outfile: join(output, 'client.js'),
      platform: 'browser',
      format: 'cjs',
      target: 'es2022',
      sourcemap: true,
      logLevel: 'info',
      loader: { '.css': 'text', '.png': 'dataurl' },
      external: [
        ...(plugin.clientExternal ?? []),
        'react',
        'react-dom/client',
        'react/jsx-runtime',
        ...(['skins', 'sidebar', 'desktop-frame'].includes(plugin.directory)
          ? ['@deepseek-ai/dsh-client-store']
          : []),
      ],
      banner: {
        js: `window.__ModuleLoader__.load({ id: "${plugin.id}", factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
      },
      footer: { js: 'return module.exports; } });' },
    }))
  }
}

await Promise.all(builds)

// The pinned DSH-better-sidebar builds itself with its own tsdown config
// (host ESM + browser client + lazy chunk scripts). Staging copies its lib/
// directly, so the build only has to run before staging does; every bundle
// convention (module loader banner, CSS modules, chunk factory shape) stays
// owned by the plugin's own build.
const upstreamBuild = spawnSync(
  process.execPath,
  [join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    '--silent', '--filter', 'dsh-better-sidebar', 'run', 'build'],
  { cwd: root, stdio: 'inherit' },
)
if (upstreamBuild.error !== undefined) throw upstreamBuild.error
if (upstreamBuild.status !== 0) process.exit(upstreamBuild.status ?? 1)

const mainBundle = readFileSync(join(dist, 'main.js'), 'utf8')
if (mainBundle.includes('Dynamic require of')
  && !mainBundle.includes('__ohDshCreateRequire(import.meta.url)')) {
  throw new Error('desktop main bundle has dynamic requires without an ESM require bridge')
}

copyFileSync(join(root, 'src', 'splash.html'), join(dist, 'splash.html'))
copyFileSync(join(root, 'src', 'update.html'), join(dist, 'update.html'))
copyFileSync(join(root, 'cordis.patch.yml'), join(dist, 'cordis.patch.yml'))
const releaseManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
releaseManifest.version = productVersion
writeFileSync(
  join(dist, 'release-package.json'),
  `${JSON.stringify(releaseManifest, undefined, 2)}\n`,
)
mkdirSync(join(dist, 'web'), { recursive: true })
copyFileSync(join(root, 'web', 'cordis.patch.yml'), join(dist, 'web', 'cordis.patch.yml'))
mkdirSync(join(dist, 'plugins', 'tui'), { recursive: true })
copyFileSync(
  join(root, 'plugins', 'tui', 'cordis.patch.yml'),
  join(dist, 'plugins', 'tui', 'cordis.patch.yml'),
)
