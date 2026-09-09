import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import {
  bundledInstallScript,
  checkForUpdate,
  detectDistributionSurface,
  fetchLatestVersion,
  formatUpdateNotice,
  installScriptUrl,
  installerPayloadHome,
  installerRecordHome,
  latestReleaseApiUrl,
  readLauncherRecord,
  runSelfUpdate,
  runSelfUpdates,
  selfUpdatePlan,
  surfaceIsInstalled,
  startupUpdateNotice,
  updateCheckEnabled,
  type SelfUpdateSurface,
  type UpdateFetcher,
} from '../src/self-update.ts'

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json' },
  })
}

function releaseFetcher(tag: string): UpdateFetcher {
  return async () => await Promise.resolve(jsonResponse({ tag_name: tag }))
}

const isUnix = process.platform !== 'win32'

test('update checks respect the opt-out and endpoint overrides', async () => {
  assert.equal(updateCheckEnabled({}), true)
  assert.equal(updateCheckEnabled({ OH_DSH_UPDATE_CHECK: '0' }), false)
  assert.equal(updateCheckEnabled({ OH_DSH_UPDATE_CHECK: 'false' }), false)
  assert.equal(updateCheckEnabled({ OH_DSH_UPDATE_CHECK: '1' }), true)

  assert.equal(
    latestReleaseApiUrl({}),
    'https://api.github.com/repos/hust-open-atom-club/oh-dsh/releases/latest',
  )
  assert.equal(
    latestReleaseApiUrl({ OH_DSH_UPDATE_API_BASE: 'http://127.0.0.1:9/' }),
    'http://127.0.0.1:9/repos/hust-open-atom-club/oh-dsh/releases/latest',
  )

  let called = false
  const counting: UpdateFetcher = async () => {
    called = true
    return jsonResponse({ tag_name: 'v9.0.0' })
  }
  assert.equal(await fetchLatestVersion({ OH_DSH_UPDATE_CHECK: '0' }, counting), undefined)
  assert.equal(called, false)
  assert.equal(await fetchLatestVersion({}, counting), '9.0.0')
})

test('checkForUpdate compares semver and fails closed on bad input', async () => {
  const older = await checkForUpdate('0.1.8', {}, releaseFetcher('v0.2.0'))
  assert.deepEqual(older, { current: '0.1.8', latest: '0.2.0', updateAvailable: true })

  const same = await checkForUpdate('0.2.0', {}, releaseFetcher('v0.2.0'))
  assert.equal(same?.updateAvailable, false)

  const newerLocal = await checkForUpdate('0.3.0', {}, releaseFetcher('v0.2.0'))
  assert.equal(newerLocal?.updateAvailable, false)

  assert.equal(await checkForUpdate('not-a-version', {}, releaseFetcher('v0.2.0')), undefined)
  assert.equal(await checkForUpdate('0.1.8', {}, releaseFetcher('not-a-tag')), undefined)

  const failing: UpdateFetcher = async () => {
    throw new Error('offline')
  }
  assert.equal(await checkForUpdate('0.1.8', {}, failing), undefined)

  const serverError: UpdateFetcher = async () => jsonResponse({ message: 'nope' }, false)
  assert.equal(await checkForUpdate('0.1.8', {}, serverError), undefined)
})

test('the startup notice names both versions and the update command', async () => {
  assert.equal(
    formatUpdateNotice({ current: '0.1.8', latest: '0.2.0', updateAvailable: true }),
    'Oh-DSH 0.1.8 -> 0.2.0 is available. Run "ohdsh update" to upgrade.\n',
  )
  const notice = await startupUpdateNotice('0.1.8', {}, releaseFetcher('v0.2.0'))
  assert.match(notice ?? '', /ohdsh update/)
  const quiet = await startupUpdateNotice('0.2.0', {}, releaseFetcher('v0.2.0'))
  assert.equal(quiet, undefined)
  const disabled = await startupUpdateNotice(
    '0.1.8',
    { OH_DSH_UPDATE_CHECK: '0' },
    releaseFetcher('v0.2.0'),
  )
  assert.equal(disabled, undefined)
})

