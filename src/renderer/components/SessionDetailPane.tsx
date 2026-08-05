/**
 * Detail pane for one live session (§8): context gauge, model, elapsed time, current tool
 * and the subagent tree — plus the jump-to-session action (F6).
 */

import { useState } from 'react';
import type { FocusResult, SessionView } from '../../shared/ipc.ts';
import { STATUS_HINT, STATUS_LABEL } from '../../shared/presentation.ts';
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

  const copy = async (label: string, text: string): Promise<void> => {
    await api.copyText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div>
      <div className="detail-head">
        <StatusDot status={session.status} />
        <span className="name">{session.name}</span>
      </div>

      <div className="estimate" title={STATUS_HINT[session.status]}>
        {STATUS_LABEL[session.status]} — {session.statusReason}
      </div>

      <dl className="kv">
        <dt>Project</dt>
        <dd title={session.project.path}>{session.project.name}</dd>
        <dt>Branch</dt>
        <dd>{session.branch ?? '—'}</dd>
        <dt>Model</dt>
        <dd>{session.model ?? '—'}</dd>
        <dt>Started</dt>
        <dd>{formatDateTime(session.startedAt)}</dd>
        <dt>Last activity</dt>
        <dd>{formatAge(session.lastActivityAt ? Date.now() - session.lastActivityAt : null)}</dd>
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
        <button type="button" onClick={() => void jump()}>
          Jump to session
        </button>
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
    </div>
  );
}
