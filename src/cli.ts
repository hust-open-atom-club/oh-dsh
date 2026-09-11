/** Unified launcher for the Oh-DSH interaction surfaces. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, posix, win32 } from 'node:path'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { OH_DSH_HOME_ENV } from './data-root.ts'
import { UsageError } from './errors.ts'
import { bundledRuntimePaths, runtimeSearchPath } from './runtime-paths.ts'
import {
  detectDistributionSurface,
  runSelfUpdates,
  surfaceIsInstalled,
  type SelfUpdateSurface,
} from './self-update.ts'
import { DEFAULT_TUI_HOME, main as runTui, resolveTuiRoot } from './tui.ts'
import { main as runWeb } from './web.ts'

const SURFACE_NAMES = ['desktop', 'web', 'tui'] as const
type SurfaceName = typeof SURFACE_NAMES[number]
const SURFACE_ALIASES: Readonly<Record<string, SurfaceName>> = Object.freeze({
  gui: 'desktop',
})

export function availableSurfaces(env: NodeJS.ProcessEnv = process.env): readonly SurfaceName[] {
  const configured = env.OH_DSH_SURFACES
  if (configured === undefined || configured === '') return SURFACE_NAMES
  const requested = new Set(configured.split(',').map(value => value.trim()))
  return SURFACE_NAMES.filter(surface => requested.has(surface))
}

export function cliHelp(env: NodeJS.ProcessEnv = process.env): string {
  const surfaces = availableSurfaces(env)
  const aliases = Object.entries(SURFACE_ALIASES)
    .filter(([, surface]) => surfaces.includes(surface))
  const descriptions: Record<SurfaceName, string> = {
    desktop: 'Start Oh-DSH Desktop',
    web: 'Start Oh-DSH Web',
    tui: 'Start Oh-DSH TUI',
  }
  return `Oh-DSH launcher

Usage:
  ohdsh <surface> [options]
  ohdsh update [surface]

Surfaces:
${surfaces.map(surface => `  ${surface.padEnd(9)} ${descriptions[surface]}`).join('\n')}
${aliases.length === 0 ? '' : `\nAliases:\n${aliases.map(([alias, surface]) => `  ${alias.padEnd(9)} ${descriptions[surface]}`).join('\n')}`}

Commands:
  update    Upgrade through the latest stable release installer. With no
            surface argument every installed surface (desktop, web, tui)
            on this machine is detected and upgraded; pass one surface to
            upgrade it alone.
  plugin    Manage plugins in an Oh-DSH profile through the staged DSH
            runtime. "--profile <desktop|web|tui>" selects the profile
            (default desktop); the remaining arguments go to the DSH
            plugin manager (e.g. "ohdsh plugin add <package>").

Run "ohdsh <surface> --help" for surface options.
`
}

export const CLI_HELP = cliHelp()

export interface DesktopLaunchSpec {
  args: string[]
  command: string
  cwd?: string
}

type WebRunner = typeof runWeb
type TuiRunner = typeof runTui
type DesktopRunner = (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<number>

function sourceElectron(
  root: string,
  platform: NodeJS.Platform,
): string {
  const paths = platform === 'win32' ? win32 : posix
  if (platform === 'darwin') {
    return paths.join(
      root,
      'node_modules',
      'electron',
      'dist',
      'Electron.app',
      'Contents',
      'MacOS',
      'Electron',
    )
  }
  return paths.join(
    root,
    'node_modules',
    'electron',
    'dist',
    platform === 'win32' ? 'electron.exe' : 'electron',
  )
}

function macOpenEnvironment(env: NodeJS.ProcessEnv): string[] {
  const ohDshHome = env[OH_DSH_HOME_ENV]
  return ohDshHome === undefined || ohDshHome === ''
    ? []
    : ['--env', `${OH_DSH_HOME_ENV}=${posix.resolve(ohDshHome)}`]
}

/** Resolve one desktop launch without starting a process. */
export function desktopLaunchSpec(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  pathExists: (path: string) => boolean = existsSync,
): DesktopLaunchSpec {
  const paths = platform === 'win32' ? win32 : posix
  const explicitApp = env.OH_DSH_DESKTOP_APP
  if (explicitApp !== undefined && explicitApp !== '') {
    if (platform === 'darwin') {
      return {
        args: [
          ...macOpenEnvironment(env),
          paths.resolve(explicitApp),
          ...(args.length === 0 ? [] : ['--args', ...args]),
        ],
        command: '/usr/bin/open',
      }
    }
    return { args: [...args], command: paths.resolve(explicitApp) }
  }

  const sourceRoot = env.OH_DSH_SOURCE_ROOT
  if (sourceRoot !== undefined && sourceRoot !== '') {
    const root = paths.resolve(sourceRoot)
    const electron = sourceElectron(root, platform)
    if (pathExists(electron)) {
      return {
        args: [root, ...args],
        command: electron,
        cwd: root,
      }
    }
  }

  if (platform === 'darwin') {
    return {
      args: [
        ...macOpenEnvironment(env),
        '-a',
        'Oh-DSH Desktop',
        ...(args.length === 0 ? [] : ['--args', ...args]),
      ],
      command: '/usr/bin/open',
    }
  }
  if (platform === 'win32') {
    return {
      args: ['/d', '/s', '/c', 'start', '""', 'Oh-DSH Desktop.exe', ...args],
      command: env.ComSpec ?? 'cmd.exe',
    }
  }
  return { args: [...args], command: 'oh-dsh-desktop' }
}

