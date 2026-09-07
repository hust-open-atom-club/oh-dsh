import type { ComposerCaret } from './composer-history-keyboard.ts'

/**
 * Composer element access for the two input shapes DSH has shipped: the
 * 0.1.1 `<textarea data-phase>` and the 0.1.2 contenteditable
 * `[data-composer-input]` div. Everything downstream reads and writes the
 * composer through these helpers, so an input-shape change lands here
 * instead of in the keyboard flow.
 */

/** The composer element the event target must be (never the terminal input). */
export function isComposerInput(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false
  // 0.1.2 marks the conversation composer itself.
  if (target.dataset.composerInput === 'true') {
    return target.dataset.phase !== 'inert'
  }
  // 0.1.1 carried data-phase on the composer textarea.
  return target instanceof HTMLTextAreaElement
    && target.dataset.phase !== undefined
    && !target.disabled
    && !target.readOnly
}

/** Read the composer's text and caret as the shared boundary-check shape. */
export function readComposerCaret(element: HTMLElement): ComposerCaret | null {
  if (element instanceof HTMLTextAreaElement) {
    return {
      selectionEnd: element.selectionEnd,
      selectionStart: element.selectionStart,
      value: element.value,
    }
  }
  const value = element.textContent ?? ''
  const selection = element.ownerDocument.getSelection()
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!element.contains(range.startContainer)) return null
  const fromStart = element.ownerDocument.createRange()
  fromStart.setStart(element, 0)
  try {
    fromStart.setEnd(range.startContainer, range.startOffset)
  } catch {
    return null
  }
  const caret = fromStart.toString().length
  return {
    selectionEnd: caret,
    selectionStart: caret,
    value,
  }
}

/** Place the caret at the end of the composer after a draft swap. */
export function focusComposerEnd(element: HTMLElement): void {
  if (element instanceof HTMLTextAreaElement) {
    const end = element.value.length
    element.setSelectionRange(end, end)
    return
  }
  const document = element.ownerDocument
  const selection = document.getSelection()
  if (selection === null) return
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}
