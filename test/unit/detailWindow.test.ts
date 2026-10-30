import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { dark: true };
  const windows: any[] = [];
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const saved: unknown[] = [];
  return { state, windows, handlers, saved };
});

vi.mock('electron', () => {
  class FakeWindow {
    options: any;
    sent: Array<[string, unknown]> = [];
    listeners = new Map<string, Array<() => void>>();
    destroyed = false;
    show = vi.fn();
    focus = vi.fn();
    bg: string | null = null;
    webContents = {
      send: (channel: string, payload: unknown) => this.sent.push([channel, payload]),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    };
    constructor(options: any) {
      this.options = options;
      h.windows.push(this);
    }
    on(event: string, fn: () => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
      return this;
    }
    once(event: string, fn: () => void) {
      return this.on(event, fn);
    }
    emit(event: string) {
      for (const fn of this.listeners.get(event) ?? []) fn();
    }
    isDestroyed() {
      return this.destroyed;
    }
    getNormalBounds() {
      return { x: 10, y: 20, width: 900, height: 700 };
    }
    setBackgroundColor(color: string) {
      this.bg = color;
    }
    close() {
      this.emit('close');
      this.destroyed = true;
      this.emit('closed');
    }
    loadURL = vi.fn(async () => undefined);
    loadFile = vi.fn(async () => undefined);
  }
  return {
    BrowserWindow: FakeWindow,
    nativeTheme: {
      get shouldUseDarkColors() {
        return h.state.dark;
      },
      on: vi.fn(),
      removeListener: vi.fn(),
    },
    screen: {
      getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
    app: { getVersion: () => '0', isPackaged: false },
    clipboard: { writeText: vi.fn() },
    ipcMain: { handle: (channel: string, fn: (...args: any[]) => unknown) => h.handlers.set(channel, fn) },
  };
});

vi.mock('../../src/main/icon-assets.ts', () => ({ appIcon: () => undefined }));
vi.mock('../../src/main/detailWindowState.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/detailWindowState.ts')>()),
  loadDetailBounds: () => null,
  saveDetailBounds: (_dir: string, bounds: unknown) => h.saved.push(bounds),
}));

const { WindowManager } = await import('../../src/main/windows.ts');
const { registerIpc } = await import('../../src/main/ipc.ts');

function manager() {
  return new WindowManager({
    rendererDir: 'renderer',
    devServerUrl: 'http://localhost:5173',
    preload: 'preload.cjs',
    userDataDir: 'userdata',
  });
}

const detailSends = (w: any) => w.sent.filter(([c]: [string]) => c === 'cc:detail-target');

beforeEach(() => {
  h.windows.length = 0;
  h.saved.length = 0;
  h.handlers.clear();
  h.state.dark = true;
  vi.useRealTimers();
});

describe('detail window', () => {
  it('opening a session creates the detail window and sends it the session id', () => {
    const m = manager();
    m.openDetail('s1');
    expect(h.windows).toHaveLength(1);
    h.windows[0].emit('ready-to-show');
    expect(detailSends(h.windows[0])).toEqual([['cc:detail-target', { sessionId: 's1' }]]);
    expect(h.windows[0].loadURL).toHaveBeenCalledWith('http://localhost:5173/detail.html?session=s1');
  });

  it('opening another session retargets the one detail window', () => {
    const m = manager();
    m.openDetail('s1');
    m.openDetail('s2');
    expect(h.windows).toHaveLength(1);
    expect(detailSends(h.windows[0])).toEqual([['cc:detail-target', { sessionId: 's2' }]]);
  });

  it('opening the shown session again only focuses it', () => {
    const m = manager();
    m.openDetail('s1');
    h.windows[0].emit('ready-to-show');
    m.openDetail('s1');
    expect(h.windows).toHaveLength(1);
    expect(h.windows[0].show).toHaveBeenCalled();
    expect(h.windows[0].focus).toHaveBeenCalled();
    expect(detailSends(h.windows[0])).toHaveLength(1);
  });

  it('a session opened before the window finished loading wins', () => {
    const m = manager();
    m.openDetail('A');
    m.openDetail('B');
    h.windows[0].emit('ready-to-show');
    const sends = detailSends(h.windows[0]);
    expect(sends[sends.length - 1]).toEqual(['cc:detail-target', { sessionId: 'B' }]);
  });

  it('the detail window saves its normal bounds on resize, move and close', () => {
    vi.useFakeTimers();
    manager().openDetail('s1');
    const w = h.windows[0];
    const normal = { x: 10, y: 20, width: 900, height: 700 };

    w.emit('resize');
    expect(h.saved).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(h.saved).toEqual([normal]);

    w.emit('move');
    vi.advanceTimersByTime(500);
    expect(h.saved).toHaveLength(2);

    w.emit('close');
    expect(h.saved).toEqual([normal, normal, normal]);
  });

  it('closing via IPC closes the detail window', () => {
    const m = manager();
    registerIpc({ windows: m } as never);
    m.openDetail('s1');
    const w = h.windows[0];
    h.handlers.get('cc:close-detail-window')!({});
    expect(w.destroyed).toBe(true);
    expect(m.allWindows()).toEqual([]);
  });

  it('opening a session over IPC ignores non-string ids', () => {
    const m = manager();
    registerIpc({ windows: m } as never);
    h.handlers.get('cc:open-session-detail')!({}, 42);
    expect(h.windows).toHaveLength(0);
    h.handlers.get('cc:open-session-detail')!({}, 's9');
    expect(h.windows).toHaveLength(1);
  });

  it('the detail window follows the OS scheme for its background', () => {
    const m = manager();
    m.openDetail('s1');
    const w = h.windows[0];
    expect(w.options.backgroundColor).toBe('#111113');
    h.state.dark = false;
    (m as any).applyThemeToLiveWindows();
    expect(w.bg).toBe('#f7f7f9');
    h.state.dark = true;
    (m as any).applyThemeToLiveWindows();
    expect(w.bg).toBe('#111113');
  });
});
