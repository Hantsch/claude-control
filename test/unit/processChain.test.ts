/**
 * `findWindowsUpChain` (D2 of story 004): one PowerShell call for a batch of pids. The child
 * process itself is mocked so this test asserts the batching/parsing contract, not a real
 * Win32 probe.
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
      callback(null, '1|1|0|Terminal\n2|2|0|Other\n', '');
    });
    const { findWindowsUpChain } = await import('../../src/main/focus/processChain.ts');

    const result = await findWindowsUpChain([1, 2, 3]);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(result.get(1)).toBe(true);
    expect(result.get(2)).toBe(true);
    // pid 3 got no matching output line, so it is a definite negative, not "unknown".
    expect(result.get(3)).toBe(false);
  });

  it('returns an all-false map without spawning anything for an empty pid list', async () => {
    const { findWindowsUpChain } = await import('../../src/main/focus/processChain.ts');
    const result = await findWindowsUpChain([]);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('deduplicates pids before building the script', async () => {
    execFileMock.mockImplementation((_cmd, args, _opts, callback) => {
      const script = args[args.length - 1] as string;
      expect(script).toContain('@(5)');
      callback(null, '5|5|0|Terminal\n', '');
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
    expect(result.get(1)).toBe(false);
    expect(result.get(2)).toBe(false);
  });
});
