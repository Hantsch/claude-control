import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeTrees } from '../fixtures/builders';

describe('fixture cleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a failing fixture cleanup warns with the path and does not throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakePath = '/nonexistent/fixture-tree';

    await expect(
      removeTrees([fakePath], () => Promise.reject(new Error('EBUSY: locked'))),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    const printed = (warn.mock.calls[0] ?? []).map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    expect(printed).toContain(fakePath);
    expect(printed).toContain('EBUSY: locked');
  });
});
