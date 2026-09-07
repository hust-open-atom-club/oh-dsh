import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, realpathSync } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { MockGitHub } from './helpers/mock-github.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const installSh = join(root, 'install.sh')

const execFileAsync = promisify(execFile)

type InstallerResult = { status: number; stdout: string; stderr: string }

// Async on purpose: the mock GitHub server runs in this process, and a
// synchronous spawn would block the event loop that must answer install.sh.
async function runInstaller(
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): Promise<InstallerResult> {
  try {
    const { stdout, stderr } = await execFileAsync('sh', [installSh, ...args], {
      env: { ...process.env, ...env },
      maxBuffer: 16 * 1024 * 1024,
      ...(cwd === undefined ? {} : { cwd }),
    })
    return { status: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return {
      status: failure.code ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

function run(command: string, args: string[], options: { cwd?: string } = {}):
ReturnType<typeof spawnSync> {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed: ${result.stderr}`,
  )
  return result
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function makeSurfaceArchive(
  surface: 'web' | 'tui',
  version: string,
  os: 'darwin' | 'linux',
  arch: 'arm64' | 'x64',
  marker: string,
): Promise<{ name: string; bytes: Buffer }> {
  const staging = await mkdtemp(join(tmpdir(), `oh-dsh-${surface}-`))
  const base = `oh-dsh-${surface}-${version}-${os}-${arch}`
  const packageDir = join(staging, base)
  await mkdir(join(packageDir, 'bin'), { recursive: true })
  await mkdir(join(packageDir, 'lib', 'oh-dsh'), { recursive: true })
  await writeFile(join(packageDir, 'bin', 'ohdsh'), `#!/bin/sh\necho ${marker}\n`)
  await chmod(join(packageDir, 'bin', 'ohdsh'), 0o755)
  await writeFile(join(packageDir, 'lib', 'oh-dsh', 'cli.js'), `// ${marker}\n`)
  const tarball = join(staging, `${base}.tar.gz`)
  run('tar', ['-czf', tarball, '-C', staging, base])
  return { name: `${base}.tar.gz`, bytes: await readFile(tarball) }
}

async function makeMacDesktopZip(
  version: string,
  arch: 'arm64' | 'x64',
): Promise<{ name: string; bytes: Buffer }> {
  const staging = await mkdtemp(join(tmpdir(), 'oh-dsh-desktop-'))
  const appDir = join(staging, 'Oh-DSH Desktop.app')
  await mkdir(join(appDir, 'Contents', 'MacOS'), { recursive: true })
  await mkdir(join(appDir, 'Contents', 'Resources'), { recursive: true })
  const executable = join(appDir, 'Contents', 'MacOS', 'Oh-DSH Desktop')
  await writeFile(executable, `#!/bin/sh\necho desktop-${version}\n`)
  await chmod(executable, 0o755)
  await writeFile(join(appDir, 'Contents', 'Resources', 'app.asar'), 'asar')
  await writeFile(
    join(appDir, 'Contents', 'Info.plist'),
    '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
      + '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
      + '<plist version="1.0">\n<dict>\n'
      + '<key>CFBundleIdentifier</key>\n<string>ai.deepseek.oh-dsh-desktop</string>\n'
      + `<key>CFBundleShortVersionString</key>\n<string>${version}</string>\n`
      + '</dict>\n</plist>\n',
  )
  const zipPath = join(staging, `Oh-DSH-Desktop-${version}-${arch}.zip`)
  if (process.platform === 'darwin') {
    run('ditto', ['-c', '-k', '--keepParent', appDir, zipPath])
  } else {
    run('zip', ['-rq', zipPath, 'Oh-DSH Desktop.app'], { cwd: staging })
  }
  return { name: `Oh-DSH-Desktop-${version}-${arch}.zip`, bytes: await readFile(zipPath) }
}

async function makeLsregisterSpy(
  directory: string,
): Promise<{ bin: string; logPath: string }> {
  const logPath = join(directory, 'lsregister.log')
  const bin = join(directory, 'lsregister')
  await writeFile(bin, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(logPath)}\n`)
  await chmod(bin, 0o755)
  return { bin, logPath }
}

// A plutil stand-in: `plutil -extract KEY raw -o - PLIST` prints `KEY=value`
// lines from the fake plist, mirroring the probes install.sh performs.
async function makePlutilSpy(
  directory: string,
): Promise<{ bin: string; logPath: string }> {
  const logPath = join(directory, 'plutil.log')
  const bin = join(directory, 'plutil')
  await writeFile(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(logPath)}\n` +
      'if grep -qF "$2=" "$6" 2>/dev/null; then\n' +
      '  grep -F "$2=" "$6" | head -n 1 | cut -d= -f2-\n' +
      'else\n' +
      '  grep -A1 "<key>$2</key>" "$6" | tail -n 1 | sed "s/.*<string>\\(.*\\)<\\/string>.*/\\1/"\n' +
      'fi\n',
  )
  await chmod(bin, 0o755)
  return { bin, logPath }
}

async function makeFakePlist(
  appDir: string,
  identifier: string,
  version: string,
): Promise<void> {
  await mkdir(join(appDir, 'Contents'), { recursive: true })
  await writeFile(
    join(appDir, 'Contents', 'Info.plist'),
    `CFBundleIdentifier=${identifier}\nCFBundleShortVersionString=${version}\n`,
  )
}

function runLauncher(
  launcher: string,
  args: string[],
  env: Record<string, string>,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('sh', [launcher, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

async function makeSandbox(
  github: MockGitHub,
  extra: Record<string, string> = {},
): Promise<{ home: string; env: Record<string, string> }> {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-install-home-'))
  return {
    home,
    env: {
      HOME: home,
      OH_DSH_API_BASE: github.apiBase,
      OH_DSH_DOWNLOAD_BASE: github.downloadBase,
      ...extra,
    },
  }
}

const skipOnWindows = process.platform === 'win32'
  ? 'install.sh targets macOS and Linux'
  : false

test('a --local install uses the checkout build without touching the network', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    // A checkout with a built artifact but nothing published: any network
    // resolution would fail the install.
    const checkout = await mkdtemp(join(tmpdir(), 'oh-dsh-local-repo-'))
    await writeFile(
      join(checkout, 'package.json'),
      JSON.stringify({ name: '@oh-dsh/desktop', version: '0.1.9-local.1' }, undefined, 2) + '\n',
    )
    await mkdir(join(checkout, 'release'), { recursive: true })
    const archive = await makeSurfaceArchive('tui', '0.1.9-local.1', 'linux', 'x64', 'local-tui-build')
    await writeFile(join(checkout, 'release', archive.name), archive.bytes)
    await copyFile(installSh, join(checkout, 'install.sh'))

    const { home, env } = await makeSandbox(github, { SHELL: '/bin/bash' })
    const result = await runInstaller(
      ['--local-root', checkout, '--os', 'linux', '--arch', 'x64'],
      env,
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Installing locally built oh-dsh-tui-0\.1\.9-local\.1-linux-x64\.tar\.gz/)
    const marker = await readFile(
      join(home, '.local', 'share', 'oh-dsh', 'tui', '.oh-dsh-install.env'),
      'utf8',
    )
    assert.match(marker, /OH_DSH_INSTALL_VERSION=0\.1\.9-local\.1/)
    assert.match(marker, /OH_DSH_INSTALL_ASSET=oh-dsh-tui-0\.1\.9-local\.1-linux-x64\.tar\.gz/)
    const launched = runLauncher(join(home, '.local', 'bin', 'ohdsh'), ['tui'], env)
    assert.equal(launched.status, 0, launched.stderr)
    assert.match(launched.stdout, /local-tui-build/)
  } finally {
    await github.stop()
  }
})

test('a --local install reports the missing build artifact instead of installing', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    const checkout = await mkdtemp(join(tmpdir(), 'oh-dsh-local-repo-'))
    await writeFile(
      join(checkout, 'package.json'),
      JSON.stringify({ name: '@oh-dsh/desktop', version: '0.1.9-local.1' }, undefined, 2) + '\n',
    )
    await mkdir(join(checkout, 'release'), { recursive: true })
    await copyFile(installSh, join(checkout, 'install.sh'))

    const { env } = await makeSandbox(github)
    const result = await runInstaller(
      ['--local-root', checkout, '--surface', 'web', '--os', 'linux', '--arch', 'x64'],
      env,
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /does not contain oh-dsh-web-0\.1\.9-local\.1-linux-x64\.tar\.gz/)
    assert.match(result.stderr, /pnpm run dist:web/)
  } finally {
    await github.stop()
  }
})

test('command-line installers default to TUI', () => {
  assert.match(readFileSync(installSh, 'utf8'), /surface=\$\{OH_DSH_SURFACE:-tui\}/)
  assert.match(readFileSync(join(root, 'install.ps1'), 'utf8'), /\[string\]\$Surface = 'tui'/)
})

test('default Unix installation provides the TUI dispatcher', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'default-tui')])
    const { home, env } = await makeSandbox(github, { SHELL: '/bin/bash' })
    const result = await runInstaller(['--os', 'linux', '--arch', 'x64'], env)
    assert.equal(result.status, 0, result.stderr)
    const launcher = join(home, '.local', 'bin', 'ohdsh')
    assert.ok(await exists(launcher))
    assert.match(await readFile(join(home, '.bash_profile'), 'utf8'), /Oh-DSH launcher path/)
    assert.match(await readFile(join(home, '.bashrc'), 'utf8'), /Oh-DSH launcher path/)
    const launched = runLauncher(launcher, ['tui'], env)
    assert.equal(launched.status, 0, launched.stderr)
    assert.match(launched.stdout, /default-tui/)
  } finally {
    await github.stop()
  }
})

