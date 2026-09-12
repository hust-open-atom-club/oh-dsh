import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

// The 0.1.5 runtime retired the standalone landlock-run package family;
// the launcher binary now ships as the linux-x64 member of node-addon-system
// (same prebuilds.json manifest, same landlock-run tool).
export const landlockLauncherPackageName = '@deepseek-ai/node-addon-system-linux-x64'
const landlockLauncherToolName = 'landlock-run'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function resolvePackageFile(packageRoot, packagePath) {
  const resolved = resolve(packageRoot, packagePath)
  const rel = relative(packageRoot, resolved)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Landlock launcher path escapes its package: ${packagePath}`)
  }
  return resolved
}

export function restoreLandlockLauncher({ runtimeRoot, sourcePackageRoot }) {
  const targetPackageRoot = join(
    runtimeRoot,
    'node_modules',
    ...landlockLauncherPackageName.split('/'),
  )
  const sourceManifest = readJson(join(sourcePackageRoot, 'package.json'))
  const targetManifest = readJson(join(targetPackageRoot, 'package.json'))
  if (sourceManifest.name !== landlockLauncherPackageName
    || targetManifest.name !== landlockLauncherPackageName
    || sourceManifest.version !== targetManifest.version) {
    throw new Error(
      `Landlock launcher package mismatch: staged ${String(targetManifest.name)}@${String(targetManifest.version)}, source ${String(sourceManifest.name)}@${String(sourceManifest.version)}`,
    )
  }

  const prebuilds = readJson(join(targetPackageRoot, 'prebuilds.json'))
  const launcher = prebuilds.binaries?.find(binary => binary.tool === landlockLauncherToolName)
  if (typeof launcher?.path !== 'string') {
    throw new Error(`staged ${landlockLauncherPackageName} does not declare ${landlockLauncherToolName}`)
  }

  const sourceLauncher = resolvePackageFile(sourcePackageRoot, launcher.path)
  if (!existsSync(sourceLauncher) || !lstatSync(sourceLauncher).isFile()) {
    throw new Error(`published Landlock launcher is missing: ${sourceLauncher}`)
  }

  const targetLauncher = resolvePackageFile(targetPackageRoot, launcher.path)
  mkdirSync(dirname(targetLauncher), { recursive: true })
  copyFileSync(sourceLauncher, targetLauncher)
  chmodSync(targetLauncher, 0o755)
  return targetLauncher
}
