import type { LocaleMessages } from '../../../shared/i18n.ts'

export type WorkspaceMessage =
  | 'panels.label'
  | 'side.expand'
  | 'side.restore'
  | 'summary.toggle'
  | 'summary.title'
  | 'terminal.toggle'
  | 'terminal.title'
  | 'side.toggle'
  | 'side.title'
  | 'review'
  | 'terminal'
  | 'browser'
  | 'files'
  | 'side-chat'
  | 'trajectory'
  | 'browser.enter-url'
  | 'browser.http-only'
  | 'browser.page-failed'
  | 'browser.back'
  | 'browser.reload'
  | 'browser.url'
  | 'browser.go'
  | 'files.select-workspace'
  | 'files.request-failed'
  | 'files.loading'
  | 'files.empty-directory'
  | 'files.showing-first'
  | 'files.open'
  | 'files.binary'
  | 'files.preview-truncated'
  | 'files.not-file'
  | 'files.no-viewer'
  | 'files.viewer.binary'
  | 'files.viewer.html'
  | 'files.viewer.markdown'
  | 'files.viewer.text'
  | 'side.back'
  | 'side.close'
  | 'side.close-tab'
  | 'side.close-named-tab'
  | 'side.not-ready'
  | 'side.orphaned-tab'
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
  | 'workspace.title'
  | 'workspace.refresh'
  | 'workspace.add'
  | 'workspace.close-review'
  | 'workspace.select'
  | 'workspace.changes'
  | 'workspace.staged'
  | 'workspace.more-changes'
  | 'workspace.clean'
  | 'workspace.not-git'
  | 'workspace.execution-environment'
  | 'workspace.git-actions'
  | 'workspace.local'
  | 'workspace.current-branch'
  | 'workspace.new-branch'
  | 'workspace.new-branch-name'
  | 'workspace.create'
  | 'workspace.commit-or-push'
  | 'workspace.commit-message'
  | 'workspace.commit-all'
  | 'workspace.push'
  | 'workspace.behind'
  | 'workspace.background-processes'
  | 'workspace.no-background-processes'
  | 'workspace.loading-diff'
  | 'workspace.no-text-diff'
  | 'workspace.review-history'
  | 'workspace.no-commits'
  | 'workspace.review-commit'
  | 'workspace.comment-commit'
  | 'workspace.comment-line'
  | 'workspace.comment-placeholder'
  | 'workspace.add-comment'
  | 'workspace.cancel'
  | 'workspace.comment-added'
  | 'workspace.comment-saved'
  | 'workspace.pending-comments'
  | 'workspace.remove-comment'
  | 'workspace.diff-truncated'

