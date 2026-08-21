/**
 * Walk from a session's PID up the parent chain to the process that owns a top-level
 * window, and report it (§7, priority 2: Windows Terminal / PowerShell, priority 3: Claude
 * Desktop).
 *
 * `claude.exe` itself owns no window; its console host or IDE does. Tabs inside Windows
 * Terminal are not individually addressable, so the window is as precise as this can get.
 *
 * PowerShell is used instead of a second FFI surface: `Win32_Process.ParentProcessId` plus
 * `Process.MainWindowHandle` is exactly the query we need, and it also works when `koffi`
 * failed to load.
 */

import { execFile } from 'node:child_process';

export interface ChainWindow {
  pid: number;
  /** HWND as a decimal string, or null when only the PID is known. */
  handle: string | null;
  title: string;
  /** How many parent hops were needed — 0 means the session process itself owns a window. */
  depth: number;
}

const MAX_HOPS = 8;

export async function findWindowUpChain(pid: number): Promise<ChainWindow | null> {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return null;

  const script = [
    `$id = ${pid}`,
    `for ($i = 0; $i -lt ${MAX_HOPS}; $i++) {`,
    '  $p = Get-Process -Id $id -ErrorAction SilentlyContinue',
    '  if ($p -and $p.MainWindowHandle -ne 0) {',
    '    "{0}|{1}|{2}|{3}" -f $p.Id, [int64]$p.MainWindowHandle, $i, ($p.MainWindowTitle -replace "\\|", "/")',
    '    break',
    '  }',
    '  $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue',
    '  if (-not $ci -or -not $ci.ParentProcessId) { break }',
    '  $id = [int]$ci.ParentProcessId',
    '  if ($id -le 4) { break }',
    '}',
  ].join('\n');

  const stdout = await run(script);
  const line = stdout.split(/\r?\n/).find((l) => /^\d+\|/.test(l.trim()));
  if (!line) return null;

  const [pidText, handleText, depthText, ...titleParts] = line.trim().split('|');
  const resolved = Number(pidText);
  if (!Number.isInteger(resolved) || resolved <= 0) return null;

  return {
    pid: resolved,
    handle: handleText && handleText !== '0' ? handleText : null,
    title: titleParts.join('|').trim(),
    depth: Number(depthText) || 0,
  };
}

/**
 * Batched form of `findWindowUpChain`: one PowerShell invocation walks the parent chain for
 * every pid, instead of one child process per pid (§ decisions, D2). Same query, same loop,
 * just fanned out over an array and re-joined with the originating pid so the results can be
 * matched back up.
 *
 * Pids that resolve to no window (or fail entirely) are reported as `false`, not omitted —
 * callers (the probe cache) need a definite negative to avoid re-probing every pass.
 */
export async function findWindowsUpChain(pids: readonly number[]): Promise<Map<number, boolean>> {
  const valid = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  const result = new Map<number, boolean>(valid.map((pid) => [pid, false]));
  if (process.platform !== 'win32' || valid.length === 0) return result;

  const script = [
    `$targets = @(${valid.join(',')})`,
    'foreach ($start in $targets) {',
    '  $id = $start',
    `  for ($i = 0; $i -lt ${MAX_HOPS}; $i++) {`,
    '    $p = Get-Process -Id $id -ErrorAction SilentlyContinue',
    '    if ($p -and $p.MainWindowHandle -ne 0) {',
    '      "{0}|{1}|{2}|{3}|{4}" -f $start, $p.Id, [int64]$p.MainWindowHandle, $i, ($p.MainWindowTitle -replace "\\|", "/")',
    '      break',
    '    }',
    '    $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue',
    '    if (-not $ci -or -not $ci.ParentProcessId) { break }',
    '    $id = [int]$ci.ParentProcessId',
    '    if ($id -le 4) { break }',
    '  }',
    '}',
  ].join('\n');

  const stdout = await run(script);
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^\d+\|\d+\|/.test(trimmed)) continue;
    const [startText] = trimmed.split('|');
    const start = Number(startText);
    if (result.has(start)) result.set(start, true);
  }
  return result;
}

/**
 * Shell fallback activation for when `koffi` is unavailable. `AppActivate` is subject to
 * the same foreground restrictions, so a `false` result is reported honestly rather than
 * assumed to be success.
 */
export async function activateViaShell(pid: number): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const script = [
    '$shell = New-Object -ComObject WScript.Shell',
    `try { if ($shell.AppActivate(${pid})) { "ok" } } catch { }`,
  ].join('\n');
  const stdout = await run(script);
  return stdout.includes('ok');
}

function run(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 8_000, maxBuffer: 512 * 1024 },
      (error, stdout) => resolve(error ? '' : stdout),
    );
  });
}