/** Start the desktop surface and detach the launcher. */
export async function launchDesktop(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const spec = desktopLaunchSpec(args, env)
  return await new Promise<number>((resolveLaunch, rejectLaunch) => {
    const child = spawn(spec.command, spec.args, {
      ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
      detached: true,
      env,
      stdio: 'ignore',
    })
    child.once('error', rejectLaunch)
    child.once('spawn', () => {
      child.unref()
      resolveLaunch(0)
    })
  })
}

/** Upgrades a list of installed surfaces through the platform installer. */
export type UpdateSurfaces = (
  surfaces: readonly SelfUpdateSurface[],
  env: NodeJS.ProcessEnv,
  announce: (surface: SelfUpdateSurface) => void,
) => Promise<number>

async function defaultUpdateSurfaces(
  surfaces: readonly SelfUpdateSurface[],
  env: NodeJS.ProcessEnv,
  announce: (surface: SelfUpdateSurface) => void,
): Promise<number> {
  return await runSelfUpdates(
    surfaces,
    env,
    process.platform,
    undefined,
    resolveTuiRoot(env),
    announce,
  )
}

/** Run "ohdsh update": upgrade installed distributions via the installer. */
export async function runUpdateCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  stdout: NodeJS.WriteStream,
  stderr: NodeJS.WriteStream,
  updater: UpdateSurfaces = defaultUpdateSurfaces,
): Promise<number> {
  const [requested] = args as readonly SelfUpdateSurface[]
  if (requested !== undefined && !SURFACE_NAMES.includes(requested)) {
    stderr.write(`Unknown surface: ${requested}\n\n${cliHelp(env)}`)
    return 2
  }
  const root = resolveTuiRoot(env)
  if (detectDistributionSurface(root, env) === 'source') {
    stderr.write('ohdsh update needs a packaged installation; update a source checkout with git instead.\n')
    return 2
  }
  // Ownership is inferred from install records and paths, never from a build
  // flag: one explicitly requested surface, or — with no argument — every
  // installer-owned installation found on this machine.
  let targets: readonly SelfUpdateSurface[]
  if (requested !== undefined) {
    if (!surfaceIsInstalled(requested, env)) {
      stderr.write(
        `ohdsh update: no installer-owned ${requested} installation was found` +
        '. Re-run install.sh (or install.ps1) with --dest matching the location, or reinstall to the default location.\n',
      )
      return 2
    }
    targets = [requested]
  } else {
    targets = SURFACE_NAMES.filter(surface => surfaceIsInstalled(surface, env))
    if (targets.length === 0) {
      stderr.write(
        'ohdsh update: no installer-owned installation was found' +
        '. Install first with install.sh (or install.ps1), or pass a surface explicitly.\n',
      )
      return 2
    }
  }
  stdout.write(`Upgrading Oh-DSH ${targets.join(', ')} with the latest stable release installer...\n`)
  return await updater(
    targets,
    env,
    surface => stdout.write(`\n=== Upgrading Oh-DSH ${surface} ===\n`),
  )
}

/** The `ohdsh plugin` argument split: the target profile and the pnpm args. */
export interface PluginCommand {
  profile: string
  forward: readonly string[]
}

/**
 * Split `ohdsh plugin` arguments: `--profile <name>` (or `--profile=name`)
 * selects the Oh-DSH profile and defaults to the desktop profile; every
 * other argument is forwarded verbatim to the DSH plugin manager.
 */
