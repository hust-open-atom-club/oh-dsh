import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { test } from 'node:test'
import {
  desktopLaunchSpec,
  main,
  runUpdateCommand,
} from '../src/cli.ts'
import type { SelfUpdateSurface } from '../src/self-update.ts'

function output(): { stream: NodeJS.WriteStream; text: () => string } {
  let value = ''
  return {
    stream: {
      isTTY: false,
      write: (chunk: string) => {
        value += chunk
        return true
      },
    } as unknown as NodeJS.WriteStream,
    text: () => value,
  }
}

/** Write the payload launcher files surfaceIsInstalled probes per platform. */
async function writePayloadLauncher(payload: string): Promise<void> {
  await writeFile(join(payload, 'bin', 'ohdsh'), '')
  await writeFile(join(payload, 'bin', 'ohdsh.cmd'), '')
}

test('ohdsh dispatches desktop aliases, web, and TUI through one surface command', async () => {
  const stdout = output()
  const stderr = output()
  const calls: Array<{ args: readonly string[]; surface: string }> = []

  assert.equal(await main(
    ['desktop', '--inspect'],
    {},
    stdout.stream,
    stderr.stream,
    async args => {
      calls.push({ args, surface: 'desktop' })
      return 0
    },
    async args => {
      calls.push({ args, surface: 'web' })
      return 0
    },
  ), 0)
  assert.equal(await main(
    ['gui', '--inspect'],
    {},
    stdout.stream,
    stderr.stream,
    async args => {
      calls.push({ args, surface: 'desktop' })
      return 0
    },
    async () => 0,
  ), 0)
  assert.equal(await main(
    ['web', '--port', '0'],
    {},
    stdout.stream,
    stderr.stream,
    async () => 0,
    async args => {
      calls.push({ args, surface: 'web' })
      return 0
    },
  ), 0)
  assert.equal(await main(
    ['tui', '--inline'],
    {},
    stdout.stream,
    stderr.stream,
    async () => 0,
    async () => 0,
    async args => {
      calls.push({ args, surface: 'tui' })
      return 0
    },
  ), 0)
  assert.deepEqual(calls, [
    { args: ['--inspect'], surface: 'desktop' },
    { args: ['--inspect'], surface: 'desktop' },
    { args: ['--port', '0'], surface: 'web' },
    { args: ['--inline'], surface: 'tui' },
  ])
})

test('layered distributions list and reject unavailable surfaces', async () => {
  const stdout = output()
  const stderr = output()
  assert.equal(await main(
    ['--help'],
    { OH_DSH_SURFACES: 'web' },
    stdout.stream,
    stderr.stream,
  ), 0)
  assert.match(stdout.text(), /web\s+Start Oh-DSH Web/)
  assert.doesNotMatch(stdout.text(), /Start Oh-DSH Desktop/)
  assert.doesNotMatch(stdout.text(), /Start Oh-DSH TUI/)

  assert.equal(await main(
    ['desktop'],
    { OH_DSH_SURFACES: 'web' },
    stdout.stream,
    stderr.stream,
  ), 2)
  assert.match(stderr.text(), /Surface 'desktop' is not included/)
  assert.equal(await main(
    ['gui'],
    { OH_DSH_SURFACES: 'web' },
    stdout.stream,
    stderr.stream,
  ), 2)
  assert.match(stderr.text(), /Surface 'gui' is not included/)
})

test('desktop launch keeps source and installed macOS paths distinct', () => {
  assert.deepEqual(desktopLaunchSpec([], {
    OH_DSH_DESKTOP_APP: '/Applications/Oh-DSH Desktop.app',
  }, 'darwin'), {
    args: ['/Applications/Oh-DSH Desktop.app'],
    command: '/usr/bin/open',
  })
  assert.deepEqual(desktopLaunchSpec([], {}, 'darwin'), {
    args: ['-a', 'Oh-DSH Desktop'],
    command: '/usr/bin/open',
  })
})

test('macOS installed launches inherit the shared Oh-DSH state root', () => {
  assert.deepEqual(desktopLaunchSpec([], {
    OH_DSH_HOME: '/data/oh-dsh',
  }, 'darwin'), {
    args: ['--env', 'OH_DSH_HOME=/data/oh-dsh', '-a', 'Oh-DSH Desktop'],
    command: '/usr/bin/open',
  })
  assert.deepEqual(desktopLaunchSpec(['--inspect'], {
    OH_DSH_DESKTOP_APP: '/Applications/Oh-DSH Desktop.app',
    OH_DSH_HOME: '/data/oh-dsh',
  }, 'darwin'), {
    args: [
      '--env',
      'OH_DSH_HOME=/data/oh-dsh',
      '/Applications/Oh-DSH Desktop.app',
      '--args',
      '--inspect',
    ],
    command: '/usr/bin/open',
  })
  assert.deepEqual(desktopLaunchSpec([], {
    OH_DSH_HOME: './relative-state',
  }, 'darwin'), {
    args: [
      '--env',
      `OH_DSH_HOME=${posix.resolve('./relative-state')}`,
      '-a',
      'Oh-DSH Desktop',
    ],
    command: '/usr/bin/open',
  })
})

test('desktop launch resolves paths with target platform semantics', () => {
  assert.deepEqual(desktopLaunchSpec(['--inspect'], {
    OH_DSH_DESKTOP_APP: 'C:\\Tools\\Oh-DSH Desktop.exe',
  }, 'win32'), {
    args: ['--inspect'],
    command: 'C:\\Tools\\Oh-DSH Desktop.exe',
  })
})

