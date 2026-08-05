/**
 * Settings persistence (M7).
 *
 * A single JSON file in Electron's `userData`. Written atomically (temp file + rename) so a
 * crash mid-write cannot leave an unreadable file — and if it ever is unreadable, the
 * defaults are used rather than failing to start.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_SETTINGS, mergeSettings, type AppSettings } from '../core/model/settings.ts';

export type SettingsListener = (settings: AppSettings) => void;

export class SettingsStore {
  private readonly file: string;
  private current: AppSettings;
  private readonly listeners = new Set<SettingsListener>();

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'settings.json');
    this.current = this.read();
  }

  get path(): string {
    return this.file;
  }

  get(): AppSettings {
    return this.current;
  }

  /** Merge, persist, notify. Invalid values fall back to defaults, never throw. */
  set(partial: unknown): AppSettings {
    this.current = mergeSettings({ ...this.current, ...(partial as object) });
    this.write(this.current);
    for (const listener of this.listeners) listener(this.current);
    return this.current;
  }

  reset(): AppSettings {
    this.current = mergeSettings(DEFAULT_SETTINGS);
    this.write(this.current);
    for (const listener of this.listeners) listener(this.current);
    return this.current;
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private read(): AppSettings {
    try {
      if (!existsSync(this.file)) return mergeSettings(DEFAULT_SETTINGS);
      return mergeSettings(JSON.parse(readFileSync(this.file, 'utf8')) as unknown);
    } catch {
      return mergeSettings(DEFAULT_SETTINGS);
    }
  }

  private write(settings: AppSettings): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      renameSync(temp, this.file);
    } catch {
      // Settings are a convenience; failing to persist must not take the app down.
    }
  }
}
