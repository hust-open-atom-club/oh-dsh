/** Oh-DSH TUI launcher over the pinned upstream dsh-TUI bundle. */

import { spawn, type SpawnOptions } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { defaultOhDshHome } from './data-root.ts'
import { UsageError } from './errors.ts'
import { ensureTuiProfile, TUI_PROFILE } from './profile.ts'
import { tryAcquireRuntimeLock } from './runtime-lock.ts'
import {
  bundledRuntimePaths,
  runtimeSearchPath,
  type BundledRuntimePaths,
} from './runtime-paths.ts'
import { resolveProductVersion } from './version.ts'
import { resolveLandlockLauncher } from './landlock-launcher.ts'
import { readLauncherRecord, startupUpdateNotice } from './self-update.ts'

/** Default Oh-DSH-owned home, isolated from the upstream DSH CLI. */
export const DEFAULT_TUI_HOME = defaultOhDshHome()

/** TUI launch options resolved from command-line flags and environment. */
export interface TuiLaunchOptions {
  cwd: string
  dataRoot: string
  fullscreen: boolean
  help: boolean
  lang?: 'en' | 'zh'
  preset?: string
  sessionId?: string
}

/** One attached TUI child-process plan. */
export interface TuiLaunchSpec {
  args: string[]
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  spawnOptions: SpawnOptions
}

export type TuiSpawner = typeof spawn

const USAGE = `usage: ohdsh tui [options]

Options:
  --cwd <dir>            workspace directory (default: current directory)
  --data <dir>           DSH home and session store (default: ~/.ohdsh)
  --resume <session>     resume an existing session id
  --lang <zh|en>         initial interface language
  --preset <name>        initial agent preset
  --fullscreen           use the alternate screen
  --inline               keep terminal scrollback instead (default)
  --help                 show this help

Environment:
  OH_DSH_HOME, DSH_OH_TUI_HOME, DSH_OH_TUI_CWD, DSH_OH_TUI_FULLSCREEN,
  DSH_OH_TUI_LANG, DSH_OH_TUI_PRESET, DSH_OH_TUI_SESSION_ID
`

function parseBoolean(value: string, name: string): boolean {
  if (value === '1' || value.toLowerCase() === 'true') return true
  if (value === '0' || value.toLowerCase() === 'false') return false
  throw new UsageError(`invalid ${name} value: ${value}`)
}

function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]
  return value === undefined || value === '' ? undefined : value
}

function language(value: string): 'en' | 'zh' {
  if (value === 'en' || value === 'zh') return value
  throw new UsageError(`invalid TUI language: ${value}`)
}

/** Resolve TUI options without touching the filesystem or spawning DSH. */
export function parseTuiArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  defaultCwd: string = process.cwd(),
  defaultDataRoot: string = DEFAULT_TUI_HOME,
): TuiLaunchOptions {
  const envFullscreen = optionalEnv(env, 'DSH_OH_TUI_FULLSCREEN')
  const envLang = optionalEnv(env, 'DSH_OH_TUI_LANG')
  const envPreset = optionalEnv(env, 'DSH_OH_TUI_PRESET')
  const envSessionId = optionalEnv(env, 'DSH_OH_TUI_SESSION_ID')
  const options: TuiLaunchOptions = {
    cwd: optionalEnv(env, 'DSH_OH_TUI_CWD') ?? defaultCwd,
    dataRoot: optionalEnv(env, 'DSH_OH_TUI_HOME')
      ?? optionalEnv(env, 'OH_DSH_HOME')
      ?? defaultDataRoot,
    fullscreen: envFullscreen === undefined
      ? false
      : parseBoolean(envFullscreen, 'DSH_OH_TUI_FULLSCREEN'),
    help: false,
    ...(envLang === undefined ? {} : { lang: language(envLang) }),
    ...(envPreset === undefined ? {} : { preset: envPreset }),
    ...(envSessionId === undefined ? {} : { sessionId: envSessionId }),
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }
    if (argument === '--fullscreen') {
      options.fullscreen = true
      continue
    }
    if (argument === '--inline') {
      options.fullscreen = false
      continue
    }
    const flag = (name: string): string | undefined => {
      if (argument === name) {
        const value = args[index + 1]
        if (value === undefined || value === '') throw new UsageError(`${name} needs a value`)
        index += 1
        return value
      }
      if (argument.startsWith(`${name}=`)) {
        const value = argument.slice(name.length + 1)
        if (value === '') throw new UsageError(`${name} needs a value`)
        return value
      }
      return undefined
    }
    const cwd = flag('--cwd')
    if (cwd !== undefined) {
      options.cwd = cwd
      continue
    }
    const data = flag('--data')
    if (data !== undefined) {
      options.dataRoot = data
      continue
    }
    const sessionId = flag('--resume')
    if (sessionId !== undefined) {
      options.sessionId = sessionId
      continue
    }
    const lang = flag('--lang')
    if (lang !== undefined) {
      options.lang = language(lang)
      continue
    }
    const preset = flag('--preset')
    if (preset !== undefined) {
      options.preset = preset
      continue
    }
    throw new UsageError(`unknown option: ${argument}`)
  }
  return options
}

