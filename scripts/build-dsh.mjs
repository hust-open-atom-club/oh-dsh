import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { DSH_SOURCE_SPEC, resolveDshSource, resolvePinnedPnpm } from './dsh-source.mjs'

const dshSource = resolveDshSource()

// npm release packages ship compiled `lib/` and web frontend assets, so the
// source-workspace build step has no work to do.
if (DSH_SOURCE_SPEC.source === 'npm') {
  console.log(`Using prebuilt DSH npm release ${DSH_SOURCE_SPEC.version}; skipping source build`)
  process.exit(0)
}

const pnpm = resolvePinnedPnpm(dshSource)

/**
 * npm runs scripts with the project's node_modules/.bin ahead of PATH, and
 * the DSH build scripts call `pnpm` for nested workspace commands. Pin that
 * bin to the declared CLI so the inner calls never reach a host pnpm whose
 * version-switch verification rejects the pinned lockfile.
 */
function pinInnerPnpm() {
  const binDir = join(dshSource, 'node_modules', '.bin')
  mkdirSync(binDir, { recursive: true })
  if (process.platform === 'win32') {
    writeFileSync(join(binDir, 'pnpm.cmd'),
      `@"${process.execPath}" "${pnpm.cliEntry}" %*\r\n`)
  } else {
    const launcher = join(binDir, 'pnpm')
    writeFileSync(launcher,
      `#!/bin/sh\nexec "${process.execPath}" "${pnpm.cliEntry}" "$@"\n`)
    chmodSync(launcher, 0o755)
  }
}

function run(args) {
  const result = spawnSync(process.execPath, [
    pnpm.cliEntry,
    ...args,
  ], {
    cwd: dshSource,
    env: {
      ...process.env,
      PATH: `${pnpm.binDir}${delimiter}${process.env.PATH ?? ''}`,
    },
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${pnpm.cliEntry} ${args.join(' ')} failed with status ${String(result.status)}`)
  }
}

/**
 * Expose the built-in Vision settings section through DSH's existing
 * configuration-client boundary. The pinned release keeps a fixed allowlist;
 * patch only the checkout used for this build and restore the tracked source
 * immediately afterwards so the upstream checkout remains pristine.
 */
