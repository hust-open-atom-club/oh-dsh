import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('desktop chrome keeps platform title bars and panel controls distinct', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const contracts = readFileSync(new URL('../src/contracts.ts', import.meta.url), 'utf8')
  const panelCss = readFileSync(new URL('../plugins/sidebar/src/client/sidebar.css', import.meta.url), 'utf8')
  const frame = readFileSync(new URL('../plugins/desktop-frame/src/client/plugin.tsx', import.meta.url), 'utf8')
  const sidePanel = readFileSync(new URL('../plugins/sidebar/src/client/SideToolsPanel.tsx', import.meta.url), 'utf8')
  const webPatch = readFileSync(new URL('../web/cordis.patch.yml', import.meta.url), 'utf8')

  // Windows uses a frameless native window; the renderer owns the single
  // chrome row and Electron still owns the BrowserWindow lifecycle.
  assert.match(
    main,
    /: process\.platform === 'win32'[\s\S]*?autoHideMenuBar: true, frame: false[\s\S]*?: \{\}\)/,
  )
  // macOS keeps the hiddenInset row and every other platform keeps the frame.
  assert.match(main, /process\.platform === 'darwin'[\s\S]*?titleBarStyle: 'hiddenInset'/)

  assert.match(contracts, /export const DESKTOP_TITLEBAR_HEIGHT = 40/)

  // Desktop publishes its platform to CSS. Only the hidden/frameless macOS
  // and Windows variants reserve the in-page titlebar row; Linux keeps its
  // native frame, while Web never loads the Desktop bridge or overrides.
  assert.match(client, /installDesktopChrome\(bridge\.platform\)/)
  assert.match(client, /dataset\.ohDshDesktopPlatform = platform/)
  assert.match(
    client,
    /data-oh-dsh-desktop-platform='darwin'\] body,[\s\S]*?data-oh-dsh-desktop-platform='win32'\] body \{[\s\S]*?padding-top: var\(--oh-dsh-titlebar-height\);[\s\S]*?border-radius: 14px/,
  )
  assert.doesNotMatch(client, /data-oh-dsh-desktop-platform='linux'[\s\S]*?padding-top:/)
  assert.doesNotMatch(client, /data-oh-dsh-desktop='true'\] body \{[\s\S]*?border-radius:/)
  assert.doesNotMatch(webPatch, /@oh-dsh\/desktop'/)

  // Every desktop surface publishes the same chrome row height, and the frame
  // publishes the details column width on the root element: floating chrome
  // lives outside the frame and can only inherit the value from there.
  assert.match(
    client,
    /html\[data-oh-dsh-desktop='true'\] \{[\s\S]*?--oh-dsh-titlebar-height: \$\{DESKTOP_TITLEBAR_HEIGHT\}px/,
  )
  assert.match(
    frame,
    /root\.style\.setProperty\('--oh-dsh-details-width', `\$\{cols\.details\}px`\)/,
  )
  assert.match(
    frame,
    /root\.style\.removeProperty\('--oh-dsh-details-width'\)/,
  )

  // macOS gets a real drag island between traffic lights and panel controls.
  assert.match(client, /if \(platform === 'darwin'\)[\s\S]*?oh-dsh-titlebar-drag-region/)
  assert.match(client, /dragRegion\?\.remove\(\)/)
  assert.match(client, /delete document\.documentElement\.dataset\.ohDshDesktopPlatform/)
  assert.match(
    client,
    /data-oh-dsh-desktop-platform='darwin'\] \.oh-dsh-titlebar-drag-region \{[\s\S]*?left: 88px;[\s\S]*?right: 112px;[\s\S]*?-webkit-app-region: drag/,
  )

  // Web and framed Linux keep the shared top-right position. The toolbar owns
  // the corner; what moves it is whatever squeezes the conversation column —
  // the details column and the side tools panel — plus one 8px gap.
  assert.match(
    panelCss,
    /\.oh-dsh-panel-toolbar \{[\s\S]*?top: 5px;[\s\S]*?right: min\([\s\S]*?max\([\s\S]*?14px,[\s\S]*?8px[\s\S]*?var\(--oh-dsh-details-width, 0px\)[\s\S]*?var\(--oh-dsh-workspace-panel-inset, 0px\)[\s\S]*?calc\(100vw - 460px\)/,
  )
  // The side tools panel squeezes the conversation column, so it publishes the
  // footprint it takes and the toolbar adds it.
  assert.match(
    sidePanel,
    /style\.setProperty\([\s\S]*?'--oh-dsh-workspace-panel-inset',[\s\S]*?\$\{Math\.round\(width \+ \(globalThis\.innerWidth - right\)\)\}px/,
  )
  assert.match(
    sidePanel,
    /root\.style\.setProperty\('--oh-dsh-workspace-panel-inset', '0px'\)/,
  )
  // A maximized panel owns the whole row, so no inset can clear it: the
  // toolbar drops to the bottom corner instead of hovering mid-panel, and
  // stays reachable because the panel header has no restore control.
  assert.match(sidePanel, /dataset\.ohDshSidePanelMaximized = 'true'/)
  assert.match(
    panelCss,
    /html\[data-oh-dsh-side-panel-maximized='true'\] \.oh-dsh-panel-toolbar \{[\s\S]*?top: auto;[\s\S]*?bottom: 14px;[\s\S]*?right: 14px/,
  )
  // The toolbar owns the corner, so the session top bar's utilities stand down
  // by its clearance — reached through the stable slot contract, not the
  // hashed utility classes, and only on framed platforms while the side panel
  // is not maximized. While a session is active the toolbar matches the
  // Session log button's row.
  assert.match(panelCss, /--oh-dsh-toolbar-clearance: 89px;/)
  assert.match(
    panelCss,
    /:not\(\[data-oh-dsh-desktop-platform='darwin'\]\):not\(\[data-oh-dsh-desktop-platform='win32'\]\):not\(\[data-oh-dsh-side-panel-maximized='true'\]\)[\s\S]*?\[data-slot='conversation\.session\.header'\][\s\S]*?:has\(> \[data-slot='conversation\.session\.header\.utilities'\]\) \{[\s\S]*?margin-right: var\(--oh-dsh-toolbar-clearance, 89px\)/,
  )
  assert.match(
    panelCss,
    /html\[data-oh-dsh-session-active='true'\] \.oh-dsh-panel-toolbar \{[\s\S]*?top: 11px/,
  )
  assert.match(frame, /dataset\.ohDshSessionActive = 'true'/)
  assert.match(
    client,
    /data-oh-dsh-desktop-platform='darwin'\] \.oh-dsh-panel-toolbar,[\s\S]*?data-oh-dsh-desktop-platform='win32'\] \.oh-dsh-panel-toolbar \{[\s\S]*?top: 4px;[\s\S]*?padding: 1px/,
  )
  assert.match(
    client,
    /data-oh-dsh-desktop-platform='darwin'\] \.oh-dsh-panel-toolbar button,[\s\S]*?data-oh-dsh-desktop-platform='win32'\] \.oh-dsh-panel-toolbar button \{[\s\S]*?width: 28px;[\s\S]*?height: 28px/,
  )
  assert.match(client, /data-oh-dsh-desktop-platform='darwin'\] \.oh-dsh-panel-toolbar \{[\s\S]*?right: 8px/)
  assert.match(client, /data-oh-dsh-desktop-platform='win32'\] \.oh-dsh-panel-toolbar \{[\s\S]*?right: 154px/)
  assert.match(client, /\.oh-dsh-window-actions \{[\s\S]*?height: var\(--oh-dsh-titlebar-height\)/)
  // Portal overlays with a bare top-level dialog (the pinned runtime's image
  // lightbox) park their fixed close button 20px below the viewport top —
  // under the opaque titlebar strip. On the platforms that reserve the row,
  // the backdrop keeps upstream's 40px gutter width but restores its
  // symmetry below the reserved row: uniform 40px on all four sides, the
  // image's 100vh-based ceiling shrinks by the reserved row plus the two
  // vertical gutters, and the close button rides the gutter grid at the
  // top-right corner.
  assert.match(
    client,
    /data-oh-dsh-desktop-platform='darwin'\] body > \[role='dialog'\]\[aria-modal='true'\],[\s\S]*?data-oh-dsh-desktop-platform='win32'\] body > \[role='dialog'\]\[aria-modal='true'\] \{[\s\S]*?top: var\(--oh-dsh-titlebar-height, 40px\) !important;[\s\S]*?padding: 40px !important/,
  )
  assert.match(
    client,
    /data-oh-dsh-desktop-platform='darwin'\] body > \[role='dialog'\]\[aria-modal='true'\] > img,[\s\S]*?data-oh-dsh-desktop-platform='win32'\] body > \[role='dialog'\]\[aria-modal='true'\] > img \{[\s\S]*?max-height: calc\(100vh - var\(--oh-dsh-titlebar-height, 40px\) - 80px\) !important/,
  )
  assert.match(
    client,
    /data-oh-dsh-desktop-platform='darwin'\] body > \[role='dialog'\]\[aria-modal='true'\] > button,[\s\S]*?data-oh-dsh-desktop-platform='win32'\] body > \[role='dialog'\]\[aria-modal='true'\] > button \{[\s\S]*?top: calc\(var\(--oh-dsh-titlebar-height, 40px\) \+ 8px\) !important;[\s\S]*?right: 8px !important/,
  )
  assert.doesNotMatch(client, /data-oh-dsh-desktop='true'\] body > \[role='dialog'\]\[aria-modal='true'\] > button/)
  assert.match(client, /body\[data-ds-dark-theme\] \.oh-dsh-menubar-brand img[\s\S]*?filter: brightness\(0\) invert\(1\)/)
  assert.match(client, /body::before \{[\s\S]*?z-index: 2147483645[\s\S]*?pointer-events: none/)
  assert.match(client, /\.oh-dsh-menubar \{[\s\S]*?z-index: 2147483646/)
  assert.match(client, /button\[data-action='minimize'\]::before \{[\s\S]*?top: 50%;[\s\S]*?width: 10px[\s\S]*?border-top: 1\.7px solid currentColor/)
  assert.match(client, /button\[data-action='maximize'\]::before \{[\s\S]*?width: 10px[\s\S]*?height: 10px[\s\S]*?border: 1\.7px solid currentColor/)
  assert.match(client, /button\[data-action='maximize'\]::before \{[\s\S]*?border-radius: 2px/)
  assert.match(client, /button\[data-action='maximize'\]\[data-maximized='true'\]::before[\s\S]*?width: 8px[\s\S]*?height: 8px[\s\S]*?border: 1\.7px solid currentColor/)
  assert.match(client, /button\[data-action='maximize'\]\[data-maximized='true'\]::after[\s\S]*?display: block[\s\S]*?width: 8px[\s\S]*?height: 8px/)
  assert.match(client, /button\[data-action='close'\]::before,[\s\S]*?left: 18px[\s\S]*?width: 10px/)
})

test('desktop marketplace remains available in read-only viewer mode', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

  assert.match(
    main,
    /function createPluginMarketplace\(\): PluginMarketplaceManager \{[\s\S]*?if \(!desktopReadOnly\) ensureDesktopProfile\(info\.dshHome\)[\s\S]*?if \(!desktopReadOnly\) mkdirSync\(workingDirectory, \{ recursive: true, mode: 0o700 \}\)[\s\S]*?desktopReadOnly \? \{ readOnly: true \} : \{\}/,
  )
  assert.match(
    main,
    /desktopReadOnly \? \{ cacheReadOnly: true \} : \{ cwd: workingDirectory \}/,
  )
  assert.doesNotMatch(main, /function createPluginMarketplace\(\): PluginMarketplaceManager \| undefined \{[\s\S]*?if \(desktopReadOnly\) return undefined/)
})

test('desktop win32 menu bar renders in the merged row but pops the native menu', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const contracts = readFileSync(new URL('../src/contracts.ts', import.meta.url), 'utf8')
  const preload = readFileSync(new URL('../src/preload.ts', import.meta.url), 'utf8')

  // The bridge exposes the application menu's labels and a native popup.
  assert.match(contracts, /menuBarLabels\(\): Promise<string\[\]\>/)
  assert.match(contracts, /setMenuLocale\(locale: 'en' \| 'zh'\): Promise<string\[\]\>/)
  assert.match(contracts, /popupMenuBarMenu\(index: number, cssX: number, cssY: number\): Promise<void>/)
  assert.match(preload, /desktop:menu-bar-labels/)
  assert.match(preload, /desktop:set-menu-locale/)
  assert.match(preload, /desktop:menu-bar-popup/)
  assert.match(preload, /desktop:window-close/)
  assert.match(preload, /desktop:window-toggle-maximize/)
  assert.match(preload, /desktop:window-state/)

  // The main process serves labels and pops the built application menu's own
  // submenus — no second menu definition beside buildMenu().
  assert.match(main, /applicationMenu = Menu\.buildFromTemplate\(template\)/)
  assert.match(main, /Menu\.setApplicationMenu\(applicationMenu\)/)
  assert.match(main, /'desktop:menu-bar-labels'/)
  assert.match(main, /'desktop:set-menu-locale'/)
  assert.match(main, /'desktop:window-state'/)
  assert.match(main, /window\.on\('maximize', sendWindowState\)/)
  assert.match(main, /window\.on\('unmaximize', sendWindowState\)/)
  assert.match(main, /buildMenu\(raw\)/)
  assert.match(main, /file: '文件'/)
  assert.match(main, /file: 'File'/)
  assert.match(main, /submenu\.popup\(\{/)
  assert.match(main, /function windowForSender\(event: IpcMainInvokeEvent\)/)
  assert.match(main, /windowForSender\(event\)\?\.close\(\)/)
  // CSS pixels convert to screen DIPs through the webContents zoom factor.
  assert.match(main, /cssX \* scale/)
  assert.match(main, /getZoomFactor\(\)/)

  // Every win32 window gets controls; only the main window gets the menu.
  assert.match(client, /if \(info\.platform === 'win32'\) removeMenuBar = installMenuBar\(bridge, locale, t, info\.preview === null\)/)
  assert.match(client, /if \(!includeMenu\) return/)
  assert.match(client, /setMenuLocale\(locale\.getSnapshot\(\)\.active\)/)
  assert.match(client, /const unsubscribeLocale = locale\.subscribe\(refreshMenuBar\)/)
  assert.match(client, /const unsubscribeWindowState = bridge\.onWindowState\(/)
  assert.match(client, /unsubscribeWindowState\(\)/)
  assert.match(client, /\.oh-dsh-menubar \{[\s\S]*?-webkit-app-region: no-drag;/)
  assert.match(client, /\.oh-dsh-menubar::before \{[\s\S]*?right: 270px[\s\S]*?-webkit-app-region: drag;/)
  assert.match(client, /\.oh-dsh-menubar button \{[\s\S]*?-webkit-app-region: no-drag;/)
  assert.match(client, /popupMenuBarMenu\(index, rect\.left, rect\.bottom\)/)
})
test('desktop v21 uses a replacement root frame without the v20 collapse workaround', () => {
  const packageManifest = readFileSync(new URL('../plugins/desktop-frame/package.json', import.meta.url), 'utf8')
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const profile = readFileSync(new URL('../src/profile.ts', import.meta.url), 'utf8')
  const build = readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8')
  const stage = readFileSync(new URL('../scripts/stage-dsh.mjs', import.meta.url), 'utf8')
  const frame = readFileSync(new URL('../plugins/desktop-frame/src/client/plugin.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../plugins/desktop-frame/src/client/frame.css', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const buildDsh = readFileSync(new URL('../scripts/build-dsh.mjs', import.meta.url), 'utf8')

  assert.match(packageManifest, /@oh-dsh\/desktop-frame/)
  assert.match(patch, /ui-layout[\s\S]*?disabled: true/)
  assert.match(patch, /oh-desktop-frame[\s\S]*?@oh-dsh\/desktop-frame/)
  assert.match(profile, /@oh-dsh\/desktop-frame/)
  assert.match(build, /directory: 'desktop-frame', id: '@oh-dsh\/desktop-frame'/)
  assert.match(stage, /desktop-frame/)
  assert.match(frame, /name: 'root'/)
  assert.match(frame, /sidebar: \{ kind: 'single', scope: 'root' \}/)
  assert.match(frame, /conversation: \{ kind: 'single', scope: 'session-maybe' \}/)
  assert.match(frame, /details: \{ kind: 'single', scope: 'session' \}/)
  assert.match(frame, /'shell\.overlay': \{ kind: 'list', scope: 'root' \}/)
  assert.match(frame, /gridTemplateColumns/)
  assert.match(css, /grid-template-columns var\(--ds-transition-duration-slow\) var\(--ds-ease-in-out\)/)
  assert.match(frame, /const lastSession = useRef\(detailsSession\)/)
  assert.match(frame, /lastSession\.current !== detailsSession[\s\S]*?actions\.closeDetails\(\)/)
  assert.match(frame, /let frame: number \| null = null/)
  assert.match(frame, /requestAnimationFrame\(\(\) => \{/)
  assert.match(frame, /data-shell-overlay/)
  assert.doesNotMatch(client, /installSidebarCollapseEdge|oh-dsh-sidebar-collapse-edge|data-sidebar-collapsed\] \{ transition: none/)
  assert.doesNotMatch(buildDsh, /withImmediateSidebarRail|COLLAPSE_SETTLE_MS|rail animation patch/)
})