test('a startup check slower than the notice budget is abandoned silently', async () => {
  const slow: UpdateFetcher = () => new Promise<Response>(() => {})
  const started = Date.now()
  const notice = await startupUpdateNotice('0.1.8', {}, slow)
  const elapsed = Date.now() - started
  assert.equal(notice, undefined)
  assert.ok(elapsed < 5_000, `budget must bound the wait, took ${String(elapsed)}ms`)
})

test('installer plans target the platform script and surface', () => {
  assert.match(installScriptUrl('darwin'), /\/install\.sh$/)
  assert.match(installScriptUrl('linux'), /\/install\.sh$/)
  assert.match(installScriptUrl('win32'), /\/install\.ps1$/)
  assert.equal(
    installScriptUrl('darwin', 'hust-open-atom-club/oh-dsh', {
      OH_DSH_INSTALL_SCRIPT_URL: 'http://127.0.0.1:9/install.sh',
    }),
    'http://127.0.0.1:9/install.sh',
  )

  const unixPlan = selfUpdatePlan('web', 'linux', 'hust-open-atom-club/oh-dsh', {
    HOME: '/nonexistent-clean-home',
  })
  assert.equal(unixPlan.command, 'sh')
  assert.deepEqual(unixPlan.args, ['<script>', '--surface', 'web'])

  const windowsPlan = selfUpdatePlan('tui', 'win32', 'hust-open-atom-club/oh-dsh', {
    LOCALAPPDATA: 'Z:\\no-such-place',
    // Without USERPROFILE the record home falls back to the real profile
    // and would read this machine's launcher records.
    USERPROFILE: 'Z:\\no-such-profile',
  })
  assert.equal(windowsPlan.command, 'powershell')
  assert.deepEqual(
    windowsPlan.args.slice(0, 4),
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'],
  )
  assert.deepEqual(windowsPlan.args.slice(-2), ['-Surface', 'tui'])
})

test('distribution detection separates desktop, web, tui, and source', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-detect-'))

  const desktop = join(home, 'app-resources')
  await mkdir(join(desktop, 'lib'), { recursive: true })
  assert.equal(
    detectDistributionSurface(desktop, { OH_DSH_DESKTOP_APP: '/Applications/Oh-DSH Desktop.app' }),
    'desktop',
  )

  const web = join(home, 'web-pkg')
  await mkdir(join(web, 'lib', 'oh-dsh-web'), { recursive: true })
  await writeFile(join(web, 'lib', 'oh-dsh-web', 'main.js'), '')
  await mkdir(join(web, 'lib', 'oh-dsh'), { recursive: true })
  await writeFile(join(web, 'lib', 'oh-dsh', 'cli.js'), '')
  assert.equal(detectDistributionSurface(web, { DSH_OH_WEB_ROOT: web }), 'web')

  const tui = join(home, 'tui-pkg')
  await mkdir(join(tui, 'lib', 'oh-dsh'), { recursive: true })
  await writeFile(join(tui, 'lib', 'oh-dsh', 'cli.js'), '')
  assert.equal(detectDistributionSurface(tui, { DSH_OH_TUI_ROOT: tui }), 'tui')

  assert.equal(
    detectDistributionSurface(web, { OH_DSH_SOURCE_ROOT: home }),
    'source',
  )
})

test('runSelfUpdate downloads and executes the installer for the surface', { skip: !isUnix }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-selfupdate-'))
  const ranPath = join(home, 'ran.txt')
  const script = `#!/bin/sh\nprintf '%s\\n' "$*" > ${JSON.stringify(ranPath)}\n`
  const body = Buffer.from(script, 'utf8')

  const fetchImpl: UpdateFetcher = async () => new Response(body, { status: 200 })
  // An isolated HOME keeps the plan free of this machine's real records.
  const code = await runSelfUpdate('web', { ...process.env, HOME: home }, 'linux', fetchImpl)
  assert.equal(code, 0)
  assert.equal(await readFile(ranPath, 'utf8'), '--surface web\n')
})

