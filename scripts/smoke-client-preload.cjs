const { contextBridge } = require('electron')

const emptyMarketplaceSnapshot = Object.freeze({
  auth: { detail: 'client smoke', status: 'ready' },
  busy: false,
  catalog: [],
  catalogGeneratedAt: null,
  error: null,
  installed: [],
  lastAction: null,
  lifecycle: {
    candidate: null,
    current: { profile: 'desktop', state: 'live' },
    previous: null,
  },
  plan: null,
  preview: null,
  sourceLocks: [],
  undoAvailable: false,
})

contextBridge.exposeInMainWorld('dshDesktop', Object.freeze({
  // The 0.1.5 workspace picker needs a real directory from the native
  // chooser; answer with the smoke's own workspace root.
  chooseWorkspace: async () => {
    const workspace = process.env.OH_DSH_SMOKE_WORKSPACE
    return workspace === undefined || workspace === '' ? [] : [workspace]
  },
  getInfo: async () => ({
    appDataPath: '',
    dshHome: '',
    platform: process.platform,
    preview: null,
    profile: 'desktop',
    version: 'smoke',
  }),
  getRuntimeSnapshot: async () => ({
    bundledPlugins: [],
    logTail: [],
    profile: 'desktop',
    runtimeUrl: null,
    status: 'ready',
  }),
  onCommand: () => () => {},
  onWindowState: () => () => {},
  openExternal: async () => {},
  pluginMarketplace: Object.freeze({
    dispatch: async () => emptyMarketplaceSnapshot,
    getSnapshot: async () => emptyMarketplaceSnapshot,
  }),
}))
