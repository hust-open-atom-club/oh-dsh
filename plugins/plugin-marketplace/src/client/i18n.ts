import type { LocaleMessages } from '../../../shared/i18n.ts'

export type MarketplaceMessage =
  | 'plugins'
  | 'subtitle'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'updates'
  | 'update-available'
  | 'not-installed'
  | 'managed'
  | 'builtin'
  | 'show-builtins'
  | 'all'
  | 'all-categories'
  | 'mechanism.repository'
  | 'mechanism.bundle'
  | 'mechanism.discover'
  | 'mechanism.unsupported'
  | 'details'
  | 'category'
  | 'mechanism'
  | 'updated'
  | 'stars'
  | 'forks'
  | 'open-issues'
  | 'language'
  | 'license'
  | 'github-stats'
  | 'unknown'
  | 'repository'
  | 'surfaces'
  | 'surfaces.assumed-all'
  | 'surfaces.all'
  | 'surfaces.none'
  | 'surfaces.desktop'
  | 'surfaces.web'
  | 'surfaces.tui'
  | 'trust'
  | 'trust.organization'
  | 'trust.community'
  | 'trust.untrusted'
  | 'runtime-boundary'
  | 'risk.profile-bundle'
  | 'risk.trusted-host'
  | 'risk.guided'
  | 'risk-level'
  | 'risk-level.low'
  | 'risk-level.elevated'
  | 'risk-level.high'
  | 'risk-level.blocked'
  | 'risk-reason.install-scripts'
  | 'risk-reason.trusted-host-code'
  | 'risk-reason.source-change'
  | 'risk-reason.protected-plugin'
  | 'source-review'
  | 'source-review.first-use'
  | 'source-review.matched'
  | 'source-review.changed'
  | 'current-commit'
  | 'latest-commit'
  | 'prepared-plan'
  | 'action.install'
  | 'action.update'
  | 'action.enable'
  | 'action.disable'
  | 'action.uninstall'
  | 'commit'
  | 'package'
  | 'allow-scripts'
  | 'accept-unsandboxed-build'
  | 'accept-high-risk'
  | 'accept-source-change'
  | 'recovery-note'
  | 'flow.review'
  | 'flow.preview'
  | 'flow.apply'
  | 'open-repository'
  | 'preview.install'
  | 'preview.update'
  | 'preview.enable'
  | 'preview.disable'
  | 'preview.uninstall'
  | 'preview.launch'
  | 'view-source'
  | 'undo-last-apply'
  | 'working'
  | 'refresh'
  | 'close'
  | 'preview.running'
  | 'preview.running-unisolated'
  | 'discard'
  | 'apply'
  | 'apply-action'
  | 'reset-and-reload'
  | 'search.label'
  | 'search.placeholder'
  | 'search.clear'
  | 'installation-status'
  | 'plugin-category'
  | 'plugin-count'
  | 'loading-catalog'
  | 'github-auth-required'
  | 'no-match'
  | 'auth.install-gh'
  | 'auth.ready'
  | 'auth.not-refreshed'
  | 'notice.loaded'
  | 'notice.preview-ready'
  | 'notice.preview-ready-unisolated'
  | 'notice.discarded'
  | 'notice.applied'
  | 'notice.restored'

