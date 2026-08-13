const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

const runtimeUrl = process.argv[2]
const timeoutMs = 20_000

if (runtimeUrl === undefined) throw new Error('runtime URL is required')
if (process.env.DSH_DESKTOP_SMOKE_USER_DATA !== undefined) {
  app.setPath('userData', process.env.DSH_DESKTOP_SMOKE_USER_DATA)
}

app.disableHardwareAcceleration()
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox')
// Keep requestAnimationFrame ticking in the hidden smoke window: the plugin
// marketplace places its sidebar nav entry from a rAF callback, and hidden
// renderers are backgrounded by default (no frames, no placement).
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

function finish(window, error) {
  if (error === undefined) {
    process.stdout.write('DSH Chromium client graph: ready\n')
  } else {
    process.stderr.write(`${error.stack ?? error.message}\n`)
  }
  window.destroy()
  app.exit(error === undefined ? 0 : 1)
}

void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    height: 800,
    // The plugin marketplace places its nav entry from a requestAnimationFrame
    // callback; never-shown windows receive no frames, so the smoke window is
    // visible (rc.5 behavior).
    show: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'smoke-client-preload.cjs'),
      sandbox: false,
    },
    width: 1280,
  })
  const startedAt = Date.now()
  let settled = false

  const settle = error => {
    if (settled) return
    settled = true
    finish(window, error)
  }

  window.webContents.on('render-process-gone', (_event, details) => {
    settle(new Error(`Chromium renderer exited: ${details.reason}`))
  })
  window.webContents.on('did-fail-load', (_event, code, description) => {
    settle(new Error(`Chromium failed to load DSH (${code}): ${description}`))
  })

  await window.loadURL(runtimeUrl)
  const poll = async () => {
    if (settled) return
    try {
      const state = await window.webContents.executeJavaScript(`(() => {
        // rc.5+ gates first launch behind onboarding dialogs (welcome notice,
        // then API-key setup). Dismiss both so the shell navigation is visible.
        const onboardingButton = [...document.querySelectorAll('button')]
          .find(button => /^(继续|continue|start using|开始使用|稍后配置|configure later|skip|later)$/i.test((button.textContent ?? '').trim()))
        if (onboardingButton !== undefined) onboardingButton.click()
        return {
        body: document.body?.innerText ?? '',
        navigation: (() => {
          const pluginsIcon = document.querySelector('.oh-marketplace-nav svg')
          const slotted = [...document.querySelectorAll('button')]
            .find(button => button.querySelector('[data-slot="settings.trigger"]') !== null
              && button.closest('[data-slot="sidebar"]') !== null)
          const labeled = [...document.querySelectorAll('button')]
            .filter(button => /settings|设置/i.test([
              button.textContent,
              button.getAttribute('aria-label'),
              button.getAttribute('title'),
            ].filter(Boolean).join(' ')))
          const settings = slotted
            ?? (labeled.length > 0
              ? labeled[labeled.length - 1]
              : [...document.querySelectorAll('button[aria-haspopup="dialog"]')]
                .filter(button => button.closest('[data-slot="sidebar"]') !== null)
                .sort((left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom)[0])
          const settingsIcon = settings?.querySelector('svg')
          if (!(pluginsIcon instanceof SVGElement)
            || !(settingsIcon instanceof SVGElement)) return null
          const pluginsRect = pluginsIcon.getBoundingClientRect()
          const settingsRect = settingsIcon.getBoundingClientRect()
          const pluginsBox = pluginsIcon.getBBox()
          const settingsBox = settingsIcon.getBBox()
          const pluginsView = pluginsIcon.viewBox.baseVal
          const settingsView = settingsIcon.viewBox.baseVal
          const pluginsArtwork = {
            height: pluginsBox.height / pluginsView.height * pluginsRect.height,
            width: pluginsBox.width / pluginsView.width * pluginsRect.width,
          }
          const settingsArtwork = {
            height: settingsBox.height / settingsView.height * settingsRect.height,
            width: settingsBox.width / settingsView.width * settingsRect.width,
          }
          return {
            artworkDelta: Math.max(
              Math.abs(pluginsArtwork.height - settingsArtwork.height),
              Math.abs(pluginsArtwork.width - settingsArtwork.width),
            ),
            delta: Math.abs(
              pluginsRect.left + pluginsRect.width / 2
              - settingsRect.left - settingsRect.width / 2
            ),
            pluginsArtwork,
            pluginsCenter: pluginsRect.left + pluginsRect.width / 2,
            settingsArtwork,
            settingsCenter: settingsRect.left + settingsRect.width / 2,
          }
        })(),
        ready: document.documentElement.dataset.ohDshDesktop === 'true',
      }
    })()`)
      if (state.ready === true && state.navigation !== null) {
        if (state.navigation.delta > 0.5) {
          settle(new Error(
            'Plugins and Settings icons are not aligned: '
            + JSON.stringify(state.navigation),
          ))
          return
        }
        if (state.navigation.artworkDelta > 1) {
          settle(new Error(
            'Plugins and Settings icons are not optically sized: '
            + JSON.stringify(state.navigation),
          ))
          return
        }
        settle()
        return
      }
      if (state.body.includes('Failed to load plugins')) {
        settle(new Error(state.body.trim()))
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        settle(new Error(`DSH Chromium client graph timed out:\n${state.body.trim()}`))
        return
      }
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)))
      return
    }
    setTimeout(() => { void poll() }, 100)
  }
  await poll()
}).catch(error => {
  process.stderr.write(`${error.stack ?? String(error)}\n`)
  app.exit(1)
})