test('zsh installations register login and interactive profiles', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'zsh-tui')])
    const { home, env } = await makeSandbox(github, { SHELL: '/bin/zsh' })
    const result = await runInstaller(['--os', 'linux', '--arch', 'x64'], env)
    assert.equal(result.status, 0, result.stderr)
    assert.match(await readFile(join(home, '.zprofile'), 'utf8'), /Oh-DSH launcher path/)
    assert.match(await readFile(join(home, '.zshrc'), 'utf8'), /Oh-DSH launcher path/)
    assert.equal(await exists(join(home, '.profile')), false)
  } finally {
    await github.stop()
  }
})

test('shell PATH profiles follow a relocated launcher directory', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'relocated-path')])
    const { home, env } = await makeSandbox(github, { SHELL: '/bin/bash' })
    const payload = join(home, 'payload')
    const binA = join(home, 'bin-a')
    const binB = join(home, 'bin-b')
    const common = ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload]
    assert.equal((await runInstaller([...common, '--bin-dir', binA], env)).status, 0)
    assert.equal((await runInstaller([...common, '--bin-dir', binB], env)).status, 0)

    for (const profile of ['.bash_profile', '.bashrc']) {
      const contents = await readFile(join(home, profile), 'utf8')
      assert.ok(contents.includes(binB), `${profile} must contain the current bin directory`)
      assert.ok(!contents.includes(binA), `${profile} must remove the retired bin directory`)
    }
  } finally {
    await github.stop()
  }
})

test('shell PATH profiles quote apostrophes in launcher paths', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'quoted-path')])
    const { home, env } = await makeSandbox(github, { SHELL: '/bin/bash' })
    const bin = join(home, "bin'a")
    const profile = join(home, '.bashrc')
    const result = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--bin-dir', bin],
      env,
    )
    assert.equal(result.status, 0, result.stderr)
    const contents = await readFile(profile, 'utf8')
    const quotedBin = bin.replaceAll("'", "'\\''")
    assert.ok(contents.includes(quotedBin))
    run('sh', ['-n', profile])
    const sourced = spawnSync('sh', ['-c', '. "$1"; command -v ohdsh', 'test', profile], {
      encoding: 'utf8',
      env: { ...process.env, ...env, PATH: '/usr/bin:/bin' },
    })
    assert.equal(sourced.status, 0, sourced.stderr)
    assert.equal(sourced.stdout.trim(), realpathSync(join(bin, 'ohdsh')))
  } finally {
    await github.stop()
  }
})

test('desktop install registers the unified launcher', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [await makeMacDesktopZip('0.1.8', 'arm64')])
    const { home, env } = await makeSandbox(github, { SHELL: '/bin/bash' })
    const plutil = await makePlutilSpy(home)
    env.OH_DSH_PLUTIL = plutil.bin
    const apps = join(home, 'Applications')
    const result = await runInstaller(
      ['--surface', 'desktop', '--os', 'darwin', '--arch', 'arm64', '--dest', apps],
      env,
    )
    assert.equal(result.status, 0, result.stderr)
    const launcher = join(home, '.local', 'bin', 'ohdsh')
    const launched = runLauncher(launcher, ['desktop'], env)
    assert.equal(launched.status, 0, launched.stderr)
    assert.match(launched.stdout, /desktop-0\.1\.8/)
    assert.match(await readFile(join(home, '.bash_profile'), 'utf8'), /Oh-DSH launcher path/)
    assert.match(await readFile(join(home, '.bashrc'), 'utf8'), /Oh-DSH launcher path/)
  } finally {
    await github.stop()
  }
})

