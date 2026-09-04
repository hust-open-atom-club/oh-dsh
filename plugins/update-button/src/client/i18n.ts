/** Copy for the Oh-DSH sidebar update entry (labels surface on hover/focus). */

export type UpdateButtonMessage = 'checkForUpdates'

export const UPDATE_BUTTON_MESSAGES: Record<'en' | 'zh', Record<UpdateButtonMessage, string>> = {
  en: {
    checkForUpdates: 'Check for Updates',
  },
  zh: {
    checkForUpdates: '检查更新',
  },
}
