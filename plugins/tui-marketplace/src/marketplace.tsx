import type React from 'react'
import type { Key } from '../../../upstream/dsh-TUI/src/ink/events/input-event.ts'
import type { TuiSceneProps } from '../../../upstream/dsh-TUI/src/scenes.ts'
import type {
  MarketplaceConfirmation,
  MarketplacePlugin,
} from '../../plugin-marketplace/src/protocol.ts'
import { marketplaceRepositoryDetails } from '../../plugin-marketplace/src/client/repository-metadata.ts'
import {
  type TuiMarketplaceController,
  surfaceMarker,
} from './marketplace-controller.ts'

const POINTER = '❯'

function clip(text: string, columns: number): string {
  if (text.length <= columns) return text
  return `${text.slice(0, Math.max(0, columns - 1))}…`
}

function confirmationLabel(confirmation: MarketplaceConfirmation): string {
  if (confirmation === 'allow-build-scripts') {
    return 'Allow install scripts in the isolated preview'
  }
  if (confirmation === 'accept-unsandboxed-build') {
    return 'Run build scripts without process isolation (unsafe)'
  }
  if (confirmation === 'accept-high-risk') {
    return 'Accept trusted host code after apply'
  }
  return 'Accept the changed source identity'
}


function pluginBadges(plugin: MarketplacePlugin): string {
  const badges: string[] = []
  if (plugin.installed) badges.push(plugin.enabled ? 'enabled' : 'disabled')
  if (plugin.updateAvailable) badges.push('update')
  if (plugin.builtin) badges.push('built-in')
  if (plugin.protected) badges.push('managed')
  return badges.length === 0 ? '' : ` · ${badges.join(' · ')}`
}

function handleKey(
  controller: TuiMarketplaceController,
  close: () => void,
  input: string,
  key: Key,
): void {
  const state = controller.getSnapshot()
  if (state.confirmation !== null) {
    if (input === 'y') controller.acceptConfirmation()
    if (input === 'n' || key.escape) controller.cancelConfirmation()
    return
  }
  if (key.escape || (key.ctrl && input === 'c') || (key.ctrl && input === 'm')) {
    if (state.screen === 'detail') controller.openDetail(null)
    else close()
    return
  }
  if (key.ctrl && input === 'b') {
    controller.toggleBuiltins()
    return
  }
  if (key.return) {
    if (state.screen === 'list') {
      const selected = controller.filteredPlugins()
        .find(plugin => plugin.id === state.selectedId)
      if (selected !== undefined) controller.openDetail(selected.id)
    }
    return
  }
  if (key.backspace) {
    if (state.screen === 'list') controller.setQuery(state.query.slice(0, -1))
    else controller.openDetail(null)
    return
  }
  if (key.upArrow || key.downArrow) {
    if (state.screen === 'list') controller.moveSelection(key.upArrow ? -1 : 1)
    return
  }
  if (input === 'r' && state.screen === 'list') {
    void controller.refresh()
    return
  }
  if (input === 'b' && state.screen === 'detail') {
    controller.openDetail(null)
    return
  }
  const plugin = controller.selectedPlugin()
  const canManage = plugin !== null
    && plugin.protected === false
    && plugin.mechanism !== 'unsupported'
  if (input === 'i' && state.screen === 'detail'
    && canManage && plugin.installed === false) {
    void controller.prepare('install', plugin.id)
    return
  }
  if (input === 'u' && state.screen === 'detail'
    && canManage && plugin.installed && plugin.updateAvailable) {
    void controller.prepare('update', plugin.id)
    return
  }
  if (input === 'e' && state.screen === 'detail'
    && canManage && plugin.installed && plugin.enabled === false) {
    void controller.prepare('enable', plugin.id)
    return
  }
  if (input === 'd' && state.screen === 'detail'
    && canManage && plugin.installed && plugin.enabled) {
    void controller.prepare('disable', plugin.id)
    return
  }
  if (input === 'x' && state.screen === 'detail'
    && canManage && plugin.installed) {
    void controller.prepare('uninstall', plugin.id)
    return
  }
  if (input === 'p' && state.screen === 'detail'
    && state.snapshot?.plan !== null && state.snapshot?.plan !== undefined) {
    void controller.preview()
    return
  }
  if (input === 'a' && state.snapshot?.preview !== null
    && state.snapshot?.preview !== undefined) {
    void controller.dispatch({ type: 'apply' })
    return
  }
  if (input === 'n' && state.snapshot?.preview !== null
    && state.snapshot?.preview !== undefined) {
    void controller.dispatch({ type: 'discard' })
    return
  }
  if (input === 'w' && state.snapshot?.undoAvailable === true) {
    void controller.dispatch({ type: 'undo' })
    return
  }
  if (state.screen === 'list' && input.length > 0
    && key.ctrl !== true && key.meta !== true) {
    controller.setQuery(state.query + input)
  }
}