test('web install resolves the latest stable release and installs only the web surface', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.2.0-rc.1', [
      await makeSurfaceArchive('web', '0.2.0-rc.1', 'linux', 'x64', 'rc'),
    ])
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'stable'),
      await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'stable'),
    ])
    github.setLatest('v0.1.8')
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')

    const result = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin],
      env,
    )

    assert.equal(result.status, 0, result.stderr)
    assert.ok(github.sawRequest('/releases/latest'))
    assert.ok(!github.sawRequest('/releases/tags/'))
    assert.equal(github.downloadCount('v0.1.8', 'oh-dsh-web-0.1.8-linux-x64.tar.gz'), 1)
    assert.equal(github.downloadCount('v0.1.8', 'oh-dsh-tui-0.1.8-linux-x64.tar.gz'), 0)
    assert.ok(await exists(join(payload, 'bin', 'ohdsh')))
    assert.ok(await exists(join(payload, 'lib', 'oh-dsh', 'cli.js')))
    const dispatched = runLauncher(join(bin, 'ohdsh'), ['web'], env)
    assert.equal(dispatched.status, 0, dispatched.stderr)
    assert.match(dispatched.stdout, /stable/)
    const marker = await readFile(join(payload, '.oh-dsh-install.env'), 'utf8')
    assert.match(marker, /^OH_DSH_INSTALL_SURFACE=web$/m)
    assert.match(marker, /^OH_DSH_INSTALL_VERSION=0\.1\.8$/m)
    assert.match(marker, /^OH_DSH_INSTALL_ASSET=oh-dsh-web-0\.1\.8-linux-x64\.tar\.gz$/m)
    assert.match(marker, new RegExp(`^OH_DSH_INSTALL_DEST=${realpathSync(payload).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))
    assert.match(result.stdout, /Installed Oh-DSH web 0\.1\.8/)
  } finally {
    await github.stop()
  }
})

test('a checksum mismatch fails closed and leaves the previous web install usable', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    const good = await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'good')
    github.publish('v0.1.8', [good])
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const args = ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin]
    assert.equal((await runInstaller(args, env)).status, 0)

    // Republish the same asset with tampered bytes: the served download no
    // longer matches the published digest.
    github.tamperAsset(
      'v0.1.8',
      good.name,
      (await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'tampered')).bytes,
    )

    const failing = await runInstaller([...args, '--force'], env)
    assert.notEqual(failing.status, 0)
    assert.match(failing.stderr, /checksum mismatch/)
    const binohdsh = await readFile(join(payload, 'bin', 'ohdsh'), 'utf8')
    assert.match(binohdsh, /good/)
    const marker = await readFile(join(payload, '.oh-dsh-install.env'), 'utf8')
    assert.match(marker, /OH_DSH_INSTALL_VERSION=0\.1\.8/)
    const parentEntries = await readdir(home)
    assert.ok(!parentEntries.some(entry => entry.includes('install-pending')))
  } finally {
    await github.stop()
  }
})

test('tui installs are idempotent, --force reinstalls, and upgrades replace the payload', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'old'),
    ])
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const args = ['--surface', 'tui', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin]
    const asset = 'oh-dsh-tui-0.1.8-linux-x64.tar.gz'

    assert.equal((await runInstaller(args, env)).status, 0)
    const rerun = await runInstaller(args, env)
    assert.equal(rerun.status, 0)
    assert.match(rerun.stdout, /already installed/)
    assert.equal(github.downloadCount('v0.1.8', asset), 1)

    // Staged leftovers from an interrupted upgrade must not survive a retry,
    // but a foreign sibling that merely shares the prefix must.
    for (const stale of ['payload.previous-stale', 'payload.install-pending.stale']) {
      await mkdir(join(home, stale, 'bin'), { recursive: true })
      await mkdir(join(home, stale, 'lib'), { recursive: true })
      await writeFile(join(home, stale, 'bin', 'ohdsh'), '#!/bin/sh\n')
      await chmod(join(home, stale, 'bin', 'ohdsh'), 0o755)
    }
    const foreignSibling = join(home, 'payload.previous-unowned')
    await mkdir(join(foreignSibling, 'keep'), { recursive: true })
    await writeFile(join(foreignSibling, 'keep', 'mine.txt'), 'not yours')

    const forced = await runInstaller([...args, '--force'], env)
    assert.equal(forced.status, 0)
    assert.equal(github.downloadCount('v0.1.8', asset), 2)

    github.publish('v0.1.9', [
      await makeSurfaceArchive('tui', '0.1.9', 'linux', 'x64', 'new'),
    ])
    github.setLatest('v0.1.9')
    const upgrade = await runInstaller(args, env)
    assert.equal(upgrade.status, 0, upgrade.stderr)
    assert.match(await readFile(join(payload, 'bin', 'ohdsh'), 'utf8'), /new/)
    const marker = await readFile(join(payload, '.oh-dsh-install.env'), 'utf8')
    assert.match(marker, /OH_DSH_INSTALL_VERSION=0\.1\.9/)
    const upgraded = runLauncher(join(bin, 'ohdsh'), ['tui'], env)
    assert.equal(upgraded.status, 0, upgraded.stderr)
    assert.match(upgraded.stdout, /new/)
    assert.ok(await exists(join(foreignSibling, 'keep', 'mine.txt')), 'foreign siblings must survive')
    const parentEntries = await readdir(home)
    assert.ok(!parentEntries.some(entry => entry.startsWith('payload.previous-stale')))
    assert.ok(!parentEntries.some(entry => entry.startsWith('payload.install-pending')))
  } finally {
    await github.stop()
  }
})

test('macOS desktop installs register the app bundle and retire verified stale bundles; other surfaces never do', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeMacDesktopZip('0.1.8', 'arm64'),
      await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'tui'),
    ])
    const { home, env } = await makeSandbox(github)
    const spy = await makeLsregisterSpy(home)
    const plutil = await makePlutilSpy(home)
    env.OH_DSH_LSREGISTER = spy.bin
    env.OH_DSH_PLUTIL = plutil.bin
    const apps = join(home, 'Applications')
    // A verified, strictly older legacy bundle and an installer-made backup.
    const legacy = join(apps, 'Oh-DSH-Desktop.app')
    await makeFakePlist(legacy, 'ai.deepseek.oh-dsh-desktop', '0.1.7')
    const staleBackup = join(apps, 'Oh-DSH Desktop-before-20200101-000000.app')
    await makeFakePlist(staleBackup, 'ai.deepseek.oh-dsh-desktop', '0.1.6')
    const foreignBackup = join(apps, 'Oh-DSH Desktop-before-19990101-000000.app')
    await makeFakePlist(foreignBackup, 'someone.elses.app', '1.0')

    const result = await runInstaller(
      ['--surface', 'desktop', '--os', 'darwin', '--arch', 'arm64', '--dest', apps],
      env,
    )
    assert.equal(result.status, 0, result.stderr)

    const installedApp = join(apps, 'Oh-DSH Desktop.app')
    assert.ok(await exists(join(installedApp, 'Contents', 'MacOS', 'Oh-DSH Desktop')))
    assert.ok(!(await exists(legacy)), 'verified older legacy bundles must be retired')
    assert.ok(!(await exists(staleBackup)), 'verified pre-upgrade backups must be removed')
    assert.ok(await exists(foreignBackup), 'foreign look-alike backups must survive')
    const lsregisterLog = await readFile(spy.logPath, 'utf8')
    assert.match(lsregisterLog, new RegExp(`-f .*${'Oh-DSH Desktop.app'}`))
    const markerPath = join(home, '.ohdsh', 'installer', 'desktop.env')
    const marker = await readFile(markerPath, 'utf8')
    assert.match(marker, /^OH_DSH_INSTALL_SURFACE=desktop$/m)
    assert.match(marker, /^OH_DSH_INSTALL_ASSET=Oh-DSH-Desktop-0\.1\.8-arm64\.zip$/m)
    assert.match(marker, /^OH_DSH_INSTALL_DEST=.*Applications$/m)

    // Web and TUI installs must not touch application registration.
    await rm(spy.logPath, { force: true })
    const payload = join(home, 'tui-payload')
    const bin = join(home, 'tui-bin')
    const tui = await runInstaller(
      ['--surface', 'tui', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin],
      env,
    )
    assert.equal(tui.status, 0, tui.stderr)
    assert.ok(!(await exists(spy.logPath)))
    assert.ok(await exists(join(payload, 'bin', 'ohdsh')))
  } finally {
    await github.stop()
  }
})

test('unverifiable or newer legacy bundles are retained', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeMacDesktopZip('0.1.8', 'arm64'),
    ])
    for (const [name, legacyVersion, identifier] of [
      ['newer', '0.1.9', 'ai.deepseek.oh-dsh-desktop'],
      ['foreign', '0.1.7', 'someone.elses.app'],
    ] as const) {
      const { home, env } = await makeSandbox(github)
      const plutil = await makePlutilSpy(home)
      env.OH_DSH_PLUTIL = plutil.bin
      const apps = join(home, 'Applications')
      const legacy = join(apps, 'Oh-DSH-Desktop.app')
      await makeFakePlist(legacy, identifier, legacyVersion)
      const result = await runInstaller(
        ['--surface', 'desktop', '--os', 'darwin', '--arch', 'arm64', '--dest', apps],
        env,
      )
      assert.equal(result.status, 0, result.stderr)
      assert.ok(await exists(legacy), `${name} legacy bundle must be retained`)
      assert.match(result.stderr, /leaving .* in place/)
    }

    // A bundle without a readable Info.plist is unverifiable and retained.
    const { home, env } = await makeSandbox(github)
    const plutil = await makePlutilSpy(home)
    env.OH_DSH_PLUTIL = plutil.bin
    const apps = join(home, 'Applications')
    const opaque = join(apps, 'Oh-DSH-Desktop.app')
    await mkdir(join(opaque, 'Contents', 'MacOS'), { recursive: true })
    const result = await runInstaller(
      ['--surface', 'desktop', '--os', 'darwin', '--arch', 'arm64', '--dest', apps],
      env,
    )
    assert.equal(result.status, 0, result.stderr)
    assert.ok(await exists(opaque), 'unverifiable legacy bundle must be retained')
  } finally {
    await github.stop()
  }
})

test('pinned --version selects that release tag instead of latest', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'newest'),
    ])
    github.publish('v0.1.7', [
      await makeSurfaceArchive('web', '0.1.7', 'linux', 'x64', 'pinned'),
    ])
    const { home, env } = await makeSandbox(github)
    const result = await runInstaller(
      [
        '--surface', 'web', '--version', 'v0.1.7',
        '--os', 'linux', '--arch', 'x64',
        '--dest', join(home, 'payload'), '--bin-dir', join(home, 'bin'),
      ],
      env,
    )
    assert.equal(result.status, 0, result.stderr)
    assert.ok(github.sawRequest('/releases/tags/v0.1.7'))
    assert.equal(github.downloadCount('v0.1.7', 'oh-dsh-web-0.1.7-linux-x64.tar.gz'), 1)
    assert.equal(github.downloadCount('v0.1.8', 'oh-dsh-web-0.1.8-linux-x64.tar.gz'), 0)
    assert.match(await readFile(join(home, 'payload', 'bin', 'ohdsh'), 'utf8'), /pinned/)
  } finally {
    await github.stop()
  }
})

test('unsupported targets fail with actionable messages', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [])
    const { env } = await makeSandbox(github)

    const arm = await runInstaller(['--surface', 'tui', '--os', 'linux', '--arch', 'arm64'], env)
    assert.notEqual(arm.status, 0)
    assert.match(arm.stderr, /linux-arm64/)

    const windows = await runInstaller(['--surface', 'desktop', '--os', 'win'], env)
    assert.notEqual(windows.status, 0)
    assert.match(windows.stderr, /install\.ps1/)

    const surface = await runInstaller(['--surface', 'editor'], env)
    assert.notEqual(surface.status, 0)
    assert.match(surface.stderr, /unsupported surface/)

    const missing = await runInstaller(['--surface', 'tui', '--os', 'linux', '--arch', 'x64'], env)
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /oh-dsh-tui-0\.1\.8-linux-x64\.tar\.gz/)
  } finally {
    await github.stop()
  }
})

test('uninstall removes the surface payload, launcher, and desktop app', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'bye'),
      await makeMacDesktopZip('0.1.8', 'arm64'),
    ])
    const { home, env } = await makeSandbox(github)
    const spy = await makeLsregisterSpy(home)
    const plutil = await makePlutilSpy(home)
    env.OH_DSH_LSREGISTER = spy.bin
    env.OH_DSH_PLUTIL = plutil.bin

    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const tuiArgs = ['--surface', 'tui', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin]
    assert.equal((await runInstaller(tuiArgs, env)).status, 0)
    const tuiUninstall = await runInstaller(['--uninstall', ...tuiArgs], env)
    assert.equal(tuiUninstall.status, 0, tuiUninstall.stderr)
    assert.ok(!(await exists(payload)))
    assert.ok(!(await exists(join(bin, 'ohdsh'))))

    const apps = join(home, 'Applications')
    const desktopArgs = ['--surface', 'desktop', '--os', 'darwin', '--arch', 'arm64', '--dest', apps]
    assert.equal((await runInstaller(desktopArgs, env)).status, 0)
    const desktopUninstall = await runInstaller(['--uninstall', ...desktopArgs], env)
    assert.equal(desktopUninstall.status, 0, desktopUninstall.stderr)
    assert.ok(!(await exists(join(apps, 'Oh-DSH Desktop.app'))))
    const unregisterLog = await readFile(spy.logPath, 'utf8')
    assert.match(unregisterLog, /-u /)
  } finally {
    await github.stop()
  }
})

test('web and tui coexist through one dispatching launcher', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'webmark'),
      await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'tuimark'),
    ])
    const { home, env } = await makeSandbox(github)
    const bin = join(home, 'bin')

    assert.equal((await runInstaller(['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--bin-dir', bin], env)).status, 0)
    assert.equal((await runInstaller(['--surface', 'tui', '--os', 'linux', '--arch', 'x64', '--bin-dir', bin], env)).status, 0)

    const webRun = runLauncher(join(bin, 'ohdsh'), ['web'], env)
    assert.equal(webRun.status, 0, webRun.stderr)
    assert.match(webRun.stdout, /webmark/)
    const tuiRun = runLauncher(join(bin, 'ohdsh'), ['tui'], env)
    assert.equal(tuiRun.status, 0, tuiRun.stderr)
    assert.match(tuiRun.stdout, /tuimark/)

    // Uninstalling tui must keep the shared launcher serving web.
    const uninstall = await runInstaller(['--uninstall', '--surface', 'tui', '--bin-dir', bin], env)
    assert.equal(uninstall.status, 0, uninstall.stderr)
    const tuiGone = runLauncher(join(bin, 'ohdsh'), ['tui'], env)
    assert.notEqual(tuiGone.status, 0)
    assert.match(tuiGone.stderr, /tui is not installed/)
    const webStill = runLauncher(join(bin, 'ohdsh'), ['web'], env)
    assert.equal(webStill.status, 0, webStill.stderr)
    assert.match(webStill.stdout, /webmark/)
  } finally {
    await github.stop()
  }
})

test('uninstall refuses destinations without a matching marker', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'keepme'),
    ])
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const args = ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin]
    assert.equal((await runInstaller(args, env)).status, 0)

    // A marker-less destination must never be recursively deleted.
    await rm(join(payload, '.oh-dsh-install.env'))
    const refused = await runInstaller(['--uninstall', ...args], env)
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /refusing to remove/)
    assert.ok(await exists(join(payload, 'bin', 'ohdsh')), 'the payload must survive the refusal')

    // A mismatched destination (the home directory itself) is refused too.
    await writeFile(join(home, 'sentinel.txt'), 'untouched')
    const homeRefused = await runInstaller(
      ['--uninstall', '--surface', 'web', '--dest', home, '--bin-dir', bin],
      env,
    )
    assert.notEqual(homeRefused.status, 0)
    assert.match(homeRefused.stderr, /refusing to remove/)
    assert.ok(await exists(join(home, 'sentinel.txt')), 'unrelated directories must survive')
  } finally {
    await github.stop()
  }
})

test('a corrupted marker is parsed as inert text, never executed', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'clean'),
    ])
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const args = ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin]
    assert.equal((await runInstaller(args, env)).status, 0)

    const pwned = join(home, 'pwned')
    await writeFile(join(payload, '.oh-dsh-install.env'), [
      'OH_DSH_INSTALL_SURFACE=web',
      `OH_DSH_INSTALL_VERSION=0.1.8; touch ${JSON.stringify(pwned)}`,
      `OH_DSH_INSTALL_ASSET=$(touch ${JSON.stringify(`${home}/pwned2`)})`,
    ].join('\n'))
    const rerun = await runInstaller(args, env)
    assert.equal(rerun.status, 0, rerun.stderr)
    assert.ok(!(await exists(pwned)), 'marker text must never execute')
    assert.ok(!(await exists(join(home, 'pwned2'))), 'marker text must never execute')
    const marker = await readFile(join(payload, '.oh-dsh-install.env'), 'utf8')
    assert.match(marker, /^OH_DSH_INSTALL_VERSION=0\.1\.8$/m)
  } finally {
    await github.stop()
  }
})

test('desktop idempotency is keyed by the requested destination', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeMacDesktopZip('0.1.8', 'arm64'),
    ])
    const { home, env } = await makeSandbox(github)
    const plutil = await makePlutilSpy(home)
    env.OH_DSH_PLUTIL = plutil.bin
    const appsA = join(home, 'ApplicationsA')
    const appsB = join(home, 'ApplicationsB')
    const first = await runInstaller(
      ['--surface', 'desktop', '--os', 'darwin', '--arch', 'arm64', '--dest', appsA],
      env,
    )
    assert.equal(first.status, 0, first.stderr)

    // The same release into a different destination must install, not skip.
    const second = await runInstaller(
      ['--surface', 'desktop', '--os', 'darwin', '--arch', 'arm64', '--dest', appsB],
      env,
    )
    assert.equal(second.status, 0, second.stderr)
    assert.doesNotMatch(second.stdout, /already installed/)
    assert.ok(await exists(join(appsB, 'Oh-DSH Desktop.app')))
    assert.equal(github.downloadCount('v0.1.8', 'Oh-DSH-Desktop-0.1.8-arm64.zip'), 2)
    const marker = await readFile(
      join(home, '.ohdsh', 'installer', 'desktop.env'),
      'utf8',
    )
    assert.match(marker, new RegExp(`^OH_DSH_INSTALL_DEST=${realpathSync(appsB).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))
  } finally {
    await github.stop()
  }
})

