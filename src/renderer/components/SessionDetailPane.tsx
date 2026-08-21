/**
 * Detail pane for one live session (§8): context gauge, model, elapsed time, current tool
 * and the subagent tree — plus the jump-to-session action (F6).
 */

import { useState } from 'react';
import type { FocusResult, SessionRun, SessionView } from '../../shared/ipc.ts';
import {
  STATUS_HINT,
  STATUS_LABEL,
  modelDisplayName,
  sessionLabel,
} from '../../shared/presentation.ts';
import { api } from '../api.ts';
import { formatAge, formatDateTime, formatDuration } from '../lib/format.ts';
import { ContextGauge } from './ContextGauge.tsx';
import { StatusDot } from './StatusDot.tsx';
import { SubagentTree } from './SubagentTree.tsx';

export function SessionDetailPane({ session }: { session: SessionView | null }): React.JSX.Element {
  const [focusResult, setFocusResult] = useState<FocusResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  if (!session) {
    return <div className="empty">Select a session to see its detail.</div>;
  }

  const jump = async (): Promise<void> => {
    setFocusResult(null);
    setFocusResult(await api.focusSession(session.sessionId));
  };

  const toggleMuted = (): void => {
    void api.setSessionMuted(session.sessionId, !session.muted);
  };

  const copy = async (label: string, text: string): Promise<void> => {
    await api.copyText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div>
      <div className="detail-head">
        <StatusDot status={session.status} />
        <span className="name">{sessionLabel(session)}</span>
      </div>

      {/* The slug is Claude Code's own session name — kept visible because the tray and the
          notifications still fall back to it, but it is not what the IDE shows. */}
      <div className="detail-slug">{session.name}</div>

      <div className="detail-jump">
        <button type="button" onClick={() => void jump()}>
          Jump to session
        </button>
        <button
          type="button"
          className={`mute-button${session.muted ? ' on' : ''}`}
          onClick={toggleMuted}
          aria-pressed={session.muted}
        >
          {session.muted ? '🔇 Unmute' : '🔔 Mute'}
        </button>
      </div>

      {focusResult && (
        <div className={`notice${focusResult.ok ? '' : ' error'}`}>
          {focusResult.message}
          {!focusResult.ok && focusResult.method === 'none' && (
            <>
              <br />
              <code>{focusResult.cwd}</code>{' '}
              <button type="button" onClick={() => void copy('directory', focusResult.cwd)}>
                Copy
              </button>
            </>
          )}
        </div>
      )}

      <div className="estimate" title={STATUS_HINT[session.status]}>
        {STATUS_LABEL[session.status]} — {session.statusReason}
        {session.statusSource === 'reported' && (
          <span
            className="status-source-badge"
            title="Claude Code's own registry reported this status, rather than it being inferred from the transcript."
          >
            {' '}
            reported by Claude Code
          </span>
        )}
      </div>

      <dl className="kv">
        <dt>Project</dt>
        <dd title={session.project.path}>{session.project.name}</dd>
        <dt>Branch</dt>
        <dd>{session.branch ?? '—'}</dd>
        <dt>Model</dt>
        <dd title={session.model ?? undefined}>{modelDisplayName(session.model) ?? '—'}</dd>
        <dt>Started</dt>
        <dd>{formatDateTime(session.startedAt)}</dd>
        <dt>Last activity</dt>
        <dd>{formatAge(session.lastActivityAt ? Date.now() - session.lastActivityAt : null)}</dd>
        <dt title="From the last prompt to the end of that turn. A running turn keeps counting.">
          Run
        </dt>
        <dd>{describeRun(session.run)}</dd>
        <dt>In status</dt>
        <dd>{formatDuration(Date.now() - session.statusSince)}</dd>
        <dt>Current tool</dt>
        <dd>
          {session.pendingTool
            ? `${session.pendingTool.name}${session.pendingTool.hint ? ` — ${session.pendingTool.hint}` : ''}`
            : '—'}
        </dd>
        <dt>Entrypoint</dt>
        <dd>
          {session.entrypoint} · pid {session.pid}
          {session.agentVersion ? ` · v${session.agentVersion}` : ''}
        </dd>
        <dt>Directory</dt>
        <dd className="mono">{session.cwd}</dd>
      </dl>

      <div className="section-title">Context pressure</div>
      <ContextGauge context={session.context} />

      <div className="section-title">Subagents ({session.subagents.length})</div>
      <SubagentTree nodes={session.subagents} />

      {session.lastAssistantText && (
        <>
          <div className="section-title">Last assistant message</div>
          <div className="assistant-text">{session.lastAssistantText}</div>
        </>
      )}

      <div className="row-actions">
        <button type="button" onClick={() => void copy('directory', session.cwd)}>
          Copy directory
        </button>
        {session.transcriptPath && (
          <button type="button" onClick={() => void api.revealPath(session.transcriptPath!)}>
            Show transcript
          </button>
        )}
      </div>

      {copied && <div className="notice">Copied the {copied} to the clipboard.</div>}
    </div>
  );
}

/**
 * How long the current or last run took. An open run is still counting, so it is labelled
 * as such rather than presented as a total. No run means the tail window held no prompt.
 */
function describeRun(run: SessionRun | null): string {
  if (!run) return '—';
  if (run.endedAt === null) return `${formatDuration(Date.now() - run.startedAt)} · running`;
  return formatDuration(run.endedAt - run.startedAt);
}
