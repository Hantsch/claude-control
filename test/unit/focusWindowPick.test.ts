/**
 * Which of a process's windows a session belongs to (story F6, §7).
 *
 * The measured case this exists for: one `Code.exe` (pid 20400) owning three windows, and
 * four live `claude-vscode` sessions whose parent chains all end at exactly that pid. The
 * pid alone therefore identifies nothing — every session used to land on whichever window
 * the fallback happened to sort first, which is the reported bug ("I always end up in the
 * wrong VS Code window, or always in the same one").
 *
 * `pickWindow` and `folderHints` are the two pure halves of that decision; everything around
 * them is `user32` behind an FFI that only exists on Windows.
 */

import { describe, expect, it } from 'vitest';
import { folderHints } from '../../src/main/focus/focuser.ts';
import { pickWindow, type WindowInfo } from '../../src/main/focus/win32.ts';

const CODE_PID = 20400;

/** The three real windows of the measured VS Code process. */
const vscodeWindows: WindowInfo[] = [
  { handle: '4917334', pid: CODE_PID, title: 'claude-control - Visual Studio Code' },
  { handle: '526188', pid: CODE_PID, title: 'sprint.md - second-brain - Visual Studio Code' },
  { handle: '67730', pid: CODE_PID, title: 'sprint.md - q2-launcher - Visual Studio Code' },
];

function pickFor(cwd: string, windows = vscodeWindows, ideFolder?: string) {
  return pickWindow(windows, folderHints(cwd, ideFolder));
}

describe('pickWindow', () => {
  it('gives every session of one shared host process its own window', () => {
    expect(pickFor('c:\\development\\Hantsch\\claude-control')?.window.handle).toBe('4917334');
    expect(pickFor('c:\\development\\Hantsch\\second-brain')?.window.handle).toBe('526188');
    expect(pickFor('c:\\development\\Hantsch\\q2-launcher')?.window.handle).toBe('67730');
  });

  it('reports a hit as matched, not as a guess', () => {
    expect(pickFor('c:\\development\\Hantsch\\q2-launcher')?.confidence).toBe('matched');
  });

  it('finds the workspace window for a session started in a subfolder', () => {
    const match = pickFor('c:\\development\\Hantsch\\q2-launcher\\src\\main');
    expect(match?.window.handle).toBe('67730');
    expect(match?.confidence).toBe('matched');
  });

  it('matches a workspace that carries a remote or profile decoration', () => {
    const windows: WindowInfo[] = [
      { handle: '1', pid: CODE_PID, title: 'claude-control [WSL: Ubuntu] - Visual Studio Code' },
      { handle: '2', pid: CODE_PID, title: 'notes.md - second-brain (Work) - Visual Studio Code' },
    ];
    expect(pickFor('/mnt/c/development/Hantsch/claude-control', windows)?.window.handle).toBe('1');
    expect(pickFor('c:\\development\\Hantsch\\second-brain', windows)?.window.handle).toBe('2');
  });

  it('does not let a folder name match a longer one', () => {
    const windows: WindowInfo[] = [
      { handle: '1', pid: CODE_PID, title: 'q2-launcher-old - Visual Studio Code' },
      { handle: '2', pid: CODE_PID, title: 'q2-launcher - Visual Studio Code' },
    ];
    expect(pickFor('c:\\development\\Hantsch\\q2-launcher', windows)?.window.handle).toBe('2');
  });

  it('prefers the plain workspace window over one that merely shows a file of that name', () => {
    const windows: WindowInfo[] = [
      { handle: '1', pid: CODE_PID, title: 'claude-control.ts - other-project - Visual Studio Code' },
      { handle: '2', pid: CODE_PID, title: 'claude-control - Visual Studio Code' },
    ];
    expect(pickFor('c:\\development\\Hantsch\\claude-control', windows)?.window.handle).toBe('2');
  });

  it('takes the only window of a process without pretending the folder was found', () => {
    const windows: WindowInfo[] = [{ handle: '9', pid: 5, title: 'Windows PowerShell' }];
    const match = pickFor('c:\\development\\Hantsch\\claude-control', windows);
    expect(match?.window.handle).toBe('9');
    expect(match?.confidence).toBe('only');
  });

  it('marks the fallback among several windows as a guess', () => {
    const windows: WindowInfo[] = [
      { handle: '1', pid: 5, title: 'Windows PowerShell' },
      { handle: '2', pid: 5, title: 'Windows PowerShell - a much longer tab title' },
    ];
    // Nothing names the folder, so the caller must be told this window is a coin flip and
    // may say so instead of reporting a clean hit.
    expect(pickFor('c:\\development\\Hantsch\\claude-control', windows)?.confidence).toBe('guess');
  });

  it('accepts a full window title as a hint only when it is the whole title', () => {
    const windows: WindowInfo[] = [
      { handle: '1', pid: 5, title: 'Claude' },
      { handle: '2', pid: 5, title: 'Claude Desktop' },
    ];
    const match = pickWindow(windows, [{ text: 'Claude Desktop', mode: 'title' }]);
    expect(match?.window.handle).toBe('2');
    expect(match?.confidence).toBe('matched');
  });

  it('returns null when the process owns no window at all', () => {
    expect(pickWindow([], folderHints('c:\\x\\y'))).toBeNull();
  });
});

describe('folderHints', () => {
  it('ranks the IDE lock folder above the cwd and the cwd above its parents', () => {
    const hints = folderHints('c:\\development\\Hantsch\\repo\\packages\\api', 'c:\\development\\Hantsch\\repo');
    expect(hints.filter((h) => h.mode === 'segment').map((h) => h.text)).toEqual([
      'repo',
      'api',
      'packages',
    ]);
  });

  it('only ever lets the session own folders match loosely, and last', () => {
    const hints = folderHints('c:\\development\\Hantsch\\repo\\src', 'c:\\development\\Hantsch\\repo');
    const loose = hints.filter((h) => h.mode === 'substring').map((h) => h.text);
    expect(loose).toEqual(['repo', 'src']);
    expect(hints.findIndex((h) => h.mode === 'substring')).toBe(hints.length - loose.length);
  });

  it('drops the drive root, which names no window', () => {
    expect(folderHints('c:\\repo').map((h) => h.text)).toEqual(['repo', 'repo']);
  });
});
