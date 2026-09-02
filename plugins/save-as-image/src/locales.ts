/** Copy keys rendered by the save-as-image controls. */
export type SaveAsImageMessage =
  | 'action.saveAsImage'
  | 'status.capturing'
  | 'status.saved'
  | 'status.failed'

/** `oh-dsh.save-as-image` namespace dictionaries; zh is the key-set source of truth. */
export const SAVE_AS_IMAGE_MESSAGES: {
  zh: Record<SaveAsImageMessage, string>
  en: Record<SaveAsImageMessage, string>
} = {
  zh: {
    'action.saveAsImage': '保存为图片',
    'status.capturing': '正在生成图片…',
    'status.saved': '已保存',
    'status.failed': '图片导出失败',
  },
  en: {
    'action.saveAsImage': 'Save as image',
    'status.capturing': 'Capturing image…',
    'status.saved': 'Saved',
    'status.failed': 'Could not export image',
  },
}
