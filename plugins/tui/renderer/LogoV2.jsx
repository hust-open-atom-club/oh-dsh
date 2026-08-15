import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getLang, t as tr } from '../i18n.js'
import { Box, Text, useTerminalSize } from '../ui.js'

/*! OH_DSH_STARTUP_CARD_V1 */

const VERSION = (() => {
  try {
    const packagePath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'package.json',
    )
    return JSON.parse(readFileSync(packagePath, 'utf8')).version ?? '0.1.0'
  } catch {
    return '0.1.0'
  }
})()

const WIDE_CARD_COLUMNS = 90
const RECENT_SESSION_LIMIT = 3

const WHALE = [
  ['                  ▄      ▄', 'purple_FOR_SUBAGENTS_ONLY'],
  ['              ▄▄███▄  ▄██', 'purple_FOR_SUBAGENTS_ONLY'],
  ['      ▄▄▄▄▄█████████████▀', 'blue_FOR_SUBAGENTS_ONLY'],
  ['   ▄███████████████████', 'claude'],
  [' ▄█████████████████████▄', 'claude'],
  ['  ▀████████████████████▀', 'blue_FOR_SUBAGENTS_ONLY'],
  ['     ▀▀████████████▀▀', 'purple_FOR_SUBAGENTS_ONLY'],
  ['          ▀▀▀▀▀', 'purple_FOR_SUBAGENTS_ONLY'],
]

const COPY = {
  en: {
    noSessions: 'No resumable sessions in this workspace',
    recentSessions: 'Recent sessions',
    tips: [
      ['Tab', 'Complete commands and paths'],
      ['Ctrl+C ×2', 'Exit with a resumable session hint'],
      ['/help', 'Browse commands and shortcuts'],
      ['PgUp/PgDn', 'Scroll through the transcript'],
    ],
    tipsTitle: 'Tips',
  },
  zh: {
    noSessions: '当前工作区暂无可恢复会话',
    recentSessions: '最近会话',
    tips: [
      ['Tab', '补全命令和路径'],
      ['Ctrl+C ×2', '退出并提示可恢复会话'],
      ['/help', '浏览命令和快捷键'],
      ['PgUp/PgDn', '滚动浏览对话记录'],
    ],
    tipsTitle: '使用提示',
  },
}

function capitalize(value) {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1)
}

function formatRelativeTime(timestamp, lang) {
  const elapsed = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return lang === 'zh' ? '刚刚' : 'just now'
  if (minutes < 60) return lang === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return lang === 'zh' ? `${hours} 小时前` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return lang === 'zh' ? `${days} 天前` : `${days}d ago`
  return new Date(timestamp).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function sessionLabel(session) {
  const title = session.title.replace(/\s+/g, ' ').trim()
  return title || `session ${String(session.id).slice(0, 8)}`
}

function CompactWhale() {
  return (
    <Box flexDirection="column" alignItems="center">
      {WHALE.map(([row, color], index) => (
        <Text key={index} color={color} wrap="truncate-end">
          {row}
        </Text>
      ))}
    </Box>
  )
}

function IdentityPanel({ model, effort, cwd, wide }) {
  return (
    <Box
      flexDirection="column"
      alignItems={wide ? 'center' : 'flex-start'}
      flexShrink={wide ? 0 : 1}
      width={wide ? 34 : '100%'}
      paddingX={2}
      paddingY={1}
      borderStyle="single"
      borderColor="promptBorder"
      borderTop={false}
      borderLeft={false}
      borderRight={wide}
      borderBottom={!wide}
    >
      <Text bold color="claude" wrap="truncate-end">
        {tr('logo-tagline')}
      </Text>
      {wide && (
        <Box marginY={1}>
          <CompactWhale />
        </Box>
      )}
      <Text wrap="truncate-end">
        {model}
        {effort !== undefined && (
          <Text dimColor>{` · ${capitalize(effort)}`}</Text>
        )}
      </Text>
      <Text dimColor wrap="truncate-end">
        {cwd}
      </Text>
    </Box>
  )
}

function TipRow({ shortcut, description, wide }) {
  return (
    <Box flexDirection="row">
      <Box width={wide ? 14 : 12} flexShrink={0}>
        <Text color="claude" wrap="truncate-end">
          {shortcut}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {description}
        </Text>
      </Box>
    </Box>
  )
}

function DetailsPanel({ sessions, wide, copy, lang }) {
  const recent = sessions.slice(0, RECENT_SESSION_LIMIT)
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="claude">
          {copy.tipsTitle}
        </Text>
        {copy.tips.map(([shortcut, description]) => (
          <TipRow
            key={shortcut}
            shortcut={shortcut}
            description={description}
            wide={wide}
          />
        ))}
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        paddingX={2}
        paddingY={1}
        borderStyle="single"
        borderColor="promptBorder"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <Text bold color="claude">
          {copy.recentSessions}
        </Text>
        {recent.length === 0 ? (
          <Text dimColor italic>
            {copy.noSessions}
          </Text>
        ) : (
          recent.map(session => (
            <Text key={session.id} dimColor wrap="truncate-end">
              {sessionLabel(session)} ({formatRelativeTime(session.updatedAt, lang)})
            </Text>
          ))
        )}
      </Box>
    </Box>
  )
}

export function LogoV2({ model, effort, cwd, sessions = [] }) {
  const { columns } = useTerminalSize()
  const wide = columns >= WIDE_CARD_COLUMNS
  const lang = getLang()
  const copy = COPY[lang] ?? COPY.en
  const title = process.env.OH_DSH_TUI_TITLE ?? 'Oh-DSH TUI'
  const version = process.env.DSH_OH_TUI_VERSION ?? VERSION

  return (
    <Box flexDirection="column" marginTop={1} width="100%">
      <Box
        flexDirection={wide ? 'row' : 'column'}
        width="100%"
        borderStyle="round"
        borderColor="promptBorder"
        borderText={{
          content: ` ${title} v${version} `,
          position: 'top',
          align: 'start',
          offset: 1,
        }}
      >
        <IdentityPanel model={model} effort={effort} cwd={cwd} wide={wide} />
        <DetailsPanel sessions={sessions} wide={wide} copy={copy} lang={lang} />
      </Box>
    </Box>
  )
}
