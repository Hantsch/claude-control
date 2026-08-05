/**
 * win32 window activation via `koffi` FFI — no native build step (§3 stack table).
 *
 * Windows restricts foreground activation from background processes. When
 * `SetForegroundWindow` is refused we flash the taskbar button with `FlashWindowEx`
 * instead of silently doing nothing (§7).
 *
 * Loading is best effort: if `koffi` cannot be loaded (ABI mismatch, non-Windows host),
 * `available` stays false and the caller falls back to the shell activator.
 */

export interface WindowInfo {
  /** Opaque handle as a decimal string — HWNDs do not fit in a JS number on Win64. */
  handle: string;
  pid: number;
  title: string;
}

export interface ActivationOutcome {
  activated: boolean;
  flashed: boolean;
}

const SW_RESTORE = 9;
const SW_SHOW = 5;
const FLASHW_ALL = 3;
const FLASHW_TIMERNOFG = 12;

interface Native {
  enumWindows(): WindowInfo[];
  activate(handle: string): ActivationOutcome;
}

let native: Native | null = null;
let loadAttempted = false;
let loadError: string | null = null;

function load(): Native | null {
  if (loadAttempted) return native;
  loadAttempted = true;
  if (process.platform !== 'win32') {
    loadError = 'not running on Windows';
    return null;
  }
  try {
    native = buildNative();
  } catch (error) {
    native = null;
    loadError = error instanceof Error ? error.message : String(error);
  }
  return native;
}

function buildNative(): Native {
  // Required lazily so a koffi load failure cannot prevent the app from starting.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi');
  const user32 = koffi.load('user32.dll');

  const FLASHWINFO = koffi.struct('FLASHWINFO', {
    cbSize: 'uint32_t',
    hwnd: 'void *',
    dwFlags: 'uint32_t',
    uCount: 'uint32_t',
    dwTimeout: 'uint32_t',
  });

  const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, int64_t lparam)');

  const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *proc, int64_t lparam)');
  const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hwnd)');
  const GetWindowThreadProcessId = user32.func(
    'uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)',
  );
  const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(void *hwnd)');
  const GetWindowTextW = user32.func(
    'int __stdcall GetWindowTextW(void *hwnd, _Out_ uint16_t *buffer, int max)',
  );
  const GetParent = user32.func('void * __stdcall GetParent(void *hwnd)');
  const ShowWindow = user32.func('bool __stdcall ShowWindow(void *hwnd, int cmd)');
  const IsIconic = user32.func('bool __stdcall IsIconic(void *hwnd)');
  const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(void *hwnd)');
  const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
  const FlashWindowEx = user32.func('bool __stdcall FlashWindowEx(FLASHWINFO *info)');

  const handles = new Map<string, unknown>();

  const rememberHandle = (hwnd: unknown): string => {
    const key = koffi.address(hwnd as never).toString();
    handles.set(key, hwnd);
    return key;
  };

  return {
    enumWindows(): WindowInfo[] {
      const found: WindowInfo[] = [];
      const callback = koffi.register((hwnd: unknown) => {
        try {
          if (!IsWindowVisible(hwnd)) return true;
          // Top-level windows only: a child window is not what the taskbar activates.
          if (koffi.address(GetParent(hwnd) as never) !== 0n) return true;
          const length = GetWindowTextLengthW(hwnd) as number;
          if (length <= 0) return true;
          const pidOut: number[] = [0];
          GetWindowThreadProcessId(hwnd, pidOut);
          const buffer = new Uint16Array(Math.min(length + 1, 512));
          GetWindowTextW(hwnd, buffer, buffer.length);
          const title = Buffer.from(buffer.buffer, 0, buffer.length * 2)
            .toString('utf16le')
            .replace(/\0.*$/, '');
          found.push({ handle: rememberHandle(hwnd), pid: pidOut[0] ?? 0, title });
        } catch {
          // One bad window must not abort the enumeration.
        }
        return true;
      }, koffi.pointer(EnumWindowsProc));

      try {
        EnumWindows(callback, 0);
      } finally {
        koffi.unregister(callback);
      }
      return found;
    },

    activate(handle: string): ActivationOutcome {
      const hwnd = handles.get(handle);
      if (!hwnd) return { activated: false, flashed: false };

      if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
      else ShowWindow(hwnd, SW_SHOW);

      const ok = SetForegroundWindow(hwnd) as boolean;
      const foreground = koffi.address(GetForegroundWindow() as never).toString();
      if (ok && foreground === handle) return { activated: true, flashed: false };

      // Refused by the foreground lock — flash the taskbar button instead (§7).
      FlashWindowEx({
        cbSize: koffi.sizeof(FLASHWINFO),
        hwnd,
        dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG,
        uCount: 3,
        dwTimeout: 0,
      });
      return { activated: false, flashed: true };
    },
  };
}

export function isNativeFocusAvailable(): boolean {
  return load() !== null;
}

export function nativeFocusError(): string | null {
  load();
  return loadError;
}

/** Visible top-level windows, or an empty list when the FFI is unavailable. */
export function listWindows(): WindowInfo[] {
  const lib = load();
  if (!lib) return [];
  try {
    return lib.enumWindows();
  } catch {
    return [];
  }
}

/**
 * Best visible top-level window of a process.
 *
 * A single VS Code process owns *one window per open workspace* (measured: three windows
 * under one pid), so the pid alone cannot identify the right one. `titleHint` — normally the
 * workspace folder name — picks the matching window; without it, the longest title wins.
 */
export function findWindowForPid(pid: number, titleHint?: string | null): WindowInfo | null {
  const candidates = listWindows().filter((window) => window.pid === pid);
  if (candidates.length === 0) return null;
  const hint = titleHint?.trim().toLowerCase();
  if (hint) {
    const matching = candidates.filter((window) => window.title.toLowerCase().includes(hint));
    if (matching.length > 0) {
      // Shortest matching title = least decorated, i.e. the plain workspace window rather
      // than one that happens to mention the folder in a tab name.
      return matching.sort((a, b) => a.title.length - b.title.length)[0]!;
    }
  }
  return candidates.sort((a, b) => b.title.length - a.title.length)[0]!;
}

export function activateWindow(handle: string): ActivationOutcome {
  const lib = load();
  if (!lib) return { activated: false, flashed: false };
  try {
    return lib.activate(handle);
  } catch {
    return { activated: false, flashed: false };
  }
}
