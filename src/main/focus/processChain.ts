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
    '    "{0}|{1}|{2}|{3}" -f $p.Id, [int64]$p.MainWindowHandle, $i, ($p.MainWindowTitle -replace "\|", "/")',
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
 * Three outcomes per pid, and the difference between the last two is the point (story 012,
 * AC1): a window found ⇒ `true`; the chain walked to its end with no window ⇒ `false`, which
 * the script now says explicitly with a `<start>|FALSE` line; and **no line at all** ⇒ the pid
 * is absent from the map, meaning "not answered". The map is therefore built purely from what
 * PowerShell actually reported — never pre-filled with `false` — so a timeout or a mid-script
 * failure leaves the pids it never reached genuinely unknown instead of silently claiming they
 * have no window. Only a decisive `false` may ever hide a session, so an unknown pid stays
 * uncached (`WindowProbe.get()` ⇒ `undefined`) and is re-probed on the next pass.
 */
export async function findWindowsUpChain(pids: readonly number[]): Promise<Map<number, boolean>> {
  const valid = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  const result = new Map<number, boolean>();
  if (process.platform !== 'win32' || valid.length === 0) return result;

  const script = [
    `$targets = @(${valid.join(',')})`,
    'foreach ($start in $targets) {',
    '  $id = $start',
    '  $found = $false',
    `  for ($i = 0; $i -lt ${MAX_HOPS}; $i++) {`,
    '    $p = Get-Process -Id $id -ErrorAction SilentlyContinue',
    '    if ($p -and $p.MainWindowHandle -ne 0) {',
    '      $found = $true',
    '      "{0}|{1}|{2}|{3}|{4}" -f $start, $p.Id, [int64]$p.MainWindowHandle, $i, ($p.MainWindowTitle -replace "\|", "/")',
    '      break',
    '    }',
    '    $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue',
    '    if (-not $ci -or -not $ci.ParentProcessId) { break }',
    '    $id = [int]$ci.ParentProcessId',
    '    if ($id -le 4) { break }',
    '  }',
    // The chain for $start was searched to its end (no parent, hit the system pids, or
    // MAX_HOPS) without a window: say so, so the JS side can tell a real negative apart from
    // a target the script never reached at all.
    '  if (-not $found) { "{0}|FALSE" -f $start }',
    '}',
  ].join('\n');

  const targets = new Set(valid);
  const stdout = await run(script);
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    // A positive line is `<start>|<pid>|<handle>|<depth>|<title>`, so its two leading numeric
    // fields can never be confused with the `<start>|FALSE` negative marker. Anything else
    // (PowerShell noise, a half-written line from a killed process) is ignored, which leaves
    // that pid unanswered rather than guessed at.
    const positive = /^(\d+)\|\d+\|/.exec(trimmed);
    const negative = positive ? null : /^(\d+)\|FALSE$/.exec(trimmed);
    const match = positive ?? negative;
    if (!match) continue;
    const start = Number(match[1]);
    if (!targets.has(start)) continue;
    // `true` wins: once a window was reported for a pid, a later negative marker for it could
    // only be an artefact.
    if (positive) result.set(start, true);
    else if (!result.has(start)) result.set(start, false);
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

/**
 * Whatever PowerShell managed to write is kept even when the call failed — a timeout (the 8 s
 * budget below still applies, it is the child that gets killed) or a mid-script error may
 * still have flushed complete, trustworthy lines for the targets it did process. Discarding
 * those was only ever safe because a missing line was read as "no window"; now that a missing
 * line means "not answered", partial output is strictly better than none.
 */
function run(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 8_000, maxBuffer: 512 * 1024 },
      (_error, stdout) => resolve(stdout ?? ''),
    );
  });
}