/** Resolve the installed distribution root or the repository root. */
export function resolveTuiRoot(env: NodeJS.ProcessEnv = process.env): string {
  for (const name of ['DSH_OH_TUI_ROOT', 'OH_DSH_SOURCE_ROOT'] as const) {
    const value = env[name]
    if (value !== undefined && value !== '') return resolve(value)
  }
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

/** Read release metadata from a standalone package or Electron resources. */
export function resolveTuiVersion(root: string): string {
  return resolveProductVersion(root)
}

/** Build one attached process launch after the profile has been initialized. */
export function tuiLaunchSpec(
  options: TuiLaunchOptions,
  env: NodeJS.ProcessEnv,
  paths: BundledRuntimePaths,
  version: string,
): TuiLaunchSpec {
  const dataRoot = resolve(options.dataRoot)
  const cwd = resolve(options.cwd)
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    DSH_HOME: dataRoot,
    DSH_OH_TUI: '1',
    DSH_OH_TUI_HOME: dataRoot,
    DSH_OH_TUI_PROFILE: TUI_PROFILE,
    DSH_OH_TUI_VERSION: version,
    OH_DSH_TUI_CONFIG_HOME: join(dataRoot, 'tui'),
    OH_DSH_TUI_CWD: cwd,
    OH_DSH_TUI_FULLSCREEN: options.fullscreen ? '1' : '0',
    OH_DSH_TUI_LANG: options.lang,
    OH_DSH_TUI_PRESET: options.preset,
    OH_DSH_TUI_SESSION_ID: options.sessionId,
    OH_DSH_TUI_TITLE: 'Oh-DSH TUI',
    OH_DSH_HOME: dataRoot,
    OH_DSH_MARKETPLACE_CLI_ENTRY: paths.cliEntry,
    OH_DSH_MARKETPLACE_NODE_BINARY: paths.nodeBinary,
    OH_DSH_MARKETPLACE_PNPM_ENTRY: paths.pnpmEntry,
    OH_DSH_MARKETPLACE_SANDBOX_LAUNCHER: resolveLandlockLauncher(paths.runtimeRoot) ?? '',
    PATH: runtimeSearchPath(paths, env),
  }
  // Do not let the pinned renderer's legacy aliases trigger a warning line
  // before the first inline frame. Oh-DSH owns the namespaced equivalents.
  delete childEnv.CC_TUI_LANG
  delete childEnv.CC_TUI_PRESET
  delete childEnv.DSH_CC_RESUME_SESSION
  return {
    args: [paths.cliEntry, '--profile', TUI_PROFILE],
    command: paths.nodeBinary,
    cwd,
    env: childEnv,
    spawnOptions: {
      cwd,
      env: childEnv,
      stdio: 'inherit',
    },
  }
}