function renderList(
  ReactRuntime: typeof React,
  ui: TuiSceneProps['ui'],
  controller: TuiMarketplaceController,
  columns: number,
  rows: number,
): React.ReactNode {
  const { Box, Text } = ui
  const h = ReactRuntime.createElement
  const state = controller.getSnapshot()
  const plugins = controller.filteredPlugins()
  const visibleRows = Math.max(1, rows - 8)
  const selectedIndex = Math.max(
    0,
    plugins.findIndex(plugin => plugin.id === state.selectedId),
  )
  const start = Math.min(
    Math.max(0, selectedIndex - Math.floor(visibleRows / 2)),
    Math.max(0, plugins.length - visibleRows),
  )
  const visible = plugins.slice(start, start + visibleRows)
  const entries = visible.map(plugin => {
    const selected = plugin.id === state.selectedId
    return h(Box, { flexDirection: 'column', key: plugin.id },
      h(Text, { color: selected ? 'remember' : undefined },
        `${selected ? POINTER : ' '} ${clip(plugin.title, Math.max(16, columns - 48))}`,
        h(Text, { color: 'subtle' }, clip(pluginBadges(plugin), 26)),
      ),
      h(Text, { color: 'subtle' },
        clip(`   ${plugin.category} · ${surfaceMarker(plugin)}`, Math.max(16, columns - 4)),
      ),
    )
  })
  if (plugins.length === 0) {
    entries.push(h(Text, { color: 'subtle', key: 'empty' }, 'No plugins match this search.'))
  }
  if (plugins.length > visible.length) {
    entries.push(h(Text, { color: 'subtle', key: 'range' },
      clip(
        `showing ${start + 1}-${Math.min(start + visible.length, plugins.length)} of ${plugins.length}`,
        columns,
      ),
    ))
  }
  return h(Box, { flexDirection: 'column' },
    h(Box, null,
      h(Text, { inverse: true }, clip(` /plugins  ${state.query}`, Math.max(24, columns - 40))),
      h(Text, null, ' '),
      h(Text, { color: 'subtle' }, clip(
        `${plugins.length} plugins · built-ins: ${state.showBuiltins ? 'shown' : 'hidden'}`,
        40,
      )),
    ),
    state.error === null
      ? null
      : h(Box, { marginTop: 1 }, h(Text, { color: 'error' }, clip(state.error, columns))),
    h(Box, { flexDirection: 'column', marginTop: 1 }, entries),
  )
}