test('runSelfUpdate reports a failed installer download', async () => {
  const failing: UpdateFetcher = async () => new Response('not found', { status: 404 })
  await assert.rejects(
    () => runSelfUpdate('tui', { ...process.env }, process.platform, failing),
    /failed to download the installer/,
  )
})

test('launcher records are parsed inertly and drive update destinations', () => {
  const env = { OH_DSH_HOME: '/state', HOME: '/home' }
  const record = readLauncherRecord(env, 'linux', path =>
    path.replaceAll('\\', '/').endsWith('/state/installer/launcher.env')
      ? 'WEB_DEST=/opt/oh web\nTUI_DEST=/opt/oh tui\nBIN_DIR=/opt/bin\nOH_DSH_NOPE=ignored\n'
      : undefined,
  )
  assert.deepEqual(record, { webDest: '/opt/oh web', tuiDest: '/opt/oh tui', binDir: '/opt/bin' })

  const plan = selfUpdatePlan('web', 'linux', 'hust-open-atom-club/oh-dsh', {
    OH_DSH_HOME: '/nowhere',
    HOME: '/home',
  })
  // No records on disk in this environment: plain default install flags.
  assert.deepEqual(plan.args, ['<script>', '--surface', 'web'])
})

test('selfUpdatePlan reconstructs recorded destinations per platform', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-plan-'))
  const recordHome = join(home, '.ohdsh', 'installer')
  await mkdir(recordHome, { recursive: true })
  await writeFile(join(recordHome, 'launcher.env'), 'WEB_DEST=/custom/web\nBIN_DIR=/custom/bin\n')
  const unixPlan = selfUpdatePlan('web', 'linux', 'hust-open-atom-club/oh-dsh', { HOME: home })
  assert.deepEqual(unixPlan.args, [
    '<script>', '--surface', 'web', '--dest', '/custom/web', '--bin-dir', '/custom/bin',
  ])

  const winHome = await mkdtemp(join(tmpdir(), 'oh-dsh-plan-win-'))
  const winData = join(winHome, '.ohdsh', 'installer')
  await mkdir(winData, { recursive: true })
  await writeFile(join(winData, 'launcher.env'), 'WEB_DEST=C:\\custom web\nBIN_DIR=C:\\custom bin\n')
  const winPlan = selfUpdatePlan('web', 'win32', 'hust-open-atom-club/oh-dsh', {
    OH_DSH_HOME: join(winHome, '.ohdsh'),
  })
  assert.deepEqual(winPlan.args.slice(-4), ['-Dest', 'C:\\custom web', '-BinDir', 'C:\\custom bin'])
})

test('desktop plans reconstruct the recorded destination and fork', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-plan-desktop-'))
  const recordHome = join(home, '.ohdsh', 'installer')
  await mkdir(recordHome, { recursive: true })
  await writeFile(
    join(recordHome, 'launcher.env'),
    'DESKTOP_DEST=/Applications\nDESKTOP_REPO=some-fork/oh-dsh\nBIN_DIR=/custom/bin\n',
  )
  const plan = selfUpdatePlan('desktop', 'linux', 'hust-open-atom-club/oh-dsh', { HOME: home })
  assert.equal(plan.scriptUrl, 'https://raw.githubusercontent.com/some-fork/oh-dsh/main/install.sh')
  assert.deepEqual(plan.args, [
    '<script>', '--surface', 'desktop',
    '--dest', '/Applications',
    '--bin-dir', '/custom/bin',
    '--repo', 'some-fork/oh-dsh',
  ])

  const plainHome = await mkdtemp(join(tmpdir(), 'oh-dsh-plan-desktop-empty-'))
  const plain = selfUpdatePlan('desktop', 'darwin', 'hust-open-atom-club/oh-dsh', { HOME: plainHome })
  assert.deepEqual(plain.args, ['<script>', '--surface', 'desktop'])
})

