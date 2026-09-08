/**
 * `formatUpdateStatusLine` (story 019, D6) — the Diagnostics state line for the opt-in
 * self-update check, extracted from `SettingsView.tsx` so it is unit testable (this project's
 * `test/unit/` has no component-testing library). Covers the four variants named in the
 * story's AC7: enabled+ok, enabled+staged-update-available, enabled+last-check-failed, disabled.
 */

import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '../../src/shared/ipc.ts';
import { formatUpdateStatusLine } from '../../src/renderer/lib/updateStatusLine.ts';

const base: UpdateStatus = {
  enabled: true,
  currentVersion: '1.0.0',
  latestVersion: '1.0.0',
  updateAvailable: false,
  staged: null,
  checkedAt: new Date(2026, 8, 8, 12, 30).getTime(),
  lastOutcome: 'ok',
  source: 'github',
};

describe('formatUpdateStatusLine', () => {
  it('shows current version, last check time, and no staged update when up to date', () => {
    const line = formatUpdateStatusLine(base);
    expect(line).toContain('v1.0.0');
    expect(line).toContain('2026-09-08');
    expect(line).toContain('staged: none');
    expect(line).not.toContain('failed');
  });

  it('shows the staged version when an update is staged', () => {
    const line = formatUpdateStatusLine({
      ...base,
      updateAvailable: true,
      latestVersion: '1.1.0',
      staged: {
        version: 1,
        releaseVersion: '1.1.0',
        assetName: 'claude-control-1.1.0.exe',
        sha256: 'deadbeef',
        stagedAt: new Date(2026, 8, 8, 13, 0).getTime(),
        file: 'claude-control-1.1.0.exe',
      },
    });
    expect(line).toContain('staged: 1.1.0');
  });

  it('shows the failure reason when the last check failed', () => {
    const line = formatUpdateStatusLine({
      ...base,
      checkedAt: null,
      lastOutcome: 'failed',
      lastError: 'network timeout',
    });
    expect(line).toContain('last check failed: network timeout');
    expect(line).toContain('never checked');
  });

  it('shows off with no network-request noise when disabled', () => {
    const line = formatUpdateStatusLine({ ...base, enabled: false });
    expect(line).toBe('off — no network requests');
    expect(line).not.toContain('v1.0.0');
    expect(line).not.toContain('checked');
  });
});
