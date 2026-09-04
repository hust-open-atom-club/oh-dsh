import assert from 'node:assert/strict'
import { spawn, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { TUI_BUNDLES, TUI_PROFILE } from '../src/profile.ts'
import { adaptTuiLiangshenPresentation } from '../plugins/liangshen/src/upstream-adapter.mjs'
import { adaptTuiRendererPackage } from '../scripts/tui-upstream-adapter.mjs'
import {
  DEFAULT_TUI_HOME,
  main,
  parseTuiArgs,
  type TuiSpawner,
} from '../src/tui.ts'

function output(isTTY = false): { stream: NodeJS.WriteStream; text: () => string } {
  let value = ''
  return {
    stream: {
      isTTY,
      write: (chunk: string) => {
        value += chunk
        return true
      },
    } as unknown as NodeJS.WriteStream,
    text: () => value,
  }
}

test('TUI arguments keep environment defaults behind explicit flags', () => {
  assert.equal(DEFAULT_TUI_HOME, join(homedir(), '.ohdsh'))

  const defaults = parseTuiArgs([], {
    DSH_OH_TUI_CWD: '/env/workspace',
    DSH_OH_TUI_FULLSCREEN: '0',
    DSH_OH_TUI_HOME: '/env/home',
    DSH_OH_TUI_LANG: 'en',
    DSH_OH_TUI_PRESET: 'code',
    DSH_OH_TUI_SESSION_ID: 'session-from-env',
  }, '/default/workspace', '/default/home')
  assert.deepEqual(defaults, {
    cwd: '/env/workspace',
    dataRoot: '/env/home',
    fullscreen: false,
    help: false,
    lang: 'en',
    preset: 'code',
    sessionId: 'session-from-env',
  })

  assert.equal(parseTuiArgs([], {}, '/default/workspace', '/default/home').fullscreen, false)

  assert.equal(
    parseTuiArgs([], { OH_DSH_HOME: '/shared/home' }).dataRoot,
    '/shared/home',
  )

  const flags = parseTuiArgs([
    '--cwd', '/flag/workspace',
    '--data=/flag/home',
    '--resume', 'session-from-flag',
    '--lang', 'zh',
    '--preset=minimal',
    '--fullscreen',
  ], {
    DSH_OH_TUI_FULLSCREEN: '0',
  }, '/default/workspace', '/default/home')
  assert.deepEqual(flags, {
    cwd: '/flag/workspace',
    dataRoot: '/flag/home',
    fullscreen: true,
    help: false,
    lang: 'zh',
    preset: 'minimal',
    sessionId: 'session-from-flag',
  })
})

test('TUI launcher initializes its profile and attaches the packaged runtime', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-tui-'))
  const packaged = join(root, 'package')
  const workspace = join(root, 'workspace')
  const dataRoot = join(root, 'data')
  const nodeBinary = process.platform === 'win32'
    ? join(packaged, 'node-runtime', 'node.exe')
    : join(packaged, 'node-runtime', 'bin', 'node')
  const cliEntry = join(packaged, 'dsh-runtime', 'lib', 'bin.js')
  mkdirSync(dirname(nodeBinary), { recursive: true })
  mkdirSync(dirname(cliEntry), { recursive: true })
  mkdirSync(workspace, { recursive: true })
  writeFileSync(nodeBinary, '')
  writeFileSync(cliEntry, '')
  writeFileSync(join(packaged, 'package.json'), '{"version":"1.2.3"}\n')

  let launch: { args: readonly string[]; command: string; options: SpawnOptions } | undefined
  const spawnTui = ((
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => {
    launch = { args, command, options }
    const child = new EventEmitter()
    queueMicrotask(() => { child.emit('exit', 0, null) })
    return child as ReturnType<typeof spawn>
  }) as TuiSpawner

  const stdout = output(true)
  const stderr = output(true)
  try {
    assert.equal(await main(
      ['--cwd', workspace, '--data', dataRoot, '--inline', '--lang', 'en'],
      { DSH_OH_TUI_ROOT: packaged, PATH: process.env.PATH },
      stdout.stream,
      stderr.stream,
      spawnTui,
      { isTTY: true } as Readable & { isTTY?: boolean },
    ), 0)
    assert.ok(launch)
    assert.equal(launch.command, nodeBinary)
    assert.deepEqual(launch.args, [cliEntry, '--profile', TUI_PROFILE])
    assert.equal(launch.options.cwd, workspace)
    assert.equal(launch.options.stdio, 'inherit')
    const childEnv = launch.options.env
    assert.equal(childEnv?.DSH_HOME, dataRoot)
    assert.equal(childEnv?.OH_DSH_HOME, dataRoot)
    assert.equal(childEnv?.CC_TUI_LANG, undefined)
    assert.equal(childEnv?.CC_TUI_PRESET, undefined)
    assert.equal(childEnv?.DSH_CC_RESUME_SESSION, undefined)
    assert.equal(childEnv?.OH_DSH_TUI_FULLSCREEN, '0')
    assert.equal(childEnv?.OH_DSH_TUI_LANG, 'en')
    assert.equal(childEnv?.DSH_OH_TUI_VERSION, '1.2.3')
    assert.equal(childEnv?.OH_DSH_TUI_CONFIG_HOME, join(dataRoot, 'tui'))
    assert.equal(childEnv?.OH_DSH_TUI_TITLE, 'Oh-DSH TUI')

    const manifest = JSON.parse(readFileSync(
      join(dataRoot, 'profiles', TUI_PROFILE, 'package.json'),
      'utf8',
    ))
    assert.equal(manifest.name, 'dsh-profile-tui')
    assert.deepEqual(manifest.dsh.profile.bundles, TUI_BUNDLES)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('TUI bundle mounts Oh-DSH adapters before the upstream renderer', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const patch = readFileSync(
    join(root, 'plugins', 'tui', 'cordis.patch.yml'),
    'utf8',
  ).replace(/\r\n?/g, '\n')
  assert.match(patch, /- id: cc-tui\n  disabled: true/)
  assert.match(patch, /- id: dsh-tui\n  disabled: true/)
  assert.match(patch, /fullscreen: !!js "process\.env\.OH_DSH_TUI_FULLSCREEN === '1'"/)
  const surface = patch.indexOf("name: '@oh-dsh/tui'")
  const marketplace = patch.indexOf("name: '@oh-dsh/plugin-marketplace'")
  const skins = patch.indexOf("name: '@oh-dsh/skins'")
  const marketplaceScene = patch.indexOf("name: '@oh-dsh/tui-marketplace'")
  const renderer = patch.indexOf("name: '@deepseek-harness-tui/dsh-tui'")
  assert.ok(surface >= 0
    && surface < marketplace
    && marketplace < skins
    && skins < marketplaceScene
    && marketplaceScene < renderer)
})

test('TUI upstream adapter removes legacy terminal branding and scopes storage', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-tui-adapter-'))
  const repository = join(dirname(fileURLToPath(import.meta.url)), '..')
  const lib = join(root, 'lib', 'types')
  cpSync(join(repository, 'upstream', 'dsh-TUI', 'lib', 'types'), lib, {
    recursive: true,
  })
  try {
    adaptTuiRendererPackage(root)
    adaptTuiLiangshenPresentation(root)
    const paths = readFileSync(join(lib, 'utils', 'paths.js'), 'utf8')
    assert.match(paths, /OH_DSH_TUI_CONFIG_HOME/)
    assert.match(paths, /LEGACY_DATA_DIR = DATA_DIR/)
    assert.doesNotMatch(paths, /join\(homeDir\(\), '\.dsh-(?:tui|cc)'\)/)
    const logo = readFileSync(join(lib, 'components', 'LogoV2.js'), 'utf8')
    assert.match(logo, /CodexStartupOverlay/)
    assert.match(logo, /borderStyle: "round"/)
    assert.doesNotMatch(logo, /permissions: |DSH_PERMISSION_MODE|codexPermissionLabel/)
    assert.match(logo, /DSH_OH_TUI_VERSION/)
    assert.match(logo, /effortLabel = effort === undefined \? '' : ' ' \+ capitalize\(effort\)/)
    assert.equal((logo.match(/function CodexStartupOverlay\(/g) ?? []).length, 1)
    assert.match(logo, /export function LogoV2\(\{ model, effort, cwd \}\)/)
    assert.doesNotMatch(logo, /WhaleArt|OPENING_SEQUENCE|renderBigText/)
    const overlay = readFileSync(join(lib, 'components', 'OverlayAbove.js'), 'utf8')
    assert.match(overlay, /bottom: "100%"/)
    assert.doesNotMatch(overlay, /top: "100%"/)
    const messageList = readFileSync(join(lib, 'components', 'MessageList.js'), 'utf8')
    assert.match(messageList, /flexDirection: "column", children: _jsx\(LogoV2/)
    const loadedContext = readFileSync(join(lib, 'components', 'LoadedContextPanel.js'), 'utf8')
    assert.match(loadedContext, /flexDirection: "column", children: \[_jsx\(Box, \{ paddingX: 1/)
    assert.doesNotMatch(
      loadedContext,
      /return \(_jsxs\(Box, \{ flexDirection: "column", marginTop: 1, marginBottom: 1/,
    )
    const promptInput = readFileSync(join(lib, 'components', 'PromptInput.js'), 'utf8')
    assert.match(promptInput, /flexDirection: "column", children: \[floatersOpen &&/)
    const chat = readFileSync(join(lib, 'screens', 'Chat.js'), 'utf8')
    assert.match(chat, /Oh-DSH TUI/)
    assert.match(chat, /inlineLayout = fullscreen === false/)
    assert.match(chat, /flexGrow: inlineLayout \? 0 : 1, width: "100%"/)
    assert.match(chat, /flexDirection: "row", flexGrow: inlineLayout \? 0 : 1/)
    assert.match(chat, /flexGrow: inlineLayout \? 0 : 1, flexShrink: inlineLayout \? 0 : 1, stickyScroll: true/)
    const scrollBox = readFileSync(join(lib, 'ink', 'components', 'ScrollBox.js'), 'utf8')
    assert.match(scrollBox, /flexGrow: style\.flexGrow \?\? 0/)
    const commands = readFileSync(join(lib, 'commands.js'), 'utf8')
    assert.match(commands, /Exit Oh-DSH TUI/)
    assert.doesNotMatch(commands, /description: .*dsh-tui/)
    const plugin = readFileSync(join(lib, 'dsh-adapter', 'plugin.js'), 'utf8')
    assert.match(plugin, /if \(process\.env\.DSH_OH_TUI !== '1'\)/)
    assert.match(plugin, /ohdsh tui --resume/)
    assert.doesNotMatch(plugin, /dsh-tui --resume/)
    const ink = readFileSync(join(lib, 'ink', 'ink.js'), 'utf8')
    assert.match(
      ink,
      /if \(process\.env\.DSH_OH_TUI !== '1' \|\| process\.env\.OH_DSH_TUI_FULLSCREEN === '1'\) \{\s+this\.log\.requestViewportReanchor\(\);\s+this\.renderNow\(\);/,
    )
    assert.match(
      ink,
      /if \(process\.env\.DSH_OH_TUI !== '1' \|\| process\.env\.OH_DSH_TUI_FULLSCREEN === '1'\) \{\s+this\.log\.requestViewportReanchor\(\);\s+this\.scheduleRender\(\);/,
    )
    const messages = readFileSync(join(lib, 'i18n.js'), 'utf8')
    assert.match(messages, /~\/\.ohdsh\/tui/)
    assert.doesNotMatch(messages, /dsh-tui|~\/\.dsh-tui/)
    assert.match(messages, /Harness credentials service/)
    assert.match(messages, /密钥由 Harness 凭据服务管理/)
    assert.match(messages, /\$DSH_HOME\/\.credentials\.yaml/)
    assert.match(messages, /already in the process environment, write skipped/)
    assert.match(messages, /进程环境已提供同名变量，跳过写入/)
    assert.doesNotMatch(messages, /~\/\.dsh\/\.credentials\.yaml|密钥将写入/)
    assert.match(messages, /Liangshen mode/)
    assert.match(messages, /'preset-desc-liangshen':/)
    const providerWizard = readFileSync(
      join(lib, 'dsh-adapter', 'providerWizard.js'),
      'utf8',
    )
    assert.match(providerWizard, /\$DSH_HOME\/\.credentials\.yaml/)
    assert.doesNotMatch(providerWizard, /~\/\.dsh\/\.credentials\.yaml/)
    const channel = readFileSync(join(lib, 'dsh-adapter', 'channel.js'), 'utf8')
    assert.match(channel, /oh-dsh-tui-export-/)
    assert.doesNotMatch(
      channel,
      /const fileName = `dsh-tui-export-|join\(userHome, '\.dsh-tui\//,
    )
    const compatibility = readFileSync(
      join(lib, 'dsh-adapter', 'compat', 'sessionLog.js'),
      'utf8',
    )
    assert.match(compatibility, /OH_DSH_TUI_CONFIG_HOME/)
    const themeProvider = readFileSync(
      join(lib, 'components', 'design-system', 'ThemeProvider.js'),
      'utf8',
    )
    assert.doesNotMatch(themeProvider, /\[dsh-tui\]|~\/\.dsh-tui/)
    const customTheme = readFileSync(join(lib, 'customTheme.js'), 'utf8')
    assert.doesNotMatch(customTheme, /\[dsh-tui\]|~\/\.dsh-tui/)
    const pluginStorage = readFileSync(join(lib, 'dsh-adapter', 'plugin-storage.js'), 'utf8')
    assert.doesNotMatch(pluginStorage, /~\/\.dsh-tui/)
    assert.doesNotThrow(() => {
      adaptTuiRendererPackage(root)
      adaptTuiLiangshenPresentation(root)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('TUI marketplace restart markers are best-effort', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const plugin = readFileSync(
    join(root, 'plugins', 'tui-marketplace', 'src', 'plugin.ts'),
    'utf8',
  )
  const marker = plugin.slice(
    plugin.indexOf('function writeRestartMarker'),
    plugin.indexOf('/** Register the Oh-DSH marketplace'),
  )
  assert.match(marker, /try \{[\s\S]*writeFileSync/)
  assert.match(marker, /catch \{[\s\S]*advisory/)
})

test('TUI refuses a non-interactive stream before touching the runtime', async () => {
  const stdout = output(false)
  const stderr = output(false)
  assert.equal(await main(
    [],
    {},
    stdout.stream,
    stderr.stream,
    undefined,
    { isTTY: false } as Readable & { isTTY?: boolean },
  ), 2)
  assert.match(stderr.text(), /requires an interactive terminal/)
})

test('TUI help is available without a terminal or staged runtime', async () => {
  const stdout = output(false)
  assert.equal(await main(['--help'], {}, stdout.stream), 0)
  assert.match(stdout.text(), /ohdsh tui/)
  assert.match(stdout.text(), /--resume/)
})
