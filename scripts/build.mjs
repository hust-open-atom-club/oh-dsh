import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
}
const nodeEsmRequireBanner = [
  "import { createRequire as __ohDshCreateRequire } from 'node:module';",
  'const require = __ohDshCreateRequire(import.meta.url);',
].join('\n')
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const pluginPackages = [
  { directory: 'better-sidebar-runtime', hostOnly: true },
  { directory: 'liangshen', hostOnly: true },
  { directory: 'tui', hostOnly: true },
  { directory: 'tui-marketplace', hostOnly: true },
  { directory: 'desktop-frame', id: '@oh-dsh/desktop-frame' },
  { directory: 'skins', id: '@oh-dsh/skins' },
  { directory: 'sidebar', id: '@oh-dsh/sidebar' },
  { directory: 'panel-controls', id: '@oh-dsh/panel-controls' },
  { directory: 'pinned-summary', id: '@oh-dsh/pinned-summary' },
  { directory: 'plugin-marketplace', id: '@oh-dsh/plugin-marketplace' },
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
  const hostEntry = plugin.directory === 'better-sidebar-runtime'
    ? join(root, 'upstream', 'DSH-better-sidebar', 'src', 'index.ts')
    : join(source, 'index.ts')
  const hostBuild = {
    ...shared,
    entryPoints: [hostEntry],
    outfile: join(output, 'index.js'),
    platform: 'node',
    format: 'esm',
    external: plugin.external ?? (plugin.directory === 'better-sidebar-runtime'
      ? ['@deepseek-ai/*', 'cordis', 'node-pty', 'schemastery', 'ws']
      : []),
  }
  builds.push(build(hostBuild))
  if (plugin.hostOnly !== true) {
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
      loader: { '.css': 'text' },
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