test('a missing launcher is repaired by an ordinary rerun', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'repaired'),
    ])
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const args = ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin]
    assert.equal((await runInstaller(args, env)).status, 0)

    await rm(join(bin, 'ohdsh'))
    const rerun = await runInstaller(args, env)
    assert.equal(rerun.status, 0, rerun.stderr)
    assert.doesNotMatch(rerun.stdout, /already installed/)
    assert.ok(await exists(join(bin, 'ohdsh')), 'the launcher must be recreated without --force')
    assert.equal(github.downloadCount('v0.1.8', 'oh-dsh-web-0.1.8-linux-x64.tar.gz'), 2)
  } finally {
    await github.stop()
  }
})

test('release parsing tolerates pretty-printed JSON responses', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  github.pretty = true
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'pretty'),
    ])
    const { home, env } = await makeSandbox(github)
    const result = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', join(home, 'payload'), '--bin-dir', join(home, 'bin')],
      env,
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Verified sha256:/)
    assert.match(await readFile(join(home, 'payload', 'bin', 'ohdsh'), 'utf8'), /pretty/)
  } finally {
    await github.stop()
  }
})

test('a marker-less non-empty destination is never replaced', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'fresh'),
    ])
    const { home, env } = await makeSandbox(github)
    const documents = join(home, 'Documents')
    await mkdir(documents, { recursive: true })
    await writeFile(join(documents, 'thesis.md'), 'irreplaceable')
    const result = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', documents, '--bin-dir', join(home, 'bin')],
      env,
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /refusing to replace/)
    assert.ok(await exists(join(documents, 'thesis.md')), 'unrelated data must survive')

    // An empty destination installs without complaint.
    const empty = join(home, 'empty-dest')
    await mkdir(empty, { recursive: true })
    const intoEmpty = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', empty, '--bin-dir', join(home, 'bin')],
      env,
    )
    assert.equal(intoEmpty.status, 0, intoEmpty.stderr)
  } finally {
    await github.stop()
  }
})

