import type { LocaleMessages } from '../../shared/i18n.ts'

export type PinnedSummaryMessage =
  | 'summary.label'
  | 'summary.title'
  | 'summary.close'
  | 'summary.copy'
  | 'summary.copy-success'
  | 'summary.copy-failure'
  | 'summary.open-session'
  | 'summary.show-more'
  | 'summary.show-less'
  | 'summary.no-active'
  | 'summary.select-session'
  | 'summary.session'
  | 'summary.empty-placeholder'
  | 'summary.source.context'
  | 'summary.source.assistant'
  | 'summary.source.overview'
  | 'summary.status.running'
  | 'summary.status.waiting'
  | 'summary.status.ready'
  | 'summary.status.no-session'
  | 'summary.status.loading'
  | 'summary.status.blank'
  | 'summary.status.unavailable'
  | 'summary.status.error'
  | 'summary.loading'
  | 'summary.error'
  | 'summary.metadata.model'
  | 'summary.metadata.tools'
  | 'summary.metadata.time-range'
  | 'summary.updated'
  | 'summary.blank'
  | 'summary.unavailable'

export const PINNED_SUMMARY_MESSAGES: LocaleMessages<PinnedSummaryMessage> = {
  en: {
    'summary.label': 'Pinned Summary',
    'summary.title': 'Pinned Summary',
    'summary.close': 'Close Pinned Summary',
    'summary.copy': 'Copy summary',
    'summary.copy-success': 'Summary copied',
    'summary.copy-failure': 'Copy unavailable',
    'summary.open-session': 'Open session',
    'summary.show-more': 'View full content',
    'summary.show-less': 'Show less',
    'summary.no-active': 'No active session',
    'summary.select-session': 'Select a session to see its summary.',
    'summary.session': 'Session',
    'summary.empty-placeholder': 'The active DSH session summary will appear here.',
    'summary.source.context': 'DSH context summary',
    'summary.source.assistant': 'Latest assistant response',
    'summary.source.overview': 'Session overview',
    'summary.status.running': 'Running',
    'summary.status.waiting': 'Waiting for input',
    'summary.status.ready': 'Ready',
    'summary.status.no-session': 'No session',
    'summary.status.loading': 'Loading',
    'summary.status.blank': 'Not started',
    'summary.status.unavailable': 'Unavailable',
    'summary.status.error': 'Error',
    'summary.loading': 'Loading session summary…',
    'summary.error': 'The session summary could not be loaded.',
    'summary.metadata.model': 'Model: {model}',
    'summary.metadata.tools': 'Tools ({count}): {names}',
    'summary.metadata.time-range': 'Activity: {range}',
    'summary.updated': 'Updated {time}',
    'summary.blank': 'This session has not started yet.',
    'summary.unavailable': 'No DSH compaction summary is available yet. The latest generated summary will be pinned here automatically.',
  },
  zh: {
    'summary.label': '固定摘要',
    'summary.title': '固定摘要',
    'summary.close': '关闭固定摘要',
    'summary.copy': '复制摘要',
    'summary.copy-success': '摘要已复制',
    'summary.copy-failure': '当前无法复制',
    'summary.open-session': '打开会话',
    'summary.show-more': '查看完整内容',
    'summary.show-less': '收起内容',
    'summary.no-active': '没有活动会话',
    'summary.select-session': '选择一个会话查看摘要。',
    'summary.session': '会话',
    'summary.empty-placeholder': '当前 DSH 会话的摘要将显示在这里。',
    'summary.source.context': 'DSH 上下文摘要',
    'summary.source.assistant': '最新助手回复',
    'summary.source.overview': '会话概览',
    'summary.status.running': '运行中',
    'summary.status.waiting': '等待输入',
    'summary.status.ready': '就绪',
    'summary.status.no-session': '没有会话',
    'summary.status.loading': '加载中',
    'summary.status.blank': '尚未开始',
    'summary.status.unavailable': '不可用',
    'summary.status.error': '加载失败',
    'summary.loading': '正在加载会话摘要…',
    'summary.error': '无法加载该会话摘要。',
    'summary.metadata.model': '模型：{model}',
    'summary.metadata.tools': '工具（{count}）：{names}',
    'summary.metadata.time-range': '活动时间：{range}',
    'summary.updated': '更新于 {time}',
    'summary.blank': '该会话尚未开始。',
    'summary.unavailable': '暂无 DSH 压缩摘要。生成后将自动固定在这里。',
  },
}