test('ohdsh update without a surface upgrades every installed surface', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ohdsh-update-all-'))
  const recordHome = join(home, '.ohdsh', 'installer')
  const tuiPayload = join(home, 'tui-root')
  await mkdir(join(recordHome), { recursive: true })
  await mkdir(join(tuiPayload, 'bin'), { recursive: true })
  // The launcher's own payload marker keeps this a packaged distribution.
  await writeFile(join(tuiPayload, '.oh-dsh-install.env'), 'OH_DSH_INSTALL_SURFACE=tui\n')
  await writePayloadLauncher(tuiPayload)
  const webPayload = join(home, 'web-root')
  await mkdir(join(webPayload, 'bin'), { recursive: true })
  await writePayloadLauncher(webPayload)
  const desktopExe = join(home, 'apps', 'Oh-DSH Desktop.app', 'Contents', 'MacOS', 'Oh-DSH Desktop')
  await mkdir(dirname(desktopExe), { recursive: true })
  await writeFile(desktopExe, '')
  await writeFile(
    join(recordHome, 'launcher.env'),
    [
      `WEB_DEST=${webPayload}`,
      `TUI_DEST=${tuiPayload}`,
      `DESKTOP_EXE=${desktopExe}`,
      `BIN_DIR=${join(home, 'bin')}`,
    ].join('\n') + '\n',
  )
  const env = { HOME: home, DSH_OH_TUI_ROOT: tuiPayload }

  const upgraded: string[][] = []
  const stdout = output()
  assert.equal(await runUpdateCommand(
    [],
    env,
    stdout.stream,
    output().stream,
    async (surfaces, _env, announce) => {
      upgraded.push([...surfaces])
      for (const surface of surfaces) announce(surface)
      return 0
    },
  ), 0)
  assert.deepEqual(upgraded, [['desktop', 'web', 'tui']])
  assert.match(stdout.text(), /Upgrading Oh-DSH desktop, web, tui/)
  assert.match(stdout.text(), /=== Upgrading Oh-DSH desktop ===/)
})

test('ohdsh update upgrades only the surfaces that are installed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ohdsh-update-tui-only-'))
  const payloadHome = join(home, '.local', 'share', 'oh-dsh')
  const tuiPayload = join(payloadHome, 'tui')
  await mkdir(join(tuiPayload, 'bin'), { recursive: true })
  await writeFile(join(tuiPayload, '.oh-dsh-install.env'), 'OH_DSH_INSTALL_SURFACE=tui\n')
  await writePayloadLauncher(tuiPayload)
  const env = { HOME: home, DSH_OH_TUI_ROOT: tuiPayload }

  const upgraded: string[][] = []
  assert.equal(await runUpdateCommand(
    [],
    env,
    output().stream,
    output().stream,
    async surfaces => {
      upgraded.push([...surfaces])
      return 0
    },
  ), 0)
  assert.deepEqual(upgraded, [['tui']])
})

test('ohdsh update <surface> requires that surface to be installed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ohdsh-update-explicit-'))
  const payloadHome = join(home, '.local', 'share', 'oh-dsh')
  const tuiPayload = join(payloadHome, 'tui')
  await mkdir(join(tuiPayload, 'bin'), { recursive: true })
  await writeFile(join(tuiPayload, '.oh-dsh-install.env'), 'OH_DSH_INSTALL_SURFACE=tui\n')
  await writePayloadLauncher(tuiPayload)
  const env = { HOME: home, DSH_OH_TUI_ROOT: tuiPayload }

  const stderr = output()
  assert.equal(await runUpdateCommand(
    ['desktop'],
    env,
    output().stream,
    stderr.stream,
    async () => 0,
  ), 2)
  assert.match(stderr.text(), /no installer-owned desktop installation was found/)

  const upgraded: string[][] = []
  const recorder = async (surfaces: readonly SelfUpdateSurface[]): Promise<number> => {
    upgraded.push([...surfaces])
    return 0
  }
  assert.equal(await runUpdateCommand(
    ['web'],
    env,
    output().stream,
    output().stream,
    recorder,
  ), 2)
  assert.deepEqual(upgraded, [])

  assert.equal(await runUpdateCommand(
    ['tui'],
    env,
    output().stream,
    output().stream,
    recorder,
  ), 0)
  assert.deepEqual(upgraded, [['tui']])
})

test('ohdsh update rejects unknown surfaces, empty machines, and source roots', async () => {
  const stderr = output()
  assert.equal(await runUpdateCommand(
    ['wireless'],
    { DSH_OH_TUI_ROOT: '/nonexistent-oh-dsh-payload' },
    output().stream,
    stderr.stream,
    async () => 0,
  ), 2)
  assert.match(stderr.text(), /Unknown surface: wireless/)

  const home = await mkdtemp(join(tmpdir(), 'ohdsh-update-empty-'))
  const payloadRoot = join(home, 'tui-root')
  await mkdir(payloadRoot, { recursive: true })
  await writeFile(join(payloadRoot, '.oh-dsh-install.env'), 'OH_DSH_INSTALL_SURFACE=tui\n')
  const source = output()
  assert.equal(await runUpdateCommand(
    [],
    { HOME: home, DSH_OH_TUI_ROOT: payloadRoot },
    output().stream,
    source.stream,
    async () => 0,
  ), 2)
  assert.match(source.text(), /no installer-owned installation was found/)

  const checkout = output()
  assert.equal(await runUpdateCommand(
    [],
    { HOME: home, OH_DSH_SOURCE_ROOT: home },
    output().stream,
    checkout.stream,
    async () => 0,
  ), 2)
  assert.match(checkout.text(), /needs a packaged installation/)
})