export const WORKSPACE_MESSAGES: LocaleMessages<WorkspaceMessage> = {
  en: {
    'panels.label': 'Desktop panels',
    'side.expand': 'Expand side panel',
    'side.restore': 'Restore side panel',
    'summary.toggle': 'Toggle pinned summary',
    'summary.title': 'Pinned summary',
    'terminal.toggle': 'Toggle terminal panel',
    'terminal.title': 'Terminal',
    'side.toggle': 'Toggle side panel',
    'side.title': 'Side panel',
    review: 'Review',
    terminal: 'Terminal',
    browser: 'Browser',
    files: 'Files',
    'side-chat': 'Side chat',
    trajectory: 'Trajectory',
    'browser.enter-url': 'Enter a URL',
    'browser.http-only': 'Only HTTP and HTTPS URLs are supported',
    'browser.page-failed': 'Page failed to load',
    'browser.back': 'Browser back',
    'browser.reload': 'Reload browser',
    'browser.url': 'Browser URL',
    'browser.go': 'Go',
    'files.select-workspace': 'Select a workspace to browse files.',
    'files.request-failed': 'File request failed ({status})',
    'files.loading': 'Loading…',
    'files.empty-directory': 'Empty directory',
    'files.showing-first': 'Showing the first 300 entries',
    'files.open': 'Open',
    'files.binary': 'Binary file · {size}',
    'files.preview-truncated': 'preview truncated',
    'files.not-file': 'The selected path is not a regular file.',
    'files.no-viewer': 'No preview is available for this file ({size}).',
    'files.viewer.binary': 'Binary file',
    'files.viewer.html': 'HTML preview',
    'files.viewer.markdown': 'Markdown preview',
    'files.viewer.text': 'Text preview',
    'side.back': 'Back to side panel',
    'side.close': 'Close side panel',
    'side.close-tab': 'Close active tab',
    'side.close-named-tab': 'Close {title}',
    'side.not-ready': 'The side panel is still starting.',
    'side.orphaned-tab': 'Its provider is not currently available. You can close this tab without losing the rest of the session.',
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
    'settings.runtime-load-failed': 'Could not load the runtime settings.',
    'settings.runtime-save-failed': 'Could not save the runtime settings.',
    'workspace.request-failed': 'Workspace request failed ({status})',
    'workspace.title': 'Workspace',
    'workspace.refresh': 'Refresh workspace',
    'workspace.add': 'Add workspace',
    'workspace.close-review': 'Close review',
    'workspace.select': 'Select a DSH workspace to inspect changes.',
    'workspace.changes': 'Changes',
    'workspace.staged': 'staged',
    'workspace.more-changes': '{count} more changes',
    'workspace.clean': 'Working tree clean',
    'workspace.not-git': 'This directory is not a Git repository.',
    'workspace.execution-environment': 'Execution environment',
    'workspace.git-actions': 'Git actions',
    'workspace.local': 'Local',
    'workspace.current-branch': 'Current branch',
    'workspace.new-branch': 'New branch',
    'workspace.new-branch-name': 'New branch name',
    'workspace.create': 'Create',
    'workspace.commit-or-push': 'Commit or push',
    'workspace.commit-message': 'Commit message',
    'workspace.commit-all': 'Commit all',
    'workspace.push': 'Push',
    'workspace.behind': 'Behind upstream by {count}',
    'workspace.background-processes': 'Background processes',
    'workspace.no-background-processes': 'No background processes',
    'workspace.loading-diff': 'Loading diff…',
    'workspace.no-text-diff': 'No textual diff is available.',
    'workspace.review-history': 'Commit history',
    'workspace.no-commits': 'No commits on this branch',
    'workspace.review-commit': 'Commit',
    'workspace.comment-commit': 'Comment on commit',
    'workspace.comment-line': 'Comment on this line',
    'workspace.comment-placeholder': 'Describe the change you want…',
    'workspace.add-comment': 'Add comment',
    'workspace.cancel': 'Cancel',
    'workspace.comment-added': 'Added to the message composer.',
    'workspace.comment-saved': 'Saved. Open a chat to send this review.',
    'workspace.pending-comments': 'Pending review comments',
    'workspace.remove-comment': 'Remove review comment',
    'workspace.diff-truncated': '{count} more lines are hidden',
  },
  zh: {
    'panels.label': '桌面面板',
    'side.expand': '展开侧边栏',
    'side.restore': '恢复侧边栏',
    'summary.toggle': '切换固定摘要',
    'summary.title': '固定摘要',
    'terminal.toggle': '切换终端面板',
    'terminal.title': '终端',
    'side.toggle': '切换侧边栏',
    'side.title': '侧边栏',
    review: '审查',
    terminal: '终端',
    browser: '浏览器',
    files: '文件',
    'side-chat': '侧边对话',
    trajectory: '轨迹',
    'browser.enter-url': '输入 URL',
    'browser.http-only': '仅支持 HTTP 和 HTTPS URL',
    'browser.page-failed': '页面加载失败',
    'browser.back': '浏览器后退',
    'browser.reload': '重新加载浏览器',
    'browser.url': '浏览器 URL',
    'browser.go': '前往',
    'files.select-workspace': '选择工作区以浏览文件。',
    'files.request-failed': '文件请求失败（{status}）',
    'files.loading': '加载中…',
    'files.empty-directory': '空目录',
    'files.showing-first': '仅显示前 300 项',
    'files.open': '打开',
    'files.binary': '二进制文件 · {size}',
    'files.preview-truncated': '预览已截断',
    'files.not-file': '所选路径不是常规文件。',
    'files.no-viewer': '此文件没有可用的预览（{size}）。',
    'files.viewer.binary': '二进制文件',
    'files.viewer.html': 'HTML 预览',
    'files.viewer.markdown': 'Markdown 预览',
    'files.viewer.text': '文本预览',
    'side.back': '返回侧边栏',
    'side.close': '关闭侧边栏',
    'side.close-tab': '关闭当前标签页',
    'side.close-named-tab': '关闭 {title}',
    'side.not-ready': '侧边栏仍在启动。',
    'side.orphaned-tab': '当前无法找到它的提供者。关闭此标签页不会影响会话中的其他内容。',
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
    'settings.runtime-load-failed': '无法加载运行时设置。',
    'settings.runtime-save-failed': '无法保存运行时设置。',
    'workspace.request-failed': '工作区请求失败（{status}）',
    'workspace.title': '工作区',
    'workspace.refresh': '刷新工作区',
    'workspace.add': '添加工作区',
    'workspace.close-review': '关闭审查',
    'workspace.select': '选择 DSH 工作区以检查变更。',
    'workspace.changes': '变更',
    'workspace.staged': '已暂存',
    'workspace.more-changes': '还有 {count} 项变更',
    'workspace.clean': '工作树已清理',
    'workspace.not-git': '此目录不是 Git 仓库。',
    'workspace.execution-environment': '执行环境',
    'workspace.git-actions': 'Git 操作',
    'workspace.local': '本地',
    'workspace.current-branch': '当前分支',
    'workspace.new-branch': '新分支',
    'workspace.new-branch-name': '新分支名称',
    'workspace.create': '创建',
    'workspace.commit-or-push': '提交或推送',
    'workspace.commit-message': '提交信息',
    'workspace.commit-all': '提交全部',
    'workspace.push': '推送',
    'workspace.behind': '落后上游 {count} 个提交',
    'workspace.background-processes': '后台进程',
    'workspace.no-background-processes': '没有后台进程',
    'workspace.loading-diff': '正在加载差异…',
    'workspace.no-text-diff': '没有可用的文本差异。',
    'workspace.review-history': '提交历史',
    'workspace.no-commits': '当前分支没有提交',
    'workspace.review-commit': '提交',
    'workspace.comment-commit': '评论此提交',
    'workspace.comment-line': '评论此行',
    'workspace.comment-placeholder': '描述希望修改的内容…',
    'workspace.add-comment': '添加评论',
    'workspace.cancel': '取消',
    'workspace.comment-added': '已添加到消息输入框。',
    'workspace.comment-saved': '已保存，请打开对话发送此次审查。',
    'workspace.pending-comments': '待发送的审查评论',
    'workspace.remove-comment': '移除审查评论',
    'workspace.diff-truncated': '另有 {count} 行已隐藏',
  },
}
