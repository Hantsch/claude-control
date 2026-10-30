/**
 * Body of the session detail window: header facts, subagent tree and the run timeline.
 * Runs are collapsed by default so a long transcript opens as a short list of prompts.
 */

import { useState } from 'react';
import type { SessionDetail, TimelineEvent } from '../../core/model/types.ts';
import { api } from '../api.ts';
import {
  detailHeader,
  detailTruncatedNotice,
  eventRow,
  groupRuns,
  visibleEvents,
  type DetailLoad,
  type TimelineRun,
} from '../lib/detailModel.ts';
import { formatDateTime } from '../lib/format.ts';
import { SubagentTree } from './SubagentTree.tsx';

export function SessionDetailWindow({ load }: { load: DetailLoad }): React.JSX.Element {
  if (load.state === 'idle' || load.state === 'loading') {
    return <div className="detail-window detail-status">Reading transcript…</div>;
  }
  if (load.state === 'failed') {
    return (
      <div className="detail-window">
        <div className="notice error">Could not read this transcript: {load.message}</div>
      </div>
    );
  }
  return <Loaded detail={load.detail} />;
}

function Loaded({ detail }: { detail: SessionDetail }): React.JSX.Element {
  const header = detailHeader(detail);
  const notice = detailTruncatedNotice(detail);
  const runs = groupRuns(detail.events);
  return (
    <div className="detail-window">
      <header className="detail-header">
        <h1>{header.title}</h1>
        <div className="detail-facts">
          <span title={header.projectPath}>{header.projectName}</span>
          <span>Branch {header.branches}</span>
          <span>Model {header.models}</span>
          <span>Started {header.startedAt}</span>
          <span>Ended {header.endedAt}</span>
          <span>Duration {header.duration}</span>
          {header.tokens ? (
            <>
              <span>Input {header.tokens.inputTokens.toLocaleString()}</span>
              <span>Cache read {header.tokens.cacheReadTokens.toLocaleString()}</span>
              <span>Cache write {header.tokens.cacheCreationTokens.toLocaleString()}</span>
              <span>Output {header.tokens.outputTokens.toLocaleString()}</span>
              <span>Total {header.tokens.total.toLocaleString()} tokens</span>
            </>
          ) : (
            <span>Tokens {header.tokensNote}</span>
          )}
        </div>
        <div className="detail-path">
          <span className="detail-path-text">{detail.transcriptPath}</span>
          <button type="button" onClick={() => void api.copyText(detail.transcriptPath)}>
            Copy path
          </button>
          <button type="button" onClick={() => void api.revealPath(detail.transcriptPath)}>
            Show file
          </button>
        </div>
      </header>
      <div className="detail-scroll">
        {notice && <div className="notice">{notice}</div>}
        <h2>Subagents</h2>
        <SubagentTree nodes={detail.subagents} emptyText="No subagents in this session." />
        <h2>Timeline</h2>
        {runs.length === 0 && <div className="estimate">No events in this transcript.</div>}
        {runs.map((run, index) => (
          <Run key={index} run={run} />
        ))}
      </div>
    </div>
  );
}

function Run({ run }: { run: TimelineRun }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState(1);
  const shown = open ? visibleEvents(run, pages) : null;
  return (
    <section className="detail-run">
      {/* A native button: Enter and Space toggle it without extra key handling. */}
      <button
        type="button"
        className="detail-run-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="detail-run-title">
          {open ? '▾' : '▸'} {run.label ?? run.promptText}
        </span>
        <span className="meta">
          {formatDateTime(run.startedAt)} · {run.eventCount} events · {run.toolCount} tool calls
        </span>
      </button>
      {shown && (
        <ul className="detail-events">
          {shown.events.map((event, index) => (
            <EventItem key={index} event={event} />
          ))}
          {shown.remaining > 0 && (
            <li>
              <button type="button" onClick={() => setPages((value) => value + 1)}>
                Show 200 more
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function EventItem({ event }: { event: TimelineEvent }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const row = eventRow(event);
  return (
    <li className="detail-event">
      <button
        type="button"
        className="detail-event-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="meta">{row.time}</span>
        <span className="detail-event-kind">
          {row.kind}
          {row.tool ? ` · ${row.tool}` : ''}
          {row.stopReason ? ` · ${row.stopReason}` : ''}
        </span>
        {!open && <span className="detail-event-text">{row.text}</span>}
      </button>
      {open && <div className="detail-event-full">{event.text ?? ''}</div>}
    </li>
  );
}
