import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  discoverAgentPresetPackages,
  discoverAgentPresetManifests,
  readAgentPresetManifest,
} from '../scripts/agent-presets.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

interface Fixture {
  compositionPath: string
  manifestPath: string
  presetDirectory: string
  root: string
}

function writePackage(repoRoot: string, path: string, name: string): void {
  const directory = join(repoRoot, path)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ name, version: '1.0.0' })}\n`)
}

function fixture(id = 'demo-mode'): Fixture {
  const repoRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-agent-presets-'))
  const presetDirectory = join(repoRoot, 'agent-presets', id)
  mkdirSync(presetDirectory, { recursive: true })
  writePackage(repoRoot, 'plugins/demo-agent', '@oh-dsh/demo-agent')
  writePackage(repoRoot, 'plugins/demo-host', '@oh-dsh/demo-host')
  const manifestPath = join(presetDirectory, 'manifest.yml')
  const compositionPath = join(presetDirectory, 'agent.cordis.yml')
  writeFileSync(join(presetDirectory, 'preset.yml'), 'name: Demo mode\ndescription: Test fixture.\n')
  writeFileSync(
    compositionPath,
    "- id: demo-agent\n  name: '@oh-dsh/demo-agent'\n  config:\n    name: '@oh-dsh/not-a-plugin-row'\n",
  )
  writeFileSync(manifestPath, `schema: 1
id: ${id}
surfaces:
  desktop: true
  web: true
  tui: true
packages:
  - path: plugins/demo-agent
    role: agent
  - path: plugins/demo-host
    role: host
    surfaces: [desktop, web]
`)
  return { compositionPath, manifestPath, presetDirectory, root: repoRoot }
}

test('repository Agent preset manifests declare their local packages and surfaces', () => {
  const manifests = discoverAgentPresetManifests(root)
  const router = manifests.find(manifest => manifest.id === 'router-standard')
  assert.ok(router)
  assert.deepEqual(router.surfaces, { desktop: true, web: true, tui: true })
  assert.deepEqual(
    router.packages.map(entry => [entry.name, entry.role, entry.surfaces]),
    [
      ['@oh-dsh/routing', 'agent', ['desktop', 'web', 'tui']],
      ['@oh-dsh/routing-injector', 'agent', ['desktop', 'web']],
      ['@oh-dsh/routing-injector-host', 'host', ['desktop', 'web']],
    ],
  )
})

test('manifest validation allows a surface-scoped Host package outside the Agent composition', () => {
  const example = fixture()
  try {
    const manifest = readAgentPresetManifest(example.root, example.presetDirectory)
    assert.equal(manifest.id, 'demo-mode')
    assert.equal(manifest.packages[1]?.role, 'host')
    assert.deepEqual(manifest.packages[1]?.surfaces, ['desktop', 'web'])
  } finally {
    rmSync(example.root, { force: true, recursive: true })
  }
})

test('preset package discovery deduplicates shared sources and rejects name conflicts', () => {
  const example = fixture('first-mode')
  try {
    const second = join(example.root, 'agent-presets', 'second-mode')
    mkdirSync(second, { recursive: true })
    writeFileSync(join(second, 'preset.yml'), 'name: Second mode\ndescription: Test fixture.\n')
    writeFileSync(join(second, 'agent.cordis.yml'), "- id: demo-agent\n  name: '@oh-dsh/demo-agent'\n")
    writeFileSync(join(second, 'manifest.yml'), `schema: 1
id: second-mode
surfaces: { desktop: true, web: true, tui: true }
packages:
  - path: plugins/demo-agent
    role: agent
  - path: plugins/demo-host
    role: host
    surfaces: [desktop, web]
`)
    assert.deepEqual(
      discoverAgentPresetPackages(example.root).map(entry => entry.path),
      ['plugins/demo-agent', 'plugins/demo-host'],
    )

    writePackage(example.root, 'plugins/conflicting-agent', '@oh-dsh/demo-agent')
    const conflict = join(example.root, 'agent-presets', 'conflict-mode')
    mkdirSync(conflict, { recursive: true })
    writeFileSync(join(conflict, 'preset.yml'), 'name: Conflict mode\ndescription: Test fixture.\n')
    writeFileSync(join(conflict, 'agent.cordis.yml'), "- id: demo-agent\n  name: '@oh-dsh/demo-agent'\n")
    writeFileSync(join(conflict, 'manifest.yml'), `schema: 1
id: conflict-mode
surfaces: { desktop: true, web: true, tui: true }
packages:
  - path: plugins/conflicting-agent
    role: agent
`)
    assert.throws(
      () => discoverAgentPresetPackages(example.root),
      /package @oh-dsh\/demo-agent is declared from multiple paths/,
    )
  } finally {
    rmSync(example.root, { force: true, recursive: true })
  }
})

test('manifest validation rejects reserved and mismatched preset ids', () => {
  const reserved = fixture('standard')
  const mismatched = fixture()
  try {
    assert.throws(
      () => readAgentPresetManifest(reserved.root, reserved.presetDirectory),
      /preset id standard is reserved/,
    )
    writeFileSync(mismatched.manifestPath, `schema: 1
id: another-mode
surfaces: { desktop: true, web: true, tui: true }
packages: []
`)
    assert.throws(
      () => readAgentPresetManifest(mismatched.root, mismatched.presetDirectory),
      /id must match directory name demo-mode/,
    )
  } finally {
    rmSync(reserved.root, { force: true, recursive: true })
    rmSync(mismatched.root, { force: true, recursive: true })
  }
})

test('manifest validation rejects package paths outside the repository', () => {
  const example = fixture()
  const outside = mkdtempSync(join(tmpdir(), 'oh-dsh-agent-preset-package-'))
  try {
    writeFileSync(join(outside, 'package.json'), '{"name":"outside-package"}\n')
    writeFileSync(example.manifestPath, `schema: 1
id: demo-mode
surfaces: { desktop: true, web: true, tui: true }
packages:
  - path: ${relative(example.root, outside)}
    role: host
`)
    assert.throws(
      () => readAgentPresetManifest(example.root, example.presetDirectory),
      /package path must be a normalized repository-relative POSIX path|package path escapes the repository/,
    )
  } finally {
    rmSync(example.root, { force: true, recursive: true })
    rmSync(outside, { force: true, recursive: true })
  }
})

test('manifest validation rejects incomplete preset directories', () => {
  const example = fixture()
  try {
    rmSync(example.compositionPath)
    assert.throws(
      () => readAgentPresetManifest(example.root, example.presetDirectory),
      /agent\.cordis\.yml is required/,
    )
  } finally {
    rmSync(example.root, { force: true, recursive: true })
  }
})

test('manifest validation enforces surface subsets and local plugin declarations', () => {
  const surface = fixture()
  const composition = fixture()
  try {
    writeFileSync(surface.manifestPath, `schema: 1
id: demo-mode
surfaces: { desktop: true, web: true, tui: false }
packages:
  - path: plugins/demo-agent
    role: agent
    surfaces: [tui]
`)
    assert.throws(
      () => readAgentPresetManifest(surface.root, surface.presetDirectory),
      /surface tui is disabled for this preset/,
    )

    writeFileSync(
      composition.compositionPath,
      "- id: missing\n  name: '@oh-dsh/not-declared'\n",
    )
    assert.throws(
      () => readAgentPresetManifest(composition.root, composition.presetDirectory),
      /local plugin @oh-dsh\/not-declared is not declared/,
    )
  } finally {
    rmSync(surface.root, { force: true, recursive: true })
    rmSync(composition.root, { force: true, recursive: true })
  }
})
