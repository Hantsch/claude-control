/**
 * Global shortcut for popover toggle (§ui.globalShortcut). `''` means "disabled" — no
 * registration attempted, no error recorded. Registration can fail at the OS level (another
 * app already owns the accelerator), which `globalShortcut.register` reports either by
 * returning `false` or, rarely, by throwing — both are folded into the same failed status so
 * callers never see an uncaught exception from `apply()`.
 */

import { globalShortcut } from 'electron';

export interface ShortcutStatus {
  accelerator: string;
  registered: boolean;
  error: string | null;
}

export interface ShortcutManagerOptions {
  onToggle: () => void;
}

export class ShortcutManager {
  private readonly onToggle: () => void;
  private registeredAccelerator: string | null = null;
  private current: ShortcutStatus = { accelerator: '', registered: true, error: null };

  constructor(options: ShortcutManagerOptions) {
    this.onToggle = options.onToggle;
  }

  /** Unregisters whatever was registered before, then registers `accelerator` (unless `''`). */
  apply(accelerator: string): void {
    if (accelerator === this.current.accelerator) {
      return;
    }

    this.unregisterCurrent();

    if (accelerator === '') {
      this.current = { accelerator: '', registered: true, error: null };
      return;
    }

    try {
      const ok = globalShortcut.register(accelerator, this.onToggle);
      if (ok) {
        this.registeredAccelerator = accelerator;
        this.current = { accelerator, registered: true, error: null };
      } else {
        this.current = { accelerator, registered: false, error: 'Shortcut already in use' };
      }
    } catch (error) {
      this.current = {
        accelerator,
        registered: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Last recorded status; before any `apply()` call, nothing has been attempted (not a failure). */
  status(): ShortcutStatus {
    return this.current;
  }

  /** Unregisters the currently-registered accelerator, if any. */
  dispose(): void {
    this.unregisterCurrent();
  }

  private unregisterCurrent(): void {
    if (this.registeredAccelerator !== null) {
      globalShortcut.unregister(this.registeredAccelerator);
      this.registeredAccelerator = null;
    }
  }
}