export function parsePluginArgs(args: readonly string[]): PluginCommand {
  let profile = 'desktop'
  const forward: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    if (argument === '--profile') {
      const value = args[index + 1]
      if (value === undefined || value === '') throw new UsageError('--profile needs a value')
      profile = value
      index += 1
      continue
    }
    if (argument.startsWith('--profile=')) {
      const value = argument.slice('--profile='.length)
      if (value === '') throw new UsageError('--profile needs a value')
      profile = value
      continue
    }
    forward.push(argument)
  }
  return { profile, forward }
}

/**
 * Manage plugins in one Oh-DSH profile by driving the staged DSH runtime.
 * The desktop profile is reserved for Electron hosts by the 0.1.5 CLI, so
 * it routes through the staged programmatic launcher; web and tui use the
 * ordinary CLI plugin subcommand with the resolved profile.
 */
export async function runPluginCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const { profile, forward } = parsePluginArgs(args)
  if (forward.length === 0) {
    throw new UsageError(
      'plugin needs manager arguments (e.g. ohdsh plugin add <package>)',
    )
  }
  const root = resolveTuiRoot(env)
  const stagedNode = process.platform === 'win32'
    ? posix.join(root, '.stage', 'node-runtime', 'node.exe')
    : posix.join(root, '.stage', 'node-runtime', 'bin', 'node')
  const resourcesRoot = env.DSH_OH_TUI_ROOT !== undefined
    ? root
    : existsSync(stagedNode)
      ? posix.join(root, '.stage')
      : root
  const paths = bundledRuntimePaths(resourcesRoot)
  if (!existsSync(paths.nodeBinary)) {
    throw new Error(`packaged Node runtime is missing: ${paths.nodeBinary}`)
  }
  const desktop = profile.toLowerCase() === 'desktop'
  if (desktop && !existsSync(paths.desktopBootEntry)) {
    throw new Error(`packaged desktop launcher is missing: ${paths.desktopBootEntry}`)
  }
  if (!desktop && !existsSync(paths.cliEntry)) {
    throw new Error(`packaged DSH CLI is missing: ${paths.cliEntry}`)
  }
  const entry = desktop ? paths.desktopBootEntry : paths.cliEntry
  const child = spawn(paths.nodeBinary, [
    entry,
    'plugin',
    ...(desktop ? [] : ['--profile', profile]),
    ...forward,
  ], {
    cwd: process.cwd(),
    env: {
      ...env,
      DSH_HOME: env.DSH_HOME ?? env.OH_DSH_HOME ?? DEFAULT_TUI_HOME,
      PATH: `${runtimeSearchPath(paths, env)}${delimiter}${env.PATH ?? ''}`,
    },
    stdio: 'inherit',
  })
  return await new Promise(resolve => {
    child.on('error', error => { throw error })
    child.on('exit', (code, signal) => {
      resolve(code ?? (signal === null ? 1 : 130))
    })
  })
}

/** Dispatch one surface command. */
export async function main(  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  stdout: NodeJS.WriteStream = process.stdout,
  stderr: NodeJS.WriteStream = process.stderr,
  desktopRunner: DesktopRunner = launchDesktop,
  webRunner: WebRunner = runWeb,
  tuiRunner: TuiRunner = runTui,
): Promise<number> {
  const [surface, ...args] = argv
  const selectedSurface = surface === undefined
    ? undefined
    : SURFACE_ALIASES[surface] ?? surface
  const help = cliHelp(env)
  if (surface === undefined || surface === '--help' || surface === '-h') {
    stdout.write(help)
    return 0
  }
  if (selectedSurface === 'update') {
    return await runUpdateCommand(args, env, stdout, stderr)
  }
  if (selectedSurface === 'plugin') {
    return await runPluginCommand(args, env)
  }
  if (SURFACE_NAMES.includes(selectedSurface as SurfaceName)
    && !availableSurfaces(env).includes(selectedSurface as SurfaceName)) {
    stderr.write(`Surface '${surface}' is not included in this Oh-DSH distribution.\n\n${help}`)
    return 2
  }
  if (selectedSurface === 'desktop') return await desktopRunner(args, env)
  if (selectedSurface === 'web') return await webRunner(args, env, stdout)
  if (selectedSurface === 'tui') return await tuiRunner(args, env, stdout, stderr)
  stderr.write(`Unknown surface: ${surface}\n\n${help}`)
  return 2
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main(process.argv.slice(2)).then(code => {
    process.exit(code)
  }, error => {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`)
      process.exit(2)
    }
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    )
    process.exit(1)
  })
}
