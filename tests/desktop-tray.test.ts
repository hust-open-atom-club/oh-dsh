import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('desktop win32 closes to the system tray instead of quitting', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

  // The tray is a main-process-only affordance: the renderer keeps issuing
  // desktop:window-close and Electron owns the hide/quit decision.
  assert.match(main, /  Tray,\r?\n/)
  assert.match(main, /'desktop:window-close'/)

  // Closing the main window hides it only while the tray exists; preview
  // windows, a missing tray, and a quit already in progress pass through.
  assert.match(
    main,
    /window\.on\('close', \(event\) => \{[\s\S]*?options\.preview === true \|\| tray === undefined \|\| quitting \|\| quittingForUpdate[\s\S]*?event\.preventDefault\(\)[\s\S]*?window\.hide\(\)/,
  )

  // The first hide tells the user where the app went, once per session.
  assert.match(main, /if \(!trayHideNoticeShown\) \{[\s\S]*?trayHideNoticeShown = true[\s\S]*?displayBalloon\(/)

  // While the tray owns the hidden window, all-windows-closed no longer
  // quits; a quit in progress finishes without re-entering app.quit().
  assert.match(
    main,
    /app\.on\('window-all-closed', \(\) => \{[\s\S]*?process\.platform === 'win32' && tray !== undefined && !quitting[\s\S]*?return\r?\n[\s\S]*?if \(process\.platform !== 'darwin'\) app\.quit\(\)/,
  )

  // Quitting tears the tray down so no orphan icon survives the process.
  assert.match(main, /app\.on\('will-quit', \(\) => \{[\s\S]*?tray\?\.destroy\(\)/)

  // The tray only exists on win32, so macOS and Linux close behavior is
  // unchanged, and a failed icon load falls back to plain close-quits.
  assert.match(
    main,
    /function createTray\(\): Tray \| undefined \{[\s\S]*?process\.platform !== 'win32'[\s\S]*?return undefined[\s\S]*?const icon = trayIconImage\(\)[\s\S]*?if \(icon === undefined\) return undefined/,
  )
  assert.match(
    main,
    /function trayIconImage\(\): NativeImage \| undefined \{[\s\S]*?nativeImage\.createFromPath\(path\)[\s\S]*?image\.isEmpty\(\)/,
  )
})

test('desktop tray menu restores the window and stays bilingual', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

  // Tray click and the tray menu's first item both reveal the main window;
  // the dock/activate path shares the same reveal.
  assert.match(main, /function revealMainWindow\(\): void \{[\s\S]*?mainWindow\.show\(\)[\s\S]*?mainWindow\.focus\(\)/)
  assert.match(main, /trayInstance\.on\('click', \(\) => \{ revealMainWindow\(\) \}\)/)
  assert.match(
    main,
    /function buildTrayMenu\(\): Menu \{[\s\S]*?\{ label: text\.show, click: \(\) => \{ revealMainWindow\(\) \} \}[\s\S]*?\{ label: text\.quit, click: \(\) => \{ app\.quit\(\) \} \}/,
  )
  assert.match(main, /app\.on\('activate', \(\) => \{ revealMainWindow\(\) \}\)/)
  // A second launch re-focuses the hidden window instead of a new one.
  assert.match(
    main,
    /app\.on\('second-instance',[\s\S]*?mainWindow\.show\(\)[\s\S]*?mainWindow\.focus\(\)/,
  )

  // The tray follows the application menu locale, rebuilt on every rebuild.
  assert.match(main, /tray\?\.setContextMenu\(buildTrayMenu\(\)\)/)
  assert.match(main, /const text = labels\(menuLocale\)/)
  assert.match(main, /show: '显示主窗口'/)
  assert.match(main, /show: 'Show Main Window'/)
  assert.match(main, /trayNotice: 'Oh-DSH 仍在系统托盘中运行/)
  assert.match(main, /trayNotice: 'Oh-DSH keeps running in the system tray/)
  assert.match(main, /setToolTip\(PRODUCT_NAME\)/)

  // User-facing docs describe the behavior in both languages.
  const usage = readFileSync(new URL('../docs/usage.md', import.meta.url), 'utf8')
  const usageZh = readFileSync(new URL('../docs/usage.zh.md', import.meta.url), 'utf8')
  assert.match(usage, /Closing the window minimizes Oh-DSH Desktop to the system tray/)
  assert.match(usageZh, /关闭窗口会将 Oh-DSH Desktop 最小化到系统托盘/)
})
