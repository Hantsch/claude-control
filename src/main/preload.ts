/**
 * Preload bridge. The renderer gets exactly the functions in `RendererApi` and nothing
 * else: no `require`, no `ipcRenderer`, no filesystem (§3).
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type AppSettings, type AppState, type HistoryQuery, type RendererApi } from '../shared/ipc.ts';

/** `payload` is typed by the `RendererApi` signature that calls this. */
function subscribe(channel: string, listener: (payload: never) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void =>
    listener(args[0] as never);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

const api: RendererApi & {
  onNavigate(listener: (tab: 'sessions' | 'history' | 'settings') => void): () => void;
  setPopoverHeight(height: number): Promise<void>;
  getPopoverPinned(): Promise<boolean>;
  setPopoverPinned(pinned: boolean): Promise<boolean>;
} = {
  getState: () => ipcRenderer.invoke(IPC.getState) as Promise<AppState>,
  getHistory: (query: HistoryQuery) => ipcRenderer.invoke(IPC.getHistory, query),
  getDetail: (id) => ipcRenderer.invoke(IPC.getDetail, id),
  focusSession: (id) => ipcRenderer.invoke(IPC.focusSession, id),
  acknowledge: (id) => ipcRenderer.invoke(IPC.acknowledge, id) as Promise<void>,
  acknowledgeAll: () => ipcRenderer.invoke(IPC.acknowledgeAll) as Promise<void>,
  getSettings: () => ipcRenderer.invoke(IPC.getSettings) as Promise<AppSettings>,
  setSettings: (settings) => ipcRenderer.invoke(IPC.setSettings, settings),
  resetSettings: () => ipcRenderer.invoke(IPC.resetSettings),
  refresh: () => ipcRenderer.invoke(IPC.refresh) as Promise<void>,
  reindexHistory: () => ipcRenderer.invoke(IPC.reindexHistory) as Promise<void>,
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text) as Promise<void>,
  revealPath: (path) => ipcRenderer.invoke(IPC.revealPath, path) as Promise<void>,
  openMainWindow: (tab) => ipcRenderer.invoke(IPC.openMainWindow, tab) as Promise<void>,
  closePopover: () => ipcRenderer.invoke(IPC.closePopover) as Promise<void>,
  diagnostics: () => ipcRenderer.invoke(IPC.diagnostics),
  quit: () => ipcRenderer.invoke(IPC.quit) as Promise<void>,
  onStateChanged: (listener) => subscribe(IPC.stateChanged, listener as (payload: never) => void),
  onHistoryChanged: (listener) => subscribe(IPC.historyChanged, listener as (payload: never) => void),
  onSettingsChanged: (listener) => subscribe(IPC.settingsChanged, listener as (payload: never) => void),
  onNavigate: (listener) => subscribe('cc:navigate', listener as (payload: never) => void),
  setPopoverHeight: (height) => ipcRenderer.invoke('cc:popover-height', height) as Promise<void>,
  getPopoverPinned: () => ipcRenderer.invoke('cc:popover-pinned') as Promise<boolean>,
  setPopoverPinned: (pinned) => ipcRenderer.invoke('cc:popover-pin', pinned) as Promise<boolean>,
};

contextBridge.exposeInMainWorld('claudeControl', api);
