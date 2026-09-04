import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { UpdateInfo } from 'electron-updater'
import {
  DesktopUpdateManager,
  officialReleaseUrl,
  selectUpdateFile,
} from '../src/update-manager.ts'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  disableDifferentialDownload = false
  result: { isUpdateAvailable: boolean; updateInfo: UpdateInfo } | null = null
  downloadResult = ['/tmp/Oh-DSH-Desktop-update.zip']
  quitCalls = 0
  installError: Error | undefined
  feedURLs: unknown[] = []
  setFeedURL(options: unknown) {
    this.feedURLs.push(options)
  }
  async checkForUpdates() {
    this.emit('checking-for-update')
    if (this.result?.isUpdateAvailable) this.emit('update-available', this.result.updateInfo)
    else if (this.result !== null) this.emit('update-not-available', this.result.updateInfo)
    return this.result
  }
  async downloadUpdate() {
    this.emit('download-progress', { percent: 50, transferred: 50, total: 100, bytesPerSecond: 10 })
    this.emit('update-downloaded', { downloadedFile: this.downloadResult[0], version: this.result?.updateInfo.version })
    return this.downloadResult
  }
  quitAndInstall() {
    this.quitCalls += 1
    if (this.installError !== undefined) this.emit('error', this.installError)
  }
}

function updateInfo(version: string, file = 'Oh-DSH-Desktop-1.2.0-arm64.zip'): UpdateInfo {
  return {
    version,
    files: [{ url: `https://github.com/hust-open-atom-club/oh-dsh/releases/download/v${version}/${file}`, sha512: 'hash', size: 100 }],
    path: file,
    sha512: 'hash',
    releaseDate: '2026-08-15T00:00:00Z',
    releaseName: `v${version}`,
    releaseNotes: 'Fixes and improvements',
  }
}

test('selectUpdateFile chooses exactly the current architecture asset', () => {
  const info = updateInfo('1.2.0')
  info.files.push({ url: 'https://example.invalid/Oh-DSH-Desktop-1.2.0-x64.zip', sha512: 'hash', size: 100 })
  assert.equal(selectUpdateFile(info, 'mac', 'arm64').url.endsWith('arm64.zip'), true)
  assert.throws(() => selectUpdateFile(info, 'mac', 'ia32'), /no installable update asset/)
})

test('official release URLs are fixed to the trusted repository', () => {
  assert.equal(officialReleaseUrl('1.2.3'), 'https://github.com/hust-open-atom-club/oh-dsh/releases/tag/v1.2.3')
  assert.throws(() => officialReleaseUrl('../evil'), /invalid release version/)
})

test('manager reports available, progress, and downloaded states', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  const states: string[] = []
  manager.subscribe(state => { states.push(state.status) })
  assert.equal((await manager.check()).status, 'available')
  assert.equal((await manager.download()).status, 'downloaded')
  assert.deepEqual(states, ['idle', 'checking', 'available', 'downloading', 'downloaded'])
  assert.equal((await manager.command({ type: 'install-now' })).status, 'scheduled')
  assert.equal(updater.quitCalls, 1)
})

test('manager rejects prereleases and downgrades', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0-beta.1') }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  assert.equal((await manager.check()).status, 'not-available')
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.0.0') }
  assert.equal((await manager.check()).status, 'not-available')
})

test('manager offers the official Release page when the platform asset is missing', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0', 'Oh-DSH-Desktop-1.2.0-x64.zip') }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  const state = await manager.check()
  assert.equal(state.status, 'unsupported')
  if (state.status === 'unsupported') {
    assert.equal(state.releaseUrl, 'https://github.com/hust-open-atom-club/oh-dsh/releases/tag/v1.2.0')
  }
})

test('manager provides a deb installer fallback without invoking updater install', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0', 'Oh-DSH-Desktop-1.2.0-amd64.deb') }
  const opened: string[] = []
  const manager = new DesktopUpdateManager({
    currentVersion: '1.1.0',
    platform: 'linux',
    packageType: 'deb',
    arch: 'x64',
    updater,
    onOpenInstaller: path => { opened.push(path) },
  })
  await manager.check()
  await manager.download()
  assert.equal('installerPath' in manager.getState(), false)
  assert.equal((await manager.command({ type: 'install-now' })).status, 'scheduled')
  assert.deepEqual(opened, ['/tmp/Oh-DSH-Desktop-update.zip'])
  assert.equal(updater.quitCalls, 0)
  assert.deepEqual(await manager.command({ type: 'install-on-quit' }), manager.getState())
})

test('manager records an explicit install-on-quit request', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  await manager.check()
  await manager.download()
  assert.equal(manager.shouldInstallOnQuit(), false)
  assert.equal((await manager.command({ type: 'install-on-quit' })).status, 'scheduled')
  assert.equal(manager.shouldInstallOnQuit(), true)
  assert.equal(updater.autoInstallOnAppQuit, true)
})

