import type { LocaleMessages } from '../../../shared/i18n.ts'

export type WorkspaceMessage =
  | 'side.title'
  | 'review'
  | 'terminal'
  | 'trajectory'
  | 'browser'
  | 'files'
  | 'side-chat'
  | 'side.back'
  | 'side.close'
  | 'side.close-tab'
  | 'side.close-named-tab'
  | 'side.not-ready'
  | 'side.tab-limit'
  | 'side.tool-disabled'
  | 'side.tool-missing'
  | 'settings.title'
  | 'settings.description'
  | 'settings.reset'
  | 'settings.open-by-default'
  | 'settings.open-by-default-description'
  | 'settings.width'
  | 'settings.width-value'
  | 'settings.tools'
  | 'settings.tools-description'
  | 'settings.viewers'
  | 'settings.viewers-description'
  | 'settings.runtime'
  | 'settings.runtime-description'
  | 'settings.agent-terminal-tools'
  | 'settings.agent-terminal-tools-description'
  | 'settings.bottom-terminal'
  | 'settings.bottom-terminal-description'
  | 'settings.open-files'
  | 'settings.open-files-description'
  | 'settings.open-links'
  | 'settings.open-links-description'
  | 'settings.runtime-load-failed'
  | 'settings.runtime-save-failed'
  | 'workspace.request-failed'

export const WORKSPACE_MESSAGES: LocaleMessages<WorkspaceMessage> = {
  en: {
    'side.title': 'Side panel',
    review: 'Review',
    terminal: 'Terminal',
    browser: 'Browser',
    files: 'Files',
    'side-chat': 'Side chat',
    trajectory: 'Trajectory',
    'side.back': 'Back to side panel',
    'side.close': 'Close side panel',
    'side.close-tab': 'Close active tab',
    'side.close-named-tab': 'Close {title}',
    'side.not-ready': 'The side panel is still starting.',
    'side.tab-limit': 'Close an existing tab before opening another.',
    'side.tool-disabled': 'This side panel tool is disabled.',
    'side.tool-missing': 'This side panel tool is no longer registered.',
    'settings.title': 'Side panel',
    'settings.description': 'Choose which tools and file previews are available in the desktop side panel.',
    'settings.reset': 'Reset',
    'settings.open-by-default': 'Open at launch',
    'settings.open-by-default-description': 'Restore the side panel automatically when the desktop starts.',
    'settings.width': 'Default width',
    'settings.width-value': '{width} px',
    'settings.tools': 'Tools',
    'settings.tools-description': 'Disabled tools are removed from the side panel launcher.',
    'settings.viewers': 'File previews',
    'settings.viewers-description': 'Higher-priority enabled previews are selected automatically.',
    'settings.runtime': 'Agent access',
    'settings.runtime-description': 'Control the Better Sidebar capabilities exposed by the desktop runtime.',
    'settings.agent-terminal-tools': 'Terminal tools for agents',
    'settings.agent-terminal-tools-description': 'Allow agents to create and control desktop terminals. This is disabled by default.',
    'settings.bottom-terminal': 'Start a shell when the bottom panel opens',
    'settings.bottom-terminal-description': 'Create a terminal automatically the first time an empty bottom panel is opened.',
    'settings.open-files': 'Open chat files in the side panel',
    'settings.open-files-description': 'Open workspace file links from messages and tool results in the desktop file viewer.',
    'settings.open-links': 'Open external links in the side browser',
    'settings.open-links-description': 'Open plain HTTP and HTTPS link clicks in the desktop browser. Cmd/Ctrl-click still opens them externally.',
    'workspace.request-failed': 'Workspace request failed ({status})',
    'settings.runtime-load-failed': 'Could not load the runtime settings.',
    'settings.runtime-save-failed': 'Could not save the runtime settings.',
  },
  zh: {
    'side.title': '侧边栏',
    review: '审查',
    terminal: '终端',
    browser: '浏览器',
    files: '文件',
    'side-chat': '侧边对话',
    trajectory: '轨迹',
    'side.back': '返回侧边栏',
    'side.close': '关闭侧边栏',
    'side.close-tab': '关闭当前标签页',
    'side.close-named-tab': '关闭 {title}',
    'side.not-ready': '侧边栏仍在启动。',
    'side.tab-limit': '请先关闭一个已有标签页。',
    'side.tool-disabled': '此侧边栏工具已被禁用。',
    'side.tool-missing': '此侧边栏工具已不再注册。',
    'settings.title': '侧边栏',
    'settings.description': '选择桌面侧边栏中可用的工具和文件预览。',
    'settings.reset': '恢复默认',
    'settings.open-by-default': '启动时打开',
    'settings.open-by-default-description': '桌面端启动时自动恢复侧边栏。',
    'settings.width': '默认宽度',
    'settings.width-value': '{width} 像素',
    'settings.tools': '工具',
    'settings.tools-description': '禁用的工具会从侧边栏启动器中移除。',
    'settings.viewers': '文件预览',
    'settings.viewers-description': '系统会自动选择优先级更高且已启用的预览器。',
    'settings.runtime': 'Agent 访问',
    'settings.runtime-description': '控制桌面运行时向 Agent 开放的 Better Sidebar 能力。',
    'settings.agent-terminal-tools': '允许 Agent 使用终端工具',
    'settings.agent-terminal-tools-description': '允许 Agent 创建并控制桌面终端；默认关闭。',
    'settings.bottom-terminal': '底部面板展开时自动新建终端',
    'settings.bottom-terminal-description': '空的底部面板首次展开时，自动创建一个终端。',
    'settings.open-files': '聊天文件在侧边栏打开',
    'settings.open-files-description': '消息和工具结果中的工作区文件链接，会在桌面文件预览器中打开。',
    'settings.open-links': '外部链接在侧边浏览器打开',
    'settings.open-links-description': '普通 HTTP/HTTPS 链接会在桌面浏览器中打开；Cmd/Ctrl 点击仍使用外部浏览器。',
    'workspace.request-failed': '工作区请求失败（{status}）',
    'settings.runtime-load-failed': '无法加载运行时设置。',
    'settings.runtime-save-failed': '无法保存运行时设置。',
  },
}
