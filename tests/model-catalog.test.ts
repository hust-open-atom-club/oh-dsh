import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** One advisory model-catalog entry in an `llm-deepseek` patch row. */
interface CatalogModel {
  id: string
  name: string
  description?: string
  contextWindow: number
  inputModalities?: string[]
  imagePixelBudget?: number
  imageMaxBytes?: number
}

interface PatchRow {
  id?: string
  config?: { models?: CatalogModel[] }
}

/** The surface patch layers copied verbatim into each distribution. */
const SURFACE_PATCHES = [
  'cordis.patch.yml',
  join('web', 'cordis.patch.yml'),
  join('plugins', 'tui', 'cordis.patch.yml'),
] as const

// The TUI layer embeds `!!js` expression scalars in other rows; keep them
// as raw strings so the shared catalog rows still parse.
const jsExpressionTag = { tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }

function surfaceCatalogModels(path: string): CatalogModel[] {
  const rows = parse(readFileSync(join(root, path), 'utf8'), {
    customTags: [jsExpressionTag],
  }) as PatchRow[]
  const row = rows.find(entry => entry.id === 'llm-deepseek')
  assert.notEqual(row, undefined, `${path} must configure the llm-deepseek catalog row`)
  assert.notEqual(row?.config?.models, undefined, `${path} must set llm-deepseek config.models`)
  return row?.config?.models ?? []
}

test('every surface patch ships the same DeepSeek advisory model catalog', () => {
  const catalogs = SURFACE_PATCHES.map(surfaceCatalogModels)
  for (const path of SURFACE_PATCHES.slice(1)) {
    assert.deepEqual(
      surfaceCatalogModels(path),
      catalogs[0],
      `${path} drifted from the desktop catalog`,
    )
  }
})

test('the default catalog adds DeepSeek-V4.1-Flash beside the pinned runtime models', () => {
  const models = surfaceCatalogModels(SURFACE_PATCHES[0])
  assert.deepEqual(
    models.map(model => model.id),
    [
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-v4-flash-vision-exp',
      'deepseek-v4.1-flash-expires-on-0910',
    ],
  )

  // Catalog invariants the llm-deepseek adapter enforces at resolve time:
  // unique ids, and image request limits only on image-capable models.
  assert.equal(new Set(models.map(model => model.id)).size, models.length)
  for (const model of models) {
    const acceptsImages = model.inputModalities?.includes('image') === true
    if (!acceptsImages) {
      assert.equal(model.imagePixelBudget, undefined)
      assert.equal(model.imageMaxBytes, undefined)
    }
  }

  const v41 = models.find(model => model.id === 'deepseek-v4.1-flash-expires-on-0910')
  assert.equal(v41?.name, 'DeepSeek-V4.1-Flash-Expires-On-0910')
  assert.equal(v41?.contextWindow, 1000000)
  assert.deepEqual(v41?.inputModalities, ['text', 'image'])
  assert.equal(v41?.imagePixelBudget, 640000)
  assert.equal(v41?.imageMaxBytes, 1048576)
})
