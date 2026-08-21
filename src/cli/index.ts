/**
 * M1 CLI (§11): `core/` reads the registry, tails transcripts and derives status, printed
 * to stdout with no UI at all.
 *
 * This exists because if the state machine is wrong, everything after it is polish on a
 * broken foundation — so it gets validated against real sessions before any UI exists.
 *
 *   npm run cli              one snapshot, then exit
 *   npm run cli -- --watch   stay attached and print every change
 *   npm run cli -- --history list the history index once it is built
 *   npm run cli -- --json    machine-readable output
 */

import { createEngine } from '../core/createEngine.ts';
import { DEFAULT_SETTINGS, mergeSettings } from '../core/model/settings.ts';
import { STATUS_LABEL } from '../core/model/status.ts';
import type { EngineSnapshot } from '../core/engine.ts';
import type { SessionView, StatusTransition } from '../core/model/types.ts';
import { sessionLabel } from '../shared/presentation.ts';
import { formatAge } from './format.ts';

interface CliOptions {
  watch: boolean;
  json: boolean;
  history: boolean;
  claudeDir: string | null;
  verbose: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    watch: false,
    json: false,
    history: false,
    claudeDir: null,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--watch' || arg === '-w') options.watch = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--history') options.history = true;
    else if (arg === '--verbose' || arg === '-v') options.verbose = true;
    else if (arg === '--claude-dir') options.claudeDir = argv[++i] ?? null;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  return options;
}

