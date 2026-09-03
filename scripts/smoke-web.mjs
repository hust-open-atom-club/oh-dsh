import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_SOURCE_SPEC } from './dsh-source.mjs'
import { ensureWebProfile, WEB_PROFILE } from '../src/profile.ts'
import { bundledRuntimePaths, runtimeSearchPath } from '../src/runtime-paths.ts'
import { resolveProductVersion } from '../src/version.ts'
import { resolveNodeDistributionPlatform } from '../src/node-platform.ts'
import electronBinary from 'electron'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const smokeClientTimeoutMs = Number.parseInt(
  process.env.DSH_SMOKE_CLIENT_TIMEOUT_MS ?? '120000',
  10,
)

/** Resolve the smoke resources root: `.stage`, an explicit dir, or the packaged release. */
function resolveResources(candidate) {
  if (candidate === 'release') {
    const platform = resolveNodeDistributionPlatform()
    const arch = process.env.DSH_DESKTOP_NODE_ARCH ?? process.arch
    const release = join(
      root,
      'release',
      `oh-dsh-web-${resolveProductVersion(root)}-${platform}-${arch}`,
    )
    assert.ok(
      existsSync(join(release, 'dsh-runtime')),
      `packaged oh-dsh-web release not found: ${release}`,
    )
    return release
  }
  return resolve(candidate)
}

const resources = resolveResources(process.argv[2] ?? join(root, '.stage'))
const paths = bundledRuntimePaths(resources)
const { cliEntry, nodeBinary } = paths
const smokeRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-web-smoke-'))
const dshHome = join(smokeRoot, 'dsh-home')
const webData = join(smokeRoot, 'web-data')
const lines = []

/** One boot entry of the DSH client graph. */
function parseBootEntries(index) {
  const marker = 'globalThis["__DSH_BOOT__"] = '
  const start = index.indexOf(marker)
  assert.notEqual(start, -1, 'DSH index did not contain a client boot graph')
  const end = index.indexOf('</script>', start)
  assert.notEqual(end, -1, 'DSH client boot graph script was not closed')
  const graph = JSON.parse(index.slice(start + marker.length, end))
  assert.equal(typeof graph.rev, 'string')
  assert.ok(Array.isArray(graph.entries))
  return graph.entries
}

/** Find a free loopback port for the smoke runtime. */
async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  const port = address.port
  await new Promise(resolveClose => { server.close(resolveClose) })
  return port
}

ensureWebProfile(dshHome)

const versionResult = spawnSync(nodeBinary, [cliEntry, '--version'], {
  cwd: smokeRoot,
  encoding: 'utf8',
  env: { ...process.env, DSH_HOME: dshHome },
})
assert.equal(versionResult.status, 0, versionResult.stderr || versionResult.stdout)
assert.equal(
  versionResult.stdout.trim(),
  DSH_SOURCE_SPEC.version,
  `staged DSH runtime must match ${DSH_SOURCE_SPEC.version}`,
)

const runtimeEnvironment = {
  ...process.env,
  DSH_HOME: dshHome,
  DSH_OH_WEB: '1',
  DSH_OH_WEB_DATA: webData,
  DSH_OH_WEB_PROFILE: WEB_PROFILE,
  DSH_OH_WEB_VERSION: 'smoke',
  OH_DSH_MARKETPLACE_CLI_ENTRY: cliEntry,
  OH_DSH_MARKETPLACE_NODE_BINARY: nodeBinary,
  OH_DSH_MARKETPLACE_PNPM_ENTRY: paths.pnpmEntry,
  PATH: runtimeSearchPath(paths),
  // Exercise the in-app browse interaction in unattended automation instead
  // of opening a platform-owned native chooser that CI cannot drive.
  SSH_CONNECTION: 'oh-dsh-smoke',
}

// 1. The composed web profile tree mounts the web-capable Oh-DSH rows and
// keeps the Electron shell row out.
const dump = spawnSync(nodeBinary, [cliEntry, '--profile', WEB_PROFILE, '--dump-config'], {
  cwd: smokeRoot,
  encoding: 'utf8',
  env: runtimeEnvironment,
})
assert.equal(dump.status, 0, dump.stderr || dump.stdout)
for (const row of [
  'oh-web',
  'oh-liangshen',
  'oh-better-sidebar-runtime',
  'oh-vision',
  'oh-skins',
  'oh-pinned-summary',
  'oh-sidebar',
  'oh-panel-controls',
  'oh-plugin-marketplace',
  'oh-about',
  'dsh-context',
  'dsh-auth',
]) {
  assert.match(dump.stdout, new RegExp(`\\b${row}\\b`), `composed web profile is missing row ${row}`)
}
for (const row of ['oh-desktop']) {
  assert.doesNotMatch(dump.stdout, new RegExp(`\\b${row}\\b`), `composed web profile must not mount desktop row ${row}`)
}

