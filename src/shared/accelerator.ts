/**
 * Accelerator helper shared by the Settings UI and main-process shortcut registration
 * (D4 of story 003): turns a captured keyboard-event-like chord into an Electron
 * accelerator string, and formats a stored accelerator for display.
 *
 * Pure data — no Node, no Electron, no DOM.
 */

export interface AcceleratorChord {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** `KeyboardEvent.key` values a bare modifier press reports — never valid as the "main" key. */
const MODIFIER_KEYS = new Set([
  'Control',
  'Alt',
  'Shift',
  'Meta',
  'AltGraph',
  'ContextMenu',
  'Fn',
  'FnLock',
  'Hyper',
  'OS',
  'Super',
  'Symbol',
  'SymbolLock',
]);

/**
 * Builds an Electron accelerator string (e.g. `'Ctrl+Alt+C'`) from a captured chord.
 *
 * Returns `null` when no Ctrl/Alt/Meta modifier is held (Shift alone doesn't count) or
 * when `key` is itself a modifier key.
 */
export function acceleratorFromChord(chord: AcceleratorChord): string | null {
  const { key, ctrlKey, altKey, shiftKey, metaKey } = chord;

  if (!ctrlKey && !altKey && !metaKey) return null;
  if (!key || MODIFIER_KEYS.has(key)) return null;

  const parts: string[] = [];
  if (ctrlKey) parts.push('Ctrl');
  if (altKey) parts.push('Alt');
  if (shiftKey) parts.push('Shift');
  if (metaKey) parts.push('Meta');

  // Electron accelerator key naming: single letters/digits uppercase; other names
  // (F1..F12, ArrowUp, etc.) are passed through as-is. Some `KeyboardEvent.key` values
  // (e.g. ' ' for Space, multi-char punctuation names) may need further mapping later.
  const mainKey = key.length === 1 ? key.toUpperCase() : key;
  parts.push(mainKey);

  return parts.join('+');
}

/** Formats a stored accelerator for display: `''` shows as `'None'`. */
export function formatAccelerator(value: string): string {
  return value === '' ? 'None' : value;
}
