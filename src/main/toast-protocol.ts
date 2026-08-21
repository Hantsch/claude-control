/**
 * Toast buttons and the URI scheme behind them (§6.6, D6).
 *
 * Electron's `actions` field is macOS-only, so the two Windows buttons ("Jump", "Mute this
 * session") have to be rendered by handing Windows a raw `toastXml`. A button cannot call
 * back into the process that showed the toast either — `activationType="protocol"` makes the
 * shell open a `claude-control://` URI, which lands as an argv entry in a *new* process; the
 * single-instance lock then forwards it to the running one (`second-instance`).
 *
 * Both halves of that round trip live here, next to each other, so the URI a button carries
 * and the URI the argv scanner accepts cannot drift apart. Deliberately free of Electron
 * imports so both are unit-testable in plain Node.
 */

import { resolve } from 'node:path';

/** Registered with `app.setAsDefaultProtocolClient` (Windows only — see index.ts). */
export const TOAST_PROTOCOL = 'claude-control';

export type ToastActionName = 'jump' | 'mute';

export interface ToastAction {
  action: ToastActionName;
  sessionId: string;
}

const BUTTONS: readonly { action: ToastActionName; label: string }[] = [
  { action: 'jump', label: 'Jump' },
  { action: 'mute', label: 'Mute this session' },
];

export interface ToastXmlInput {
  title: string;
  /** Body lines; empty ones are dropped. ToastGeneric renders at most three. */
  lines: readonly string[];
  /** `file:///…` logo, or null when the art is not reachable for the shell (asar). */
  imageUri?: string | null;
  sessionId: string;
}

/** `claude-control://jump?session=…` — the argument of one toast button. */
export function toastActionUri(action: ToastActionName, sessionId: string): string {
  return `${TOAST_PROTOCOL}://${action}?session=${encodeURIComponent(sessionId)}`;
}

/**
 * The whole toast, because `toastXml` replaces title, body *and* icon wholesale — anything
 * omitted here is simply not shown, so this mirrors the plain `Notification` path field for
 * field, including `silent` (F5: no sound).
 */
export function buildToastXml(input: ToastXmlInput): string {
  const texts = [input.title, ...input.lines]
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((line) => `<text>${escapeXml(line)}</text>`)
    .join('');
  const image = input.imageUri
    ? `<image placement="appLogoOverride" src="${escapeXml(input.imageUri)}"/>`
    : '';
  const actions = BUTTONS.map(
    ({ action, label }) =>
      `<action content="${escapeXml(label)}" activationType="protocol" ` +
      `arguments="${escapeXml(toastActionUri(action, input.sessionId))}"/>`,
  ).join('');

  // No `activationType` on the root: the body keeps Windows' default (foreground) activation,
  // which is what Electron's own `click` event is wired to. Only the buttons leave the process.
  return (
    '<toast>' +
    `<visual><binding template="ToastGeneric">${texts}${image}</binding></visual>` +
    '<audio silent="true"/>' +
    `<actions>${actions}</actions>` +
    '</toast>'
  );
}

/**
 * The first `claude-control://…` entry of a command line, or null.
 *
 * Scans rather than reading a fixed position: Windows appends the URI to whatever the
 * registered command line already carries, and a dev run puts the script path in front of it.
 */
export function toastActionFromArgv(argv: readonly string[]): ToastAction | null {
  for (const arg of argv) {
    const action = parseToastAction(arg);
    if (action) return action;
  }
  return null;
}

/** Strict on purpose: an unknown verb or a missing session id is not an action. */
export function parseToastAction(value: string): ToastAction | null {
  if (typeof value !== 'string') return null;
  if (!value.toLowerCase().startsWith(`${TOAST_PROTOCOL}:`)) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // `claude-control://jump?…` puts the verb in the host, `claude-control:jump?…` in the path;
  // the shell is free to hand back either.
  const verb = (url.hostname || url.pathname).replaceAll('/', '').trim().toLowerCase();
  if (verb !== 'jump' && verb !== 'mute') return null;

  const sessionId = url.searchParams.get('session')?.trim();
  if (!sessionId) return null;
  return { action: verb, sessionId };
}

export interface ProtocolClientTarget {
  /** Second arg to `app.setAsDefaultProtocolClient` — omitted when the exe is self-sufficient. */
  path?: string;
  /** Third arg — extra argv Windows appends when relaunching via the registered path. */
  args?: string[];
}

/**
 * What to register with `app.setAsDefaultProtocolClient` (D4).
 *
 * `process.execPath` is normally stable, but electron-builder's `portable` target extracts to a
 * per-run temp dir and points `execPath` there — a path that stops existing once the app exits,
 * so a toast button pressed later launches nothing. That target also exports
 * `PORTABLE_EXECUTABLE_FILE`: the *launched* exe's own stable path. Prefer it when present,
 * with no extra args since it is a full standalone exe. Otherwise fall back to today's
 * behaviour: no-argument registration when packaged (the exe finds itself), or Electron plus
 * the script path in dev (there is no exe of its own to register).
 */
export function protocolClientTarget(
  env: NodeJS.ProcessEnv,
  execPath: string,
  isPackaged: boolean,
  script: string | undefined,
): ProtocolClientTarget {
  const portableExe = env.PORTABLE_EXECUTABLE_FILE;
  if (portableExe) return { path: portableExe };
  if (isPackaged || !script) return {};
  return { path: execPath, args: [resolve(script)] };
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
