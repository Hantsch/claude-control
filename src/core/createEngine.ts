/**
 * Assembly point: settings + Claude adapter + engine. This is the single place that picks
 * an adapter implementation — "adding an agent means adding a class and registering it"
 * (§9). No plugin discovery.
 */

import { ClaudeAdapter } from './adapters/claude/adapter.ts';
import { resolveClaudePaths, type ClaudePaths } from './adapters/claude/paths.ts';
import type { AgentAdapter } from './adapters/types.ts';
import { WindowSource } from './context/windowSource.ts';
import { ControlEngine } from './engine.ts';
import type { AppSettings } from './model/settings.ts';
import { createProcessProbe, type ProcessProbe } from './registry/liveness.ts';

export interface CreateEngineOptions {
  settings: AppSettings;
  /** Override the process probe (tests, non-Windows hosts). */
  probe?: ProcessProbe;
  now?: () => number;
  /** See `ControlEngineOptions.hasTerminalWindow` — the main-process window-probe cache read. */
  hasTerminalWindow?: (pid: number) => boolean | undefined;
  /**
   * Where the model-window cache lives — Electron's `userData` in the app, the CLI's own
   * resolution otherwise (story 005 D6 supplies both). Omitting it is a supported mode, not
   * a degraded one: no data dir means no `WindowSource`, i.e. the estimate table only.
   */
  dataDir?: string;
}

export interface CreatedEngine {
  engine: ControlEngine;
  adapter: AgentAdapter;
  paths: ClaudePaths;
  /** Null when no `dataDir` was given. Exposed so Settings/Diagnostics can drive it. */
  windowSource: WindowSource | null;
}

export function createEngine(options: CreateEngineOptions): CreatedEngine {
  const paths = resolveClaudePaths(options.settings.claudeDir);
  const adapter = new ClaudeAdapter({
    paths,
    tailWindowBytes: options.settings.reading.tailWindowBytes,
    maxTailWindowBytes: options.settings.reading.maxTailWindowBytes,
    probe: options.probe ?? createProcessProbe(),
    thresholds: options.settings.thresholds,
    now: options.now,
  });
  // Constructed enabled-or-not straight from the setting, so nothing is fetched and no
  // window resolves before the user has opted in.
  const windowSource = options.dataDir
    ? new WindowSource(options.dataDir, {
        enabled: options.settings.contextWindows.useOnlineTable,
        now: options.now,
      })
    : null;
  const engine = new ControlEngine({
    adapter,
    settings: options.settings,
    now: options.now,
    hasTerminalWindow: options.hasTerminalWindow,
    ...(windowSource ? { windowSource } : {}),
  });
  return { engine, adapter, paths, windowSource };
}
