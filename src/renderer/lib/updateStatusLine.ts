/**
 * The Diagnostics state line for the opt-in self-update check (story 019, D6). Mirrors
 * `SettingsView.tsx`'s inline `formatModelWindowsLine` for the exact-context-window row (story
 * 005, D7), but pulled into its own file from the start — this project's `test/unit/` has no
 * component-testing library, so the wording is unit tested here rather than through the JSX.
 */

import type { UpdateStatus } from '../../shared/ipc.ts';
import { formatDateTime } from './format.ts';

export function formatUpdateStatusLine(status: UpdateStatus): string {
  if (!status.enabled) return 'off — no network requests';
  const parts: string[] = [
    'on',
    `v${status.currentVersion}`,
    status.checkedAt === null ? 'never checked' : `checked ${formatDateTime(status.checkedAt)}`,
    `staged: ${status.staged ? status.staged.releaseVersion : 'none'}`,
  ];
  if (status.lastOutcome === 'failed') {
    parts.push(status.lastError ? `last check failed: ${status.lastError}` : 'last check failed');
  }
  return parts.join(' · ');
}