function renderDetail(
  ReactRuntime: typeof React,
  ui: TuiSceneProps['ui'],
  controller: TuiMarketplaceController,
  columns: number,
): React.ReactNode {
  const { Box, Text } = ui
  const h = ReactRuntime.createElement
  const state = controller.getSnapshot()
  const plugin = controller.selectedPlugin()
  if (plugin === null) return h(Text, null, 'Select a plugin first.')
  const plan = state.snapshot?.plan?.pluginId === plugin.id ? state.snapshot.plan : null
  const preview = state.snapshot?.preview
  const actions: string[] = []
  if (plugin.mechanism !== 'unsupported' && plugin.protected === false) {
    if (plugin.installed === false) actions.push('i=install')
    if (plugin.installed && plugin.updateAvailable) actions.push('u=update')
    if (plugin.installed && plugin.enabled === false) actions.push('e=enable')
    if (plugin.installed && plugin.enabled) actions.push('d=disable')
    if (plugin.installed) actions.push('x=uninstall')
  }
  if (plan !== null) actions.push('p=preview')
  if (preview !== null && preview !== undefined) actions.push('a=apply', 'n=discard')
  if (state.snapshot?.undoAvailable === true) actions.push('w=undo')
  actions.push('ctrl+b=built-ins')
  actions.push('b=back')
  return h(Box, { flexDirection: 'column' },
    h(Text, { bold: true, inverse: true }, clip(` ${plugin.title} `, columns)),
    h(Text, { color: 'subtle' }, clip(
      `${plugin.category} · ${plugin.builtin
        ? 'built-in'
        : plugin.installed ? (plugin.enabled ? 'enabled' : 'disabled') : 'not installed'}`,
      columns,
    )),
    h(Box, { marginTop: 1 }, h(Text, null, clip(plugin.description, columns))),
    h(Text, { color: 'subtle' }, clip(`surfaces: ${surfaceMarker(plugin)}`, columns)),
    h(Text, { color: 'subtle' }, clip(
      `repository: ${plugin.url.replace('https://github.com/', '')}`,
      columns,
    )),
    ...marketplaceRepositoryDetails(plugin).map(line => h(Text, {
      color: 'subtle',
      key: line,
    }, clip(line, columns))),
    plan === null
      ? null
      : h(Box, { marginTop: 1 }, h(Text, { color: 'warning' }, clip(
        `plan: ${plan.action} risk=${plan.riskLevel} source=${plan.sourceReview}`,
        columns,
      ))),
    preview === null || preview === undefined
      ? null
      : h(Text, { color: 'success' }, clip(
        `preview: ${preview.pluginId} · apply or discard`,
        columns,
      )),
    state.confirmation === null
      ? null
      : h(Box, { flexDirection: 'column', marginTop: 1 },
        h(Text, { color: 'warning' }, clip(
          `Confirmation ${state.acceptedConfirmations.length + 1}/${state.snapshot?.plan?.requirements.length ?? 0}: ${confirmationLabel(state.confirmation)}`,
          columns,
        )),
        h(Text, { color: 'subtle' }, clip('y accept · n cancel', columns)),
      ),
    state.error === null ? null : h(Text, { color: 'error' }, clip(state.error, columns)),
    state.notice === null ? null : h(Text, { color: 'subtle' }, clip(state.notice, columns)),
    h(Box, { marginTop: 1 }, h(Text, { color: 'subtle' }, clip(actions.join(' · '), columns))),
  )
}

export interface TuiMarketplaceSceneProps extends TuiSceneProps {
  controller: TuiMarketplaceController
}

/** Marketplace scene rendered with the upstream TUI's React and UI kit. */
export function TuiMarketplaceScene({
  React: ReactRuntime,
  ui,
  close,
  controller,
}: TuiMarketplaceSceneProps): React.ReactNode {
  const { Box, Text, useInput, useTerminalSize } = ui
  const h = ReactRuntime.createElement
  const { columns, rows } = useTerminalSize()
  const state = ReactRuntime.useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  )
  useInput((input, key, event) => {
    event.stopImmediatePropagation()
    handleKey(controller, close, input, key)
  })
  return h(Box, {
    flexDirection: 'column',
    flexGrow: 1,
    paddingX: 2,
    paddingY: 1,
    width: '100%',
  },
  h(Box, null,
    h(Text, { bold: true }, 'Plugin marketplace'),
    h(Text, { color: 'subtle' }, ' search · install · preview · apply · esc close'),
  ),
  h(Box, { flexDirection: 'column', flexGrow: 1, marginTop: 1 },
    state.screen === 'list'
      ? renderList(ReactRuntime, ui, controller, columns, rows)
      : renderDetail(ReactRuntime, ui, controller, columns),
    state.busy ? h(Text, { color: 'subtle' }, 'Working…') : null,
  ),
  h(Text, { color: 'subtle' },
    'Ctrl+B built-ins · installs are shared across surfaces.',
  ))
}