export const MARKETPLACE_MESSAGES: LocaleMessages<MarketplaceMessage> = {
  en: {
    plugins: 'Plugins',
    subtitle: 'Public DSH catalog · isolated preview before every change',
    installed: 'Installed',
    enabled: 'Enabled',
    disabled: 'Disabled',
    updates: 'Updates',
    'update-available': 'Update available',
    'not-installed': 'Not installed',
    managed: 'Oh-DSH managed',
    builtin: 'Built-in',
    'show-builtins': 'Show built-in plugins',
    all: 'All',
    'all-categories': 'All categories',
    'mechanism.repository': 'Repository',
    'mechanism.bundle': 'Bundle',
    'mechanism.discover': 'Auto-detect',
    'mechanism.unsupported': 'Browse only',
    details: '{plugin} details',
    category: 'Category',
    mechanism: 'Mechanism',
    updated: 'Updated',
    stars: 'Stars',
    forks: 'Forks',
    'open-issues': 'Open issues and pull requests',
    language: 'Language',
    license: 'License',
    'github-stats': 'GitHub repository statistics',
    unknown: 'Unknown',
    repository: 'Repository',
    surfaces: 'Effective surfaces',
    'surfaces.assumed-all': 'TUI · Web · Desktop (assumed)',
    'surfaces.all': 'TUI · Web · Desktop',
    'surfaces.none': 'None declared',
    'surfaces.desktop': 'Desktop',
    'surfaces.web': 'Web',
    'surfaces.tui': 'TUI',
    trust: 'Source trust',
    'trust.organization': 'Registry reviewed source',
    'trust.community': 'Community source',
    'trust.untrusted': 'Untrusted source',
    'runtime-boundary': 'Runtime boundary',
    'risk.profile-bundle': 'Official Profile bundle mechanism',
    'risk.trusted-host': 'Trusted host code after apply',
    'risk.guided': 'Guided install only',
    'risk-level': 'Risk level',
    'risk-level.low': 'Low',
    'risk-level.elevated': 'Elevated',
    'risk-level.high': 'High',
    'risk-level.blocked': 'Blocked',
    'risk-reason.install-scripts': 'Declares install-time scripts',
    'risk-reason.trusted-host-code': 'Runs as trusted host code after apply',
    'risk-reason.source-change': 'Source identity differs from the TOFU lock',
    'risk-reason.protected-plugin': 'Owned by an Oh-DSH transaction layer',
    'source-review': 'Source lock',
    'source-review.first-use': 'First use · lock after apply',
    'source-review.matched': 'Matches the stored TOFU identity',
    'source-review.changed': 'Changed · explicit approval required',
    'current-commit': 'Installed commit',
    'latest-commit': 'Latest commit',
    'prepared-plan': 'Prepared {action} plan',
    'action.install': 'install',
    'action.update': 'update',
    'action.enable': 'enable',
    'action.disable': 'disable',
    'action.uninstall': 'uninstall',
    commit: 'commit {commit}',
    package: 'package {package}',
    'allow-scripts': 'Allow these scripts only inside the write-restricted preview.',
    'accept-unsandboxed-build': 'Run these third-party build scripts without process isolation (unsafe).',
    'accept-high-risk': 'I understand that this plugin runs as trusted host code after apply.',
    'accept-source-change': 'I reviewed and accept the changed source identity.',
    'recovery-note': 'Apply swaps the profile atomically. The previous profile stays available for recovery; arbitrary external effects are not rolled back.',
    'flow.review': 'Review',
    'flow.preview': 'Preview',
    'flow.apply': 'Apply',
    'open-repository': 'Open repository',
    'preview.install': 'Preview install',
    'preview.update': 'Preview update',
    'preview.enable': 'Preview enable',
    'preview.disable': 'Preview disable',
    'preview.uninstall': 'Preview uninstall',
    'preview.launch': 'Launch isolated preview',
    'view-source': 'View source',
    'undo-last-apply': 'Undo last apply',
    working: 'Working…',
    refresh: 'Refresh',
    close: 'Close Plugins',
    'preview.running': '{plugin} is running in an isolated preview window.',
    'preview.running-unisolated': '{plugin} is running in a preview without process isolation.',
    discard: 'Discard',
    apply: 'Apply to {target}',
    'apply-action': 'Apply {action}',
    'reset-and-reload': 'Reset and reload',
    'search.label': 'Search plugins',
    'search.placeholder': 'Search plugins, skills, and tags…',
    'search.clear': 'Clear plugin search',
    'installation-status': 'Installation status',
    'plugin-category': 'Plugin category',
    'plugin-count': '{count} plugins',
    'loading-catalog': 'Loading the plugin catalog…',
    'github-auth-required': 'GitHub authentication required',
    'no-match': 'No plugins match this view.',
    'auth.install-gh': 'Install GitHub CLI and run `gh auth login` to browse private organization plugins.',
    'auth.ready': 'Authenticated with GitHub CLI.',
    'auth.not-refreshed': 'Plugin catalog has not been refreshed yet.',
    'notice.loaded': 'Loaded {count} catalog plugins.',
    'notice.preview-ready': 'Isolated {action} preview is ready for {plugin}.',
    'notice.preview-ready-unisolated': '{action} preview is ready for {plugin} without process isolation.',
    'notice.discarded': 'Discarded the {plugin} preview without changing the profile.',
    'notice.applied': 'Applied {plugin}; the previous profile remains available for Undo.',
    'notice.restored': 'Restored the profile from before {plugin} was applied.',
  },
  zh: {
    plugins: '插件',
    subtitle: '公开 DSH 目录 · 每次变更前均进行隔离预览',
    installed: '已安装',
    enabled: '已启用',
    disabled: '已停用',
    updates: '可更新',
    'update-available': '有可用更新',
    'not-installed': '未安装',
    managed: '由 Oh-DSH 管理',
    builtin: '内置',
    'show-builtins': '显示内置插件',
    all: '全部',
    'all-categories': '全部分类',
    'mechanism.repository': '仓库插件',
    'mechanism.bundle': '插件包',
    'mechanism.discover': '自动检测',
    'mechanism.unsupported': '仅浏览',
    details: '{plugin} 详情',
    category: '分类',
    mechanism: '安装机制',
    updated: '更新时间',
    stars: 'Stars',
    forks: 'Forks',
    'open-issues': '开放 Issue 与 PR',
    language: '主要语言',
    license: '许可证',
    'github-stats': 'GitHub 仓库统计',
    unknown: '未知',
    repository: '仓库',
    surfaces: '生效界面',
    'surfaces.assumed-all': 'TUI · Web · Desktop（默认假定）',
    'surfaces.all': 'TUI · Web · Desktop',
    'surfaces.none': '未声明',
    'surfaces.desktop': 'Desktop',
    'surfaces.web': 'Web',
    'surfaces.tui': 'TUI',
    trust: '来源信任',
    'trust.organization': 'Registry 已审核来源',
    'trust.community': '社区来源',
    'trust.untrusted': '不受信任来源',
    'runtime-boundary': '运行边界',
    'risk.profile-bundle': '官方 Profile 插件包机制',
    'risk.trusted-host': '应用后作为受信任主机代码运行',
    'risk.guided': '仅提供安装引导',
    'risk-level': '风险等级',
    'risk-level.low': '低',
    'risk-level.elevated': '中',
    'risk-level.high': '高',
    'risk-level.blocked': '已阻止',
    'risk-reason.install-scripts': '声明了安装阶段脚本',
    'risk-reason.trusted-host-code': '应用后会作为受信任主机代码运行',
    'risk-reason.source-change': '来源身份与 TOFU 锁不一致',
    'risk-reason.protected-plugin': '由 Oh-DSH 事务层自身管理',
    'source-review': '来源锁',
    'source-review.first-use': '首次使用 · 应用后写入锁',
    'source-review.matched': '与已保存的 TOFU 身份一致',
    'source-review.changed': '来源有变化 · 需要明确确认',
    'current-commit': '已安装提交',
    'latest-commit': '最新提交',
    'prepared-plan': '已准备{action}方案',
    'action.install': '安装',
    'action.update': '更新',
    'action.enable': '启用',
    'action.disable': '停用',
    'action.uninstall': '卸载',
    commit: '提交 {commit}',
    package: '软件包 {package}',
    'allow-scripts': '仅允许在写入受限的预览环境中运行这些脚本。',
    'accept-unsandboxed-build': '在没有进程隔离的情况下运行这些第三方构建脚本（不安全）。',
    'accept-high-risk': '我了解应用后该插件会作为受信任主机代码运行。',
    'accept-source-change': '我已检查并接受变化后的来源身份。',
    'recovery-note': '应用时会原子替换 Profile，并保留上一版本用于恢复；插件产生的任意外部副作用不在回滚范围内。',
    'flow.review': '检查',
    'flow.preview': '预览',
    'flow.apply': '应用',
    'open-repository': '打开仓库',
    'preview.install': '预览安装',
    'preview.update': '预览更新',
    'preview.enable': '预览启用',
    'preview.disable': '预览停用',
    'preview.uninstall': '预览卸载',
    'preview.launch': '启动隔离预览',
    'view-source': '查看源码',
    'undo-last-apply': '撤销上次应用',
    working: '处理中…',
    refresh: '刷新',
    close: '关闭插件市场',
    'preview.running': '{plugin} 正在隔离预览窗口中运行。',
    'preview.running-unisolated': '{plugin} 正在没有进程隔离的预览中运行。',
    discard: '放弃',
    apply: '应用到 {target}',
    'apply-action': '应用{action}',
    'reset-and-reload': '重置并重新加载',
    'search.label': '搜索插件',
    'search.placeholder': '搜索插件、技能和标签…',
    'search.clear': '清空插件搜索',
    'installation-status': '安装状态',
    'plugin-category': '插件分类',
    'plugin-count': '{count} 个插件',
    'loading-catalog': '正在加载组织插件目录…',
    'github-auth-required': '需要 GitHub 身份验证',
    'no-match': '当前视图中没有匹配的插件。',
    'auth.install-gh': '请安装 GitHub CLI 并运行 `gh auth login`，以浏览组织的私有插件。',
    'auth.ready': '已通过 GitHub CLI 完成身份验证。',
    'auth.not-refreshed': '插件目录尚未刷新。',
    'notice.loaded': '已加载 {count} 个目录插件。',
    'notice.preview-ready': '{plugin} 的隔离{action}预览已就绪。',
    'notice.preview-ready-unisolated': '{plugin} 的{action}预览已就绪，未使用进程隔离。',
    'notice.discarded': '已放弃 {plugin} 的预览，Profile 配置未发生更改。',
    'notice.applied': '已应用 {plugin}；之前的配置仍可撤销恢复。',
    'notice.restored': '已恢复应用 {plugin} 之前的配置。',
  },
}