test('BIN_DIR survives while another surface remains installed', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'webmark'),
      await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'tuimark'),
    ])
    const { home, env } = await makeSandbox(github)
    const bin = join(home, 'bin')
    assert.equal((await runInstaller(['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--bin-dir', bin], env)).status, 0)
    assert.equal((await runInstaller(['--surface', 'tui', '--os', 'linux', '--arch', 'x64', '--bin-dir', bin], env)).status, 0)

    assert.equal((await runInstaller(['--uninstall', '--surface', 'web', '--bin-dir', bin], env)).status, 0)
    const record = await readFile(join(home, '.ohdsh', 'installer', 'launcher.env'), 'utf8')
    assert.match(record, /^TUI_DEST=/m)
    assert.match(record, /^BIN_DIR=/m, 'BIN_DIR must survive for the remaining surface')
    assert.match(record, /^TUI_REPO=hust-open-atom-club\/oh-dsh$/m)
  } finally {
    await github.stop()
  }
})

test('uninstall never deletes an unrelated launcher file', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'bye'),
    ])
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const args = ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin]
    assert.equal((await runInstaller(args, env)).status, 0)
    // Plant an unrelated launcher and uninstall: it must survive.
    await rm(join(bin, 'ohdsh'))
    await writeFile(join(bin, 'ohdsh'), '#!/bin/sh\necho still not ours\n')
    await chmod(join(bin, 'ohdsh'), 0o755)
    assert.equal((await runInstaller(['--uninstall', ...args], env)).status, 0)
    const survivor = await readFile(join(bin, 'ohdsh'), 'utf8')
    assert.match(survivor, /still not ours/)
  } finally {
    await github.stop()
  }
})

