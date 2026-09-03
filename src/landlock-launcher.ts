import { accessSync, constants, existsSync } from 'node:fs'
import { join } from 'node:path'

export const LANDLOCK_LAUNCHER_PACKAGE = '@deepseek-ai/node-addon-landlock-run-linux-x64'

export function resolveLandlockLauncher(
  runtimeRoot: string,
  platform: NodeJS.Platform = process.platform,
  arch = process.arch,
  pathExists: (path: string) => boolean = existsSync,
): string | undefined {
  if (platform !== 'linux' || arch !== 'x64') return undefined
  const launcher = join(runtimeRoot, 'node_modules', ...LANDLOCK_LAUNCHER_PACKAGE.split('/'), 'bin', 'landlock-run')
  if (!pathExists(launcher)) return undefined
  try {
    accessSync(launcher, constants.X_OK)
    return launcher
  } catch {
    return undefined
  }
}

export function landlockPreviewCommand(input: {
  launcher: string
  nodeBinary: string
  nodeArguments: readonly string[]
  root: string
}): { command: string; args: string[] } {
  return {
    command: input.launcher,
    args: ['--ro', '/', '--rw', input.root, '--rw', '/dev/null', '--', input.nodeBinary, ...input.nodeArguments],
  }
}
