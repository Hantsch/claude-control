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
 * How a hint is allowed to match a window title.
 *
 *  - `segment` — the title, cut at ` - `, contains a part that *is* the hint. VS Code builds
 *    its titles as `file - rootName - Visual Studio Code`, so the workspace name is a whole
 *    segment; requiring that is what keeps `q2` from matching `q2-launcher` and a folder from
 *    matching a file that merely mentions it. Remote and profile decorations (`rootName
 *    [WSL: Ubuntu]`, `rootName (Profile)`) still count.
 *  - `substring` — anywhere in the title. Weaker, and only used for the hint we trust most
 *    (the workspace folder the session actually runs in) after every segment match failed.
 *  - `title` — the whole title, verbatim. That is what a process's `MainWindowTitle` is, so
 *    it is the only honest way to use one as a hint.
 */
export type HintMode = 'segment' | 'substring' | 'title';

export interface WindowHint {
  text: string;
  mode: HintMode;
}

/**
 * Why this window was chosen — the caller needs to know how much to trust it:
 *
 *  - `matched` — a hint matched its title.
 *  - `only` — no hint matched, but the process owns exactly one window, so there is nothing
 *    to be wrong about.
 *  - `guess` — no hint matched and the process owns several windows. Handing one of those
 *    over silently is the bug this whole file exists for (every VS Code session ended up on
 *    the same arbitrary window), so it is reported instead of hidden.
 */
export type MatchConfidence = 'matched' | 'only' | 'guess';

export interface WindowMatch {
  window: WindowInfo;
  confidence: MatchConfidence;
}

/**
 * Best visible top-level window of a process.
 *
 * A single VS Code process owns *one window per open workspace* (measured: three windows
 * under one pid), so the pid alone cannot identify the right one — the hints, normally the
 * session's workspace folder name, are what picks the window out.
 */
export function findWindowForPid(pid: number, hints: readonly WindowHint[] = []): WindowMatch | null {
  return pickWindow(listWindows().filter((window) => window.pid === pid), hints);
}

/**
 * The choice itself, split out of `findWindowForPid` so it has unit coverage: everything
 * around it is `user32` behind an FFI that only exists on Windows, while *which* of a
 * process's windows is the right one is pure list logic and is where the bug was.
 *
 * Hints are tried in the order given and the first that matches wins, so callers rank them
 * by confidence rather than by how likely they are to match anything.
 */
export function pickWindow(
  candidates: readonly WindowInfo[],
  hints: readonly WindowHint[] = [],
): WindowMatch | null {
  if (candidates.length === 0) return null;

  for (const hint of hints) {
    const text = hint.text.trim().toLowerCase();
    if (!text) continue;
    const matching = candidates.filter((window) => titleMatches(window.title, text, hint.mode));
    if (matching.length === 0) continue;
    // Shortest matching title = least decorated, i.e. the plain workspace window rather
    // than one that happens to mention the folder in a tab name.
    const window = [...matching].sort((a, b) => a.title.length - b.title.length)[0]!;
    return { window, confidence: 'matched' };
  }

  if (candidates.length === 1) return { window: candidates[0]!, confidence: 'only' };
  return { window: [...candidates].sort((a, b) => b.title.length - a.title.length)[0]!, confidence: 'guess' };
}

function titleMatches(title: string, hint: string, mode: HintMode): boolean {
  const lower = title.toLowerCase();
  if (mode === 'title') return lower.trim() === hint;
  if (mode === 'substring') return lower.includes(hint);
  return lower
    .split(' - ')
    .map((part) => part.trim())
    // `folder [WSL: Ubuntu]` and `folder (Profile)` are the same workspace, decorated.
    .some((part) => part === hint || part.startsWith(`${hint} [`) || part.startsWith(`${hint} (`));
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