test('manager clears install-on-quit request before attempting immediate install', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  await manager.check()
  await manager.download()
  await manager.command({ type: 'install-on-quit' })
  assert.equal(manager.shouldInstallOnQuit(), true)
  assert.equal((await manager.command({ type: 'install-now' })).status, 'scheduled')
  assert.equal(manager.shouldInstallOnQuit(), false)
})

test('manager preserves a synchronous updater install error for recovery', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  updater.installError = Object.assign(new Error('installer missing'), { code: 'UPDATE_INSTALLER_MISSING' })
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  await manager.check()
  await manager.download()
  const state = await manager.command({ type: 'install-now' })
  assert.equal(state.status, 'error')
  if (state.status === 'error') assert.equal(state.code, 'UPDATE_INSTALLER_MISSING')
})

test('manager exposes actionable retryable errors', async () => {
  const updater = new FakeUpdater()
  updater.result = null
  updater.checkForUpdates = async () => { throw Object.assign(new Error('404 Not Found'), { code: 'HTTP_404' }) }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  const state = await manager.check()
  assert.equal(state.status, 'error')
  if (state.status === 'error') {
    assert.equal(state.stage, 'check')
    assert.equal(state.retryable, true)
    assert.match(state.message, /404/)
  }
})

test('manager turns proxy authentication into a redacted actionable error', () => {
  const updater = new FakeUpdater()
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })
  updater.emit('login', {}, () => {})
  const state = manager.getState()
  assert.equal(state.status, 'error')
  if (state.status === 'error') {
    assert.equal(state.code, 'PROXY_AUTH_REQUIRED')
    assert.equal(state.retryable, true)
    assert.doesNotMatch(state.message, /password|token/i)
  }
})

test('manager explains Chromium proxy connection failures and offers a manual fallback', async () => {
  const updater = new FakeUpdater()
  const opened: string[] = []
  updater.checkForUpdates = async () => { throw new Error('net::ERR_PROXY_CONNECTION_FAILED') }
  const manager = new DesktopUpdateManager({
    currentVersion: '1.1.0',
    platform: 'darwin',
    arch: 'arm64',
    updater,
    onOpenRelease: url => { opened.push(url) },
  })

  const state = await manager.check()
  assert.equal(state.status, 'error')
  if (state.status === 'error') {
    assert.equal(state.code, 'ERR_PROXY_CONNECTION_FAILED')
    assert.equal(state.message, 'Could not connect to the configured proxy. Check your system proxy settings, then try again.')
    assert.equal(state.retryable, true)
    assert.equal(state.releaseUrl, 'https://github.com/hust-open-atom-club/oh-dsh/releases')
  }

  await manager.openRelease()
  assert.deepEqual(opened, ['https://github.com/hust-open-atom-club/oh-dsh/releases'])
})

