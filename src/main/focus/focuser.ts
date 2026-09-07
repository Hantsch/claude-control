/**
 * Jump to session (F6, §7).
 *
 * Order of attempts, matching the measured entrypoint distribution
 * (`claude-vscode` dominates by three orders of magnitude — RESEARCH.md §2):
 *
 *  1. **VS Code** — match `cwd` against `workspaceFolders` in `~/.claude/ide/*.lock`
 *     (case-insensitive, normalized, longest prefix wins), then focus that lock's `pid`.
 *     Best effort: the *window*; there is no supported way to select a specific
 *     integrated-terminal tab. The lock is written by the IDE extension, so it is absent
 *     whenever the extension is not connected — measured on a machine with four live
 *     `claude-vscode` sessions and an empty `ide/` directory, which is why nothing below
 *     may depend on it.
 *  2. **Windows Terminal / PowerShell / VS Code** — walk the parent chain to the process that
 *     owns a top-level window, then pick that process's window by the session's own folder
 *     name. The folder is essential, not a nicety: a VS Code terminal's chain ends at the
 *     *shared* main `Code.exe`, whose `MainWindowHandle` names one arbitrary one of its
 *     windows — so every session in every workspace resolved to the same window, and clicking
 *     a row jumped to somebody else's project or to the window already in front. Tabs inside
 *     Windows Terminal are still not individually addressable.
 *  3. **Claude Desktop** — same mechanism as 2.
 *
 * If nothing can be resolved, that is reported so the UI can say so and offer the `cwd`
 * for copying instead of pretending the click worked. The same honesty applies one step
 * earlier: when the host process owns several windows and none of them names the session's
 * folder, the window that is activated is reported as a guess rather than as a hit.
 */

import { matchIdeWindow } from '../../core/adapters/claude/ide.ts';
import type { IdeWindowRef, SessionView } from '../../core/model/types.ts';
import type { FocusResult } from '../../shared/ipc.ts';
import { activateViaShell, findWindowUpChain } from './processChain.ts';
import {
  activateWindow,
  findWindowForPid,
  isNativeFocusAvailable,
  nativeFocusError,
  type MatchConfidence,
  type WindowHint,
} from './win32.ts';

export interface WindowFocuserDeps {
  ideWindows: () => IdeWindowRef[];
}

interface ActivateOutcome {
  activated: boolean;
  flashed: boolean;
  title?: string;
  confidence?: MatchConfidence;
}

export class WindowFocuser {
  private readonly deps: WindowFocuserDeps;

  constructor(deps: WindowFocuserDeps) {
    this.deps = deps;
  }

  backendName(): string {
    if (process.platform !== 'win32') return `unsupported (${process.platform})`;
    return isNativeFocusAvailable() ? 'koffi/user32' : `shell fallback (${nativeFocusError() ?? 'koffi unavailable'})`;
  }

  async focus(session: SessionView): Promise<FocusResult> {
    const ide = matchIdeWindow(session.cwd, this.deps.ideWindows());
    // One VS Code process hosts one window per workspace, so the folder name is what
    // distinguishes them (see `pickWindow`) — for both attempts below, since the lock's pid
    // (the extension host) usually owns no window at all and the chain then has to do the
    // work with the very same hints.
    const hints = folderHints(session.cwd, ide?.folder);

    if (ide) {
      const outcome = await this.activatePid(ide.ref.pid, hints);
      if (outcome.activated || outcome.flashed) {
        const where = outcome.title ?? `${ide.ref.ideName} (${ide.folder})`;
        return {
          ok: outcome.activated,
          method: 'vscode',
          flashed: outcome.flashed,
          target: outcome.title ?? ide.ref.ideName,
          message: outcome.activated
            ? focusedMessage(where, outcome.confidence, folderName(session.cwd))
            : `${ide.ref.ideName} refused foreground activation — its taskbar button is flashing`,
          cwd: session.cwd,
        };
      }
    }

    const chain = await findWindowUpChain(session.pid);
    if (chain) {
      // `chain.title` is whichever window the *process* happens to call its main one, which
      // for a shared host process is not this session's — so it ranks last, behind every
      // folder hint, and is only ever of use to a process that owns a single window anyway.
      const outcome = await this.activatePid(chain.pid, [...hints, { text: chain.title, mode: 'title' }]);
      if (outcome.activated || outcome.flashed) {
        const target = outcome.title || chain.title || `pid ${chain.pid}`;
        return {
          ok: outcome.activated,
          method: 'process-chain',
          flashed: outcome.flashed,
          target,
          message: outcome.activated
            ? focusedMessage(target, outcome.confidence, folderName(session.cwd))
            : 'Windows refused foreground activation — the taskbar button is flashing',
          cwd: session.cwd,
        };
      }
    }

    return {
      ok: false,
      method: 'none',
      flashed: false,
      target: null,
      message:
        'No window could be resolved for this session. ' +
        'Its working directory is available for copying instead.',
      cwd: session.cwd,
    };
  }

