const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

const runtimeUrl = process.env.DSH_SMOKE_RUNTIME_URL ?? process.argv[2]
const smokeSurface = process.env.DSH_SMOKE_SURFACE ?? 'desktop'
const webSmoke = smokeSurface === 'web'
const timeoutMs = 20_000

if (runtimeUrl === undefined) throw new Error('runtime URL is required')

app.disableHardwareAcceleration()
// Keep requestAnimationFrame ticking in the hidden smoke window: the plugin
// marketplace places its sidebar nav entry from a rAF callback, and hidden
// renderers are backgrounded by default (no frames, no placement).
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

function finish(window, error) {
  if (error === undefined) {
    process.stdout.write(`DSH ${smokeSurface} client graph and native image attachment: ready\n`)
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
  let navigationReadyAt = null
  let settled = false

  const settle = error => {
    if (settled) return
    settled = true
    finish(window, error)
  }

  window.webContents.on('render-process-gone', (_event, details) => {
    settle(new Error(`Chromium renderer exited: ${details.reason}`))
  })
  window.webContents.on('did-fail-load', (_event, code, description, validatedUrl, isMainFrame) => {
    if (isMainFrame === false) return
    if (code === -3) return
    settle(new Error(`Chromium failed to load DSH (${code}): ${description} (${validatedUrl})`))
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
        const marketplaceButton = document.querySelector('.oh-marketplace-nav')
        const collapsed = marketplaceButton?.dataset.collapsed === 'true'
        if (document.documentElement.dataset.ohDshDesktop === 'true'
          && marketplaceButton instanceof HTMLButtonElement
          && !collapsed
          && window.__OH_DSH_SMOKE_COLLAPSE_REQUESTED__ !== true) {
          const toggle = [...document.querySelectorAll('button')]
            .find(button => /^(collapse sidebar|收起侧边栏)$/i.test(
              button.getAttribute('aria-label') ?? '',
            ))
          if (toggle instanceof HTMLButtonElement) {
            window.__OH_DSH_SMOKE_COLLAPSE_REQUESTED__ = true
            toggle.click()
          }
        }
        return {
        body: document.body?.innerText ?? '',
        vision: (() => {
          const image = [...document.querySelectorAll('[data-composer-card] img')]
            .find(candidate => candidate instanceof HTMLImageElement
              && candidate.getClientRects().length > 0)
          const card = document.querySelector('[data-composer-card]')
          if (image instanceof HTMLImageElement
            && card instanceof HTMLElement
            && image.complete
            && image.naturalWidth > 0) {
            const thumbnail = image.closest('button')
            const thumbnailRect = (thumbnail ?? image).getBoundingClientRect()
            const cardRect = card.getBoundingClientRect()
            const removeButtons = [...card.querySelectorAll('button')]
              .filter(button => /remove|移除|删除/i.test([
                button.getAttribute('aria-label'),
                button.getAttribute('title'),
              ].filter(Boolean).join(' ')))
            const remove = removeButtons.find(button => !button.disabled)
            window.__OH_DSH_SMOKE_VISION_FACTS__ = {
              bubbleBottom: thumbnailRect.bottom,
              cardTop: cardRect.top,
              imageWidth: image.naturalWidth,
              removeLabel: remove?.getAttribute('aria-label') ?? null,
              removeDisabled: remove?.disabled ?? null,
              status: 'ready',
            }
            window.__OH_DSH_SMOKE_VISION_SEEN__ = true
            if (window.__OH_DSH_SMOKE_VISION_REMOVE_REQUESTED__ !== true) {
              if (remove instanceof HTMLButtonElement) {
                window.__OH_DSH_SMOKE_VISION_REMOVE_REQUESTED__ = true
                remove.focus()
                remove.dispatchEvent(new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                }))
                remove.click()
              }
            }
          }
          if (window.__OH_DSH_SMOKE_VISION_REQUESTED__ !== true) {
            const textarea = [...document.querySelectorAll(
              '[data-composer-card] textarea:not(:disabled):not([readonly])',
            )].find(element => element instanceof HTMLTextAreaElement
              && element.getClientRects().length > 0)
            if (textarea instanceof HTMLTextAreaElement) {
              const encoded = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
              const binary = atob(encoded)
              const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
              const transfer = new DataTransfer()
              transfer.items.add(new File([bytes], 'vision-smoke.png', { type: 'image/png' }))
              const paste = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: transfer,
              })
              window.__OH_DSH_SMOKE_VISION_REQUESTED__ = true
              textarea.dispatchEvent(paste)
            } else {
              const workspaceTrigger = [...document.querySelectorAll(
                '[data-composer-card] textarea[aria-label="Choose workspace"], '
                + '[data-composer-card] textarea[aria-label="选择工作区"]',
              )].find(element => element instanceof HTMLTextAreaElement
                && element.getClientRects().length > 0)
              if (workspaceTrigger instanceof HTMLTextAreaElement
                && workspaceTrigger.getAttribute('aria-expanded') !== 'true'
                && Date.now() - (window.__OH_DSH_SMOKE_WORKSPACE_REQUESTED_AT__ ?? 0) > 500) {
                window.__OH_DSH_SMOKE_WORKSPACE_REQUESTED_AT__ = Date.now()
                const count = (window.__OH_DSH_SMOKE_WORKSPACE_REQUEST_COUNT__ ?? 0) + 1
                window.__OH_DSH_SMOKE_WORKSPACE_REQUEST_COUNT__ = count
                // rc.7 binds the hero picker open on the trigger textarea itself
                // (a card-level click no longer lands) and the untrusted click
                // lands only intermittently, so alternate between the card and
                // the textarea and keep trying until aria-expanded flips
                // instead of toggling an open picker shut on the next poll.
                const target = count % 2 === 1
                  ? (workspaceTrigger.closest('[data-composer-card]') ?? workspaceTrigger)
                  : workspaceTrigger
                target.dispatchEvent(new PointerEvent('pointerdown', {
                  bubbles: true,
                  cancelable: true,
                }))
                target.dispatchEvent(new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                }))
              }
              const directoryDialog = [...document.querySelectorAll('[role="dialog"]')]
                .find(dialog => /^(Select Workspace Directory|选择工作区目录)$/i.test(
                  dialog.querySelector('h2')?.textContent?.trim() ?? '',
                ))
              const openWorkspace = [...(directoryDialog?.querySelectorAll('button') ?? [])]
                .find(button => /^(Open|打开)$/i.test((button.textContent ?? '').trim())
                  && !button.disabled)
              if (openWorkspace instanceof HTMLButtonElement
                && Date.now() - (window.__OH_DSH_SMOKE_WORKSPACE_OPENED_AT__ ?? 0) > 500) {
                window.__OH_DSH_SMOKE_WORKSPACE_OPENED_AT__ = Date.now()
                window.__OH_DSH_SMOKE_WORKSPACE_OPEN_COUNT__ =
                  (window.__OH_DSH_SMOKE_WORKSPACE_OPEN_COUNT__ ?? 0) + 1
                openWorkspace.click()
              }
            }
          }
          const current = [...document.querySelectorAll('[data-composer-card] img')]
            .find(candidate => candidate instanceof HTMLImageElement
              && candidate.getClientRects().length > 0)
          return {
            error: null,
            facts: window.__OH_DSH_SMOKE_VISION_FACTS__ ?? null,
            removeAvailable: window.__OH_DSH_SMOKE_VISION_FACTS__?.removeLabel !== null
              && window.__OH_DSH_SMOKE_VISION_FACTS__?.removeDisabled === false,
            removed: window.__OH_DSH_SMOKE_VISION_REMOVE_REQUESTED__ === true
              && current === null,
            requested: window.__OH_DSH_SMOKE_VISION_REQUESTED__ === true,
            seen: window.__OH_DSH_SMOKE_VISION_SEEN__ === true,
            workspaceOpenCount: window.__OH_DSH_SMOKE_WORKSPACE_OPEN_COUNT__ ?? 0,
            workspaceRequestCount: window.__OH_DSH_SMOKE_WORKSPACE_REQUEST_COUNT__ ?? 0,
          }
        })(),
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
          const pluginsButton = pluginsIcon?.closest('button')
          if (!(pluginsIcon instanceof SVGElement)
            || !(settingsIcon instanceof SVGElement)
            || !(pluginsButton instanceof HTMLButtonElement)
            || !(settings instanceof HTMLButtonElement)) return null
          if (collapsed) {
            let footer = pluginsButton.parentElement
            while (footer !== null && !footer.contains(settings)) {
              footer = footer.parentElement
            }
            // Replay hosts that lay out both collapsed footer actions in a row.
            // The marketplace contract must keep the icon rail vertical.
            footer?.style.setProperty('flex-direction', 'row')
          }
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
            collapsed,
            delta: Math.abs(
              pluginsRect.left + pluginsRect.width / 2
              - settingsRect.left - settingsRect.width / 2
            ),
            pluginsArtwork,
            pluginsBottom: pluginsRect.bottom,
            pluginsCenter: pluginsRect.left + pluginsRect.width / 2,
            pluginsTop: pluginsRect.top,
            settingsArtwork,
            settingsBottom: settingsRect.bottom,
            settingsCenter: settingsRect.left + settingsRect.width / 2,
            settingsTop: settingsRect.top,
            viewportHeight: window.innerHeight,
          }
        })(),
        ready: document.documentElement.dataset.ohDshDesktop === 'true',
        webReady: document.title === 'Oh-DSH Web',
      }
    })()`)
      if (state.ready === true
        && state.navigation !== null
        && state.navigation.collapsed === false
        && state.navigation.artworkDelta > 1) {
        settle(new Error(
          'Plugins and Settings icons are not optically sized: '
          + JSON.stringify(state.navigation),
        ))
        return
      }
      if (state.vision.error !== null) {
        settle(new Error(`Pasted image thumbnail failed: ${state.vision.error}`))
        return
      }
      // DSH owns the native AttachmentRail layout. Keep this smoke check
      // agnostic to whether a surface places the rail inside the composer
      // card or as a floating bubble; only visibility and removal are ours.
      if (webSmoke
        && state.webReady === true
        && state.vision.seen === true
        && state.vision.removeAvailable === true) {
        settle()
        return
      }
      if (state.ready === true
        && state.navigation !== null
        && state.navigation.collapsed === true
        && state.vision.seen === true
        && state.vision.removeAvailable === true) {
        if (state.navigation.pluginsTop < 0
          || state.navigation.pluginsBottom > state.navigation.viewportHeight
          || state.navigation.settingsTop < 0
          || state.navigation.settingsBottom > state.navigation.viewportHeight) {
          settle(new Error(
            'Plugins and Settings navigation is outside the viewport: '
            + JSON.stringify(state.navigation),
          ))
          return
        }
        if (state.navigation.delta > 0.5) {
          settle(new Error(
            'Plugins and Settings icons are not aligned: '
            + JSON.stringify(state.navigation),
          ))
          return
        }
        if (state.navigation.settingsTop < state.navigation.pluginsBottom) {
          settle(new Error(
            'Plugins and Settings icons are not stacked vertically: '
            + JSON.stringify(state.navigation),
          ))
          return
        }
        navigationReadyAt ??= Date.now()
        if (Date.now() - navigationReadyAt >= 750) {
          settle()
          return
        }
      }
      if (state.body.includes('Failed to load plugins')) {
        settle(new Error(state.body.trim()))
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        settle(new Error(
          `DSH Chromium client graph timed out:\n${state.body.trim()}\n`
          + `Vision: ${JSON.stringify(state.vision)}`,
        ))
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
