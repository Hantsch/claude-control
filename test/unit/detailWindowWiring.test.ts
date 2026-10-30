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
  const view = read('src/renderer/components/SessionDetailWindow.tsx');
  const entry = read('src/renderer/detail.tsx');

  it('the detail window renders the header, the subagent tree and the run timeline', () => {
    expect(view).toMatch(/detailHeader\(detail\)/);
    expect(view).toMatch(/<SubagentTree nodes=\{detail\.subagents\}/);
    expect(view).toContain('No subagents in this session.');
    expect(view).toMatch(/groupRuns\(detail\.events\)/);
    expect(view).toMatch(/visibleEvents\(run, pages\)/);
    expect(view).toContain('Show 200 more');
    expect(view).toMatch(/detailTruncatedNotice\(detail\)/);
    for (const field of ['inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens', 'total']) {
      expect(view).toContain(`header.tokens.${field}`);
    }
    expect(view).toContain('header.tokensNote');
    expect(read('src/renderer/components/SubagentTree.tsx')).toMatch(/emptyText\?: string/);
  });

  it('the detail window offers Copy path and Show file for its transcript', () => {
    expect(view).toMatch(/api\.copyText\(detail\.transcriptPath\)/);
    expect(view).toMatch(/api\.revealPath\(detail\.transcriptPath\)/);
    expect(view).toContain('Copy path');
    expect(view).toContain('Show file');
  });

  it('Escape closes the detail window', () => {
    expect(entry).toMatch(/document\.addEventListener\('keydown'/);
    expect(entry).toMatch(/event\.key === 'Escape'/);
    expect(entry).toMatch(/api\.closeDetailWindow\(\)/);
  });

  it('the detail window gets its data only through getDetail and shows a loading state', () => {
    expect(entry).toMatch(/api\.getDetail\(targetId\)/);
    expect(entry).toMatch(/useReducer\(detailLoad/);
    expect(entry).toMatch(/type: 'resolved'/);
    expect(entry).toMatch(/type: 'rejected'/);
    expect(entry).toMatch(/get\('session'\)/);
    expect(entry).toMatch(/onDetailTarget/);
    expect(view).toContain('Reading transcript…');
    expect(read('src/renderer/detail.html')).toContain('/detail.tsx');
    expect(read('electron.vite.config.ts')).toMatch(/detail: resolve\([^)]*detail\.html/);
  });

  it('a history row opens the detail window on click and on Enter', () => {
    const history = read('src/renderer/components/HistoryView.tsx');
    expect(history).toMatch(/tabIndex=\{0\}\s+onClick=\{onSelect\}/);
    expect(history).toMatch(/event\.key === 'Enter'\) onSelect\(\)/);
    expect(history.match(/onSelect=\{\(\) => void api\.openSessionDetail\(entry\.sessionId\)\}/g)).toHaveLength(2);
  });

  it('history no longer renders the notice or calls getDetail itself', () => {
    const history = read('src/renderer/components/HistoryView.tsx');
    expect(history).not.toContain('className="notice"');
    expect(history).not.toMatch(/api\.getDetail/);
    expect(history).not.toMatch(/setSelected/);
  });
});
