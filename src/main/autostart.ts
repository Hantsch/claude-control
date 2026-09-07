/**
 * Autostart (Windows login item).
 *
 * Everything here goes through `path` + `args` **identically** on get and set. On Windows
 * Electron writes an `HKCU\...\Run` value whose data is the formatted command line, and
 * `getLoginItemSettings` only reports `openAtLogin: true` when the stored command line
 * matches the `path`/`args` it was asked about. Passing them on set but not on get (or vice
 * versa) makes the readback permanently disagree with the registry — hence the single
 * `loginItemOptions()` used by every call below.
 *
 * `applyAutostart(false)` passes the same `path`/`args` as well: the option object identifies
 * *which* entry is meant, so a bare `{ openAtLogin: false }` can leave the entry behind.
 */

import { app } from 'electron';

/** The flag the login item is registered with — see `--autostart` handling in index.ts. */
export const AUTOSTART_FLAG = '--autostart';

function loginItemOptions(): { path: string; args: string[] } {
  return { path: process.execPath, args: [AUTOSTART_FLAG] };
}

/** Registers or removes the login item for the *current* executable location. */
export function applyAutostart(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled, ...loginItemOptions() });
}

/**
 * Intentional no-op — kept only so `index.ts`'s existing call site needs no change.
 *
 * This used to compare the registered login item's path against `process.execPath` to repair
 * an entry left pointing at a previous location of the EXE (moved, or upgraded into a new
 * versioned directory). Two review rounds established that comparison is unworkable through
 * Electron's public API on Windows: `app.getLoginItemSettings(options)` normalizes/filters
 * `launchItems` against the *lookup* `path`, and when `options` is omitted, Electron defaults
 * `path` to `process.execPath` anyway (see `getLoginItemSettings` in electron.d.ts: "path —
 * Defaults to `process.execPath`"). So the lookup always resolves to the *current* EXE path,
 * whether that path is passed explicitly or left out — there is no way, through this API, to
 * ask "what path is currently registered" independent of "does it match this specific path".
 * A stale entry at an old path is therefore either filtered out entirely (reported as if
 * nothing is registered) or, if it happens to still match, reported as already correct — this
 * function could never actually observe genuine drift. There is nothing left here to
 * conditionally decide.
 *
 * The self-heal effect is achieved elsewhere: `applyAutostart()` is called unconditionally on
 * every app start (see index.ts) and always writes the *current* `process.execPath`. That
 * alone re-points the login item at wherever the EXE currently is, every time the app starts
 * with autostart on — which is the actual behavior the "portable EXE" acceptance criterion
 * needs. Doing that write unconditionally is the correct behavior, not a bug to avoid.
 */
export function healAutostartPath(): void {}