test('manager retries a check once without the configured proxy', async () => {
  const updater = new FakeUpdater()
  const attempts: number[] = []
  let calls = 0
  updater.checkForUpdates = async () => {
    calls += 1
    attempts.push(calls)
    if (calls === 1) {
      const error = new Error('net::ERR_PROXY_CONNECTION_FAILED')
      updater.emit('error', error)
      throw error
    }
    updater.emit('checking-for-update')
    updater.emit('update-available', updateInfo('1.2.0'))
    return { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  }
  let bypassCalls = 0
  const manager = new DesktopUpdateManager({
    currentVersion: '1.1.0',
    platform: 'darwin',
    arch: 'arm64',
    updater,
    bypassProxy: async () => { bypassCalls += 1 },
  })
  const states: string[] = []
  manager.subscribe(state => { states.push(state.status) })

  const state = await manager.check()
  assert.equal(state.status, 'available')
  assert.deepEqual(attempts, [1, 2])
  assert.equal(bypassCalls, 1)
  assert.deepEqual(states, ['idle', 'checking', 'available'])
})

test('manager retries a download once without the configured proxy', async () => {
  const updater = new FakeUpdater()
  updater.result = { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  let bypassCalls = 0
  const manager = new DesktopUpdateManager({
    currentVersion: '1.1.0',
    platform: 'darwin',
    arch: 'arm64',
    updater,
    bypassProxy: async () => { bypassCalls += 1 },
  })
  await manager.check()
  let calls = 0
  updater.downloadUpdate = async () => {
    calls += 1
    if (calls === 1) {
      const error = new Error('net::ERR_TUNNEL_CONNECTION_FAILED')
      updater.emit('error', error)
      throw error
    }
    updater.emit('download-progress', { percent: 50, transferred: 50, total: 100, bytesPerSecond: 10 })
    updater.emit('update-downloaded', { downloadedFile: '/tmp/Oh-DSH-Desktop-update.zip' })
    return ['/tmp/Oh-DSH-Desktop-update.zip']
  }

  const state = await manager.download()
  assert.equal(state.status, 'downloaded')
  assert.equal(calls, 2)
  assert.equal(bypassCalls, 1)
  assert.equal(manager.getState().status, 'downloaded')
})

test('manager keeps the proxy bypassed for later operations', async () => {
  const updater = new FakeUpdater()
  let calls = 0
  updater.checkForUpdates = async () => {
    calls += 1
    if (calls === 1) throw new Error('net::ERR_PROXY_CONNECTION_FAILED')
    updater.emit('update-available', updateInfo('1.2.0'))
    return { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  }
  let bypassCalls = 0
  const manager = new DesktopUpdateManager({
    currentVersion: '1.1.0',
    platform: 'darwin',
    arch: 'arm64',
    updater,
    bypassProxy: async () => { bypassCalls += 1 },
  })

  assert.equal((await manager.check()).status, 'available')
  updater.checkForUpdates = async () => { throw new Error('net::ERR_PROXY_CONNECTION_FAILED') }
  const state = await manager.check()
  assert.equal(state.status, 'error')
  if (state.status === 'error') assert.equal(state.code, 'ERR_PROXY_CONNECTION_FAILED')
  assert.equal(bypassCalls, 1)
})

test('manager does not bypass the proxy for unrelated failures', async () => {
  const updater = new FakeUpdater()
  updater.checkForUpdates = async () => { throw Object.assign(new Error('404 Not Found'), { code: 'HTTP_404' }) }
  let bypassCalls = 0
  const manager = new DesktopUpdateManager({
    currentVersion: '1.1.0',
    platform: 'darwin',
    arch: 'arm64',
    updater,
    bypassProxy: async () => { bypassCalls += 1 },
  })

  const state = await manager.check()
  assert.equal(state.status, 'error')
  assert.equal(bypassCalls, 0)
})

test('manager retries Node-style network failures on the mirror once per cycle', async () => {
  const updater = new FakeUpdater()
  let calls = 0
  updater.checkForUpdates = async () => {
    calls += 1
    if (calls === 1) throw Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' })
    updater.emit('checking-for-update')
    updater.emit('update-available', updateInfo('1.2.0'))
    return { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })

  const state = await manager.check()
  assert.equal(state.status, 'available')
  assert.equal(calls, 2)
  assert.deepEqual(updater.feedURLs, [{
    provider: 'generic',
    url: 'https://gh-proxy.cn/https://github.com/hust-open-atom-club/oh-dsh/releases/latest/download/',
  }])
})

test('manager does not retry non-network failures on the mirror', async () => {
  const updater = new FakeUpdater()
  updater.checkForUpdates = async () => { throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }) }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })

  const state = await manager.check()
  assert.equal(state.status, 'error')
  if (state.status === 'error') assert.equal(state.code, 'ENOSPC')
  assert.deepEqual(updater.feedURLs, [])
})

test('mirror serves one update cycle, then the next check restores GitHub', async () => {
  const updater = new FakeUpdater()
  let calls = 0
  updater.checkForUpdates = async () => {
    calls += 1
    if (calls === 1) {
      const error = new Error('net::ERR_CONNECTION_TIMED_OUT')
      updater.emit('error', error)
      throw error
    }
    updater.emit('checking-for-update')
    updater.emit('update-available', updateInfo('1.2.0'))
    return { isUpdateAvailable: true, updateInfo: updateInfo('1.2.0') }
  }
  updater.downloadUpdate = async () => {
    // While the mirror is active the download must not reset the feed yet.
    assert.deepEqual(updater.feedURLs, [{
      provider: 'generic',
      url: 'https://gh-proxy.cn/https://github.com/hust-open-atom-club/oh-dsh/releases/latest/download/',
    }])
    updater.emit('download-progress', { percent: 50, transferred: 50, total: 100, bytesPerSecond: 10 })
    updater.emit('update-downloaded', { downloadedFile: '/tmp/Oh-DSH-Desktop-update.zip' })
    return ['/tmp/Oh-DSH-Desktop-update.zip']
  }
  const manager = new DesktopUpdateManager({ currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', updater })

  assert.equal((await manager.check()).status, 'available')
  assert.equal((await manager.download()).status, 'downloaded')
  assert.deepEqual(updater.feedURLs, [{
    provider: 'generic',
    url: 'https://gh-proxy.cn/https://github.com/hust-open-atom-club/oh-dsh/releases/latest/download/',
  }])

  assert.equal((await manager.check()).status, 'available')
  assert.deepEqual(updater.feedURLs, [
    {
      provider: 'generic',
      url: 'https://gh-proxy.cn/https://github.com/hust-open-atom-club/oh-dsh/releases/latest/download/',
    },
    { provider: 'github', owner: 'hust-open-atom-club', repo: 'oh-dsh' },
  ])
})
