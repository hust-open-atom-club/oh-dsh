import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('embedded tools keep the application root inside the window row', () => {
  const css = readFileSync(
    join(root, 'plugins/sidebar/src/client/sidebar.css'),
    'utf8',
  )

  assert.match(
    css,
    /#oh-dsh-embedded-layout\s*\{[^}]*grid-template-rows: minmax\(0, 1fr\);/s,
  )
  assert.match(
    css,
    /#oh-dsh-embedded-layout > #root\s*\{[^}]*min-height: 0;[^}]*overflow: hidden;/s,
  )
})

test('review, pinned summary, and embedded side tools keep distinct layouts', () => {
  const summary = readFileSync(join(root, 'plugins/pinned-summary/src/client.ts'), 'utf8')
  const workspace = readFileSync(join(root, 'plugins/sidebar/src/client/plugin.tsx'), 'utf8')
  const workspaceCss = readFileSync(join(root, 'plugins/sidebar/src/client/sidebar.css'), 'utf8')
  const sideTools = readFileSync(join(root, 'plugins/sidebar/src/client/SideToolsPanel.tsx'), 'utf8')
  const sideToolsCss = readFileSync(join(root, 'plugins/sidebar/src/client/side-tools.css'), 'utf8')

  assert.match(workspace, /if \(open\) this\.pinnedSummary\.setOpen\(false\)/)
  assert.match(workspace, /if \(this\.state\.open\) this\.pinnedSummary\.setOpen\(false\)/)
  assert.match(workspace, /ohDshRightPanelOwner = 'sidebar'/)
  assert.doesNotMatch(summary, /ohDshRightPanelOwner = 'pinned-summary'/)
  assert.doesNotMatch(summary, /#root\s*\{[^}]*padding-right:/s)
  assert.match(summary, /height: auto;/)
  assert.match(summary, /max-height: min\(/)
  assert.match(summary, /transform: translateY\(-8px\) scale\(0\.98\);/)
  assert.match(
    summary,
    /\[data-oh-dsh-summary-body\]\s*\{[^}]*flex: 0 1 auto;[^}]*min-height: 0;[^}]*overflow: hidden;/s,
  )
  assert.match(
    summary,
    /document\.addEventListener\('pointerdown', this\.#handleDocumentPointerDown\)/,
  )
  assert.match(workspace, /data-oh-dsh-summary-toggle=""/)
  assert.match(summary, /closest\('\[data-oh-dsh-summary-toggle\]'\)/)
  assert.doesNotMatch(summary, /closest\('\.oh-dsh-panel-toolbar'\)/)
  assert.match(summary, /event\.key === 'Escape'/)
  assert.doesNotMatch(workspace, /aria-label="Toggle review panel"/)
  assert.match(workspace, /className="oh-dsh-review-view"/)
  assert.doesNotMatch(workspace, /oh-dsh-review-panel/)
  assert.doesNotMatch(workspace, /const embeddedWidth/)
  assert.match(workspace, /const track = this\.state\.open && !this\.narrowViewport\.matches \? this\.state\.width : 0/)
  assert.match(workspaceCss, /\.oh-dsh-review-view\s*\{[^}]*display: flex;[^}]*flex: 1;[^}]*flex-direction: column;/s)
  assert.match(sideTools, /props\.sidebar\.getTabs\(\)/)
  assert.match(sideTools, /props\.sidebar\.getTab\(activeTab\.type\)/)
  assert.match(sideTools, /descriptor\.render\(renderProps\)/)
  assert.match(sideTools, /<TabStrip sidebar=\{props\.sidebar\} t=\{props\.t\} \/>/)
  assert.match(workspace, /function registerBuiltinSidebarTools/)
  assert.match(workspace, /sidebar\.registerTab\(\{[\s\S]*id: 'review'/)
  assert.match(workspace, /sidebar\.registerViewer\(\{[\s\S]*id: 'binary'/)
  assert.match(workspace, /desktopSidebar\.setSession\(sessions\.list\.getSnapshot\(\)\.current \?\? null\)/)
  assert.match(sideToolsCss, /\.oh-dsh-side-panel\s*\{[^}]*width: 100% !important;[^}]*border-radius: 0;[^}]*box-shadow: none;/s)
  assert.match(workspace, /const sideOpen = workspaceState\.open/)
  assert.match(workspace, /\{sideOpen\s*\?\s*\(/)
  assert.doesNotMatch(workspace, /\{workspaceState\.open\s*\?\s*\(/)
  assert.match(workspace, /service\.setOpen\(false\); pinnedSummary\.toggle\(\)/)
  assert.match(workspace, /kind === 'summary'[\s\S]{0,200}M9 5h7M4 10h12/)
  assert.match(workspaceCss, /\.oh-dsh-workspace-panel\[data-open='true'\]/)
  assert.match(summary, /\[data-oh-dsh-pinned-summary\]\[data-open='true'\]/)
})
