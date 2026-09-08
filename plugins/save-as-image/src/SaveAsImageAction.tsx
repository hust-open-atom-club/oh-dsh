/** Save-as-image entry in the conversation.chat.assistant-actions strip. */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconCheckOutline16,
  IconDownloadOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  captureAssistantStep,
  captureFileName,
  downloadBlob,
  findAssistantStep,
} from './capture.ts'
import {
  SAVE_AS_IMAGE_MESSAGES,
  type SaveAsImageMessage,
} from './locales.ts'

/** How long the transient check icon stays before returning to idle. */
const SAVED_RESET_MS = 1500

/** Style tag identity for the injected action-strip CSS. */
const STYLE_TAG = 'oh-dsh.save-as-image'

/** Action strip chrome, mirroring the shared icon-button row styling. */
const ACTION_CSS = `
[data-oh-dsh-save-as-image] {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  border: 0;
  border-radius: 28px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

[data-oh-dsh-save-as-image]:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

[data-oh-dsh-save-as-image]:disabled {
  cursor: default;
  opacity: 0.4;
}

[data-oh-dsh-save-as-image-failure] {
  padding-left: 4px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}
`

interface SaveAsImageActionProps {
  messageId: string
  t: (key: SaveAsImageMessage) => string
}

interface SlotsService {
  inject(name: string, register: () => () => void): void
  register(
    options: {
      id: string
      locale: string
      name: string
      order: number
    },
    component: (props: SaveAsImageActionProps) => JSX.Element,
  ): () => void
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  locale: {
    register(
      namespace: string,
      messages: typeof SAVE_AS_IMAGE_MESSAGES,
    ): void
  }
  slots: SlotsService
}

type Phase = 'idle' | 'capturing' | 'saved'

/**
 * One finalized assistant message's save control. The capture target is the
 * rendered `assistant-step` sibling node, so the exported image carries the
 * response body and never this action row.
 */
export function SaveAsImageAction({
  messageId,
  t,
}: SaveAsImageActionProps): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [failed, setFailed] = useState(false)
  const alive = useRef(true)
  const resetTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => {
    alive.current = false
    window.clearTimeout(resetTimer.current)
  }, [])

  const capture = useCallback(async () => {
    const button = buttonRef.current
    if (button === null) return
    setFailed(false)
    setPhase('capturing')
    try {
      const node = findAssistantStep(button)
      const blob = await captureAssistantStep(node)
      downloadBlob(blob, captureFileName(messageId))
      if (!alive.current) return
      setPhase('saved')
      resetTimer.current = window.setTimeout(() => {
        if (alive.current) setPhase('idle')
      }, SAVED_RESET_MS)
    } catch {
      if (!alive.current) return
      setPhase('idle')
      setFailed(true)
    }
  }, [messageId])

  const label = phase === 'capturing'
    ? t('status.capturing')
    : phase === 'saved'
      ? t('status.saved')
      : t('action.saveAsImage')

  return (
    <>
      <Tooltip label={label} side="bottom">
        <button
          ref={buttonRef}
          type="button"
          data-oh-dsh-save-as-image=""
          aria-label={label}
          disabled={phase === 'capturing'}
          onClick={() => { void capture() }}
        >
          {phase === 'saved' ? <IconCheckOutline16 /> : <IconDownloadOutline16 />}
        </button>
      </Tooltip>
      {failed && (
        <span role="status" data-oh-dsh-save-as-image-failure="">
          {t('status.failed')}
        </span>
      )}
    </>
  )
}

function injectStyles(): void {
  if (document.querySelector(`style[data-plugin="${STYLE_TAG}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = STYLE_TAG
  tag.textContent = ACTION_CSS
  document.head.append(tag)
}

function removeStyles(): void {
  document.querySelector(`style[data-plugin="${STYLE_TAG}"]`)?.remove()
}

/** Required services: the slot registry and the copy. */
export const inject = ['slots', 'locale']

/**
 * Save-as-image client plugin: the save entry in the assistant-actions strip.
 * The runtime renders this slot only for finalized assistant messages, so an
 * interrupted turn shows no control.
 */
export function apply(ctx: ClientContext): void {
  injectStyles()
  ctx.effect(
    () => ctx.locale.register('oh-dsh.save-as-image', SAVE_AS_IMAGE_MESSAGES),
    'oh-dsh-save-as-image: dictionaries',
  )
  ctx.slots.inject('conversation.chat.assistant-actions', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.chat.assistant-actions',
      id: 'save-as-image',
      order: 20,
      locale: 'oh-dsh.save-as-image',
    }, SaveAsImageAction)
    return () => {
      dispose()
      removeStyles()
    }
  })
}
