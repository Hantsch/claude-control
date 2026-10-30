import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Temp file + rename, so a crash mid-write never leaves a half-written file. Throws on failure. */
export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, file);
}