test('a destination owned by the other surface is never replaced', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'webmark'),
      await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'tuimark'),
    ])
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const args = ['--surface', 'tui', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin]
    assert.equal((await runInstaller(args, env)).status, 0)

    // Installing web INTO the tui payload's directory must be refused even
    // though a marker exists: it belongs to the other surface.
    const cross = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin],
      env,
    )
    assert.notEqual(cross.status, 0)
    assert.match(cross.stderr, /refusing to replace/)
    assert.match(await readFile(join(payload, 'bin', 'ohdsh'), 'utf8'), /tuimark/)
  } finally {
    await github.stop()
  }
})

test('the linux desktop refuses to replace an unowned executable', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    const image = Buffer.from('#!/bin/sh\necho foreign tool\n', 'utf8')
    github.publish('v0.1.8', [{ name: 'Oh-DSH-Desktop-0.1.8-x86_64.AppImage', bytes: image }])
    const { home, env } = await makeSandbox(github)
    const bin = join(home, 'bin')
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'oh-dsh-desktop'), 'unrelated tool\n')
    const result = await runInstaller(
      ['--surface', 'desktop', '--os', 'linux', '--arch', 'x64', '--dest', bin],
      env,
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /refusing to replace/)
    assert.equal(await readFile(join(bin, 'oh-dsh-desktop'), 'utf8'), 'unrelated tool\n')
  } finally {
    await github.stop()
  }
})

