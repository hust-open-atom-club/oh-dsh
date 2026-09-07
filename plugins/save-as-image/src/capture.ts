/** Browser-local PNG capture of one rendered assistant response. */

import { getFontEmbedCSS, toBlob } from 'html-to-image'

const FLOW_ITEM_SELECTOR = '[data-chat-flow-kind]'
const ASSISTANT_STEP_KIND = 'assistant-step'
/** Sibling hops the strip row may sit above the response node. */
const MAX_SIBLING_HOPS = 10

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

async function renderBlob(
  node: HTMLElement,
  pixelRatio: number,
  fontEmbedCSS: string | undefined,
  backgroundColor: string | undefined,
): Promise<Blob> {
  // html-to-image sizes the canvas from node.clientHeight/clientWidth, which
  // truncate fractional layout heights — a response whose rendered box ends at
  // e.g. 812.67 CSS pixels loses its last partial line. getBoundingClientRect
  // keeps the fraction, so ceil it instead of letting the library truncate.
  const rect = node.getBoundingClientRect()
  const options = {
    pixelRatio,
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
    ...(fontEmbedCSS === undefined ? { skipFonts: true } : { fontEmbedCSS }),
    ...(backgroundColor === undefined ? {} : { backgroundColor }),
  }
  const blob = await toBlob(node, options)
  if (blob === null) throw new Error('save-as-image: capture produced no image')
  return blob
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
