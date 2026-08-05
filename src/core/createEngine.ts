/**
 * Assembly point: settings + Claude adapter + engine. This is the single place that picks
 * an adapter implementation — "adding an agent means adding a class and registering it"
 * (§9). No plugin discovery.
 */

import { ClaudeAdapter } from './adapters/claude/adapter.ts';
import { resolveClaudePaths, type ClaudePaths } from './adapters/claude/paths.ts';
import type { AgentAdapter } from './adapters/types.ts';
import { ControlEngine } from './engine.ts';
import type { AppSettings } from './model/settings.ts';
import { createProcessProbe, type ProcessProbe } from './registry/liveness.ts';

export interface CreateEngineOptions {
  settings: AppSettings;
  /** Override the process probe (tests, non-Windows hosts). */
  probe?: ProcessProbe;
  now?: () => number;
}

export interface CreatedEngine {
  engine: ControlEngine;
  adapter: AgentAdapter;
  paths: ClaudePaths;
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
  const engine = new ControlEngine({ adapter, settings: options.settings, now: options.now });
  return { engine, adapter, paths };
}