function printUsage(): void {
  process.stdout.write(
    [
      'claude-control (M1 CLI)',
      '',
      'Usage: npm run cli -- [options]',
      '',
      '  -w, --watch          keep running and print status changes',
      '      --history        print the history index as well',
      '      --json           emit JSON instead of a table',
      '      --claude-dir P   read Claude Code state from P instead of ~/.claude',
      '  -v, --verbose        include derivation reasons and read diagnostics',
      '  -h, --help           this text',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const settings = mergeSettings({
    ...DEFAULT_SETTINGS,
    claudeDir: options.claudeDir,
    indexHistoryOnStart: options.history,
  });

  const started = Date.now();
  const { engine, paths } = createEngine({ settings });

  engine.on('error', (error) => {
    process.stderr.write(`[error] ${error.message}\n`);
  });

  if (options.watch) {
    engine.on('transitions', (transitions) => printTransitions(transitions, options));
    engine.on('sessions', (snapshot) => {
      if (!options.json) return;
      process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    });
  }

  await engine.start();
  const elapsed = Date.now() - started;

  if (options.json && !options.watch) {
    const snapshot = engine.getSnapshot();
    process.stdout.write(
      `${JSON.stringify({ ...snapshot, coldStartMs: elapsed, history: options.history ? engine.listHistory({ limit: 200 }).entries : [] }, null, 2)}\n`,
    );
  } else if (!options.json) {
    printSnapshot(engine.getSnapshot(), options, paths.root, elapsed);
  }

  if (options.history && !options.json) {
    // The index runs in the background (§5.1); wait for it before printing.
    await new Promise<void>((resolve) => {
      engine.on('history', (info) => {
        if (info.done) resolve();
      });
    });
    printHistory(engine.listHistory({ limit: 40 }).entries);
  }

  if (!options.watch) {
    await engine.stop();
    return;
  }

  process.stdout.write('\nWatching for changes — Ctrl+C to stop.\n');
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      void engine.stop().then(resolve);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

function printSnapshot(
  snapshot: EngineSnapshot,
  options: CliOptions,
  root: string,
  coldStartMs: number,
): void {
  process.stdout.write(`Claude data directory: ${root}\n`);
  process.stdout.write(
    `${snapshot.sessions.length} live session(s) · tray=${snapshot.trayState} · badge=${snapshot.attention} · cold start ${coldStartMs} ms\n\n`,
  );

  if (snapshot.sessions.length === 0) {
    process.stdout.write('No live sessions found.\n');
    return;
  }

  for (const group of snapshot.groups) {
    process.stdout.write(`${group.project.name}  (${group.project.path})\n`);
    for (const branch of group.branches) {
      process.stdout.write(`  ${branch.branch ?? '(no branch)'}\n`);
      for (const session of branch.sessions) {
        printSession(session, options);
      }
    }
    process.stdout.write('\n');
  }
}

function printSession(session: SessionView, options: CliOptions): void {
  const age = session.lastActivityAt ? formatAge(Date.now() - session.lastActivityAt) : '—';
  const context = session.context
    ? `${Math.round(session.context.ratio * 100)}%${session.context.widened ? '*' : ''}`
    : '—';
  const tool = session.pendingTool ? ` tool=${session.pendingTool.name}` : '';
  const subagents = session.subagents.length > 0 ? ` agents=${session.subagents.length}` : '';

  process.stdout.write(
    `    ${symbol(session.status)} ${pad(sessionLabel(session), 32)} ${pad(STATUS_LABEL[session.status], 16)} ` +
      `${pad(age, 8)} ctx=${pad(context, 6)} ${session.model ?? '—'}${tool}${subagents}\n`,
  );
  if (options.verbose) {
    const source =
      session.statusSource === 'reported' ? 'reported by Claude Code' : 'inferred from transcript';
    process.stdout.write(`        why: ${session.statusReason} (${source})\n`);
    process.stdout.write(`        pid=${session.pid} entrypoint=${session.entrypoint} v${session.agentVersion ?? '?'}\n`);
    const run = session.run
      ? `${formatAge(
          (session.run.endedAt ?? Date.now()) - session.run.startedAt,
        )}${session.run.endedAt === null ? ' (running)' : ''}`
      : '—';
    process.stdout.write(`        run: ${run}\n`);
    if (session.transcriptPath) process.stdout.write(`        ${session.transcriptPath}\n`);
    for (const node of session.subagents) {
      const duration = node.durationMs !== null ? formatAge(node.durationMs) : '—';
      process.stdout.write(`        └─ ${node.status.padEnd(9)} ${duration.padEnd(8)} ${node.label}\n`);
      if (node.errorText) process.stdout.write(`           ${node.errorText}\n`);
      if (node.finalText || node.model) {
        process.stdout.write(`           model=${node.model ?? '—'} report=${node.finalText ?? '—'}\n`);
      }
      const metrics = node.metrics;
      if (metrics) {
        const ctx = metrics.context ? `ctx=${Math.round(metrics.context.ratio * 100)}%` : 'ctx=—';
        process.stdout.write(
          `           ${metrics.model ?? '—'} tokens=${metrics.totalTokens ?? '—'} ${ctx} ` +
            `tools=${metrics.toolUses ?? '—'} +${metrics.linesAdded ?? 0}/-${metrics.linesRemoved ?? 0}\n`,
        );
      }
    }
  }
}

function printTransitions(transitions: readonly StatusTransition[], options: CliOptions): void {
  for (const transition of transitions) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify(transition)}\n`);
      continue;
    }
    const stamp = new Date(transition.at).toISOString().slice(11, 19);
    const seeded = transition.seeded ? ' (seed)' : '';
    process.stdout.write(
      `${stamp} ${sessionLabel(transition.view)}: ${transition.from ?? '—'} → ${transition.to}${seeded}\n`,
    );
    if (options.verbose) process.stdout.write(`         ${transition.view.statusReason}\n`);
  }
}

function printHistory(entries: readonly { sessionId: string; title: string | null; project: { name: string }; endedAt: number | null; finalStatus: string }[]): void {
  process.stdout.write(`\nHistory (${entries.length} shown)\n`);
  for (const entry of entries) {
    const when = entry.endedAt ? new Date(entry.endedAt).toISOString().slice(0, 16).replace('T', ' ') : '—';
    process.stdout.write(
      `  ${pad(when, 18)} ${pad(entry.project.name, 24)} ${pad(entry.finalStatus, 9)} ${entry.title ?? entry.sessionId}\n`,
    );
  }
}

function symbol(status: string): string {
  switch (status) {
    case 'waiting':
      return '◑';
    case 'done':
      return '●';
    case 'working':
      return '◐';
    case 'stale':
      return '○';
    case 'queued':
      return '◇';
    case 'starting':
      return '◌';
    default:
      return '·';
  }
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
