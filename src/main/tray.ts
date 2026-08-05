/**
 * `TrayPresenter` (M2, F3, F4, §6.5).
 *
 * Icon colour follows the most urgent status across all sessions; the overlay badge counts
 * sessions in `waiting` or `done` and disappears at zero. Left click opens the compact
 * popover (§8), right click a native menu.
 */

import { Menu, Tray, nativeImage, type NativeImage } from 'electron';
import { STATUS_LABEL } from '../core/model/status.ts';
import type { AppState } from '../shared/ipc.ts';
import { clampLabel, sessionLabel } from '../shared/presentation.ts';
import { renderTrayIcon } from './tray-icons.ts';

export interface TrayPresenterDeps {
  onTogglePopover: (bounds: Electron.Rectangle) => void;
  onOpenWindow: (tab: 'sessions' | 'history' | 'settings') => void;
  onFocusSession: (sessionId: string) => void;
  onRefresh: () => void;
  onQuit: () => void;
}

export class TrayPresenter {
  private readonly deps: TrayPresenterDeps;
  private tray: Tray | null = null;
  private state: AppState | null = null;
  private lastKey = '';

  constructor(deps: TrayPresenterDeps) {
    this.deps = deps;
  }

  create(): void {
    if (this.tray) return;
    this.tray = new Tray(iconFor('none', 0));
    this.tray.setToolTip('Claude Control — no sessions');
    this.tray.on('click', (_event, bounds) => this.deps.onTogglePopover(bounds));
    this.tray.on('right-click', () => this.tray?.popUpContextMenu(this.buildMenu()));
    this.tray.on('double-click', () => this.deps.onOpenWindow('sessions'));
  }

  update(state: AppState): void {
    this.state = state;
    if (!this.tray) return;

    // Re-rendering the icon on every tick would be wasteful; the visual state is a pure
    // function of (trayState, badge), so only rebuild when that pair changes.
    const key = `${state.trayState}:${Math.min(state.attention, 10)}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.tray.setImage(iconFor(state.trayState, state.attention));
    }
    this.tray.setToolTip(tooltipFor(state));
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  getBounds(): Electron.Rectangle | null {
    return this.tray?.getBounds() ?? null;
  }

  /**
   * The right-click menu doubles as a keyboard-reachable version of the popover: the
   * sessions are listed so the fast path works even if the popover is unavailable.
   */
  private buildMenu(): Menu {
    const sessions = this.state?.sessions ?? [];
    const items: Electron.MenuItemConstructorOptions[] = [];

    if (sessions.length === 0) {
      items.push({ label: 'No live sessions', enabled: false });
    } else {
      for (const session of sessions.slice(0, 12)) {
        items.push({
          label: `${clampLabel(sessionLabel(session), 48)} — ${STATUS_LABEL[session.status]} · ${session.project.name}${session.branch ? ` · ${session.branch}` : ''}`,
          click: () => this.deps.onFocusSession(session.sessionId),
        });
      }
      if (sessions.length > 12) {
        items.push({ label: `… ${sessions.length - 12} more`, enabled: false });
      }
    }

    items.push(
      { type: 'separator' },
      { label: 'Open Claude Control', click: () => this.deps.onOpenWindow('sessions') },
      { label: 'History', click: () => this.deps.onOpenWindow('history') },
      { label: 'Settings', click: () => this.deps.onOpenWindow('settings') },
      { type: 'separator' },
      { label: 'Refresh now', click: () => this.deps.onRefresh() },
      { label: 'Quit', click: () => this.deps.onQuit() },
    );

    return Menu.buildFromTemplate(items);
  }
}

function iconFor(state: AppState['trayState'], badge: number): NativeImage {
  const image = nativeImage.createFromBuffer(renderTrayIcon(state, badge, 32));
  // Windows picks the 16 px slot from the tray; letting Electron scale a 32 px source keeps
  // it crisp at 150 % and 200 % display scaling.
  image.setTemplateImage(false);
  return image;
}

function tooltipFor(state: AppState): string {
  if (state.sessions.length === 0) return 'Claude Control — no sessions';
  const counts = new Map<string, number>();
  for (const session of state.sessions) {
    counts.set(session.status, (counts.get(session.status) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([status, count]) => `${count} ${status}`);
  return `Claude Control — ${state.sessions.length} session(s): ${parts.join(', ')}`;
}
