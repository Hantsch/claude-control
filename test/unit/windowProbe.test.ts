/**
 * D2 of story 004: the pid->bool cache with TTL re-probing and candidate selection. The
 * batched PowerShell probe itself is injected here so these stay plain-Node unit tests — no
 * real child_process call.
 */

import { describe, expect, it, vi } from 'vitest';
import { WindowProbe, type LiveSessionRef } from '../../src/main/focus/windowProbe.ts';

describe('WindowProbe.candidatePids', () => {
  it('excludes a lone session in its folder', () => {
    const sessions: LiveSessionRef[] = [{ pid: 1, cwd: 'C:/a' }];
    expect(WindowProbe.candidatePids(sessions)).toEqual([]);
  });

  it('includes both sessions once a folder has two or more', () => {
    const sessions: LiveSessionRef[] = [
      { pid: 1, cwd: 'C:/a' },
      { pid: 2, cwd: 'C:/a' },
      { pid: 3, cwd: 'C:/b' },
    ];
    expect(new Set(WindowProbe.candidatePids(sessions))).toEqual(new Set([1, 2]));
  });
});

describe('WindowProbe.refresh', () => {
  it('makes no probe call for a single session in a folder', async () => {
    const probe = vi.fn().mockResolvedValue(new Map());
    const windowProbe = new WindowProbe({ probe });
    await windowProbe.refresh([{ pid: 1, cwd: 'C:/a' }]);
    expect(probe).not.toHaveBeenCalled();
    expect(windowProbe.get(1)).toBeUndefined();
  });

  it('fills the cache for two sessions in one folder within one probe pass', async () => {
    const probe = vi.fn().mockResolvedValue(
      new Map([
        [1, true],
        [2, false],
      ]),
    );
    const windowProbe = new WindowProbe({ probe });
    const sessions: LiveSessionRef[] = [
      { pid: 1, cwd: 'C:/a' },
      { pid: 2, cwd: 'C:/a' },
    ];
    await windowProbe.refresh(sessions);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith([1, 2]);
    expect(windowProbe.get(1)).toBe(true);
    expect(windowProbe.get(2)).toBe(false);
  });

  it('does not re-probe within the TTL window', async () => {
    let now = 0;
    const probe = vi.fn().mockResolvedValue(new Map([[1, true], [2, true]]));
    const windowProbe = new WindowProbe({ probe, ttlMs: 1000, now: () => now });
    const sessions: LiveSessionRef[] = [
      { pid: 1, cwd: 'C:/a' },
      { pid: 2, cwd: 'C:/a' },
    ];
    await windowProbe.refresh(sessions);
    now += 500;
    await windowProbe.refresh(sessions);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('re-probes once the TTL has elapsed', async () => {
    let now = 0;
    const probe = vi.fn().mockResolvedValue(new Map([[1, true], [2, true]]));
    const windowProbe = new WindowProbe({ probe, ttlMs: 1000, now: () => now });
    const sessions: LiveSessionRef[] = [
      { pid: 1, cwd: 'C:/a' },
      { pid: 2, cwd: 'C:/a' },
    ];
    await windowProbe.refresh(sessions);
    now += 1500;
    await windowProbe.refresh(sessions);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('treats a missing pid in the probe result as false, never as unknown', async () => {
    const probe = vi.fn().mockResolvedValue(new Map([[1, true]]));
    const windowProbe = new WindowProbe({ probe });
    const sessions: LiveSessionRef[] = [
      { pid: 1, cwd: 'C:/a' },
      { pid: 2, cwd: 'C:/a' },
    ];
    await windowProbe.refresh(sessions);
    expect(windowProbe.get(2)).toBe(false);
  });

  it('drops a pid from the cache once its session is no longer live', async () => {
    const probe = vi.fn().mockResolvedValue(new Map([[1, true], [2, true]]));
    const windowProbe = new WindowProbe({ probe });
    await windowProbe.refresh([
      { pid: 1, cwd: 'C:/a' },
      { pid: 2, cwd: 'C:/a' },
    ]);
    expect(windowProbe.get(2)).toBe(true);
    await windowProbe.refresh([{ pid: 1, cwd: 'C:/a' }]);
    expect(windowProbe.get(2)).toBeUndefined();
  });
});