// 2. Boot the web profile and verify the served UI and client graph.
const port = await freePort()
const child = spawn(nodeBinary, [
  cliEntry,
  '--profile', WEB_PROFILE,
  '--host', '127.0.0.1',
  '--port', String(port),
], {
  cwd: smokeRoot,
  env: runtimeEnvironment,
  stdio: ['ignore', 'pipe', 'pipe'],
})

function lineReader(stream, resolveReady) {
  let pending = ''
  return chunk => {
    pending += chunk.toString('utf8')
    for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
      const line = pending.slice(0, newline).replace(/\r$/, '')
      pending = pending.slice(newline + 1)
      lines.push(`[${stream}] ${line}`)
      const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/.exec(line)
      if (match?.[1] !== undefined) resolveReady(new URL(match[1]))
    }
  }
}

let readySettled = false
const ready = new Promise((resolve, reject) => {
  const resolveOnce = value => {
    if (readySettled) return
    readySettled = true
    resolve(value)
  }
  child.stdout.on('data', lineReader('stdout', resolveOnce))
  child.stderr.on('data', lineReader('stderr', resolveOnce))
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    if (readySettled) return
    reject(new Error(`runtime exited before readiness (code=${String(code)}, signal=${String(signal)})\n${lines.join('\n')}`))
  })
})

const timeout = new Promise((_, reject) => {
  setTimeout(() => reject(new Error(`runtime readiness timed out\n${lines.join('\n')}`)), 60_000).unref()
})