test('relocating a surface retires the previous installation', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'here'),
    ])
    const { home, env } = await makeSandbox(github)
    const bin = join(home, 'bin')
    const first = join(home, 'first')
    const second = join(home, 'second')
    const common = ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--bin-dir', bin]
    assert.equal((await runInstaller([...common, '--dest', first], env)).status, 0)
    assert.equal((await runInstaller([...common, '--dest', second], env)).status, 0)

    assert.ok(!(await exists(first)), 'the previous payload must be retired')
    assert.match(await readFile(join(second, 'bin', 'ohdsh'), 'utf8'), /here/)
    const record = await readFile(join(home, '.ohdsh', 'installer', 'launcher.env'), 'utf8')
    assert.match(record, new RegExp(`^WEB_DEST=${realpathSync(second).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))
  } finally {
    await github.stop()
  }
})

test('install refuses to overwrite an unowned launcher', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'here'),
    ])
    const { home, env } = await makeSandbox(github)
    const bin = join(home, 'bin')
    await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'ohdsh'), '#!/bin/sh\necho precious tool\n')
    await chmod(join(bin, 'ohdsh'), 0o755)
    const payload = join(home, 'payload')
    const result = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin],
      env,
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /refusing to replace .*not an Oh-DSH launcher/)
    assert.match(await readFile(join(bin, 'ohdsh'), 'utf8'), /precious tool/)
    assert.ok(!(await exists(payload)), 'a refused install must not stage a payload')
    assert.ok(
      !(await exists(join(home, '.ohdsh', 'installer', 'launcher.env'))),
      'a refused install must not write records',
    )
  } finally {
    await github.stop()
  }
})

test('desktop uninstall verifies the legacy bundle identity too', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [])
    const { home, env } = await makeSandbox(github)
    const plutil = await makePlutilSpy(home)
    env.OH_DSH_PLUTIL = plutil.bin
    const apps = join(home, 'Applications')
    const foreign = join(apps, 'Oh-DSH-Desktop.app')
    await makeFakePlist(foreign, 'someone.elses.app', '0.1.0')
    const result = await runInstaller(
      ['--uninstall', '--surface', 'desktop', '--os', 'darwin', '--arch', 'arm64', '--dest', apps],
      env,
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /refusing to replace/)
    assert.ok(await exists(foreign), 'the foreign legacy bundle must survive')
  } finally {
    await github.stop()
  }
})

test('relocating the linux desktop retires the previous AppImage', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    const image = Buffer.from('#!/bin/sh\necho linux-desktop\n', 'utf8')
    github.publish('v0.1.8', [{ name: 'Oh-DSH-Desktop-0.1.8-x86_64.AppImage', bytes: image }])
    const { home, env } = await makeSandbox(github)
    const binA = join(home, 'binA')
    const binB = join(home, 'binB')
    const args = ['--surface', 'desktop', '--os', 'linux', '--arch', 'x64']
    assert.equal((await runInstaller([...args, '--dest', binA], env)).status, 0)
    assert.equal((await runInstaller([...args, '--dest', binB], env)).status, 0)

    assert.ok(!(await exists(join(binA, 'oh-dsh-desktop'))), 'the previous AppImage must be retired')
    assert.ok(await exists(join(binB, 'oh-dsh-desktop')))
    const launched = runLauncher(join(home, '.local', 'bin', 'ohdsh'), ['desktop'], env)
    assert.equal(launched.status, 0, launched.stderr)
    assert.match(launched.stdout, /linux-desktop/)
    const marker = await readFile(join(home, '.ohdsh', 'installer', 'desktop.env'), 'utf8')
    assert.match(marker, new RegExp(`^OH_DSH_INSTALL_DEST=${realpathSync(binB).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))
  } finally {
    await github.stop()
  }
})

test('a foreign launcher symlink is not silently replaced', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'here'),
    ])
    const { home, env } = await makeSandbox(github)
    const bin = join(home, 'bin')
    const precious = join(home, 'precious-tool')
    await mkdir(bin, { recursive: true })
    await writeFile(precious, '#!/bin/sh\necho keep\n')
    await chmod(precious, 0o755)
    await symlink(precious, join(bin, 'ohdsh'))
    const result = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', join(home, 'payload'), '--bin-dir', bin],
      env,
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /refusing to replace/)
    assert.equal(await readlink(join(bin, 'ohdsh')), precious)
    assert.match(await readFile(precious, 'utf8'), /keep/)
  } finally {
    await github.stop()
  }
})

test('linux desktop stale-file cleanup respects destination ownership', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    const image = Buffer.from('appimage\n', 'utf8')
    github.publish('v0.1.8', [{ name: 'Oh-DSH-Desktop-0.1.8-x86_64.AppImage', bytes: image }])
    const { home, env } = await makeSandbox(github)
    const bin = join(home, 'bin')
    await mkdir(bin, { recursive: true })
    // A foreign file sharing our hidden staging prefix, with no marker
    // proving this destination is ours.
    const foreign = join(bin, '.oh-dsh-desktop.previous-notours')
    await writeFile(foreign, 'keep me')
    const result = await runInstaller(
      ['--surface', 'desktop', '--os', 'linux', '--arch', 'x64', '--dest', bin],
      env,
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(await readFile(foreign, 'utf8'), 'keep me')
  } finally {
    await github.stop()
  }
})

test('a mistyped uninstall destination keeps the real records', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'here'),
    ])
    const { home, env } = await makeSandbox(github)
    const bin = join(home, 'bin')
    assert.equal((await runInstaller(['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--bin-dir', bin], env)).status, 0)

    const typo = await runInstaller(
      ['--uninstall', '--surface', 'web', '--dest', join(home, 'wrong-dest'), '--bin-dir', bin],
      env,
    )
    assert.equal(typo.status, 0, typo.stderr)
    const record = await readFile(join(home, '.ohdsh', 'installer', 'launcher.env'), 'utf8')
    assert.match(record, /^WEB_DEST=/m, 'the real destination record must survive')
    assert.ok(await exists(join(home, '.local', 'share', 'oh-dsh', 'web')), 'the real payload must survive')
  } finally {
    await github.stop()
  }
})

test('a launcher symlink to an unrecorded payload is refused', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'here'),
    ])
    const { home, env } = await makeSandbox(github)
    const bin = join(home, 'bin')
    const foreignPayload = join(home, 'other', 'bin')
    await mkdir(foreignPayload, { recursive: true })
    await writeFile(join(foreignPayload, 'ohdsh'), '#!/bin/sh\n')
    await chmod(join(foreignPayload, 'ohdsh'), 0o755)
    await mkdir(bin, { recursive: true })
    await symlink(join(foreignPayload, 'ohdsh'), join(bin, 'ohdsh'))
    const result = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', join(home, 'payload'), '--bin-dir', bin],
      env,
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /not a recorded Oh-DSH payload launcher/)
    assert.equal(await readlink(join(bin, 'ohdsh')), join(foreignPayload, 'ohdsh'))
  } finally {
    await github.stop()
  }
})

test('relocating the bin directory retires the previous dispatcher', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'here'),
    ])
    const { home, env } = await makeSandbox(github)
    const binA = join(home, 'binA')
    const binB = join(home, 'binB')
    const common = ['--surface', 'web', '--os', 'linux', '--arch', 'x64']
    assert.equal((await runInstaller([...common, '--dest', join(home, 'payload'), '--bin-dir', binA], env)).status, 0)
    assert.equal((await runInstaller([...common, '--dest', join(home, 'payload'), '--bin-dir', binB], env)).status, 0)

    assert.ok(!(await exists(join(binA, 'ohdsh'))), 'the old dispatcher must be retired')
    assert.ok(await exists(join(binB, 'ohdsh')))
    const record = await readFile(join(home, '.ohdsh', 'installer', 'launcher.env'), 'utf8')
    assert.match(record, /^BIN_DIR=/m)
  } finally {
    await github.stop()
  }
})

