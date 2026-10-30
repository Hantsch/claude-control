/**
 * The popover's "Show in Claude Control" and the main window's navigation listener must
 * name the same bridge. Main-side behaviour (tab + session id in one `cc:navigate`) is
 * proven in `detailWindow.test.ts`; what the renderers do with it is the e2e gap, as vitest
 * runs without a render harness here. Identifier presence is all this file can honestly claim.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(
    new URL(`../../src/${relative}`, import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'),
    'utf8',
  );
}

describe('Show in Claude Control', () => {
  it('the popover and the main window are linked through the bridge', () => {
    expect(source('renderer/popover.tsx')).toContain('api.openMainWindow');
    expect(source('renderer/App.tsx')).toContain('api.onNavigate');
  });
});
