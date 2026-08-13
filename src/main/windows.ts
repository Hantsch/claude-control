/**
 * The two surfaces from §8: the tray popover (fast path) and the main window.
 *
 * Both are locked down per §3: `contextIsolation: true`, `nodeIntegration: false`, no
 * filesystem access from the renderer, and navigation to anything but the bundled document
 * is refused — the app has no network features at all (N1).
 */

import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';

/**
 * The popover is deliberately wide: every column (title, project · branch, status, age) has
 * to fit on one line, because a horizontal scrollbar in a menu-like surface is unusable.
 */
const POPOVER_WIDTH = 620;
const POPOVER_MIN_HEIGHT = 120;
const POPOVER_MAX_HEIGHT = 560;
/** Margin kept between the popover and the edges of the work area. */
const SCREEN_MARGIN = 8;

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
  /**
   * The popover's intended size — tracked here rather than read back from the window.
   *
   * Reading it back used to make the popover shrink: DIP↔physical conversion is lossy, so
   * every open fed a slightly smaller number into `setSize()`. Width is a constant now and
   * height comes from the content, so neither can accumulate an error — and because this is
   * the intent rather than an observation, it can be re-asserted on the window at any time.
   */
  private popoverHeight = 260;
  /** Position the user dragged the popover to; honoured only while it is pinned. */
  private popoverPosition: { x: number; y: number } | null = null;
  /** Last position *we* set, so the `moved` handler can ignore its own echo. */
  private appliedPosition: { x: number; y: number } | null = null;
  private popoverPinned = false;
  /** Tray bounds of the most recent open, so a resize can re-anchor to the icon. */
  private lastTrayBounds: Electron.Rectangle | null = null;

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

  /**
   * Compact popover anchored to the tray icon. Unpinned it behaves like a menu — one blur
   * and it is gone; pinned it stays open wherever the user dragged it.
   */
  togglePopover(trayBounds: Electron.Rectangle): void {
    if (this.popover && !this.popover.isDestroyed() && this.popover.isVisible()) {
      this.popover.hide();
      return;
    }

    this.lastTrayBounds = trayBounds;
    const window = this.ensurePopover();
    // Size *and* position are re-asserted on every open, never just on a content change —
    // see `applyPopoverBounds` for why the window cannot be trusted to keep its size.
    this.applyPopoverBounds(window);
    window.show();
    window.focus();
  }

  /**
   * Hide the popover. A pinned one is left alone unless `force` is set: jumping to a session
   * or opening the main window must not dismiss a panel the user deliberately parked — but
   * its own close button still closes it.
   */
  hidePopover(force = false): void {
    if (this.popoverPinned && !force) return;
    if (this.popover && !this.popover.isDestroyed()) this.popover.hide();
  }

  isPopoverPinned(): boolean {
    return this.popoverPinned;
  }

  /**
   * Pinning keeps the popover open on blur and remembers where it was dragged to. Unpinning
   * drops that position, so the next open snaps back to the tray icon.
   */
  setPopoverPinned(pinned: boolean): boolean {
    this.popoverPinned = pinned;
    if (!pinned) this.popoverPosition = null;
    const window = this.popover;
    if (window && !window.isDestroyed()) {
      // A pinned popover has to survive a click into another app, so it must not be hidden
      // by whatever else claims to be always-on-top.
      window.setAlwaysOnTop(true, pinned ? 'floating' : 'normal');
      if (!pinned && window.isVisible()) this.applyPopoverBounds(window);
    }
    return this.popoverPinned;
  }

  /**
   * Height the popover's content asked for. Clamped to the work area, applied only when it
   * actually changed, and followed by a re-anchor so a growing list does not run off the
   * bottom of the screen.
   */
  resizePopover(height: number): void {
    const window = this.popover;
    if (!window || window.isDestroyed()) return;

    const work = this.workArea();
    const ceiling = Math.min(POPOVER_MAX_HEIGHT, work.height - 2 * SCREEN_MARGIN);
    const clamped = Math.max(POPOVER_MIN_HEIGHT, Math.min(ceiling, Math.ceil(height)));
    if (clamped === this.popoverHeight) return;

    this.popoverHeight = clamped;
    this.applyPopoverBounds(window);
  }

  private ensurePopover(): BrowserWindow {
    if (this.popover && !this.popover.isDestroyed()) return this.popover;

    const window = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: this.popoverHeight,
      show: false,
      frame: false,
      resizable: false,
      // Movable so the drag region in the popover's title bar can be used (F: pin & drag).
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#17171a',
      webPreferences: this.webPreferences(),
    });

    this.harden(window);
    window.on('blur', () => {
      if (!this.popoverPinned) window.hide();
    });
    // `moved` also fires for our own `setPosition`, so a programmatic move must not be
    // mistaken for a drag — otherwise the very first anchoring would freeze the position.
    window.on('moved', () => {
      if (window.isDestroyed()) return;
      const [x, y] = window.getPosition();
      const at = { x: x ?? 0, y: y ?? 0 };
      if (this.appliedPosition && at.x === this.appliedPosition.x && at.y === this.appliedPosition.y) {
        return;
      }
      this.popoverPosition = at;
    });
    window.on('closed', () => {
      this.popover = null;
    });

    void this.load(window, 'popover.html', '');
    this.popover = window;
    return window;
  }

  /**
   * Force the popover to the geometry we intend: the tracked size, at the dragged-to position
   * while pinned and anchored to the tray icon otherwise.
   *
   * Both halves have to be applied together, and on every open. Windows keeps a
   * non-resizable window's min/max constraints pinned to its current size and re-applies the
   * frame insets on top of them each time it is shown, so the popover lost 12 × 6 px per
   * click on the tray icon — it only *looked* like a resize bug because nothing ever put the
   * size back. Lifting `resizable` for the duration of the call keeps those constraints out
   * of it; the window ends up within a pixel of the request and, crucially, stays there.
   */
  private applyPopoverBounds(window: BrowserWindow): void {
    const work = this.workArea();
    const target =
      this.popoverPinned && this.popoverPosition
        ? clampToWorkArea(this.popoverPosition, POPOVER_WIDTH, this.popoverHeight, work)
        : this.lastTrayBounds
          ? anchorToTray(this.lastTrayBounds, POPOVER_WIDTH, this.popoverHeight, work)
          : null;

    const resizable = window.isResizable();
    if (!resizable) window.setResizable(true);
    if (target) {
      this.appliedPosition = target;
      window.setBounds({ ...target, width: POPOVER_WIDTH, height: this.popoverHeight }, false);
    } else {
      // No anchor yet (the popover was opened before the tray reported bounds): at least
      // keep the size honest.
      window.setSize(POPOVER_WIDTH, this.popoverHeight, false);
    }
    if (!resizable) window.setResizable(false);
  }

  private workArea(): Electron.Rectangle {
    const bounds = this.lastTrayBounds;
    const display = bounds
      ? screen.getDisplayNearestPoint({
          x: bounds.x + Math.round(bounds.width / 2),
          y: bounds.y + Math.round(bounds.height / 2),
        })
      : screen.getPrimaryDisplay();
    return display.workArea;
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

/** Centred under/over the tray icon, kept inside the work area. */
export function anchorToTray(
  trayBounds: Electron.Rectangle,
  width: number,
  height: number,
  work: Electron.Rectangle,
): { x: number; y: number } {
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);

  // Tray on the bottom (the usual case) → open upwards; otherwise below the icon.
  const trayNearBottom = trayBounds.y > work.y + work.height / 2;
  const y = trayNearBottom
    ? trayBounds.y - height - SCREEN_MARGIN
    : trayBounds.y + trayBounds.height + SCREEN_MARGIN;

  return clampToWorkArea({ x, y }, width, height, work);
}

export function clampToWorkArea(
  at: { x: number; y: number },
  width: number,
  height: number,
  work: Electron.Rectangle,
): { x: number; y: number } {
  const maxX = work.x + work.width - width - SCREEN_MARGIN;
  const maxY = work.y + work.height - height - SCREEN_MARGIN;
  return {
    x: Math.round(Math.max(work.x + SCREEN_MARGIN, Math.min(at.x, Math.max(work.x + SCREEN_MARGIN, maxX)))),
    y: Math.round(Math.max(work.y + SCREEN_MARGIN, Math.min(at.y, Math.max(work.y + SCREEN_MARGIN, maxY)))),
  };
}
