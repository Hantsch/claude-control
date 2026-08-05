/**
 * Jump to session (F6, §7).
 *
 * Order of attempts, matching the measured entrypoint distribution
 * (`claude-vscode` dominates by three orders of magnitude — RESEARCH.md §2):
 *
 *  1. **VS Code** — match `cwd` against `workspaceFolders` in `~/.claude/ide/*.lock`
 *     (case-insensitive, normalized, longest prefix wins), then focus that lock's `pid`.
 *     Best effort: the *window*; there is no supported way to select a specific
 *     integrated-terminal tab.
 *  2. **Windows Terminal / PowerShell** — walk the parent chain to the process that owns a
 *     top-level window. Tabs inside Windows Terminal are not individually addressable.
 *  3. **Claude Desktop** — same mechanism as 2.
 *
 * If nothing can be resolved, that is reported so the UI can say so and offer the `cwd`
 * for copying instead of pretending the click worked.
 */

import { matchIdeWindow } from '../../core/adapters/claude/ide.ts';
import type { IdeWindowRef, SessionView } from '../../core/model/types.ts';
import type { FocusResult } from '../../shared/ipc.ts';
import { activateViaShell, findWindowUpChain } from './processChain.ts';
import { activateWindow, findWindowForPid, isNativeFocusAvailable, nativeFocusError } from './win32.ts';

export interface WindowFocuserDeps {
  ideWindows: () => IdeWindowRef[];
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
    if (ide) {
      // One VS Code process hosts one window per workspace, so the folder name is what
      // distinguishes them (see `findWindowForPid`).
      const outcome = await this.activatePid(ide.ref.pid, folderName(ide.folder));
      if (outcome.activated || outcome.flashed) {
        return {
          ok: outcome.activated,
          method: 'vscode',
          flashed: outcome.flashed,
          target: outcome.title ?? ide.ref.ideName,
          message: outcome.activated
            ? `Focused ${ide.ref.ideName} (${ide.folder})`
            : `${ide.ref.ideName} refused foreground activation — its taskbar button is flashing`,
          cwd: session.cwd,
        };
      }
    }

    const chain = await findWindowUpChain(session.pid);
    if (chain) {
      const outcome = await this.activatePid(chain.pid, chain.title);
      if (outcome.activated || outcome.flashed) {
        return {
          ok: outcome.activated,
          method: 'process-chain',
          flashed: outcome.flashed,
          target: chain.title || `pid ${chain.pid}`,
          message: outcome.activated
            ? `Focused ${chain.title || `pid ${chain.pid}`}`
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
   * Activate a process's window. The FFI path is preferred because only it can distinguish
   * several windows of one process and only it can fall back to flashing; if `koffi` is
   * unavailable the shell activator is tried, which can only address the process as a whole.
   */
  private async activatePid(
    pid: number,
    titleHint?: string | null,
  ): Promise<{ activated: boolean; flashed: boolean; title?: string }> {
    const window = findWindowForPid(pid, titleHint);
    if (window) {
      const outcome = activateWindow(window.handle);
      if (outcome.activated || outcome.flashed) return { ...outcome, title: window.title };
    }
    const shell = await activateViaShell(pid);
    // Only a real window title is reported back; the hint is a folder name, not a title.
    return { activated: shell, flashed: false, title: window?.title };
  }
}

/** Last segment of a workspace folder path — what VS Code puts in its window title. */
function folderName(folder: string): string {
  const parts = folder.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] ?? folder;
}
