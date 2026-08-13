import { spawnSync } from 'node:child_process'
import { resolveDshSource } from './dsh-source.mjs'

const dshSource = resolveDshSource()
const pnpmCommand = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'pnpm'
const pnpmArguments = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm.cmd'] : []

function run(args) {
  const result = spawnSync(pnpmCommand, [...pnpmArguments, ...args], {
    cwd: dshSource,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['install', '--frozen-lockfile'])
run(['run', 'build'])
