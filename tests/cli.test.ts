import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  desktopLaunchSpec,
  main,
} from '../src/cli.ts'

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

test('ohdsh dispatches desktop, web, and TUI through one surface command', async () => {
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
      `OH_DSH_HOME=${resolve('./relative-state')}`,
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
