/** Copy for the Oh-DSH Settings update section. */

export type UpdateButtonMessage =
  | 'sectionNav'
  | 'sectionTitle'
  | 'sectionDescription'
  | 'checkForUpdates'
  | 'openUpdater'
  | 'checking'
  | 'statusIdle'
  | 'statusNotAvailable'
  | 'statusAvailable'
  | 'statusDownloading'
  | 'statusDownloaded'
  | 'statusUnsupported'
  | 'statusError'
  | 'statusUnknown'

export const UPDATE_BUTTON_MESSAGES: Record<'en' | 'zh', Record<UpdateButtonMessage, string>> = {
  en: {
    sectionNav: 'Update',
    sectionTitle: 'Application updates',
    sectionDescription: 'Check for Oh-DSH Desktop releases and open the update window to download and install them.',
    checkForUpdates: 'Check for Updates',
    openUpdater: 'Open Update Window',
    checking: 'Checking…',
    statusIdle: 'Current version: {version}',
    statusNotAvailable: 'Up to date (latest: {version})',
    statusAvailable: 'Version {version} is available',
    statusDownloading: 'Downloading — {percent}%',
    statusDownloaded: 'Version {version} is ready to install',
    statusUnsupported: 'Updates are not supported in this build',
    statusError: 'The update check failed; try again',
    statusUnknown: 'Update state is not available yet',
  },
  zh: {
    sectionNav: '更新',
    sectionTitle: '应用更新',
    sectionDescription: '检查 Oh-DSH Desktop 的新版本，并打开更新窗口下载安装。',
    checkForUpdates: '检查更新',
    openUpdater: '打开更新窗口',
    checking: '检查中…',
    statusIdle: '当前版本：{version}',
    statusNotAvailable: '已是最新（最新版：{version}）',
    statusAvailable: '新版本 {version} 可用',
    statusDownloading: '下载中 — {percent}%',
    statusDownloaded: '版本 {version} 已就绪，可安装',
    statusUnsupported: '此构建不支持更新',
    statusError: '更新检查失败，请重试',
    statusUnknown: '暂未获取到更新状态',
  },
}
