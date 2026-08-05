/**
 * The two surfaces from §8: the tray popover (fast path) and the main window.
 *
 * Both are locked down per §3: `contextIsolation: true`, `nodeIntegration: false`, no
 * filesystem access from the renderer, and navigation to anything but the bundled document
 * is refused — the app has no network features at all (N1).
 */

import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';

const POPOVER_WIDTH = 460;
const POPOVER_MAX_HEIGHT = 420;

export type MainTab = 'sessions' | 'history' | 'settings';

export interface WindowManagerOptions {
  /** Directory of the built renderer output, or the dev-server URL. */
  rendererDir: string;
  devServerUrl: string | null;
  preload: string;
}

export class WindowManager {
  private readonly options: WindowManagerOptions;
  private main: BrowserWindow | null = null;
  private popover: BrowserWindow | null = null;

  constructor(options: WindowManagerOptions) {
    this.options = options;
  }

  getMain(): BrowserWindow | null {
    return this.main;
  }

  getPopover(): BrowserWindow | null {
    return this.popover;
  }

  allWindows(): BrowserWindow[] {
    return [this.main, this.popover].filter((w): w is BrowserWindow => w !== null && !w.isDestroyed());
  }

  openMain(tab: MainTab = 'sessions'): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) {
      this.main.show();
      this.main.focus();
      this.main.webContents.send('cc:navigate', tab);
      return this.main;
    }

    const window = new BrowserWindow({
      width: 1080,
      height: 720,
      minWidth: 720,
      minHeight: 480,
      show: false,
      backgroundColor: '#111113',
      title: 'Claude Control',
      autoHideMenuBar: true,
      webPreferences: this.webPreferences(),
    });

    this.harden(window);
    window.once('ready-to-show', () => {
      window.show();
      window.webContents.send('cc:navigate', tab);
    });
    // Closing the window keeps the app alive in the tray — that is the whole point (§8).
    window.on('closed', () => {
      this.main = null;
    });

    void this.load(window, 'index.html', `?tab=${tab}`);
    this.main = window;
    return window;
  }

  /** Compact popover anchored to the tray icon; closes on blur so it behaves like a menu. */
  togglePopover(trayBounds: Electron.Rectangle): void {
    if (this.popover && !this.popover.isDestroyed() && this.popover.isVisible()) {
      this.popover.hide();
      return;
    }

    const window = this.ensurePopover();
    positionPopover(window, trayBounds);
    window.show();
    window.focus();
  }

  hidePopover(): void {
    if (this.popover && !this.popover.isDestroyed()) this.popover.hide();
  }

  resizePopover(height: number): void {
    if (!this.popover || this.popover.isDestroyed()) return;
    const clamped = Math.max(120, Math.min(POPOVER_MAX_HEIGHT, Math.round(height)));
    const [width] = this.popover.getSize();
    this.popover.setSize(width ?? POPOVER_WIDTH, clamped);
  }

  private ensurePopover(): BrowserWindow {
    if (this.popover && !this.popover.isDestroyed()) return this.popover;

    const window = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: 260,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#17171a',
      webPreferences: this.webPreferences(),
    });

    this.harden(window);
    window.on('blur', () => window.hide());
    window.on('closed', () => {
      this.popover = null;
    });

    void this.load(window, 'popover.html', '');
    this.popover = window;
    return window;
  }

  private webPreferences(): Electron.WebPreferences {
    return {
      preload: this.options.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
      spellcheck: false,
    };
  }

  private async load(window: BrowserWindow, file: string, query: string): Promise<void> {
    if (this.options.devServerUrl) {
      await window.loadURL(`${this.options.devServerUrl}/${file}${query}`);
    } else {
      await window.loadFile(join(this.options.rendererDir, file), {
        search: query.replace(/^\?/, ''),
      });
    }
  }

  /** No in-app navigation, no popups, no new windows. External links go to the browser. */
  private harden(window: BrowserWindow): void {
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      const allowed = this.options.devServerUrl && url.startsWith(this.options.devServerUrl);
      if (!allowed) event.preventDefault();
    });
  }
}

function positionPopover(window: BrowserWindow, trayBounds: Electron.Rectangle): void {
  const [width, height] = window.getSize();
  const w = width ?? POPOVER_WIDTH;
  const h = height ?? 260;
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x + Math.round(trayBounds.width / 2),
    y: trayBounds.y + Math.round(trayBounds.height / 2),
  });
  const work = display.workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - w / 2);
  x = Math.max(work.x + 8, Math.min(x, work.x + work.width - w - 8));

  // Tray on the bottom (the usual case) → open upwards; otherwise below the icon.
  const trayNearBottom = trayBounds.y > work.y + work.height / 2;
  const y = trayNearBottom
    ? Math.max(work.y + 8, trayBounds.y - h - 8)
    : Math.min(work.y + work.height - h - 8, trayBounds.y + trayBounds.height + 8);

  window.setPosition(x, y, false);
}
