import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TUI_PRODUCT_NAME = 'Oh-DSH TUI'

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8')
  if (source.includes(after)) return
  const first = source.indexOf(before)
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`TUI upstream adapter seam changed: ${path}`)
  }
  writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length))
}

function replaceEvery(path, before, after) {
  const source = readFileSync(path, 'utf8')
  if (!source.includes(before)) {
    if (source.includes(after)) return
    throw new Error(`TUI upstream adapter seam changed: ${path}`)
  }
  writeFileSync(path, source.split(before).join(after))
}

function replaceLogoModule(path) {
  const source = readFileSync(path, 'utf8')
  if (
    source.includes('function CodexStartupOverlay')
    && source.includes('export function LogoV2({ model, effort, cwd })')
  ) return

  for (const marker of [
    'function capitalize(text) {',
    'export function LogoV2({ model, effort, cwd, skipIntro = false, tip, whale = true, drift, }) {',
  ]) {
    if (!source.includes(marker)) {
      throw new Error(`TUI upstream adapter seam changed: ${path}`)
    }
  }

  const replacement = `import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box, Text } from '../ui.js';

const VERSION = (() => {
    try {
        const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json');
        return JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? '0.1.0';
    }
    catch {
        return '0.1.0';
    }
})();
function capitalize(text) {
    return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}
function CodexStartupOverlay({ model, effort, cwd }) {
    const title = process.env.OH_DSH_TUI_TITLE ?? 'Oh-DSH TUI';
    const version = process.env.DSH_OH_TUI_VERSION ?? VERSION;
    const effortLabel = effort === undefined ? '' : ' ' + capitalize(effort);
    return _jsxs(Box, { alignSelf: "flex-start", borderColor: "permission", borderStyle: "round", flexDirection: "column", marginTop: 1, maxWidth: "100%", paddingX: 1, flexShrink: 0, children: [_jsxs(Text, { color: "permission", bold: true, wrap: "truncate-end", children: [">_ ", title, " (v", version, ")"] }), _jsx(Text, { children: " " }), _jsxs(Text, { wrap: "truncate-end", children: [_jsx(Text, { dimColor: true, children: "model:       " }), model, effortLabel, _jsx(Text, { color: "permission", dimColor: true, children: "   /model to change" })] }), _jsxs(Text, { wrap: "truncate-end", children: [_jsx(Text, { dimColor: true, children: "directory:   " }), cwd] })] });
}

export function LogoV2({ model, effort, cwd }) {
    return _jsx(CodexStartupOverlay, { model, effort, cwd });
}
`
  writeFileSync(path, replacement)
}

function adaptOverlayDirection(path) {
  const source = readFileSync(path, 'utf8')
  if (source.includes('Oh-DSH transient panels follow') && source.includes('bottom: "100%"')) return
  if (!source.includes('bottom: "100%"') || !source.includes('export function OverlayAbove')) {
    throw new Error(`TUI upstream adapter seam changed: ${path}`)
  }
  const replacement = `import { jsx as _jsx } from "react/jsx-runtime";
import { Box } from '../ui.js';

/**
 * Oh-DSH transient panels stay above the input anchor so inline rendering can
 * keep the panel inside the current frame and preserve terminal scrollback.
 */
export function OverlayAbove({ children, maxHeight, }) {
    return (_jsx(Box, { position: "absolute", bottom: "100%", left: 0, right: 0, flexDirection: "column", justifyContent: "flex-end", overflow: "hidden", opaque: true, ...(maxHeight === undefined ? {} : { maxHeight }), children: _jsx(Box, { flexDirection: "column", flexShrink: 0, children: children }) }));
}
`
  writeFileSync(path, replacement)
}

function replaceRequiredOnce(path, before, after) {
  const source = readFileSync(path, 'utf8')
  const first = source.indexOf(before)
  if (first === -1) {
    if (source.includes(after)) return
    throw new Error(`TUI upstream adapter seam changed: ${path}`)
  }
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`TUI upstream adapter seam changed: ${path}`)
  }
  writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length))
}

