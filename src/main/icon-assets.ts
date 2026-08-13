/**
 * The shipped icon art in `assets/icons`, loaded on demand and cached (§6.5).
 *
 * Three consumers, one folder: the tray tile per state and badge count, the window icon, and
 * the toast logo per notifying status. `scripts/build-icons.py` writes all of it; the names
 * here are the app's own state names, so nothing has to translate between the art's
 * vocabulary and the state machine's.
 *
 * Files are read through `fs` rather than `nativeImage.createFromPath` because in the
 * packaged app they live inside `app.asar`, which only the patched `fs` can open.
 */

import { app, nativeImage, type NativeImage } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionStatus, TrayIcon } from '../core/model/status.ts';
import { badgeLabel, paintBadge, renderFallbackTile } from './tray-icons.ts';

/** Physical tile sizes `scripts/build-icons.py` emits. */
const TRAY_SIZES = [16, 20, 24, 32, 40, 48];
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
 * The shipped size closest to the physical box this display will give the tray.
 *
 * Handing Windows a tile it does not have to resample is the whole reason the art ships per
 * size: the ring is a thin stroke, and a 32 px tile squeezed into a 16 px slot loses it.
 */
export function trayPixelSize(scaleFactor: number): number {
  const wanted = TRAY_BASE_SIZE * (scaleFactor > 0 ? scaleFactor : 1);
  return TRAY_SIZES.reduce((best, size) =>
    Math.abs(size - wanted) < Math.abs(best - wanted) ? size : best,
  );
}

/** Tray tile for a state and badge count, rendered at a physical pixel size. */
export function trayImage(icon: TrayIcon, badgeCount: number, size: number): NativeImage {
  const label = badgeLabel(badgeCount);
  const key = `tray:${icon}:${label ?? ''}:${size}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const image = buildTrayImage(icon, label, size);
  cache.set(key, image);
  return image;
}

function buildTrayImage(icon: TrayIcon, label: string | null, size: number): NativeImage {
  const art = read('tray', String(size), `${icon}.png`);
  if (!art) {
    const fallback = renderFallbackTile(icon, size);
    if (label) paintBadge(fallback, label);
    return nativeImage.createFromBitmap(fallback.data, { width: size, height: size });
  }
  if (!label) return art;

  // The badge has to be composited on the pixels, not laid on as a second representation:
  // the tray takes one image.
  const { width, height } = art.getSize();
  const bitmap = { width, height, data: art.toBitmap() };
  paintBadge(bitmap, label);
  return nativeImage.createFromBitmap(bitmap.data, { width, height });
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
