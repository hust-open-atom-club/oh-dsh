import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const executable = resolve(process.argv[2] ?? '')
assert.ok(process.argv[2], 'packaged application executable is required')
assert.ok(existsSync(executable), `packaged application is missing: ${executable}`)

const userData = mkdtempSync(join(tmpdir(), 'Oh DSH Desktop packaged smoke '))
const logPath = join(userData, 'logs', 'desktop.log')
const childEnvironment = {
  ...process.env,
  ELECTRON_ENABLE_LOGGING: '1',
}
delete childEnvironment.ELECTRON_RUN_AS_NODE
const child = spawn(executable, [
  `--user-data-dir=${userData}`,
  '--disable-gpu',
  '--no-sandbox',
], {
  env: {
    ...childEnvironment,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', chunk => { output += chunk.toString('utf8') })
child.stderr.on('data', chunk => { output += chunk.toString('utf8') })

const timeoutMs = Number(process.env.DSH_DESKTOP_SMOKE_TIMEOUT_MS ?? '90000')
assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, 'invalid packaged smoke timeout')
const deadline = Date.now() + timeoutMs
try {
  for (;;) {
    if (existsSync(logPath)) {
      const log = readFileSync(logPath, 'utf8')
      if (/DSH runtime ready: http:\/\/127\.0\.0\.1:\d+/.test(log)) {
        console.log(`Packaged desktop runtime: ready (${executable})`)
        break
      }
      if (/startup failed|exited before readiness|packaged .* is missing/i.test(log)) {
        throw new Error(`packaged desktop reported a startup failure:\n${log}`)
      }
    }
    if (child.exitCode !== null) {
      throw new Error(`packaged desktop exited before readiness (code=${String(child.exitCode)})\n${output}`)
    }
    if (Date.now() >= deadline) {
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '(desktop log missing)'
      throw new Error(`packaged desktop readiness timed out\n${log}\n${output}`)
    }
    await new Promise(resolveWait => { setTimeout(resolveWait, 250) })
  }
} finally {
  if (child.exitCode === null && process.platform === 'win32') {
    const { spawnSync } = await import('node:child_process')
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
  } else if (child.exitCode === null) {
    child.kill()
  }
  await Promise.race([
    new Promise(resolveExit => { child.once('exit', resolveExit) }),
    new Promise(resolveWait => { setTimeout(resolveWait, 10_000) }),
  ])
  if (child.exitCode === null) {
    child.kill('SIGKILL')
  }
  try {
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch (error) {
    console.warn(`Could not remove packaged smoke profile: ${String(error)}`)
  }
}
