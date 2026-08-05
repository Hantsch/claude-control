/**
 * PID liveness with a process-creation-time cross-check (§4, §12 "Registry staleness").
 *
 * A registry file may outlive its session (crash, hard kill). A PID that is alive but was
 * created at a different time belongs to an unrelated process — PID reuse. `procStart`
 * from the registry is a Windows FILETIME (100 ns ticks since 1601-01-01 UTC), which
 * `System.Diagnostics.Process.StartTime.ToFileTimeUtc()` reproduces exactly, so the two
 * are directly comparable.
 *
 * The cheap check (`process.kill(pid, 0)`) runs on every 5 s tick; the expensive one
 * (one PowerShell call for all candidate PIDs) is cached per PID because a process's
 * creation time cannot change.
 */

import { execFile } from 'node:child_process';

export interface ProcessProbe {
  /** Which of `pids` are currently alive. */
  alive(pids: readonly number[]): Promise<Set<number>>;
  /**
   * Creation stamp per PID in the same units as the registry's `procStart`, or null when
   * it could not be determined. Unknown must never be read as "stale".
   */
  creationStamps(pids: readonly number[]): Promise<Map<number, string>>;
}

/** FILETIME ticks per millisecond. */
const TICKS_PER_MS = 10_000n;
/** Default tolerance when comparing creation stamps. */
const DEFAULT_TOLERANCE_MS = 1_000;

/**
 * Compare a registry `procStart` against a probed stamp. Unknown values pass: the check
 * exists to catch a *provably* different process, not to guess.
 */
export function procStartMatches(
  expected: string | null,
  actual: string | null | undefined,
  toleranceMs = DEFAULT_TOLERANCE_MS,
): boolean {
  if (!expected || !actual) return true;
  let a: bigint;
  let b: bigint;
  try {
    a = BigInt(expected.trim());
    b = BigInt(actual.trim());
  } catch {
    return true;
  }
  const delta = a > b ? a - b : b - a;
  return delta <= BigInt(Math.max(0, Math.floor(toleranceMs))) * TICKS_PER_MS;
}

/** FILETIME ticks → epoch ms. Exposed for fixtures and the detail view. */
export function fileTimeToEpochMs(fileTime: string): number | null {
  try {
    const ticks = BigInt(fileTime.trim());
    const epochDeltaMs = 11_644_473_600_000n;
    return Number(ticks / TICKS_PER_MS - epochDeltaMs);
  } catch {
    return null;
  }
}

/** epoch ms → FILETIME ticks. Used to build fixtures. */
export function epochMsToFileTime(ms: number): string {
  const epochDeltaMs = 11_644_473_600_000n;
  return ((BigInt(Math.round(ms)) + epochDeltaMs) * TICKS_PER_MS).toString();
}

/** Signal-0 based liveness. Works on every platform, gives no creation time. */
export class NodeProcessProbe implements ProcessProbe {
  async alive(pids: readonly number[]): Promise<Set<number>> {
    const live = new Set<number>();
    for (const pid of pids) {
      if (isAliveSync(pid)) live.add(pid);
    }
    return live;
  }

  async creationStamps(): Promise<Map<number, string>> {
    return new Map();
  }
}

export function isAliveSync(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else — still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Windows probe: signal-0 liveness plus cached `StartTime.ToFileTimeUtc()`. */
export class Win32ProcessProbe implements ProcessProbe {
  private readonly cache = new Map<number, string>();
  private readonly unknown = new Set<number>();

  async alive(pids: readonly number[]): Promise<Set<number>> {
    const live = new Set<number>();
    for (const pid of pids) {
      if (isAliveSync(pid)) live.add(pid);
      else {
        this.cache.delete(pid);
        this.unknown.delete(pid);
      }
    }
    return live;
  }

  async creationStamps(pids: readonly number[]): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    const missing: number[] = [];
    for (const pid of pids) {
      const cached = this.cache.get(pid);
      if (cached !== undefined) result.set(pid, cached);
      else if (!this.unknown.has(pid)) missing.push(pid);
    }
    if (missing.length === 0) return result;

    const probed = await queryStartTimes(missing);
    for (const pid of missing) {
      const stamp = probed.get(pid);
      if (stamp) {
        this.cache.set(pid, stamp);
        result.set(pid, stamp);
      } else {
        // Remember the failure so a protected process is not re-queried every tick.
        this.unknown.add(pid);
      }
    }
    return result;
  }
}

async function queryStartTimes(pids: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (pids.length === 0 || process.platform !== 'win32') return out;
  const idList = pids.filter((p) => Number.isInteger(p) && p > 0).join(',');
  if (!idList) return out;

  const script =
    `Get-Process -Id ${idList} -ErrorAction SilentlyContinue | ` +
    'ForEach-Object { try { "{0}:{1}" -f $_.Id, $_.StartTime.ToFileTimeUtc() } catch { } }';

  const stdout = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]);
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(\d+):(\d+)$/.exec(line.trim());
    if (!match) continue;
    out.set(Number(match[1]), match[2]!);
  }
  return out;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { windowsHide: true, timeout: 5_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        // A failed probe yields "unknown", which passes the cross-check by design.
        resolve(error ? '' : stdout);
      },
    );
  });
}

export function createProcessProbe(): ProcessProbe {
  return process.platform === 'win32' ? new Win32ProcessProbe() : new NodeProcessProbe();
}
