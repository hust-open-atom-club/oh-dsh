/** Browser-local PNG capture of one rendered assistant response. */

import { getFontEmbedCSS, toCanvas } from 'html-to-image'

const FLOW_ITEM_SELECTOR = '[data-chat-flow-kind]'
const ASSISTANT_STEP_KIND = 'assistant-step'
/** Sibling hops the strip row may sit above the response node. */
const MAX_SIBLING_HOPS = 10
/**
 * Tail headroom over the node box, as a fraction of its height. The
 * foreignObject re-layout inside html-to-image treats block margins
 * differently from the live flex layout, so a tall response renders a few
 * percent taller than its live box and a canvas sized to the box clips the
 * last lines. The canvas grows by this slack, the render is then measured,
 * and the export crops to the drawn content.
 */
const BOTTOM_SLACK_RATIO = 0.05
/** Tail headroom floor so short responses keep room for boundary drift. */
const MIN_BOTTOM_SLACK_PX = 128
/**
 * Background rows kept beyond the drawn content on each end, mirroring the
 * node's own padding. Clamped against degenerate computed styles.
 */
const CONTENT_PADDING_FLOOR_PX = 8
const CONTENT_PADDING_CEILING_PX = 48
/** Summed channel distance below which a pixel counts as background. */
const BACKGROUND_TOLERANCE = 24
/** Canvas rows read back per band when locating the drawn content bottom. */
const SCAN_BAND_ROWS = 1024
/**
 * How often the tail headroom may double when a render measures content all
 * the way down to the canvas floor — the signature that the drift ate the
 * slack and a plain crop would clip the tail.
 */
const MAX_SLACK_GROWTHS = 2

/** Build the download file name for one finalized assistant message. */
export function captureFileName(messageId: string): string {
  return `dsh-response-${messageId.replace(/[^a-zA-Z0-9._-]+/g, '-')}.png`
}

/**
 * Locate the rendered response node from the action strip. Each chat node
 * renders as a sibling flow item (`data-chat-flow-kind`) under the
 * conversation list, the strip renders inside the `turn-tail` one, so the
 * response is the nearest earlier `assistant-step` flow item and capturing it
 * structurally excludes the action row.
 */
export function findAssistantStep(anchor: Element): HTMLElement {
  const row = anchor.closest(FLOW_ITEM_SELECTOR)
  if (row === null) throw new Error('save-as-image: chat flow row not found')
  let sibling = row.previousElementSibling
  for (let hops = 0; sibling !== null && hops < MAX_SIBLING_HOPS; hops += 1) {
    if (sibling.getAttribute('data-chat-flow-kind') === ASSISTANT_STEP_KIND) {
      return sibling as HTMLElement
    }
    sibling = sibling.previousElementSibling
  }
  throw new Error('save-as-image: assistant response node not found')
}

/** Materialize a CSS color into RGBA for pixel comparison. */
function parseBackgroundColor(color: string | undefined): [number, number, number, number] {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('save-as-image: 2d context unavailable')
  context.clearRect(0, 0, 1, 1)
  if (color !== undefined) {
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
  }
  const { data } = context.getImageData(0, 0, 1, 1)
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0]
}

/**
 * Row index of the last drawn content row, scanning upward for pixels that
 * differ from the background. A transparent export (no skin color) counts
 * any opaque pixel as content. Pixels are read back band by band so a tall
 * render never materializes one full-image buffer. Returns the canvas
 * height when nothing is detected, keeping the full render.
 */
function measureContentBottom(
  canvas: HTMLCanvasElement,
  background: [number, number, number, number],
): number {
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('save-as-image: 2d context unavailable')
  let bandFloor = canvas.height
  while (bandFloor > 0) {
    const bandHeight = Math.min(SCAN_BAND_ROWS, bandFloor)
    const bandTop = bandFloor - bandHeight
    const { data, width } = context.getImageData(0, bandTop, canvas.width, bandHeight)
    const channel = (offset: number): number => data[offset] ?? 0
    for (let y = bandHeight - 1; y >= 0; y -= 1) {
      for (let x = 0; x < width; x += 2) {
        const index = (y * width + x) * 4
        const opaque = channel(index + 3) >= 128
        const differs = Math.abs(channel(index) - background[0])
          + Math.abs(channel(index + 1) - background[1])
          + Math.abs(channel(index + 2) - background[2]) > BACKGROUND_TOLERANCE
        if (opaque && (background[3] < 128 || differs)) return bandTop + y
      }
    }
    bandFloor = bandTop
  }
  return canvas.height
}

/**
 * The node's own padding, reused as the export's framing so the image
 * breathes exactly like the live widget.
 */
