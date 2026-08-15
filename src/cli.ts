/** Unified launcher for the Oh-DSH interaction surfaces. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { OH_DSH_HOME_ENV, resolveOhDshHome } from './data-root.ts'
import { UsageError } from './errors.ts'
import { main as runTui } from './tui.ts'
import { main as runWeb } from './web.ts'

const SURFACE_NAMES = ['desktop', 'web', 'tui'] as const
type SurfaceName = typeof SURFACE_NAMES[number]

export function availableSurfaces(env: NodeJS.ProcessEnv = process.env): readonly SurfaceName[] {
  const configured = env.OH_DSH_SURFACES
  if (configured === undefined || configured === '') return SURFACE_NAMES
  const requested = new Set(configured.split(',').map(value => value.trim()))
  return SURFACE_NAMES.filter(surface => requested.has(surface))
}

export function cliHelp(env: NodeJS.ProcessEnv = process.env): string {
  const surfaces = availableSurfaces(env)
  const descriptions: Record<SurfaceName, string> = {
    desktop: 'Start Oh-DSH Desktop',
    web: 'Start Oh-DSH Web',
    tui: 'Start Oh-DSH TUI',
  }
  return `Oh-DSH launcher

Usage:
  ohdsh <surface> [options]

Surfaces:
${surfaces.map(surface => `  ${surface.padEnd(9)} ${descriptions[surface]}`).join('\n')}

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
    : ['--env', `${OH_DSH_HOME_ENV}=${resolveOhDshHome(env)}`]
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

/** Dispatch one surface command. */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  stdout: NodeJS.WriteStream = process.stdout,
  stderr: NodeJS.WriteStream = process.stderr,
  desktopRunner: DesktopRunner = launchDesktop,
  webRunner: WebRunner = runWeb,
  tuiRunner: TuiRunner = runTui,
): Promise<number> {
  const [surface, ...args] = argv
  const help = cliHelp(env)
  if (surface === undefined || surface === '--help' || surface === '-h') {
    stdout.write(help)
    return 0
  }
  if (SURFACE_NAMES.includes(surface as SurfaceName)
    && !availableSurfaces(env).includes(surface as SurfaceName)) {
    stderr.write(`Surface '${surface}' is not included in this Oh-DSH distribution.\n\n${help}`)
    return 2
  }
  if (surface === 'desktop') return await desktopRunner(args, env)
  if (surface === 'web') return await webRunner(args, env, stdout)
  if (surface === 'tui') return await tuiRunner(args, env, stdout, stderr)
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
