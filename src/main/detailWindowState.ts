/** Geometry of the session detail window. No runtime electron import: unit-testable in plain Node. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './atomicJson.ts';

export type Rect = { x: number; y: number; width: number; height: number };
export type SavedDetailBounds = Rect;

export const DETAIL_WINDOW_DEFAULT = { width: 1000, height: 760 };
export const DETAIL_WINDOW_MIN = { width: 640, height: 420 };

const FILE = 'detail-window.json';

export type RestoredBounds = { x?: number; y?: number; width: number; height: number };

function isValid(b: unknown): b is SavedDetailBounds {
  if (typeof b !== 'object' || b === null) return false;
  const r = b as Record<string, unknown>;
  return (
    ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k])) &&
    (r.width as number) > 0 &&
    (r.height as number) > 0
  );
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, Math.max(lo, hi)));

export function restoreDetailBounds(
  saved: SavedDetailBounds | null,
  workAreas: Rect[],
  primary: Rect,
): RestoredBounds {
  if (!isValid(saved)) return { ...DETAIL_WINDOW_DEFAULT };
  const hit = workAreas.filter((w) => intersects(saved, w));
  // Size is limited by the display the window lands on; with no such display, the primary one.
  const target = hit.length
    ? hit.reduce((best, w) => (overlapArea(saved, w) > overlapArea(saved, best) ? w : best))
    : primary;
  const width = clamp(saved.width, DETAIL_WINDOW_MIN.width, target.width);
  const height = clamp(saved.height, DETAIL_WINDOW_MIN.height, target.height);
  if (!hit.length) return { width, height };
  return { x: Math.round(saved.x), y: Math.round(saved.y), width: Math.round(width), height: Math.round(height) };
}

/** BrowserWindow constructor options, minus webPreferences. */
export function detailWindowOptions(restored: RestoredBounds) {
  return {
    ...restored,
    resizable: true,
    minWidth: DETAIL_WINDOW_MIN.width,
    minHeight: DETAIL_WINDOW_MIN.height,
    show: false,
    autoHideMenuBar: true,
    title: 'Session detail',
  };
}

export function loadDetailBounds(userDataDir: string): SavedDetailBounds | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(userDataDir, FILE), 'utf8'));
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDetailBounds(userDataDir: string, bounds: SavedDetailBounds): void {
  try {
    writeJsonAtomic(join(userDataDir, FILE), bounds);
  } catch {
    // Remembering the window position is a convenience.
  }
}