function nodeContentPadding(node: HTMLElement): number {
  const padding = Number.parseFloat(getComputedStyle(node).paddingBottom)
  const value = Number.isNaN(padding) ? 0 : padding
  return Math.min(Math.max(value, CONTENT_PADDING_FLOOR_PX), CONTENT_PADDING_CEILING_PX)
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => {
    canvas.toBlob(resolve, 'image/png')
  })
}

async function renderBlob(
  node: HTMLElement,
  pixelRatio: number,
  fontEmbedCSS: string | undefined,
  backgroundColor: string | undefined,
): Promise<Blob> {
  // html-to-image rasterizes through a foreignObject whose block-margin
  // handling differs from the live layout, so the drawn content can drift
  // out of the node's box by a few percent on tall responses — sizing the
  // canvas to the box alone clips the tail. Render with tail headroom,
  // measure where the content actually ends, and crop to it. Content
  // measuring all the way down to the canvas floor means the drift ate the
  // headroom, so it doubles and re-renders instead of silently cropping.
  const rect = node.getBoundingClientRect()
  const contentHeight = Math.ceil(rect.height)
  let bottomSlack = Math.max(
    MIN_BOTTOM_SLACK_PX,
    Math.ceil(contentHeight * BOTTOM_SLACK_RATIO),
  )
  const background = parseBackgroundColor(backgroundColor)
  for (let growth = 0; ; growth += 1) {
    const options = {
      pixelRatio,
      width: Math.ceil(rect.width),
      height: contentHeight + bottomSlack,
      ...(fontEmbedCSS === undefined ? { skipFonts: true } : { fontEmbedCSS }),
      ...(backgroundColor === undefined ? {} : { backgroundColor }),
    }
    const rendered = await toCanvas(node, options)
    // The library's dimension guard may scale an oversized canvas down; every
    // css-space offset follows the canvas' real scale, not the requested ratio.
    const scale = rendered.height / (contentHeight + bottomSlack)
    const padding = Math.round(nodeContentPadding(node) * scale)
    const contentBottom = measureContentBottom(rendered, background)
    if (contentBottom < rendered.height - 2 || growth >= MAX_SLACK_GROWTHS) {
      return frameRender(rendered, contentBottom, padding, backgroundColor)
    }
    bottomSlack *= 2
  }
}

/**
 * Crop the render to the measured content plus the node's own padding, and
 * widen it by one padding on each side — the node box hugs the text, and the
 * frame lets the image breathe like the live widget. The frame uses the same
 * skin background; a transparent export stays transparent there.
 */
function frameRender(
  rendered: HTMLCanvasElement,
  contentBottom: number,
  padding: number,
  backgroundColor: string | undefined,
): Promise<Blob> {
  const cropBottom = Math.min(rendered.height, contentBottom + 1 + padding)
  const cropped = document.createElement('canvas')
  cropped.width = rendered.width + padding * 2
  cropped.height = cropBottom
  const context = cropped.getContext('2d')
  if (context === null) throw new Error('save-as-image: 2d context unavailable')
  if (backgroundColor !== undefined) {
    context.fillStyle = backgroundColor
    context.fillRect(0, 0, cropped.width, cropped.height)
  }
  context.drawImage(rendered, padding, 0)
  return canvasToPng(cropped).then(blob => {
    if (blob === null) throw new Error('save-as-image: capture produced no image')
    return blob
  })
}

/**
 * Resolve the active skin's base background so the export stays readable in
 * dark themes: the captured node paints its own opaque layers, but the page
 * background sits on ancestors the clone does not carry, and without an
 * explicit color the canvas renders transparent — light text on a transparent
 * PNG reads as invisible once pasted onto a white surface. Reading the custom
 * property from the node itself picks up whichever skin layer is active.
 */
function skinBaseBackground(node: HTMLElement): string | undefined {
  const value = getComputedStyle(node).getPropertyValue('--dsw-alias-bg-base').trim()
  return value === '' ? undefined : value
}

/**
 * Render the response node to a PNG blob. The active skin's base background
 * is painted onto the canvas so dark themes stay readable. Font embedding
 * failure degrades to `skipFonts` instead of failing the export, and an
 * oversized render retries once at unit pixel ratio before the error
 * propagates.
 */
export async function captureAssistantStep(node: HTMLElement): Promise<Blob> {
  let fontEmbedCSS: string | undefined
  try {
    fontEmbedCSS = await getFontEmbedCSS(node)
  } catch {
    fontEmbedCSS = undefined
  }
  const backgroundColor = skinBaseBackground(node)
  try {
    return await renderBlob(node, 2, fontEmbedCSS, backgroundColor)
  } catch {
    return await renderBlob(node, 1, fontEmbedCSS, backgroundColor)
  }
}

/** Trigger a local PNG download for one rendered blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  // Some browsers abort the download when the mapping vanishes before the
  // navigation settles, so revoke late instead of inline.
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 10_000)
}