  /**
   * Activate a process's window. The FFI path is the real one — only it can distinguish
   * several windows of one process and only it can fall back to flashing. The shell
   * activator addresses the process as a whole, so it is reserved for the case it was
   * written for: `koffi` did not load. Using it as a second chance whenever no window was
   * found would turn "this pid owns no window" (the normal state of a VS Code extension
   * host) into a reported success that moved nothing.
   */
  private async activatePid(pid: number, hints: readonly WindowHint[]): Promise<ActivateOutcome> {
    const match = findWindowForPid(pid, hints);
    if (match) {
      const outcome = activateWindow(match.window.handle);
      if (outcome.activated || outcome.flashed) {
        return { ...outcome, title: match.window.title, confidence: match.confidence };
      }
    }
    if (isNativeFocusAvailable()) return { activated: false, flashed: false };
    const shell = await activateViaShell(pid);
    return { activated: shell, flashed: false };
  }
}

/**
 * Title hints for a session, most trustworthy first.
 *
 * The workspace folder from the IDE lock beats the session's own `cwd`, which beats its
 * parents — a session started in a subfolder (`repo/packages/api`) runs in a window titled
 * after the workspace root, so the ancestors are what rescue it. They may only match a whole
 * title segment: a loose `src` would otherwise match half the windows on the machine. The one
 * hint allowed to match loosely is the session's own folder, and only after every exact
 * match failed.
 */
export function folderHints(cwd: string, ideFolder?: string | null): WindowHint[] {
  const hints: WindowHint[] = [];
  const seen = new Set<string>();
  const add = (text: string, mode: WindowHint['mode']): void => {
    const trimmed = text.trim();
    const key = `${mode}:${trimmed.toLowerCase()}`;
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    hints.push({ text: trimmed, mode });
  };

  if (ideFolder) add(folderName(ideFolder), 'segment');
  add(folderName(cwd), 'segment');
  // Two levels up covers `repo/packages/api` and `repo/src`; beyond that the names get too
  // generic (`development`, `Users`) to be evidence of anything.
  for (const ancestor of ancestorNames(cwd, 2)) add(ancestor, 'segment');
  if (ideFolder) add(folderName(ideFolder), 'substring');
  add(folderName(cwd), 'substring');
  return hints;
}

/** Last segment of a workspace folder path — what VS Code puts in its window title. */
function folderName(folder: string): string {
  const parts = segments(folder);
  return parts[parts.length - 1] ?? folder;
}

/** Names of the `count` folders above `cwd`, nearest first, drive roots excluded. */
function ancestorNames(cwd: string, count: number): string[] {
  const parts = segments(cwd).slice(0, -1);
  return parts
    .reverse()
    .filter((part) => part.length > 1 && !part.endsWith(':'))
    .slice(0, count);
}

function segments(p: string): string[] {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
}

/**
 * A guessed window is still activated — one of the process's windows is better than nothing —
 * but it is never reported as if the session had been found. `folder` names what was looked
 * for so the message says why the window may be the wrong one.
 */
function focusedMessage(target: string, confidence: MatchConfidence | undefined, folder: string): string {
  if (confidence !== 'guess') return `Focused ${target}`;
  return `Focused ${target} — no window of that process is titled after ${folder}, so this may be the wrong one`;
}
