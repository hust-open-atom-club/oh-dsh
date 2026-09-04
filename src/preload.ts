import { contextBridge, ipcRenderer } from 'electron'
import type { AboutUpdateCommand, AboutUpdateSnapshot, DesktopBridge, DesktopCommand, DesktopInfo, DesktopRuntimeSnapshot, DesktopWindowState } from './contracts.ts'
import type { MarketplaceCommand, MarketplaceSnapshot } from '../plugins/plugin-marketplace/src/protocol.ts'

const bridge: DesktopBridge = Object.freeze({
  platform: process.platform,
  closeWindow: async (): Promise<void> => {
    await ipcRenderer.invoke('desktop:window-close')
  },
  chooseWorkspace: async (): Promise<string[]> => {
    return await ipcRenderer.invoke('desktop:choose-workspace') as string[]
  },
  brandIconDataUrl: async (): Promise<string | null> => await ipcRenderer.invoke('desktop:brand-icon') as string | null,
  getInfo: async (): Promise<DesktopInfo> => await ipcRenderer.invoke('desktop:get-info') as DesktopInfo,
  getRuntimeSnapshot: async (): Promise<DesktopRuntimeSnapshot> => {
    return await ipcRenderer.invoke('desktop:get-runtime-snapshot') as DesktopRuntimeSnapshot
  },
  minimizeWindow: async (): Promise<void> => {
    await ipcRenderer.invoke('desktop:window-minimize')
  },
  menuBarLabels: async (): Promise<string[]> => await ipcRenderer.invoke('desktop:menu-bar-labels') as string[],
  setMenuLocale: async (locale: 'en' | 'zh'): Promise<string[]> => {
    return await ipcRenderer.invoke('desktop:set-menu-locale', locale) as string[]
  },
  openUpdater: async (): Promise<void> => {
    await ipcRenderer.invoke('desktop:open-updater')
  },
  aboutUpdate: Object.freeze({
    getSnapshot: async (): Promise<AboutUpdateSnapshot> => {
      return await ipcRenderer.invoke('desktop:about-update:get-state') as AboutUpdateSnapshot
    },
    check: async (): Promise<AboutUpdateSnapshot> => {
      return await ipcRenderer.invoke('desktop:about-update:check') as AboutUpdateSnapshot
    },
    command: async (command: AboutUpdateCommand): Promise<AboutUpdateSnapshot> => {
      return await ipcRenderer.invoke('desktop:about-update:command', command) as AboutUpdateSnapshot
    },
    onState: (listener: (snapshot: AboutUpdateSnapshot) => void): (() => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, snapshot: AboutUpdateSnapshot): void => { listener(snapshot) }
      ipcRenderer.on('desktop:about-update:state', wrapped)
      return () => { ipcRenderer.removeListener('desktop:about-update:state', wrapped) }
    },
  }),
  onCommand: (listener: (command: DesktopCommand) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, command: DesktopCommand): void => { listener(command) }
    ipcRenderer.on('desktop:command', wrapped)
    return () => { ipcRenderer.removeListener('desktop:command', wrapped) }
  },
  onWindowState: (listener: (state: DesktopWindowState) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: DesktopWindowState): void => { listener(state) }
    ipcRenderer.on('desktop:window-state', wrapped)
    return () => { ipcRenderer.removeListener('desktop:window-state', wrapped) }
  },
  openExternal: async (url: string): Promise<void> => {
    await ipcRenderer.invoke('desktop:open-external', url)
  },
  pluginMarketplace: Object.freeze({
    dispatch: async (command: MarketplaceCommand): Promise<MarketplaceSnapshot> => {
      return await ipcRenderer.invoke('desktop:plugin-marketplace-dispatch', command) as MarketplaceSnapshot
    },
    getSnapshot: async (): Promise<MarketplaceSnapshot> => {
      return await ipcRenderer.invoke('desktop:plugin-marketplace-snapshot') as MarketplaceSnapshot
    },
  }),
  popupMenuBarMenu: async (index: number, cssX: number, cssY: number): Promise<void> => {
    await ipcRenderer.invoke('desktop:menu-bar-popup', index, cssX, cssY)
  },
  toggleMaximizeWindow: async (): Promise<boolean> => {
    return await ipcRenderer.invoke('desktop:window-toggle-maximize') as boolean
  },
  isWindowMaximized: async (): Promise<boolean> => {
    return await ipcRenderer.invoke('desktop:window-is-maximized') as boolean
  },
})

contextBridge.exposeInMainWorld('dshDesktop', bridge)