test('desktop uninstalls keep the marker for other destinations', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    const image = Buffer.from('appimage\n', 'utf8')
    github.publish('v0.1.8', [{ name: 'Oh-DSH-Desktop-0.1.8-x86_64.AppImage', bytes: image }])
    const { home, env } = await makeSandbox(github)
    const binA = join(home, 'binA')
    const wrong = join(home, 'wrong-dest')
    assert.equal((await runInstaller(['--surface', 'desktop', '--os', 'linux', '--arch', 'x64', '--dest', binA], env)).status, 0)

    const typo = await runInstaller(
      ['--uninstall', '--surface', 'desktop', '--os', 'linux', '--arch', 'x64', '--dest', wrong],
      env,
    )
    assert.equal(typo.status, 0, typo.stderr)
    const marker = await readFile(join(home, '.ohdsh', 'installer', 'desktop.env'), 'utf8')
    assert.match(marker, /^OH_DSH_INSTALL_DEST=/m, 'the real marker must survive a mistyped uninstall')
    assert.ok(await exists(join(binA, 'oh-dsh-desktop')))
  } finally {
    await github.stop()
  }
})

test('downloads never carry the GitHub token to the download base', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'clean'),
    ])
    const { home, env } = await makeSandbox(github, { GH_TOKEN: 'ghp_super-secret' })
    const result = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', join(home, 'payload'), '--bin-dir', join(home, 'bin')],
      env,
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(github.downloadsWithAuthorization(), 0, 'the token must never reach the download base')
    assert.equal(
      github.authorizedApiRequestCount(),
      0,
      'the token must never reach a custom API base',
    )
  } finally {
    await github.stop()
  }
})

test('a corrupted mac app fails the same-version fast path', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeMacDesktopZip('0.1.8', 'arm64'),
    ])
    const { home, env } = await makeSandbox(github)
    const plutil = await makePlutilSpy(home)
    env.OH_DSH_PLUTIL = plutil.bin
    const apps = join(home, 'Applications')
    const args = ['--surface', 'desktop', '--os', 'darwin', '--arch', 'arm64', '--dest', apps]
    assert.equal((await runInstaller(args, env)).status, 0)

    await rm(join(apps, 'Oh-DSH Desktop.app', 'Contents', 'MacOS', 'Oh-DSH Desktop'))
    const repair = await runInstaller(args, env)
    assert.equal(repair.status, 0, repair.stderr)
    assert.doesNotMatch(repair.stdout, /already installed/)
    assert.ok(
      await exists(join(apps, 'Oh-DSH Desktop.app', 'Contents', 'MacOS', 'Oh-DSH Desktop')),
      'the executable must be restored',
    )
  } finally {
    await github.stop()
  }
})

test('OH_DSH_INSTALLER_HOME pins the posix record root', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'here'),
    ])
    const { home, env } = await makeSandbox(github)
    env.OH_DSH_INSTALLER_HOME = join(home, 'custom-records')
    const result = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', join(home, 'payload'), '--bin-dir', join(home, 'bin')],
      env,
    )
    assert.equal(result.status, 0, result.stderr)
    const record = await readFile(join(home, 'custom-records', 'launcher.env'), 'utf8')
    assert.match(record, /^WEB_DEST=/m)
    const dispatcher = await readFile(join(home, 'bin', 'ohdsh'), 'utf8')
    assert.match(dispatcher, new RegExp(join(home, 'custom-records', 'launcher.env').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  } finally {
    await github.stop()
  }
})

test('semver build metadata installs without stranding the payload', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v1.2.3+build.1', [
      await makeSurfaceArchive('web', '1.2.3+build.1', 'linux', 'x64', 'meta'),
    ])
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const result = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', join(home, 'bin')],
      env,
    )
    assert.equal(result.status, 0, result.stderr)
    const marker = await readFile(join(payload, '.oh-dsh-install.env'), 'utf8')
    assert.match(marker, /^OH_DSH_INSTALL_VERSION=1\.2\.3\+build\.1$/m)
    assert.match(marker, /^OH_DSH_INSTALL_ASSET=oh-dsh-web-1\.2\.3\+build\.1-linux-x64\.tar\.gz$/m)
  } finally {
    await github.stop()
  }
})

test('relative destinations are recorded as absolute paths', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'abs'),
    ])
    const { home, env } = await makeSandbox(github)
    const result = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', 'rel-payload', '--bin-dir', 'rel-bin'],
      { ...env, HOME: home },
      home,
    )
    assert.equal(result.status, 0, result.stderr)
    const record = await readFile(join(home, '.ohdsh', 'installer', 'launcher.env'), 'utf8')
    assert.match(record, /^WEB_DEST=\//m, 'records must carry absolute paths')
    assert.match(record, /^BIN_DIR=\//m)
    assert.ok(await exists(join(home, 'rel-payload', 'bin', 'ohdsh')), 'the relative dest resolves against the invocation directory')
  } finally {
    await github.stop()
  }
})

test('equivalent destination spellings do not count as relocation', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'same'),
    ])
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    assert.equal((await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', './payload', '--bin-dir', join(home, 'bin')],
      env, home,
    )).status, 0)
    // The absolute spelling of the same directory must be a no-op upgrade,
    // not a relocation that retires the payload.
    const rerun = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', join(home, 'bin')],
      env,
    )
    assert.equal(rerun.status, 0, rerun.stderr)
    assert.match(rerun.stdout, /already installed/)
    assert.match(await readFile(join(payload, 'bin', 'ohdsh'), 'utf8'), /same/)
  } finally {
    await github.stop()
  }
})

test('a failed record commit keeps the previous payload recoverable', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'old'),
    ])
    const newer = await makeSurfaceArchive('web', '0.1.9', 'linux', 'x64', 'new')
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const args = ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', join(home, 'bin')]
    assert.equal((await runInstaller(args, env)).status, 0)

    // Block the record root with a regular file so the upgrade dies after
    // the payload swap but before any deletion.
    await writeFile(join(home, '.ohdsh', 'installer', 'blocked'), '')
    github.publish('v0.1.9', [newer])
    github.setLatest('v0.1.9')
    // Re-point the record root at the blocked path via the env knob.
    const failing = await runInstaller(args, {
      ...env,
      OH_DSH_INSTALLER_HOME: join(home, '.ohdsh', 'installer', 'blocked'),
    })
    assert.notEqual(failing.status, 0)
    const entries = await readdir(home)
    const backup = entries.find(entry => entry.startsWith('payload.previous'))
    assert.ok(backup !== undefined, 'the previous payload must remain recoverable')
    assert.match(await readFile(join(home, backup, 'bin', 'ohdsh'), 'utf8'), /old|new/)
  } finally {
    await github.stop()
  }
})
