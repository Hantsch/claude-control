import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Every directory handed out by `makeTempDir`, so `test/setup.ts` can delete them after each
 * file even when a test's own teardown never ran. Lives here (not in builders.ts) so that
 * builders.ts can import it without a cycle.
 */
const createdDirs: string[] = [];

/** Remove from the list and return every registered directory. */
export function drainTempDirs(): string[] {
  return createdDirs.splice(0, createdDirs.length);
}

/** Create a unique directory under the OS temp dir and register it for after-all cleanup. */
export async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}
