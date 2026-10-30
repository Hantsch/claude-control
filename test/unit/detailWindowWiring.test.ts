/**
 * Source-level wiring of the detail window (vitest runs without a DOM here): each link is
 * inert on its own, so a break anywhere would be silent.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relative: string): string {
  return readFileSync(
    new URL(`../../${relative}`, import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'),
    'utf8',
  );
}

describe('detail window wiring', () => {
  it('the detail window entry is built from detail.html and loads detail.tsx', () => {
    expect(read('src/renderer/detail.html')).toContain('/detail.tsx');
    expect(read('electron.vite.config.ts')).toMatch(/detail: resolve\([^)]*detail\.html/);
  });

  it('the history view and the detail entry reach the detail window through the bridge', () => {
    expect(read('src/renderer/components/HistoryView.tsx')).toContain('api.openSessionDetail');
    expect(read('src/renderer/detail.tsx')).toContain('api.onDetailTarget');
  });
});