function adaptStartupSpacing(messageListPath, loadedContextPath, promptInputPath) {
  replaceRequiredOnce(
    messageListPath,
    'return (_jsx(Box, { flexDirection: "column", marginBottom: 1, children: _jsx(LogoV2,',
    'return (_jsx(Box, { flexDirection: "column", children: _jsx(LogoV2,',
  )
  replaceRequiredOnce(
    loadedContextPath,
    'return (_jsxs(Box, { flexDirection: "column", marginTop: 1, marginBottom: 1, children: [_jsx(Box, { paddingX: 1,',
    'return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { paddingX: 1,',
  )
  replaceRequiredOnce(
    promptInputPath,
    'return (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [floatersOpen &&',
    'return (_jsxs(Box, { flexDirection: "column", children: [floatersOpen &&',
  )
}

function adaptChatStartupLayout(path) {
  const marker = '    const loadedContextVisible = channel.rows.length === 0 && channel.loadedContext !== undefined;'
  const source = readFileSync(path, 'utf8')
  if (source.includes('const inlineLayout = fullscreen === false;')) return
  if (!source.includes(marker)) {
    throw new Error(`TUI upstream adapter seam changed: ${path}`)
  }
  replaceOnce(
    path,
    marker,
    `${marker}\n    const inlineLayout = fullscreen === false;`,
  )
  replaceOnce(
    path,
    'return (_jsxs(Box, { ref: wakeTickRef, flexDirection: "column", flexGrow: 1, width: "100%", children:',
    'return (_jsxs(Box, { ref: wakeTickRef, flexDirection: "column", flexGrow: inlineLayout ? 0 : 1, width: "100%", children:',
  )
  replaceOnce(
    path,
    'flexDirection: "row", flexGrow: 1, flexShrink: 1, width: "100%", children:',
    'flexDirection: "row", flexGrow: inlineLayout ? 0 : 1, flexShrink: inlineLayout ? 0 : 1, width: "100%", children:',
  )
  replaceOnce(
    path,
    'flexGrow: 1, flexShrink: 1, stickyScroll: true',
    'flexGrow: inlineLayout ? 0 : 1, flexShrink: inlineLayout ? 0 : 1, stickyScroll: true',
  )
}

function adaptScrollBoxContentGrowth(path) {
  const before = 'children: _jsx(Box, { flexDirection: "column", flexGrow: 1, flexShrink: 0, width: "100%", children: children })'
  const after = 'children: _jsx(Box, { flexDirection: "column", flexGrow: style.flexGrow ?? 0, flexShrink: 0, width: "100%", children: children })'
  replaceOnce(path, before, after)
}

function disableUpstreamUpdateCheck(path) {
  const before = `    void checkForTuiUpdate().then((update) => {
        if (update === undefined || exited || updateRequested)
            return;
        const key = update.isStandalone ? 'update-standalone-available' : 'update-available';
        // A standalone release without a SHA256SUMS asset (published before the
        // checksum workflow landed) still updates, but the notice must say the
        // package's integrity cannot be verified — silent degradation is exactly
        // how the unverified-download window went unnoticed.
        const suffix = update.isStandalone && update.checksumUrl === undefined
            ? \` \${t('update-standalone-no-checksum')}\`
            : '';
        channel.notify(\`\${t(key, { current: update.current, latest: update.latest })}\${suffix}\`, { color: 'warning', timeoutMs: 12000 });
    });`
  const after = `    if (process.env.DSH_OH_TUI !== '1') {
        void checkForTuiUpdate().then((update) => {
            if (update === undefined || exited || updateRequested)
                return;
            const key = update.isStandalone ? 'update-standalone-available' : 'update-available';
            // A standalone release without a SHA256SUMS asset (published before the
            // checksum workflow landed) still updates, but the notice must say the
            // package's integrity cannot be verified — silent degradation is exactly
            // how the unverified-download window went unnoticed.
            const suffix = update.isStandalone && update.checksumUrl === undefined
                ? \` \${t('update-standalone-no-checksum')}\`
                : '';
            channel.notify(\`\${t(key, { current: update.current, latest: update.latest })}\${suffix}\`, { color: 'warning', timeoutMs: 12000 });
        });
    }`
  replaceOnce(path, before, after)
}

