/**
 * "Show in Claude Control" — the popover row menu's route into the main window, and the
 * session id it goes there to show.
 *
 * Source-level checks, for the reason `statusRollupWiring.test.ts` states: vitest runs
 * without jsdom here, so what a piece of JSX renders can only be asserted about its text.
 * What matters is that the four links in the chain stay connected — menu item → IPC with a
 * session id → `cc:navigate` payload → selection in the main window — because each one is
 * inert on its own and a break anywhere is silent.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(
    new URL(`../../src/${relative}`, import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'),
    'utf8',
  );
}

describe('Show in Claude Control (popover row menu → main window)', () => {
  it('the row menu offers the item and sends the session id with it', () => {
    const popover = source('renderer/popover.tsx');
    expect(popover).toContain('Show in Claude Control');
    expect(popover).toMatch(/api\.openMainWindow\('sessions',\s*sessionId\)/);
  });

  it('the main window carries the session id alongside the tab', () => {
    // One message, not two: the window may still be opening when the request is made.
    expect(source('main/windows.ts')).toMatch(/const target: NavigateTarget = \{ tab, sessionId \}/);
    expect(source('main/ipc.ts')).toMatch(/openMain\(tab \?\? 'sessions',/);
  });

  it('the main window selects the session it was navigated to', () => {
    const app = source('renderer/App.tsx');
    expect(app).toMatch(/setTab\(target\.tab\)/);
    expect(app).toMatch(/setSelectedId\(target\.sessionId\)/);
  });

  it('the detail pane shows the session id with a button that copies it', () => {
    const pane = source('renderer/components/SessionDetailPane.tsx');
    expect(pane).toContain('{session.sessionId}');
    expect(pane).toMatch(/copy\('session ID', session\.sessionId\)/);
  });
});
