import type { HiddenCause, HiddenSessions } from '../../shared/ipc.ts';

/** Must stay word-for-word the labels of the Settings toggles that cause each hiding. */
export const HIDDEN_CAUSE_LABELS: Record<HiddenCause, string> = {
  unused: 'Hide unused sessions',
  doneOnStart: 'Hide sessions already done at start',
  orphan: 'Hide abandoned sessions',
};

export function hiddenIndicator(hidden: HiddenSessions): { text: string; title: string } | null {
  if (hidden.count === 0) return null;
  const names = hidden.causes.map((cause) => `"${HIDDEN_CAUSE_LABELS[cause]}"`);
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return {
    text: `${hidden.count} hidden`,
    title: `Hidden by ${list ?? 'a filter'} — change it in Settings › Session list.`,
  };
}