function disableInlineAutoReanchor(path) {
  // Fullscreen launches use the alternate screen, where the upstream
  // reanchor-and-render cadence must keep working; only inline launches
  // suppress it.
  const guard = "process.env.DSH_OH_TUI !== '1' || process.env.OH_DSH_TUI_FULLSCREEN === '1'"
  const idleBefore = `            this.log.requestViewportReanchor();
            this.renderNow();`
  const idleAfter = `            if (${guard}) {
                this.log.requestViewportReanchor();
                this.renderNow();
            }`
  replaceOnce(path, idleBefore, idleAfter)

  const stderrBefore = `                        this.log.requestViewportReanchor();
                        this.scheduleRender();`
  const stderrAfter = `                        if (${guard}) {
                            this.log.requestViewportReanchor();
                            this.scheduleRender();
                        }`
  replaceOnce(path, stderrBefore, stderrAfter)
}

/**
 * Apply the small Oh-DSH adapter to a copied upstream package. Exact-match
 * guards make an upstream layout change fail packaging instead of silently
 * restoring a second data root or the upstream launcher identity.
 */
export function adaptTuiRendererPackage(packageDir) {
  const lib = join(packageDir, 'lib', 'types')
  const paths = join(lib, 'utils', 'paths.js')
  replaceOnce(
    paths,
    "export const DATA_DIR = join(homeDir(), '.dsh-tui');",
    "export const DATA_DIR = process.env.OH_DSH_TUI_CONFIG_HOME ?? join(homeDir(), '.ohdsh', 'tui');",
  )
  replaceOnce(
    paths,
    "export const LEGACY_DATA_DIR = join(homeDir(), '.dsh-cc');",
    'export const LEGACY_DATA_DIR = DATA_DIR;',
  )

  const logo = join(lib, 'components', 'LogoV2.js')
  replaceLogoModule(logo)
  adaptOverlayDirection(join(lib, 'components', 'OverlayAbove.js'))
  adaptStartupSpacing(
    join(lib, 'components', 'MessageList.js'),
    join(lib, 'components', 'LoadedContextPanel.js'),
    join(lib, 'components', 'PromptInput.js'),
  )

  const chat = join(lib, 'screens', 'Chat.js')
  adaptScrollBoxContentGrowth(join(lib, 'ink', 'components', 'ScrollBox.js'))
  adaptChatStartupLayout(chat)
  replaceOnce(
    chat,
    '`${titlePrefix} 🐋 ${channel.sessionTitle}`',
    "`${titlePrefix} ${process.env.OH_DSH_TUI_TITLE ?? 'Oh-DSH TUI'} · ${channel.sessionTitle}`",
  )

  const commands = join(lib, 'commands.js')
  for (const [before, after] of [
    ['Show the dsh-tui configuration source', 'Show the Oh-DSH TUI configuration source'],
    ['Update dsh-tui and restart', 'Update Oh-DSH TUI and restart'],
    // beta.4 dropped the "Practice programming" preset command.
    ['Restart dsh-tui and resume this session', 'Restart Oh-DSH TUI and resume this session'],
    ['Exit dsh-tui', 'Exit Oh-DSH TUI'],
  ]) {
    replaceEvery(commands, before, after)
  }

  const plugin = join(lib, 'dsh-adapter', 'plugin.js')
  disableUpstreamUpdateCheck(plugin)
  disableInlineAutoReanchor(join(lib, 'ink', 'ink.js'))
  replaceEvery(
    plugin,
    'dsh-tui requires an interactive terminal',
    'Oh-DSH TUI requires an interactive terminal',
  )
  replaceEvery(plugin, 'dsh-tui: exit after error:', 'Oh-DSH TUI: exit after error:')
  replaceEvery(plugin, 'dsh-tui crashed:', 'Oh-DSH TUI crashed:')
  replaceEvery(
    plugin,
    // beta.4 replaced the "Updating … and restarting" notice with exit-time
    // failure lines naming the package.
    'dsh-tui update failed',
    'Oh-DSH TUI update failed',
  )
  replaceOnce(
    plugin,
    "const boot = profile === undefined ? 'dsh --config cordis.yml' : `dsh --profile ${profile}`;\n    return process.platform === 'win32'\n        ? `dsh-tui --resume ${sessionId}`\n        : `DSH_TUI_RESUME_SESSION=${sessionId} ${boot}`;",
    'return `ohdsh tui --resume ${sessionId}`;',
  )
  replaceEvery(plugin, 'dsh-tui --resume', 'ohdsh tui --resume')

  const providerWizard = join(lib, 'dsh-adapter', 'providerWizard.js')
  replaceEvery(
    providerWizard,
    '`~/.dsh/.credentials.yaml`',
    '`$DSH_HOME/.credentials.yaml`',
  )

  const channel = join(lib, 'dsh-adapter', 'channel.js')
  replaceOnce(
    channel,
    '`dsh-tui-export-${Date.now()}.md`',
    '`oh-dsh-tui-export-${Date.now()}.md`',
  )
  replaceOnce(
    channel,
    "join(userHome, '.dsh-tui/cordis.yml')",
    "join(process.env.OH_DSH_TUI_CONFIG_HOME ?? join(userHome, '.ohdsh', 'tui'), 'cordis.yml')",
  )

  const compatibility = join(lib, 'dsh-adapter', 'compat', 'sessionLog.js')
  replaceOnce(
    compatibility,
    "roots.push(join(home, '.dsh-tui', 'sessions'));",
    "roots.push(join(process.env.OH_DSH_TUI_CONFIG_HOME ?? join(home, '.ohdsh', 'tui'), 'sessions'));",
  )

  const messages = join(lib, 'i18n.js')
  replaceEvery(messages, '~/.dsh-tui', '~/.ohdsh/tui')
  replaceEvery(messages, 'dsh-tui', 'Oh-DSH TUI')
  replaceOnce(
    messages,
    "'provider-q-apikey-detail': { zh: '密钥将写入 ~/.dsh/.credentials.yaml（权限 0600），不会出现在会话记录中', en: 'The key is stored in ~/.dsh/.credentials.yaml (mode 0600) and never shown in the transcript' },",
    "'provider-q-apikey-detail': { zh: '密钥由 Harness 凭据服务管理，不会出现在会话记录中', en: 'The key is managed by the Harness credentials service and never shown in the transcript' },",
  )
  replaceEvery(
    messages,
    '~/.dsh/.credentials.yaml',
    '$DSH_HOME/.credentials.yaml',
  )

  const customTheme = join(lib, 'customTheme.js')
  replaceEvery(customTheme, '[dsh-tui]', '[Oh-DSH TUI]')
  replaceEvery(customTheme, '~/.dsh-tui', '~/.ohdsh/tui')
  const themeProvider = join(lib, 'components', 'design-system', 'ThemeProvider.js')
  replaceEvery(themeProvider, '[dsh-tui]', '[Oh-DSH TUI]')
  replaceEvery(themeProvider, '~/.dsh-tui', '~/.ohdsh/tui')
  const pluginStorage = join(lib, 'dsh-adapter', 'plugin-storage.js')
  replaceEvery(pluginStorage, '~/.dsh-tui', '~/.ohdsh/tui')
}
