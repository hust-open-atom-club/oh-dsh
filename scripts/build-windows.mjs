import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'win32') {
  throw new Error('Windows release artifacts must be built on Windows')
}

const electronPackage = join(root, 'node_modules', 'electron')
if (!existsSync(join(electronPackage, 'dist'))) {
  const installResult = spawnSync(process.execPath, [join(electronPackage, 'install.js')], {
    cwd: root,
    stdio: 'inherit',
  })
  if (installResult.error !== undefined) throw installResult.error
  if (installResult.status !== 0) process.exit(installResult.status ?? 1)
}

// Run the JavaScript entry directly: Node cannot spawn a .cmd shim on Windows.
const builder = join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
const result = spawnSync(process.execPath, [
  builder, '--win', 'nsis', 'portable', '--x64',
], {
  cwd: root,
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  },
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
