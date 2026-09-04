/**
 * Shared positioning layer for Oh-DSH floating chrome.
 *
 * The layer spans exactly the app's content region: below the in-page
 * titlebar on framed desktop platforms (the desktop chrome publishes
 * `--oh-dsh-titlebar-height` there) and the full viewport elsewhere. Panels
 * mount inside it and anchor with plain absolute offsets, so a chrome
 * geometry change is absorbed by the layer alone — every consumer stays
 * relative, with no per-panel viewport coordinate math to drift out of date.
 *
 * Modal dialogs demote the whole layer below their backdrop (see the desktop
 * chrome stylesheet), matching the per-panel demotion the panels carried
 * before they shared the layer.
 */

const CHROME_LAYER_ID = 'oh-dsh-chrome-layer'

const CHROME_LAYER_CSS = `
#${CHROME_LAYER_ID} {
  position: fixed;
  inset: var(--oh-dsh-titlebar-height, 0px) 0 0 0;
  z-index: 8900;
  pointer-events: none;
}

#${CHROME_LAYER_ID} > * {
  pointer-events: auto;
}
`

let layer: HTMLElement | undefined
let style: HTMLStyleElement | undefined
let consumers = 0

/** Acquire the chrome layer, creating it on first use. */
export function acquireChromeLayer(): HTMLElement {
  if (layer?.isConnected !== true) {
    style = document.createElement('style')
    style.dataset.ohDshChromeLayer = 'true'
    style.textContent = CHROME_LAYER_CSS
    document.head.append(style)
    layer = document.createElement('div')
    layer.id = CHROME_LAYER_ID
    document.body.append(layer)
  }
  consumers += 1
  return layer
}

/** Release a previous acquisition; the layer removes itself once idle. */
export function releaseChromeLayer(): void {
  consumers = Math.max(0, consumers - 1)
  if (consumers > 0) return
  layer?.remove()
  layer = undefined
  style?.remove()
  style = undefined
}
