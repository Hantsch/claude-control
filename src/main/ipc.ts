/**
 * IPC handlers (§3). The renderer asks; main answers with finished view models. Nothing
 * here accepts a path or a command from the renderer that would let it read arbitrary
 * files — `revealPath` is restricted to paths the renderer was given in the first place.
 */

import { BrowserWindow, app, clipboard, ipcMain, shell } from 'electron';
import type { ControlEngine } from '../core/engine.ts';
import type { HistoryQuery, SessionId } from '../core/model/types.ts';
import { IPC, type AppState, type DiagnosticsInfo, type FocusResult } from '../shared/ipc.ts';
import type { WindowFocuser } from './focus/focuser.ts';
import type { SettingsStore } from './settings.ts';
import type { MainTab, WindowManager } from './windows.ts';

export interface IpcDeps {
  engine: ControlEngine;
  settings: SettingsStore;
  focuser: WindowFocuser;
  windows: WindowManager;
  claudeDir: string;
  adapterId: string;
  state: () => AppState;
  focusSession: (id: SessionId) => Promise<FocusResult>;
  quit: () => void;
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle(IPC.getState, () => deps.state());

  ipcMain.handle(IPC.getHistory, (_event, query: HistoryQuery) => deps.engine.listHistory(query ?? {}));

  ipcMain.handle(IPC.getDetail, async (_event, id: SessionId) => deps.engine.getDetail(id));

  ipcMain.handle(IPC.focusSession, async (_event, id: SessionId) => deps.focusSession(id));

  ipcMain.handle(IPC.getSettings, () => deps.settings.get());

  ipcMain.handle(IPC.setSettings, (_event, partial: unknown) => deps.settings.set(partial));

  ipcMain.handle(IPC.resetSettings, () => deps.settings.reset());

  ipcMain.handle(IPC.refresh, async () => {
    await deps.engine.refreshNow();
  });

  ipcMain.handle(IPC.reindexHistory, () => {
    deps.engine.restartHistoryIndex();
  });

  ipcMain.handle(IPC.copyText, (_event, text: string) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });

  ipcMain.handle(IPC.revealPath, async (_event, path: string) => {
    // Only paths that belong to a known session or history entry may be revealed.
    if (typeof path !== 'string' || !path) return;
    const known =
      deps.engine.listHistory({}).entries.some((entry) => entry.transcriptPath === path) ||
      deps.engine.getSnapshot().sessions.some((s) => s.transcriptPath === path || s.cwd === path);
    if (!known) return;
    shell.showItemInFolder(path);
  });

  ipcMain.handle(IPC.openMainWindow, (_event, tab: MainTab | undefined) => {
    deps.windows.hidePopover();
    deps.windows.openMain(tab ?? 'sessions');
  });

  ipcMain.handle(IPC.closePopover, () => {
    deps.windows.hidePopover();
  });

  ipcMain.handle(IPC.diagnostics, (): DiagnosticsInfo => ({
    claudeDir: deps.claudeDir,
    adapterId: deps.adapterId,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    focusBackend: deps.focuser.backendName(),
    platform: `${process.platform} ${process.arch}`,
  }));

  ipcMain.handle(IPC.quit, () => {
    deps.quit();
  });

  // The popover sizes itself to its content, so it can ask for the height it needs (§8).
  ipcMain.handle('cc:popover-height', (_event, height: number) => {
    if (typeof height === 'number' && Number.isFinite(height)) deps.windows.resizePopover(height);
  });
}

export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}