test('desktop detection follows DESKTOP_EXE, records, and the marker', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-desktop-installed-'))
  const recordHome = join(home, '.ohdsh', 'installer')
  const env = { HOME: home }

  assert.equal(surfaceIsInstalled('desktop', env, 'darwin'), false)

  // The recorded executable path is the primary probe on every platform.
  await mkdir(recordHome, { recursive: true })
  const appExe = join(home, 'Applications', 'Oh-DSH Desktop.app', 'Contents', 'MacOS', 'Oh-DSH Desktop')
  await writeFile(join(recordHome, 'launcher.env'), `DESKTOP_EXE=${appExe}\n`)
  assert.equal(surfaceIsInstalled('desktop', env, 'darwin'), false)
  await mkdir(dirname(appExe), { recursive: true })
  await writeFile(appExe, '')
  assert.equal(surfaceIsInstalled('desktop', env, 'darwin'), true)

  // Without DESKTOP_EXE, the launcher record's destination and its app
  // image decide; the desktop.env marker covers records that predate it.
  const markerHome = await mkdtemp(join(tmpdir(), 'oh-dsh-desktop-marker-'))
  const markerRecords = join(markerHome, '.ohdsh', 'installer')
  const markerApps = join(markerHome, 'apps')
  await mkdir(markerRecords, { recursive: true })
  await writeFile(
    join(markerRecords, 'desktop.env'),
    `OH_DSH_INSTALL_SURFACE=desktop\nOH_DSH_INSTALL_DEST=${markerApps}\n`,
  )
  const markerEnv = { HOME: markerHome }
  assert.equal(surfaceIsInstalled('desktop', markerEnv, 'linux'), false)
  await mkdir(markerApps, { recursive: true })
  await writeFile(join(markerApps, 'oh-dsh-desktop'), '')
  assert.equal(surfaceIsInstalled('desktop', markerEnv, 'linux'), true)
  assert.equal(surfaceIsInstalled('desktop', markerEnv, 'darwin'), false)
})

test('runSelfUpdates upgrades every surface and keeps going past a failure', { skip: !isUnix }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-selfupdates-'))
  const ranDir = join(home, 'runs')
  await mkdir(ranDir, { recursive: true })
  // The downloaded script records its arguments per invocation and fails
  // only for the desktop surface, so the run proves both ordering and the
  // continue-past-failure contract.
  const script = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${JSON.stringify(join(ranDir, 'log.txt'))}`,
    `[ "$2" = desktop ] && exit 3`,
    'exit 0',
  ].join('\n')
  const body = Buffer.from(script, 'utf8')
  const fetchImpl: UpdateFetcher = async () => new Response(body, { status: 200 })

  const announced: SelfUpdateSurface[] = []
  const code = await runSelfUpdates(
    ['desktop', 'web', 'tui'],
    { ...process.env, HOME: home },
    'linux',
    fetchImpl,
    '',
    surface => { announced.push(surface) },
  )
  assert.equal(code, 3)
  assert.deepEqual(announced, ['desktop', 'web', 'tui'])
  const log = (await readFile(join(ranDir, 'log.txt'), 'utf8')).split('\n').filter(line => line !== '')
  assert.deepEqual(log.map(line => line.split(' ')[1]), ['desktop', 'web', 'tui'])
})

test('detection prefers the payload marker and app path over layout probes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-detect2-'))
  const recordHome = join(home, '.ohdsh', 'installer')
  const payloadHome = join(home, '.local', 'share', 'oh-dsh')
  const env = { HOME: home }

  // A payload marker wins even inside a foreign directory.
  const marked = join(home, 'manual')
  await mkdir(marked, { recursive: true })
  await writeFile(join(marked, '.oh-dsh-install.env'), 'OH_DSH_INSTALL_SURFACE=tui\n')
  assert.equal(detectDistributionSurface(marked, env, () => true), 'tui')

  // macOS .app resource paths are desktop regardless of anything else.
  assert.equal(
    detectDistributionSurface(
      '/Applications/Oh-DSH Desktop.app/Contents/Resources',
      env,
      () => false,
      'darwin',
    ),
    'desktop',
  )

  // The installer's default payload path is recognized without a marker.
  const defaultWeb = join(payloadHome, 'web')
  await mkdir(defaultWeb, { recursive: true })
  assert.equal(detectDistributionSurface(defaultWeb, env, () => false, 'linux'), 'web')

  // Recorded custom destinations are recognized via launcher.env.
  const customTui = join(home, 'custom tui')
  await mkdir(recordHome, { recursive: true })
  await writeFile(join(recordHome, 'launcher.env'), `TUI_DEST=${customTui}\n`)
  await mkdir(customTui, { recursive: true })
  assert.equal(detectDistributionSurface(customTui, env, () => false, 'linux'), 'tui')

  // Manual archives fall back to the payload layout.
  const manual = join(home, 'extracted')
  await mkdir(join(manual, 'lib', 'oh-dsh'), { recursive: true })
  await writeFile(join(manual, 'lib', 'oh-dsh', 'cli.js'), '')
  assert.equal(detectDistributionSurface(manual, env, undefined), 'tui')
  assert.equal(
    detectDistributionSurface(manual, { HOME: home, OH_DSH_SOURCE_ROOT: home }, undefined),
    'source',
  )
})

test('the bundled installer script is preferred over a download', { skip: !isUnix }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-bundled-'))
  const packageRoot = join(home, 'pkg')
  await mkdir(join(packageRoot, 'lib', 'oh-dsh'), { recursive: true })
  const ranPath = join(home, 'ran.txt')
  await writeFile(
    join(packageRoot, 'lib', 'oh-dsh', 'install.sh'),
    `#!/bin/sh\nprintf '%s\\n' "$*" > ${JSON.stringify(ranPath)}\n`,
  )

  let fetched = false
  const fetchImpl: UpdateFetcher = async () => {
    fetched = true
    return new Response('# downloaded', { status: 200 })
  }
  // An isolated HOME keeps the plan free of this machine's real records.
  const code = await runSelfUpdate(
    'tui',
    { ...process.env, HOME: home },
    'linux',
    fetchImpl,
    packageRoot,
  )
  assert.equal(code, 0)
  assert.equal(fetched, false, 'no download when the package bundles the script')
  assert.equal(await readFile(ranPath, 'utf8'), '--surface tui\n')
  assert.equal(bundledInstallScript(packageRoot, 'linux'), join(packageRoot, 'lib', 'oh-dsh', 'install.sh'))
  assert.equal(bundledInstallScript(packageRoot, 'win32'), undefined)
})

