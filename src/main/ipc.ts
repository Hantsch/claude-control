/**
 * IPC handlers (§3). The renderer asks; main answers with finished view models. Nothing
 * here accepts a path or a command from the renderer that would let it read arbitrary
 * files — `revealPath` is restricted to paths the renderer was given in the first place.
 */

import { BrowserWindow, app, clipboard, ipcMain, shell } from 'electron';
import type { WindowSource } from '../core/context/windowSource.ts';
import type { ControlEngine } from '../core/engine.ts';
import type { HistoryQuery, SessionId } from '../core/model/types.ts';
import { IPC, type AppState, type DiagnosticsInfo, type FocusResult } from '../shared/ipc.ts';
import type { WindowFocuser } from './focus/focuser.ts';
import type { SettingsStore } from './settings.ts';
import type { ShortcutManager } from './shortcuts.ts';
import type { ProtocolRegistration } from './toast-protocol.ts';
import type { MainTab, WindowManager } from './windows.ts';

export interface IpcDeps {
  engine: ControlEngine;
  settings: SettingsStore;
  focuser: WindowFocuser;
  windows: WindowManager;
  shortcutManager: ShortcutManager;
  claudeDir: string;
  adapterId: string;
  state: () => AppState;
  focusSession: (id: SessionId) => Promise<FocusResult>;
  quit: () => void;
  protocolRegistration: ProtocolRegistration;
  /** Null when no data dir was supplied (story 005, D6) — no fetch is possible, only an estimate. */
  windowSource: WindowSource | null;
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle(IPC.getState, () => deps.state());

  ipcMain.handle(IPC.getHistory, (_event, query: HistoryQuery) => deps.engine.listHistory(query ?? {}));

  ipcMain.handle(IPC.getDetail, async (_event, id: SessionId) => deps.engine.getDetail(id));

  ipcMain.handle(IPC.focusSession, async (_event, id: SessionId) => deps.focusSession(id));

  ipcMain.handle(IPC.acknowledge, (_event, id: SessionId) => {
    deps.engine.acknowledge(id);
  });

  ipcMain.handle(IPC.acknowledgeAll, () => {
    deps.engine.acknowledgeAll();
  });

  ipcMain.handle(IPC.dismiss, (_event, id: SessionId) => {
    deps.engine.dismiss(id);
  });

  ipcMain.handle(IPC.dismissAll, () => {
    deps.engine.dismissAll();
  });

  ipcMain.handle(IPC.setSessionMuted, (_event, id: SessionId, muted: boolean) => {
    deps.engine.setMuted(id, muted === true);
  });

  ipcMain.handle(IPC.getSettings, () => deps.settings.get());

  ipcMain.handle(IPC.setSettings, (_event, partial: unknown) => deps.settings.set(partial));

  ipcMain.handle(IPC.resetSettings, () => deps.settings.reset());

  ipcMain.handle(IPC.getShortcutStatus, () => deps.shortcutManager.status());

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

  // The popover's own close button — explicit, so it closes even a pinned one.
  ipcMain.handle(IPC.closePopover, () => {
    deps.windows.hidePopover(true);
  });

  ipcMain.handle(IPC.diagnostics, (): DiagnosticsInfo => ({
    claudeDir: deps.claudeDir,
    adapterId: deps.adapterId,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    focusBackend: deps.focuser.backendName(),
    platform: `${process.platform} ${process.arch}`,
    protocolTarget: deps.protocolRegistration,
    modelWindows: deps.windowSource?.status() ?? null,
  }));

  ipcMain.handle(IPC.quit, () => {
    deps.quit();
  });

  // The Settings checkbox (D7) awaits this — a forced refresh happens inside the call, so the
  // toggle's own success/failure is visible immediately rather than on the next background tick.
  ipcMain.handle(IPC.refreshModelWindows, async () => {
    if (!deps.windowSource) return null;
    return deps.windowSource.refresh({ force: true });
  });

  // The popover sizes itself to its content, so it can ask for the height it needs (§8).
  ipcMain.handle('cc:popover-height', (_event, height: number) => {
    if (typeof height === 'number' && Number.isFinite(height)) deps.windows.resizePopover(height);
  });

  ipcMain.handle('cc:popover-pinned', () => deps.windows.isPopoverPinned());

  // Pinning is persisted, so a popover the user parked on their second screen is still
  // there after a restart — that is the point of pinning it in the first place.
  ipcMain.handle('cc:popover-pin', (_event, pinned: unknown) => {
    const next = deps.windows.setPopoverPinned(pinned === true);
    if (next !== deps.settings.get().ui.popoverPinned) {
      deps.settings.set({ ui: { ...deps.settings.get().ui, popoverPinned: next } });
    }
    return next;
  });
}

export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}