try {
  const base = await Promise.race([ready, timeout])
  assert.ok(existsSync(join(
    dshHome,
    '.agent-presets',
    'liangshen',
    'agent.cordis.yml',
  )), 'Web Liangshen plugin did not install its preset')
  const indexResponse = await fetch(base)
  const index = await indexResponse.text()
  assert.equal(indexResponse.status, 200)
  assert.match(index, /<div id="root"><\/div>/)

  // The Oh-DSH web plugins enroll their browser entries in the client graph.
  const bootEntries = parseBootEntries(index)
  const agentPresetClient = bootEntries.find(
    entry => entry.id === '@deepseek-ai/dsh-client-ui-agent-preset',
  )
  assert.ok(agentPresetClient, 'DSH client graph is missing the Agent preset UI')
  const agentPresetBundleResponse = await fetch(new URL(agentPresetClient.url, base))
  const agentPresetBundle = await agentPresetBundleResponse.text()
  assert.equal(agentPresetBundleResponse.status, 200)
  assert.match(agentPresetBundle, /presetLiangshenName/)
  assert.match(agentPresetBundle, /Liangshen mode/)
  assert.match(agentPresetBundle, /preset\.managedBy/)

  const loaded = []
  for (const pluginId of [
    '@oh-dsh/web',
    '@oh-dsh/skins',
    '@oh-dsh/pinned-summary',
    '@oh-dsh/sidebar',
    '@oh-dsh/panel-controls',
    '@oh-dsh/vision',
    '@oh-dsh/plugin-marketplace',
    '@oh-dsh/about',
    'dsh-context',
  ]) {
    const row = bootEntries.find(entry => entry.id === pluginId)
    assert.ok(row, `${pluginId} Host entry did not activate in the DSH client graph`)
    const manifest = JSON.parse(readFileSync(join(
      resources,
      'dsh-runtime',
      'node_modules',
      ...pluginId.split('/'),
      'package.json',
    ), 'utf8'))
    assert.deepEqual(row.inject ?? [], manifest.dsh.client.inject ?? [])
    assert.equal(row.immediately === true, manifest.dsh.client.immediately === true)
    const bundleUrl = new URL(row.url, base)
    const bundleResponse = await fetch(bundleUrl)
    const bundle = await bundleResponse.text()
    assert.equal(
      bundleResponse.status,
      200,
      `${pluginId} Client bundle returned ${String(bundleResponse.status)}`,
    )
    assert.ok(bundle.includes(pluginId), `${pluginId} client bundle did not enroll its module id`)
    loaded.push({ bytes: bundle.length, id: pluginId })
  }

  // The host-only PTY runtime ships inside the web distribution.
  assert.ok(existsSync(join(
    resources,
    'dsh-runtime',
    'node_modules',
    '@oh-dsh',
    'better-sidebar-runtime',
    'dist',
    'index.js',
  )), '@oh-dsh/better-sidebar-runtime Host bundle is missing')
  assert.ok(existsSync(join(
    resources,
    'dsh-runtime',
    'node_modules',
    '@oh-dsh',
    'vision',
    'dist',
    'index.js',
  )), '@oh-dsh/vision Host bundle is missing')
  assert.ok(existsSync(join(
    resources,
    'dsh-runtime',
    'node_modules',
    '@deepseek-harness-tui',
    'dsh-auth',
    'lib',
    'index.js',
  )), '@deepseek-harness-tui/dsh-auth Host bundle is missing')

  // Only the Electron shell must stay out of the web client graph.
  assert.equal(
    bootEntries.some(entry => entry.id === '@oh-dsh/desktop'),
    false,
    '@oh-dsh/desktop must not enroll in the Oh-DSH Web client graph',
  )
  assert.equal(
    bootEntries.some(entry => entry.id === '@oh-dsh/plugin-marketplace'),
    true,
    '@oh-dsh/plugin-marketplace must enroll in the Oh-DSH Web client graph',
  )

  // The skins preferences server mounts on the web server.
  const preferencesUrl = new URL('/oh-dsh/skins/preferences', base)
  const initialResponse = await fetch(preferencesUrl)
  const initial = await initialResponse.json()
  assert.equal(initialResponse.status, 200)
  assert.equal(initial.activeId, null)
  assert.equal(initial.fallbackTheme, 'system')
  const saveResponse = await fetch(preferencesUrl, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      origin: base.origin,
    },
    body: JSON.stringify({ activeId: 'oh-dsh-skin-porcelain', fallbackTheme: 'dark' }),
  })
  assert.equal(saveResponse.status, 200, await saveResponse.text())
  const saved = await fetch(preferencesUrl)
  const persisted = await saved.json()
  assert.equal(persisted.activeId, 'oh-dsh-skin-porcelain')
  assert.equal(persisted.fallbackTheme, 'dark')

  // The plugin marketplace host serves its transaction bridge on the web server.
  const marketplaceUrl = new URL('/oh-dsh/plugin-marketplace', base)
  const marketplaceSnapshotResponse = await fetch(marketplaceUrl)
  const marketplaceSnapshot = await marketplaceSnapshotResponse.json()
  assert.equal(marketplaceSnapshotResponse.status, 200)
  assert.equal(Array.isArray(marketplaceSnapshot.catalog), true)
  assert.equal(typeof marketplaceSnapshot.lifecycle, 'object')
  const marketplaceDispatchResponse = await fetch(marketplaceUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: base.origin,
    },
    body: JSON.stringify({ type: 'discard' }),
  })
  assert.equal(marketplaceDispatchResponse.status, 200, await marketplaceDispatchResponse.text())

  // The sidebar host serves the workspace Git API on the web server.
  const git = (...args) => {
    const result = spawnSync('git', args, {
      cwd: smokeRoot,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return result.stdout
  }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Oh DSH Web Smoke')
  git('config', 'user.email', 'oh-dsh-web-smoke@example.test')
  writeFileSync(join(smokeRoot, 'web-smoke.txt'), 'before\n')
  git('add', 'web-smoke.txt')
  git('commit', '-m', 'web smoke baseline')
  writeFileSync(join(smokeRoot, 'web-smoke.txt'), 'after\n')

  const workspaceFactsResponse = await fetch(new URL(
    `/oh-dsh/workspace?cwd=${encodeURIComponent(smokeRoot)}`,
    base,
  ))
  const workspaceFacts = await workspaceFactsResponse.json()
  assert.equal(workspaceFactsResponse.status, 200)
  assert.equal(workspaceFacts.kind, 'repository')
  const actualRoot = statSync(workspaceFacts.root)
  const expectedRoot = statSync(smokeRoot)
  assert.equal(actualRoot.dev, expectedRoot.dev)
  assert.equal(actualRoot.ino, expectedRoot.ino)

  // The better-sidebar host serves session, Files, and Git through the same
  // /sidebar API the desktop distribution uses.
  const sidebarCall = async (method, payload) => {
    const response = await fetch(new URL(`/sidebar/api/${method}`, base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const envelope = await response.json()
    assert.equal(response.status, 200, JSON.stringify(envelope))
    assert.equal(envelope.ok, true, JSON.stringify(envelope))
    return envelope.value
  }
  const sidebarScope = { sessionId: 'web-smoke', cwd: smokeRoot }
  const sessionCwd = await sidebarCall('session.cwd', sidebarScope)
  assert.equal(sessionCwd.cwd, smokeRoot)
  const workspaceTree = await sidebarCall('fs.tree', sidebarScope)
  assert.equal(workspaceTree.path, smokeRoot)
  const gitStatus = await sidebarCall('git.status', sidebarScope)
  assert.equal(gitStatus.isRepo, true)
  assert.ok(gitStatus.entries.some(entry => entry.path === 'web-smoke.txt'))
  const gitBranches = await sidebarCall('git.branch', sidebarScope)
  assert.equal(gitBranches.current, 'main')
  const gitLog = await sidebarCall('git.log', {
    ...sidebarScope,
    count: 5,
    skip: 0,
  })
  assert.equal(gitLog[0]?.subject, 'web smoke baseline')

  // The PTY terminal host answers over the same websocket on the web server.
  const terminalUrl = new URL('/sidebar/ws/terminal', base)
  terminalUrl.protocol = 'ws:'
  terminalUrl.searchParams.set('sessionId', sidebarScope.sessionId)
  terminalUrl.searchParams.set('tab', 'smoke-terminal')
  terminalUrl.searchParams.set('cwd', smokeRoot)
  await new Promise((resolveTerminal, rejectTerminal) => {
    const socket = new WebSocket(terminalUrl)
    let output = ''
    let settled = false
    const terminalTimeout = setTimeout(() => {
      finish(new Error(`terminal smoke timed out; output=${JSON.stringify(output)}`))
    }, 10_000)
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(terminalTimeout)
      socket.close()
      if (error === undefined) resolveTerminal()
      else rejectTerminal(error)
    }
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }))
      // Split the marker so the echoed command line never contains it; only
      // real execution produces `OH_DSH_WEB_TERMINAL_SMOKE`.
      socket.send("printf '%s%s\\n' OH_DSH_WEB_TERMINAL_ SMOKE; exit\r")
    })
    socket.addEventListener('message', (event) => {
      output += String(event.data)
      if (output.includes('OH_DSH_WEB_TERMINAL_SMOKE')) {
        socket.send(JSON.stringify({ type: 'close' }))
        finish()
      }
    })
    socket.addEventListener('error', () => { finish(new Error('terminal websocket connection failed')) })
    socket.addEventListener('close', () => {
      if (!settled) finish(new Error(`terminal websocket closed early; output=${JSON.stringify(output)}`))
    })
  })

  // Linux GitHub-hosted runners do not provide a window server. Electron can
  // otherwise wait indefinitely while creating its first BrowserWindow, so
  // run the client under the runner-provided Xvfb when it is available.
  const smokeClient = join(root, 'scripts', 'smoke-client.cjs')
  const electronCommand = process.platform === 'linux'
    && existsSync('/usr/bin/xvfb-run')
    ? '/usr/bin/xvfb-run'
    : electronBinary
  const electronArgs = electronCommand === '/usr/bin/xvfb-run'
    ? [
      '--auto-servernum',
      '--server-args=-screen 0 1280x800x24',
      electronBinary,
      '--no-sandbox',
      smokeClient,
    ]
    : [
      '--no-sandbox',
      smokeClient,
    ]
  const browserClient = spawnSync(electronCommand, electronArgs, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...runtimeEnvironment,
      DSH_SMOKE_RUNTIME_URL: base.href,
      DSH_SMOKE_SURFACE: 'web',
    },
    timeout: Number.isFinite(smokeClientTimeoutMs) && smokeClientTimeoutMs > 0
      ? smokeClientTimeoutMs
      : 120_000,
  })
  assert.equal(
    browserClient.status,
    0,
    browserClient.error?.message || browserClient.stderr || browserClient.stdout,
  )

  console.log(`Oh-DSH Web profile ready: ${base.href}`)
  console.log(`Web composition verified: ${dump.stdout.split('\n').length} dump lines`)
  for (const plugin of loaded) {
    console.log(
      `Plugin compatible: ${plugin.id} (Host active, Client ${String(plugin.bytes)} bytes)`,
    )
  }
  console.log('Skins preferences API: ready, persistence verified')
  console.log('Sidebar workspace Git API: ready, repository facts verified')
  console.log('Better Sidebar Host API: ready, session/files/Git verified on the web surface')
  console.log('Better Sidebar terminal PTY: ready, command execution verified on the web surface')
  console.log('Web native image attachment: thumbnail, upload and removal verified')
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise(resolve => {
      const escalate = setTimeout(() => { child.kill('SIGKILL') }, 8_000)
      child.once('exit', () => {
        clearTimeout(escalate)
        resolve()
      })
      child.once('error', () => {
        clearTimeout(escalate)
        resolve()
      })
    })
  }
  rmSync(smokeRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 250,
  })
}