test('surfaceIsInstalled follows records and default payload paths', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-installed-'))
  const recordHome = join(home, '.ohdsh', 'installer')
  const env = { HOME: home }

  assert.equal(surfaceIsInstalled('web', env, 'linux'), false)

  const payloadHome = join(home, '.local', 'share', 'oh-dsh')
  await mkdir(join(payloadHome, 'web', 'bin'), { recursive: true })
  await writeFile(join(payloadHome, 'web', 'bin', 'ohdsh'), '')
  assert.equal(surfaceIsInstalled('web', env, 'linux'), true)
  assert.equal(surfaceIsInstalled('tui', env, 'linux'), false)

  await mkdir(recordHome, { recursive: true })
  await writeFile(join(recordHome, 'launcher.env'), `TUI_DEST=${join(home, 'custom tui')}\n`)
  await mkdir(join(home, 'custom tui', 'bin'), { recursive: true })
  await writeFile(join(home, 'custom tui', 'bin', 'ohdsh'), '')
  assert.equal(surfaceIsInstalled('tui', env, 'linux'), true)
})

test('fork provenance flows from the record into the update plan', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-fork-'))
  const recordHome = join(home, '.ohdsh', 'installer')
  await mkdir(recordHome, { recursive: true })
  await writeFile(
    join(recordHome, 'launcher.env'),
    'TUI_DEST=/custom/tui\nTUI_REPO=someone/oh-dsh-fork\n',
  )
  const env = { HOME: home }
  const plan = selfUpdatePlan('tui', 'linux', 'hust-open-atom-club/oh-dsh', env)
  assert.match(plan.scriptUrl, /someone\/oh-dsh-fork\/main\/install\.sh$/)
  assert.deepEqual(plan.args, [
    '<script>', '--surface', 'tui', '--dest', '/custom/tui', '--repo', 'someone/oh-dsh-fork',
  ])

  const winPlan = selfUpdatePlan('tui', 'win32', 'hust-open-atom-club/oh-dsh', {
    HOME: home,
    OH_DSH_HOME: join(home, '.ohdsh'),
  })
  assert.deepEqual(winPlan.args.slice(-2), ['-Repo', 'someone/oh-dsh-fork'])
})

