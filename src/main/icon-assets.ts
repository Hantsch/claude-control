/**
 * Every image the main process hands to the OS (§6.5).
 *
 * Two sources: the tray tile is drawn per state and badge count by `tray-icons.ts`, and the
 * window icon plus the toast logo per notifying status are shipped art in `assets/icons`,
 * loaded on demand and cached. `scripts/build-icons.py` writes the latter; the file names are
 * the app's own status names, so nothing has to translate between the art's vocabulary and the
 * state machine's.
 *
 * Files are read through `fs` rather than `nativeImage.createFromPath` because in the
 * packaged app they live inside `app.asar`, which only the patched `fs` can open.
 */

import { app, nativeImage, nativeTheme, type NativeImage } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SessionStatus, TrayIcon } from '../core/model/status.ts';
import { badgeLabel, paintBadge, renderTrayTile } from './tray-icons.ts';

/** Windows hands the tray a 16 DIP box; display scaling multiplies it. */
const TRAY_BASE_SIZE = 16;

const cache = new Map<string, NativeImage>();

function read(...segments: string[]): NativeImage | null {
  try {
    const image = nativeImage.createFromBuffer(readFileSync(join(app.getAppPath(), 'assets', 'icons', ...segments)));
    return image.isEmpty() ? null : image;
  } catch {
    return null;
  }
}

/**
 * The physical pixel box this display will give the tray.
 *
 * Windows resamples whatever it is handed, and a resampled 16 px tile is mush — so the tile is
 * drawn at exactly this size instead. Back when the tiles were shipped art this had to snap to
 * the nearest size that existed on disk; drawing them means there is nothing to snap to.
 */
export function trayPixelSize(scaleFactor: number): number {
  return Math.max(TRAY_BASE_SIZE, Math.round(TRAY_BASE_SIZE * (scaleFactor > 0 ? scaleFactor : 1)));
}

/** Tray tile for a state and badge count, rendered at a physical pixel size. */
export function trayImage(icon: TrayIcon, badgeCount: number, size: number): NativeImage {
  const label = badgeLabel(badgeCount);
  // Both the state colours and the badge rim follow the OS theme (§007 D4, §014 D4) — a cached
  // dark tile must not survive a switch to a light taskbar, so the theme joins the key
  // alongside icon/badge/size.
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  const key = `tray:${icon}:${label ?? ''}:${size}:${theme}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const image = buildTrayImage(icon, label, size);
  cache.set(key, image);
  return image;
}

function buildTrayImage(icon: TrayIcon, label: string | null, size: number): NativeImage {
  // The state's own colours follow the OS theme (§014 D4) — the light set is darkened enough
  // to read on a light taskbar, which the dark set is not.
  const tile = renderTrayTile(icon, size, nativeTheme.shouldUseDarkColors);
  // The badge is composited onto the same pixels rather than laid on as a second
  // representation: the tray takes one image.
  if (label) paintBadge(tile, label);
  return nativeImage.createFromBitmap(tile.data, { width: size, height: size });
}

/**
 * Window icon. The packaged exe carries `app.ico` and Windows takes the window icon from it,
 * but a dev run has no exe — without this the app shows Electron's own logo in the taskbar.
 */
export function appIcon(): NativeImage | undefined {
  const cached = cache.get('app');
  if (cached) return cached;
  const image = read('app.png');
  if (image) cache.set('app', image);
  return image ?? undefined;
}

/**
 * Toast logo per notifying status (F5), so a `done` and a `waiting` toast are distinguishable
 * before reading a word of them. Falls back to the app logo Windows would use anyway.
 */
export function toastIcon(status: SessionStatus): NativeImage | undefined {
  const key = `toast:${status}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const image = read(`app-${status}.png`);
  if (image) cache.set(key, image);
  return image ?? undefined;
}

/**
 * The same logo as a `file:///` URI for the `toastXml` path (D6), where Windows loads the
 * image itself instead of taking a `NativeImage` from us — so unlike `toastIcon` this only
 * works for art the shell can actually open. `app.getAppPath()` always points inside
 * `app.asar`, which the shell cannot open directly (only the patched `fs` sees in there), so
 * `assets/icons/**` is listed under `asarUnpack` in `electron-builder.yml` and actually lives
 * on disk next to the asar, under `app.asar.unpacked`; rewriting the path is what lets the
 * shell reach it. In a dev run there is no `.asar` segment to rewrite, so this is a no-op there.
 */
export function toastIconUri(status: SessionStatus): string | null {
  try {
    const appPath = join(app.getAppPath(), 'assets', 'icons', `app-${status}.png`);
    const path = appPath.replace(/\.asar([\\/])/i, '.asar.unpacked$1');
    return existsSync(path) ? pathToFileURL(path).href : null;
  } catch {
    return null;
  }
}
