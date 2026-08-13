/**
 * `TrayPresenter` (M2, F3, F4, §6.5).
 *
 * Icon colour follows the most urgent status across the tray sessions — `trayIconFor`, which
 * also has the one two-state tile — and the overlay badge counts sessions in `waiting` or
 * `done` and disappears at zero. Left click opens the compact popover (§8), right click a
 * native menu.
 */

import { Menu, Tray, screen } from 'electron';
import { STATUS_LABEL } from '../core/model/status.ts';
import { trayIconFor } from '../core/state/aggregate.ts';
import type { AppState } from '../shared/ipc.ts';
import { clampLabel, sessionLabel } from '../shared/presentation.ts';
import { trayImage, trayPixelSize } from './icon-assets.ts';

export interface TrayPresenterDeps {
  onTogglePopover: (bounds: Electron.Rectangle) => void;
  onOpenWindow: (tab: 'sessions' | 'history' | 'settings') => void;
  onFocusSession: (sessionId: string) => void;
  onAcknowledgeAll: () => void;
  onRefresh: () => void;
  onQuit: () => void;
}

export class TrayPresenter {
  private readonly deps: TrayPresenterDeps;
  private tray: Tray | null = null;
  private state: AppState | null = null;
  private lastKey = '';
  /** Physical size of the tile Windows will ask for on this display. */
  private pixelSize = trayPixelSize(1);
  private readonly onDisplayChange = (): void => this.rescale();

  constructor(deps: TrayPresenterDeps) {
    this.deps = deps;
  }

  create(): void {
    if (this.tray) return;
    this.pixelSize = trayPixelSize(screen.getPrimaryDisplay().scaleFactor);
    this.tray = new Tray(trayImage('none', 0, this.pixelSize));
    this.tray.setToolTip('Claude Control — no sessions');
    this.tray.on('click', (_event, bounds) => this.deps.onTogglePopover(bounds));
    this.tray.on('right-click', () => this.tray?.popUpContextMenu(this.buildMenu()));
    this.tray.on('double-click', () => this.deps.onOpenWindow('sessions'));
    // Display scaling can change under a running app — docking a laptop, moving the taskbar
    // to another monitor. The tile has to be rebuilt at the new physical size or Windows
    // resamples the one it has.
    screen.on('display-metrics-changed', this.onDisplayChange);
  }

  update(state: AppState): void {
    this.state = state;
    if (!this.tray) return;

    // Re-rendering the icon on every tick would be wasteful; the visual state is a pure
    // function of (icon, badge, size), so only rebuild when that triple changes.
    const icon = trayIconFor(state.traySessions);
    const key = `${icon}:${Math.min(state.attention, 10)}:${this.pixelSize}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.tray.setImage(trayImage(icon, state.attention, this.pixelSize));
    }
    this.tray.setToolTip(tooltipFor(state));
  }

  destroy(): void {
    screen.removeListener('display-metrics-changed', this.onDisplayChange);
    this.tray?.destroy();
    this.tray = null;
  }

  getBounds(): Electron.Rectangle | null {
    return this.tray?.getBounds() ?? null;
  }

  private rescale(): void {
    const size = trayPixelSize(screen.getPrimaryDisplay().scaleFactor);
    if (size === this.pixelSize) return;
    this.pixelSize = size;
    this.lastKey = '';
    if (this.state) this.update(this.state);
  }

  /**
   * The right-click menu doubles as a keyboard-reachable version of the popover: the
   * sessions are listed so the fast path works even if the popover is unavailable.
   */
  private buildMenu(): Menu {
    // Same list as the popover: what is in flight, unacknowledged, or recent. "Open Claude
    // Control" is one item below for everything else.
    const sessions = this.state?.traySessions ?? [];
    const hidden = (this.state?.sessions.length ?? 0) - sessions.length;
    const items: Electron.MenuItemConstructorOptions[] = [];

    if (sessions.length === 0) {
      items.push({ label: 'Nothing needs you', enabled: false });
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
    if (hidden > 0) {
      items.push({ label: `${hidden} settled session(s) hidden`, enabled: false });
    }

    // The badge has to be dismissible, otherwise the icon claims something is open with no
    // way for the user to answer it. Offered only when there is something to dismiss.
    if ((this.state?.attention ?? 0) > 0) {
      items.push(
        { type: 'separator' },
        {
          label: `Mark all as seen (${this.state?.attention ?? 0})`,
          click: () => this.deps.onAcknowledgeAll(),
        },
      );
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

function tooltipFor(state: AppState): string {
  if (state.sessions.length === 0) return 'Claude Control — no sessions';
  const counts = new Map<string, number>();
  for (const session of state.traySessions) {
    counts.set(session.status, (counts.get(session.status) ?? 0) + 1);
  }
  if (counts.size === 0) return `Claude Control — ${state.sessions.length} session(s), all settled`;
  const parts = [...counts.entries()].map(([status, count]) => `${count} ${status}`);
  return `Claude Control — ${state.sessions.length} session(s): ${parts.join(', ')}`;
}
