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

import { app, dialog, globalShortcut } from 'electron';
import { join } from 'node:path';
import { createEngine } from '../core/createEngine.ts';
import type { SessionId } from '../core/model/types.ts';
import { IPC, type AppState, type FocusResult } from '../shared/ipc.ts';
import { applyAutostart, AUTOSTART_FLAG, healAutostartPath } from './autostart.ts';
import { WindowFocuser } from './focus/focuser.ts';
import { createWindowProbe } from './focus/windowProbe.ts';
import { broadcast, registerIpc } from './ipc.ts';
import { Notifier } from './notifier.ts';
import { SettingsStore } from './settings.ts';
import { ShortcutManager } from './shortcuts.ts';
import {
  protocolClientTarget,
  TOAST_PROTOCOL,
  toastActionFromArgv,
  type ToastAction,
} from './toast-protocol.ts';
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
  registerToastProtocol();
  // The app has no network features at all (N1).
  app.commandLine.appendSwitch('disable-http-cache');

  await app.whenReady();

  const settings = new SettingsStore(app.getPath('userData'));

  // Heal first (a login item from an earlier install may point at an old EXE path), then
  // apply — so the setting always wins over whatever is currently registered.
  healAutostartPath();
  applyAutostart(settings.get().ui.autostart);

  // Sync cache read for `hasTerminalWindow` — the real probe is async and runs out-of-band,
  // driven off the same `sessions` event the tray/renderer already consume (see below), so no
  // separate timer is needed.
  const windowProbe = createWindowProbe();

  const { engine, adapter, paths } = createEngine({
    settings: settings.get(),
    hasTerminalWindow: (pid) => windowProbe.get(pid),
  });

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
    isMuted: (sessionId) => engine.isMuted(sessionId),
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
    // Piggybacks on the engine's own refresh cadence (tick + file-change driven) instead of a
    // separate timer. `getLiveSessions()` is the unfiltered list on purpose — see its doc.
    void windowProbe.refresh(engine.getLiveSessions());
  });
  engine.on('transitions', (transitions) => notifier.handle(transitions));
  engine.on('history', (info) => broadcast(IPC.historyChanged, info));
  engine.on('error', (error) => {
    process.stderr.write(`[claude-control] ${error.message}\n`);
  });

  const shortcutManager = new ShortcutManager({
    onToggle: () => {
      const bounds = tray.getBounds();
      if (bounds) windows.togglePopover(bounds);
    },
  });

  settings.onChange((next) => {
    void engine.updateSettings(next);
    applyAutostart(next.ui.autostart);
    shortcutManager.apply(next.ui.globalShortcut);
    broadcast(IPC.shortcutStatusChanged, shortcutManager.status());
    broadcast(IPC.settingsChanged, next);
  });

  registerIpc({
    engine,
    settings,
    focuser,
    windows,
    shortcutManager,
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

  shortcutManager.apply(settings.get().ui.globalShortcut);
  broadcast(IPC.shortcutStatusChanged, shortcutManager.status());

  // Started by the login item: a modal at logon would be pure noise, so it stays silent.
  const startedByAutostart = process.argv.includes(AUTOSTART_FLAG);

  if (!startedByAutostart && lastState.sessions.length === 0 && !hasClaudeData(paths.root)) {
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

  // A toast button (D6) reaches us as a *new* process launched by the shell for the
  // `claude-control://` URI; the lock above bounces it here with its argv. Anything else is a
  // user starting the app a second time, which means "show me the app".
  app.on('second-instance', (_event, argv) => {
    const action = toastActionFromArgv(argv);
    if (action) runToastAction(action);
    else windows.openMain('sessions');
  });

  // Same URI, but the app was not running when the button was pressed: then there is no second
  // instance and the URI is simply in our own command line. Runs last, so the engine is
  // started and `jump` can find its session.
  const startupAction = toastActionFromArgv(process.argv);
  if (startupAction) runToastAction(startupAction);

  // Tray app: closing all windows must not quit (N3, §8).
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  });

  app.on('before-quit', () => {
    void engine.stop();
    tray.destroy();
    windows.destroy();
  });

  // Belt-and-suspenders: guarantees the registration is gone even if `before-quit` is cancelled.
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
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

  /**
   * What a toast button does (D6). "Jump" is the same path as clicking the toast body, and
   * "Mute" is the same call the renderer's mute switch makes over IPC — one behaviour each,
   * reached from a second entry point.
   */
  function runToastAction(action: ToastAction): void {
    const sessionId = action.sessionId as SessionId;
    if (action.action === 'mute') engine.setMuted(sessionId, true);
    else void focusSession(sessionId);
  }

  function quit(): void {
    void engine.stop().finally(() => {
      tray.destroy();
      windows.destroy();
      app.quit();
    });
  }
}

/**
 * Makes `claude-control://` ours, so the shell can hand a toast button's URI back to the app
 * (D6). Windows-only: that is the only platform where the buttons exist, and registering a
 * scheme elsewhere would be a side effect nothing asked for. A dev run has no exe of its own,
 * so the registration has to name Electron plus the script it should run. `protocolClientTarget`
 * (D4) additionally prefers the portable build's stable exe path over the temp extraction dir
 * `process.execPath` would otherwise record.
 */
function registerToastProtocol(): void {
  if (process.platform !== 'win32') return;
  try {
    const target = protocolClientTarget(process.env, process.execPath, app.isPackaged, process.argv[1]);
    if (target.path) app.setAsDefaultProtocolClient(TOAST_PROTOCOL, target.path, target.args ?? []);
    else app.setAsDefaultProtocolClient(TOAST_PROTOCOL);
  } catch {
    // A blocked registry write costs the buttons, not the app — the toast itself still shows.
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
    traySessions: [],
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
