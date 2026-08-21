/**
 * `findWindowsUpChain` (D2 of story 004, corrected by story 012): one PowerShell call for a
 * batch of pids. The child process itself is mocked so this test asserts the batching and
 * parsing contract, not a real Win32 probe.
 *
 * That contract is three-valued (012, AC1): `true` — a window was found; `false` — the script
 * said so explicitly with a `<start>|FALSE` line; absent from the map — no line at all, i.e.
 * the probe never answered for that pid. Only a `false` may ever hide a session, so the
 * difference between `false` and absent is the safety property under test here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

describe('findWindowsUpChain', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    execFileMock.mockReset();
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.resetModules();
  });

  it('makes exactly one child_process call for several pids', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, '1|1|4242|0|Terminal\n2|2|4243|1|Other\n3|FALSE\n', '');
    });
    const { findWindowsUpChain } = await import('../../src/main/focus/processChain.ts');

    const result = await findWindowsUpChain([1, 2, 3]);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(result.get(1)).toBe(true);
    expect(result.get(2)).toBe(true);
    // pid 3 got an explicit `|FALSE` line: the script walked its chain to the end and found
    // no window, so this is a decisive negative.
    expect(result.get(3)).toBe(false);
  });

  it('separates an explicit negative from a pid that was never answered', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, '1|1|4242|0|Terminal\n2|FALSE\n', '');
    });
    const { findWindowsUpChain } = await import('../../src/main/focus/processChain.ts');

    const result = await findWindowsUpChain([1, 2, 3]);

    expect(result.get(1)).toBe(true);
    expect(result.get(2)).toBe(false);
    // No line at all for pid 3 — it must stay out of the map so the probe cache leaves it
    // unknown and re-probes it, instead of the orphan filter hiding a live session on no
    // evidence (012, AC1).
    expect(result.has(3)).toBe(false);
    expect(result.get(3)).toBeUndefined();
  });

  it('keeps the lines a failed or timed-out call already flushed', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
      // The child was killed on its timeout after reporting the first two targets.
      const killed = Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' });
      callback(killed, '7|7|4242|0|Terminal\n8|FALSE\n', '');
    });
    const { findWindowsUpChain } = await import('../../src/main/focus/processChain.ts');

    const result = await findWindowsUpChain([7, 8, 9]);

    expect(result.get(7)).toBe(true);
    expect(result.get(8)).toBe(false);
    // The timeout hit before pid 9 was reached, so it stays unknown.
    expect(result.has(9)).toBe(false);
  });

  it('ignores output lines for pids that were not asked about', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, '1|1|4242|0|Terminal\n99|FALSE\nsome stray powershell noise\n', '');
    });
    const { findWindowsUpChain } = await import('../../src/main/focus/processChain.ts');

    const result = await findWindowsUpChain([1]);

    expect(result.get(1)).toBe(true);
    expect(result.size).toBe(1);
  });

  it('has the script report decisive negatives explicitly', async () => {
    execFileMock.mockImplementation((_cmd, args, _opts, callback) => {
      const script = args[args.length - 1] as string;
      expect(script).toContain('if (-not $found) { "{0}|FALSE" -f $start }');
      callback(null, '', '');
    });
    const { findWindowsUpChain } = await import('../../src/main/focus/processChain.ts');

    const result = await findWindowsUpChain([5]);

    // The script was built, but it reported nothing at all: nobody is known either way.
    expect(result.size).toBe(0);
  });

  it('returns an empty map without spawning anything for an empty pid list', async () => {
    const { findWindowsUpChain } = await import('../../src/main/focus/processChain.ts');
    const result = await findWindowsUpChain([]);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('deduplicates pids before building the script', async () => {
    execFileMock.mockImplementation((_cmd, args, _opts, callback) => {
      const script = args[args.length - 1] as string;
      expect(script).toContain('@(5)');
      callback(null, '5|5|4242|0|Terminal\n', '');
    });
    const { findWindowsUpChain } = await import('../../src/main/focus/processChain.ts');
    const result = await findWindowsUpChain([5, 5, 5]);
    expect(result.get(5)).toBe(true);
  });

  it('resolves an empty map on non-Windows platforms without spawning anything', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { findWindowsUpChain } = await import('../../src/main/focus/processChain.ts');
    const result = await findWindowsUpChain([1, 2]);
    expect(execFileMock).not.toHaveBeenCalled();
    // Nothing was probed, so nothing is known — which is not the same as "neither has a
    // window". Both read as unknown, and unknown never hides a session (012, AC5).
    expect(result.size).toBe(0);
    expect(result.get(1)).toBeUndefined();
    expect(result.get(2)).toBeUndefined();
  });
});