/** Start the TUI in the caller's terminal and return its exit status. */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  stdout: NodeJS.WriteStream = process.stdout,
  stderr: NodeJS.WriteStream = process.stderr,
  spawnTui: TuiSpawner = spawn,
  stdin: Readable & { isTTY?: boolean } = process.stdin,
): Promise<number> {
  const options = parseTuiArgs(argv, env)
  if (options.help) {
    stdout.write(USAGE)
    return 0
  }
  if (stdin.isTTY !== true || stdout.isTTY !== true) {
    stderr.write('Oh-DSH TUI requires an interactive terminal.\n')
    return 2
  }

  const root = resolveTuiRoot(env)
  // One bounded startup update check, printed before the first TUI frame so
  // it survives in the inline scrollback like the codex-TUI notice. Fork
  // installs check their own recorded repository.
  const record = readLauncherRecord(env)
  const notice = await startupUpdateNotice(
    resolveTuiVersion(root),
    env,
    fetch,
    record.tuiRepo !== undefined && record.tuiRepo !== '' ? record.tuiRepo : undefined,
  )
  if (notice !== undefined) stderr.write(notice)
  const stagedNode = process.platform === 'win32'
    ? join(root, '.stage', 'node-runtime', 'node.exe')
    : join(root, '.stage', 'node-runtime', 'bin', 'node')
  const resourcesRoot = env.DSH_OH_TUI_ROOT !== undefined
    ? root
    : existsSync(stagedNode)
      ? join(root, '.stage')
      : root
  const paths = bundledRuntimePaths(resourcesRoot)
  if (!existsSync(paths.nodeBinary)) {
    throw new Error(`packaged Node runtime is missing: ${paths.nodeBinary}`)
  }
  if (!existsSync(paths.cliEntry)) {
    throw new Error(`packaged DSH CLI is missing: ${paths.cliEntry}`)
  }

  const dataRoot = resolve(options.dataRoot)
  const cwd = resolve(options.cwd)
  if (!existsSync(cwd)) throw new UsageError(`workspace directory does not exist: ${cwd}`)
  mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
  const { lock: runtimeLock, readOnly } = tryAcquireRuntimeLock(dataRoot, 'tui')
  if (runtimeLock !== undefined) {
    process.once('exit', () => { runtimeLock.release() })
  }
  const runtimeEnv = { ...env, OH_DSH_READ_ONLY: readOnly ? '1' : '0' }
  if (readOnly === false || !existsSync(join(dataRoot, 'profiles', TUI_PROFILE))) {
    ensureTuiProfile(dataRoot)
  }

  const runOnce = async (current: TuiLaunchOptions): Promise<number> => {
    const spec = tuiLaunchSpec(
      { ...current, cwd, dataRoot },
      runtimeEnv,
      paths,
      resolveTuiVersion(root),
    )
    return await new Promise<number>((resolveExit, rejectExit) => {
      const child = spawnTui(spec.command, spec.args, spec.spawnOptions)
      const childPid = child.pid
      if (childPid !== undefined) runtimeLock?.setChildPids([childPid])
      child.once('error', rejectExit)
      child.once('exit', (code, signal) => {
        resolveExit(code ?? (signal === null ? 1 : 128))
      })
    })
  }

  try {
    let next = options
    // Exit code 75 means a marketplace apply/undo committed a new profile.
    // Only a validated resume marker restarts the TUI; a bare 75 without a
    // marker is returned to the caller instead of entering a restart loop.
    while (true) {
      const code = await runOnce(next)
      if (code !== 75) return code
      const resumePath = join(dataRoot, 'tui', 'marketplace-resume')
      let sessionId: string | undefined
      try {
        sessionId = readFileSync(resumePath, 'utf8').trim() || undefined
        rmSync(resumePath, { force: true })
      } catch {
        sessionId = undefined
      }
      if (sessionId === undefined) return code
      next = { ...next, sessionId }
    }
  } finally {
    runtimeLock?.release()
  }
}
