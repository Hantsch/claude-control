/**
 * Electron main (§3). A single process tree — no separate service to install or supervise.
 *
 * Startup order matters for N5: settings → engine (live tier only) → tray, so the tray
 * appears with a populated list rather than empty. The history index starts afterwards, in
 * the background.
 *
 * **Single-instance lock** (§12 "Open decisions"): recommended for M2 and included here.
 * Two instances would both be read-only and harmless, but would double every toast — and
 * doubling notifications defeats the purpose of the app.
 */

import { app, dialog } from 'electron';
import { join } from 'node:path';
import { createEngine } from '../core/createEngine.ts';
import type { SessionId } from '../core/model/types.ts';
import { IPC, type AppState, type FocusResult } from '../shared/ipc.ts';
import { WindowFocuser } from './focus/focuser.ts';
import { broadcast, registerIpc } from './ipc.ts';
import { Notifier } from './notifier.ts';
import { SettingsStore } from './settings.ts';
import { TrayPresenter } from './tray.ts';
import { WindowManager, type MainTab } from './windows.ts';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  // Required on Windows for toasts to be attributed to this app (F5).
  app.setAppUserModelId('solutions.aidu.claude-control');
  // The app has no network features at all (N1).
  app.commandLine.appendSwitch('disable-http-cache');

  await app.whenReady();

  const settings = new SettingsStore(app.getPath('userData'));
  const { engine, adapter, paths } = createEngine({ settings: settings.get() });

  const windows = new WindowManager({
    rendererDir: join(app.getAppPath(), 'out', 'renderer'),
    devServerUrl: process.env.ELECTRON_RENDERER_URL ?? null,
    preload: join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
  });

  windows.setPopoverPinned(settings.get().ui.popoverPinned);

  const focuser = new WindowFocuser({ ideWindows: () => engine.getIdeWindows() });

  const notifier = new Notifier({
    settings: () => settings.get().notifications,
    onActivate: (sessionId) => {
      void focusSession(sessionId);
    },
  });

  const tray = new TrayPresenter({
    onTogglePopover: (bounds) => windows.togglePopover(bounds),
    onOpenWindow: (tab: MainTab) => windows.openMain(tab),
    onFocusSession: (sessionId) => {
      void focusSession(sessionId);
    },
    onAcknowledgeAll: () => engine.acknowledgeAll(),
    onRefresh: () => {
      void engine.refreshNow();
    },
    onQuit: () => quit(),
  });

  let lastState: AppState = emptyState();

  engine.on('sessions', (snapshot) => {
    lastState = snapshot;
    tray.update(snapshot);
    broadcast(IPC.stateChanged, snapshot);
  });
  engine.on('transitions', (transitions) => notifier.handle(transitions));
  engine.on('history', (info) => broadcast(IPC.historyChanged, info));
  engine.on('error', (error) => {
    process.stderr.write(`[claude-control] ${error.message}\n`);
  });

  settings.onChange((next) => {
    void engine.updateSettings(next);
    broadcast(IPC.settingsChanged, next);
  });

  registerIpc({
    engine,
    settings,
    focuser,
    windows,
    claudeDir: paths.root,
    adapterId: adapter.id,
    state: () => lastState,
    focusSession,
    quit,
  });

  // Live tier first (N5), tray immediately afterwards.
  await engine.start();
  lastState = engine.getSnapshot();
  tray.create();
  tray.update(lastState);

  if (lastState.sessions.length === 0 && !hasClaudeData(paths.root)) {
    // Better a clear message than a permanently empty tray icon.
    dialog.showMessageBox({
      type: 'info',
      title: 'Claude Control',
      message: 'No Claude Code data found',
      detail:
        `Nothing was found under ${paths.root}. If your Claude Code state lives elsewhere, ` +
        'set the data directory in Settings.',
    });
  }

  // `--show [sessions|history|settings|popover]` opens a surface straight away. Useful when
  // starting the app from a terminal to check a change; the normal start is tray-only (§8).
  const show = surfaceToShow(process.argv, process.env.CC_SHOW_WINDOW ?? null);
  if (show === 'popover') {
    const bounds = tray.getBounds();
    if (bounds) windows.togglePopover(bounds);
  } else if (show) {
    windows.openMain(show);
  }

  app.on('second-instance', () => {
    windows.openMain('sessions');
  });

  // Tray app: closing all windows must not quit (N3, §8).
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  });

  app.on('before-quit', () => {
    void engine.stop();
    tray.destroy();
  });

  async function focusSession(sessionId: SessionId): Promise<FocusResult> {
    const session = engine.getSession(sessionId);
    if (!session) {
      return {
        ok: false,
        method: 'none',
        flashed: false,
        target: null,
        message: 'That session is no longer live.',
        cwd: '',
      };
    }
    // Jumping to a session is the strongest possible "I have seen this", so it clears the
    // badge for it whether the focus itself succeeds or not.
    engine.acknowledge(sessionId);
    windows.hidePopover();
    return focuser.focus(session);
  }

  function quit(): void {
    void engine.stop().finally(() => {
      tray.destroy();
      app.quit();
    });
  }
}

/** Parses the `--show` dev flag. Returns null when the app should start tray-only. */
export function surfaceToShow(
  argv: readonly string[],
  envValue: string | null,
): MainTab | 'popover' | null {
  const surfaces = ['sessions', 'history', 'settings', 'popover'] as const;
  const fromEnv = envValue?.trim().toLowerCase();
  if (fromEnv === '1' || fromEnv === 'true') return 'sessions';
  if (fromEnv && (surfaces as readonly string[]).includes(fromEnv)) {
    return fromEnv as MainTab | 'popover';
  }

  const index = argv.indexOf('--show');
  if (index === -1) return null;
  const value = argv[index + 1]?.toLowerCase();
  if (value && (surfaces as readonly string[]).includes(value)) return value as MainTab | 'popover';
  return 'sessions';
}

function emptyState(): AppState {
  return {
    sessions: [],
    groups: [],
    trayState: 'none',
    attention: 0,
    projects: [],
    at: Date.now(),
    indexingHistory: false,
    historyCount: 0,
  };
}

function hasClaudeData(root: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    return existsSync(join(root, 'projects')) || existsSync(join(root, 'sessions'));
  } catch {
    return false;
  }
}