test('update checks target the recorded fork repository', async () => {
  let requestedUrl = ''
  const fetchImpl: UpdateFetcher = async url => {
    requestedUrl = String(url)
    return jsonResponse({ tag_name: 'v0.2.0' })
  }
  const result = await checkForUpdate('0.1.8', {}, fetchImpl, 'someone/oh-dsh-fork')
  assert.equal(result?.updateAvailable, true)
  assert.match(requestedUrl, /repos\/someone\/oh-dsh-fork\/releases\/latest$/)
})

test('records tolerate a UTF-8 BOM and CRLF line endings', () => {
  const env = { OH_DSH_HOME: '/state' }
  const content = '﻿; generated by install.ps1\r\nWEB_DEST=/opt/oh web\r\nBIN_DIR=/opt/bin\r\n'
  const record = readLauncherRecord(env, 'win32', path =>
    path.replaceAll('\\', '/').endsWith('/state/installer/launcher.env') ? content : undefined,
  )
  assert.deepEqual(record, { webDest: '/opt/oh web', binDir: '/opt/bin' })
})

test('windows record roots follow USERPROFILE, not a Git-Bash HOME', () => {
  const env = { HOME: 'C:/gitbash/home', USERPROFILE: 'C:\\Users\\runner' }
  assert.equal(
    installerRecordHome('win32', env),
    join('C:\\Users\\runner', '.ohdsh', 'installer'),
  )
  assert.equal(
    installerPayloadHome('win32', env),
    join('C:\\Users\\runner', 'AppData', 'Local', 'oh-dsh'),
  )
})

test('OH_DSH_INSTALLER_HOME pins the record root for custom installs', () => {
  assert.equal(
    installerRecordHome('win32', { OH_DSH_INSTALLER_HOME: 'D:\\custom-records' }),
    'D:\\custom-records',
  )
  assert.equal(
    installerRecordHome('linux', {
      OH_DSH_INSTALLER_HOME: '/custom/records',
      OH_DSH_HOME: '/ignored',
    }),
    '/custom/records',
  )
})

test('surfaceIsInstalled probes the platform launcher name', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-suffix-'))
  const recordHome = join(home, '.ohdsh', 'installer')
  const env = { HOME: home, OH_DSH_HOME: join(home, '.ohdsh') }
  await mkdir(recordHome, { recursive: true })
  const custom = join(home, 'custom tui')
  await mkdir(join(custom, 'bin'), { recursive: true })
  await writeFile(join(custom, 'bin', 'ohdsh.cmd'), '')
  await writeFile(join(recordHome, 'launcher.env'), `TUI_DEST=${custom}\n`)
  assert.equal(surfaceIsInstalled('tui', env, 'win32'), true)
  assert.equal(surfaceIsInstalled('tui', env, 'linux'), false)
})

test('update-check tokens stay on the GitHub origin', async () => {
  const seen: Array<{ url: string; auth: string | undefined }> = []
  const fetchImpl: UpdateFetcher = async (url, init) => {
    seen.push({
      url: String(url),
      auth: (init?.headers as Record<string, string> | undefined)?.authorization,
    })
    return jsonResponse({ tag_name: 'v0.2.0' })
  }
  await checkForUpdate('0.1.8', { GH_TOKEN: 'ghp_secret', OH_DSH_UPDATE_API_BASE: 'http://127.0.0.1:9' }, fetchImpl)
  assert.equal(seen[0]?.auth, undefined, 'custom API bases never receive the token')
  await checkForUpdate('0.1.8', { GH_TOKEN: 'ghp_secret' }, fetchImpl)
  assert.equal(seen[1]?.auth, 'Bearer ghp_secret')
  assert.match(seen[1]?.url ?? '', /^https:\/\/api\.github\.com\//)
})
