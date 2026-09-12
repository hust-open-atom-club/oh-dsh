import { posix, win32 } from 'node:path'

/** Files bundled beside the packaged Electron application. */
export interface BundledRuntimePaths {
  cliEntry: string
  /** Programmatic desktop-profile boot the 0.1.5 CLI reserves for Electron hosts. */
  desktopBootEntry: string
  nodeBinary: string
  nodeBinDirectory: string
  pnpmBinary: string
  pnpmEntry: string
  runtimeRoot: string
}

function pathApi(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === 'win32' ? win32 : posix
}

/** Resolve an explicit distribution root before Electron's packaged/dev defaults. */
export function resolveRuntimeResourcesRoot(
  packagedRoot: string,
  developmentRoot: string,
  isPackaged: boolean,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = environment.OH_DSH_RESOURCES_ROOT ?? environment.DSH_OH_WEB_ROOT
  if (explicit !== undefined && explicit !== '') return explicit
  return isPackaged ? packagedRoot : developmentRoot
}

/** Resolve the bundled DSH and Node entry points for one target platform. */
export function bundledRuntimePaths(
  resourcesRoot: string,
  platform: NodeJS.Platform = process.platform,
  dshRuntimeRootOverride?: string,
): BundledRuntimePaths {
  const paths = pathApi(platform)
  const runtimeRoot = dshRuntimeRootOverride ?? paths.join(resourcesRoot, 'dsh-runtime')
  const nodeRoot = paths.join(resourcesRoot, 'node-runtime')
  const nodeBinDirectory = platform === 'win32'
    ? nodeRoot
    : paths.join(nodeRoot, 'bin')
  return {
    cliEntry: paths.join(runtimeRoot, 'lib', 'bin.js'),
    desktopBootEntry: paths.join(runtimeRoot, 'lib', 'ohdsh-desktop.mjs'),
    nodeBinary: paths.join(nodeBinDirectory, platform === 'win32' ? 'node.exe' : 'node'),
    nodeBinDirectory,
    pnpmBinary: paths.join(nodeBinDirectory, platform === 'win32' ? 'pnpm.cmd' : 'pnpm'),
    pnpmEntry: paths.join(
      nodeRoot,
      ...(platform === 'win32' ? ['node_modules'] : ['lib', 'node_modules']),
      'pnpm',
      'bin',
      'pnpm.mjs',
    ),
    runtimeRoot,
  }
}

/** Put bundled commands first without applying POSIX PATH rules on Windows. */
export function runtimeSearchPath(
  paths: BundledRuntimePaths,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const path = pathApi(platform)
  const inherited = environment.PATH
    ?? (platform === 'win32' ? environment.Path : undefined)
    ?? (platform === 'win32' ? '' : '/usr/bin:/bin:/usr/sbin:/sbin')
  return [
    paths.nodeBinDirectory,
    path.join(paths.runtimeRoot, 'node_modules', '.bin'),
    ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : []),
    inherited,
  ].filter(entry => entry !== '').join(path.delimiter)
}
