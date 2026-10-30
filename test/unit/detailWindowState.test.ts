import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DETAIL_WINDOW_DEFAULT,
  DETAIL_WINDOW_MIN,
  detailWindowOptions,
  loadDetailBounds,
  restoreDetailBounds,
  saveDetailBounds,
} from '../../src/main/detailWindowState.ts';

const primary = { x: 0, y: 0, width: 1920, height: 1040 };

describe('detail window geometry', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'detail-win-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('the detail window is resizable with a minimum size and opens at the default size', () => {
    const opts = detailWindowOptions(restoreDetailBounds(null, [primary], primary));
    expect(opts.resizable).toBe(true);
    expect(opts.minWidth).toBe(DETAIL_WINDOW_MIN.width);
    expect(opts.minHeight).toBe(DETAIL_WINDOW_MIN.height);
    expect(opts.width).toBe(DETAIL_WINDOW_DEFAULT.width);
    expect(opts.height).toBe(DETAIL_WINDOW_DEFAULT.height);
    expect(opts.x).toBeUndefined();
    expect(opts.show).toBe(false);
    expect(opts.title).toBe('Session detail');
  });

  it('a restored size is never below the minimum nor larger than the work area', () => {
    const small = restoreDetailBounds({ x: 10, y: 10, width: 100, height: 50 }, [primary], primary);
    expect(small).toMatchObject({ width: DETAIL_WINDOW_MIN.width, height: DETAIL_WINDOW_MIN.height });
    const big = restoreDetailBounds({ x: 0, y: 0, width: 5000, height: 4000 }, [primary], primary);
    expect(big).toMatchObject({ width: 1920, height: 1040 });
  });

  it('saved bounds survive a save and load', () => {
    const b = { x: 40, y: 50, width: 900, height: 700 };
    saveDetailBounds(dir, b);
    expect(loadDetailBounds(dir)).toEqual(b);
    expect(restoreDetailBounds(loadDetailBounds(dir), [primary], primary)).toEqual(b);
  });

  it('a position on a disconnected display is dropped, the size kept', () => {
    const r = restoreDetailBounds({ x: 3000, y: 100, width: 800, height: 600 }, [primary], primary);
    expect(r).toEqual({ width: 800, height: 600 });
  });

  it('garbage or an unreadable file counts as no saved state', () => {
    expect(restoreDetailBounds({ x: NaN, y: 0, width: 800, height: 600 }, [primary], primary)).toEqual(
      DETAIL_WINDOW_DEFAULT,
    );
    expect(restoreDetailBounds({ x: 0, y: 0, width: -5, height: 600 }, [primary], primary)).toEqual(
      DETAIL_WINDOW_DEFAULT,
    );
    expect(loadDetailBounds(dir)).toBeNull();
    writeFileSync(join(dir, 'detail-window.json'), '{not json');
    expect(loadDetailBounds(dir)).toBeNull();
  });
});
