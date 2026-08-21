/**
 * D6 of story 004: the two toast buttons and the `claude-control://` round trip they take.
 *
 * The toast itself can only be seen on Windows, but both ends of the trip are plain string
 * work — the XML handed to the shell, and the argv scan that catches the URI coming back — so
 * the contract between them is testable without Electron.
 */

import { describe, expect, it } from 'vitest';
import {
  buildToastXml,
  parseToastAction,
  toastActionFromArgv,
  toastActionUri,
} from '../../src/main/toast-protocol.ts';

const xml = (overrides: Partial<Parameters<typeof buildToastXml>[0]> = {}): string =>
  buildToastXml({
    title: 'api — Finished',
    lines: ['claude-control · dev', 'All done.'],
    imageUri: null,
    sessionId: 's-1',
    ...overrides,
  });

describe('buildToastXml', () => {
  it('renders both buttons as protocol actions carrying the session id', () => {
    const body = xml({ sessionId: 'abc-123' });
    expect(body).toContain(
      '<action content="Jump" activationType="protocol" arguments="claude-control://jump?session=abc-123"/>',
    );
    expect(body).toContain(
      '<action content="Mute this session" activationType="protocol" ' +
        'arguments="claude-control://mute?session=abc-123"/>',
    );
  });

  it('keeps title, body lines, logo and silence — toastXml replaces all of them', () => {
    const body = xml({ imageUri: 'file:///C:/app/assets/icons/app-done.png' });
    expect(body).toContain('<text>api — Finished</text>');
    expect(body).toContain('<text>claude-control · dev</text>');
    expect(body).toContain('<text>All done.</text>');
    expect(body).toContain('<image placement="appLogoOverride" src="file:///C:/app/assets/icons/app-done.png"/>');
    expect(body).toContain('<audio silent="true"/>');
  });

  it('drops empty lines and omits the logo when the art is not reachable', () => {
    const body = xml({ lines: ['', 'only this'] });
    expect(body).not.toContain('<text></text>');
    expect(body).not.toContain('<image');
    expect(body.match(/<text>/g)).toHaveLength(2);
  });

  it('escapes markup so a session name cannot break the document', () => {
    const body = xml({ title: 'a & b <x>', sessionId: 'a"b' });
    expect(body).toContain('<text>a &amp; b &lt;x&gt;</text>');
    expect(body).toContain('arguments="claude-control://mute?session=a%22b"');
  });

  it('leaves the toast body on default activation, so the click handler still fires', () => {
    expect(xml().startsWith('<toast>')).toBe(true);
    expect(xml()).not.toContain('<toast activationType');
  });
});

describe('parseToastAction', () => {
  it('reads both verbs', () => {
    expect(parseToastAction(toastActionUri('jump', 's-1'))).toEqual({ action: 'jump', sessionId: 's-1' });
    expect(parseToastAction(toastActionUri('mute', 's-1'))).toEqual({ action: 'mute', sessionId: 's-1' });
  });

  it('decodes a session id the shell handed back percent-encoded', () => {
    expect(parseToastAction(toastActionUri('mute', 'a b/c'))?.sessionId).toBe('a b/c');
  });

  it('accepts the shapes the shell may produce for the same URI', () => {
    expect(parseToastAction('claude-control://jump/?session=s-1')?.action).toBe('jump');
    expect(parseToastAction('claude-control:jump?session=s-1')?.action).toBe('jump');
    expect(parseToastAction('CLAUDE-CONTROL://JUMP?session=s-1')?.action).toBe('jump');
  });

  it('rejects anything that is not one of our two actions', () => {
    expect(parseToastAction('claude-control://quit?session=s-1')).toBeNull();
    expect(parseToastAction('claude-control://mute')).toBeNull();
    expect(parseToastAction('claude-control://mute?session=')).toBeNull();
    expect(parseToastAction('https://example.com/mute?session=s-1')).toBeNull();
    expect(parseToastAction('--show')).toBeNull();
    expect(parseToastAction('claude-control://')).toBeNull();
  });
});

describe('toastActionFromArgv', () => {
  it('finds the URI wherever the shell put it on the command line', () => {
    const argv = ['C:/app/electron.exe', 'C:/app/out/main/index.js', 'claude-control://mute?session=s-9'];
    expect(toastActionFromArgv(argv)).toEqual({ action: 'mute', sessionId: 's-9' });
  });

  it('is null for an ordinary second start, so that keeps opening the window', () => {
    expect(toastActionFromArgv(['C:/app/ClaudeControl.exe'])).toBeNull();
    expect(toastActionFromArgv(['C:/app/ClaudeControl.exe', '--show', 'sessions'])).toBeNull();
    expect(toastActionFromArgv([])).toBeNull();
  });
});
