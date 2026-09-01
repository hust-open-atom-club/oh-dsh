import assert from 'node:assert/strict'
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { replaceMacBundle } from '../scripts/install-mac.mjs'

async function makeBundle(path: string, marker: string): Promise<void> {
  await mkdir(join(path, 'Contents', 'MacOS'), { recursive: true })
  await mkdir(join(
    path,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
  ), { recursive: true })
  await mkdir(join(path, 'Contents', 'Resources'), { recursive: true })
  await writeFile(join(path, 'Contents', 'MacOS', 'Oh-DSH Desktop'), marker)
  await writeFile(join(
    path,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Electron Framework',
  ), marker)
  await writeFile(join(path, 'Contents', 'Resources', 'app.asar'), marker)
}

test('local mac install never exposes a partially copied app bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oh-dsh-install-'))
  const source = join(root, 'source.app')
  const destination = join(root, 'Applications', 'Oh-DSH Desktop.app')
  const backups = join(root, 'Trash')
  await makeBundle(source, 'new')
  await makeBundle(destination, 'old')

  const result = await replaceMacBundle({
    source,
    destination,
    backupDirectory: backups,
    copyBundle: async (from: string, pending: string) => {
      assert.notEqual(pending, destination)
      assert.equal(
        await readFile(join(
          destination,
          'Contents',
          'Frameworks',
          'Electron Framework.framework',
          'Electron Framework',
        ), 'utf8'),
        'old',
      )
      await cp(from, pending, { recursive: true })
    },
    validateBundle: (path: string) => makeBundleValidation(path),
  })

  assert.equal(
    await readFile(join(destination, 'Contents', 'Resources', 'app.asar'), 'utf8'),
    'new',
  )
  assert.equal(
    await readFile(join(result.backup!, 'Contents', 'Resources', 'app.asar'), 'utf8'),
    'old',
  )
})

async function makeBundleValidation(path: string): Promise<void> {
  const values = await Promise.all([
    readFile(join(path, 'Contents', 'MacOS', 'Oh-DSH Desktop'), 'utf8'),
    readFile(join(
      path,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Electron Framework',
    ), 'utf8'),
    readFile(join(path, 'Contents', 'Resources', 'app.asar'), 'utf8'),
  ])
  assert.equal(new Set(values).size, 1)
}

function macTimestamp(date: Date): string {
  const part = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}`
    + `-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`
}

test('a mac bundle replace fails when every backup name is already taken', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oh-dsh-install-'))
  const source = join(root, 'source.app')
  const destination = join(root, 'Applications', 'Oh-DSH Desktop.app')
  const backups = join(root, 'Trash')
  await makeBundle(source, 'new')
  await makeBundle(destination, 'old')

  const now = Date.now()
  for (let offset = -1; offset <= 5; offset += 1) {
    const stem = `Oh-DSH Desktop-before-${macTimestamp(new Date(now + offset * 1000))}`
    for (let suffix = 0; suffix < 100; suffix += 1) {
      await mkdir(join(backups, suffix === 0 ? `${stem}.app` : `${stem}-${suffix}.app`), { recursive: true })
    }
  }
  const seeded = (await readdir(backups)).length

  await assert.rejects(
    replaceMacBundle({
      source,
      destination,
      backupDirectory: backups,
      copyBundle: async (from: string, to: string) => { await cp(from, to, { recursive: true }) },
      validateBundle: (path: string) => makeBundleValidation(path),
    }),
    /unable to reserve an Oh-DSH Desktop backup path/,
  )
  assert.equal(
    await readFile(join(destination, 'Contents', 'Resources', 'app.asar'), 'utf8'),
    'old',
    'the installed bundle must be untouched',
  )
  assert.equal(
    (await readdir(backups)).length,
    seeded,
    'the failed run must not reserve an additional backup path',
  )
})

test('a failed staged-copy validation aborts the replace and recovers on rerun', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oh-dsh-install-'))
  const source = join(root, 'source.app')
  const destination = join(root, 'Applications', 'Oh-DSH Desktop.app')
  const backups = join(root, 'Trash')
  await makeBundle(source, 'new')
  await makeBundle(destination, 'old')

  await assert.rejects(
    replaceMacBundle({
      source,
      destination,
      backupDirectory: backups,
      copyBundle: async (from: string, to: string) => { await cp(from, to, { recursive: true }) },
      validateBundle: async (path: string) => {
        if (path !== source) throw new Error('staged bundle failed validation')
      },
    }),
    /staged bundle failed validation/,
  )
  assert.equal(
    await readFile(join(destination, 'Contents', 'MacOS', 'Oh-DSH Desktop'), 'utf8'),
    'old',
    'the old bundle must survive the aborted replace intact',
  )
  assert.deepEqual(
    await readdir(join(root, 'Applications')),
    ['Oh-DSH Desktop.app'],
    'the pending copy must be cleaned up',
  )

  const result = await replaceMacBundle({
    source,
    destination,
    backupDirectory: backups,
    copyBundle: async (from: string, to: string) => { await cp(from, to, { recursive: true }) },
    validateBundle: (path: string) => makeBundleValidation(path),
  })
  assert.equal(
    await readFile(join(destination, 'Contents', 'Resources', 'app.asar'), 'utf8'),
    'new',
  )
  assert.equal(
    await readFile(join(result.backup!, 'Contents', 'Resources', 'app.asar'), 'utf8'),
    'old',
  )
})

test('replaceMacBundle is safe to run twice without overwriting the earlier backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oh-dsh-install-'))
  const sourceA = join(root, 'source-a.app')
  const sourceB = join(root, 'source-b.app')
  const destination = join(root, 'Applications', 'Oh-DSH Desktop.app')
  const backups = join(root, 'Trash')
  await makeBundle(sourceA, 'one')
  await makeBundle(sourceB, 'two')
  await makeBundle(destination, 'old')

  const copy = async (from: string, to: string) => { await cp(from, to, { recursive: true }) }
  const first = await replaceMacBundle({
    source: sourceA,
    destination,
    backupDirectory: backups,
    copyBundle: copy,
    validateBundle: (path: string) => makeBundleValidation(path),
  })
  const second = await replaceMacBundle({
    source: sourceB,
    destination,
    backupDirectory: backups,
    copyBundle: copy,
    validateBundle: (path: string) => makeBundleValidation(path),
  })

  assert.notEqual(first.backup, second.backup, 'the second run must reserve a fresh backup path')
  assert.equal(
    await readFile(join(destination, 'Contents', 'Resources', 'app.asar'), 'utf8'),
    'two',
  )
  assert.equal(
    await readFile(join(first.backup!, 'Contents', 'Resources', 'app.asar'), 'utf8'),
    'old',
    'the first backup must not be overwritten by the second run',
  )
  assert.equal(
    await readFile(join(second.backup!, 'Contents', 'Resources', 'app.asar'), 'utf8'),
    'one',
  )
})
