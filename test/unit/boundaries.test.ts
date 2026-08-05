/**
 * The architectural rules from §3, enforced rather than asserted in a comment:
 *
 *  - **`core/` never imports Electron.** This is what makes the state machine testable with
 *    plain Node and fixture files, and it is the rule that quietly rots first.
 *  - **The renderer never reaches the filesystem.** It receives finished view models over
 *    IPC; the preload is the entire surface.
 *  - **N1: no network.** No HTTP server, no client, no socket, anywhere.
 *  - **N2: nothing under `core/` opens a file for writing.**
 */

import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../src/', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (['.ts', '.tsx'].includes(extname(entry.name))) out.push(full);
  }
  return out;
}

/** Source with comments removed, so a rule cannot be "broken" by a comment mentioning it. */
async function code(file: string): Promise<string> {
  const text = await readFile(file, 'utf8');
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Any way a module can be pulled in: static import, `require`, and dynamic `import()`.
 * Built as a function so every rule below covers all three forms rather than one of them.
 */
function importsAny(specifiers: string, options: { subpaths?: boolean } = {}): RegExp {
  const tail = options.subpaths ? `(?:/[^'"]*)?` : '';
  const target = `['"](?:${specifiers})${tail}['"]`;
  return new RegExp(`\\bfrom\\s+${target}|\\brequire\\s*\\(\\s*${target}|\\bimport\\s*\\(\\s*${target}`);
}

const ELECTRON = 'electron';
const NODE_BUILTINS = 'node:[a-z_]+|fs|fs/promises|path|os|child_process|crypto|net|http|https|zlib|worker_threads';
const NETWORK_MODULES =
  'node:(?:http|https|http2|net|dgram|tls)|http|https|http2|net|dgram|tls|axios|undici|node-fetch|ws|socket\\.io|socket\\.io-client';

describe('architecture boundaries', () => {
  it('core/ never imports Electron, in any import form', async () => {
    const rule = importsAny(ELECTRON, { subpaths: true });
    const offenders: string[] = [];
    for (const file of await sourceFiles(join(SRC, 'core'))) {
      if (rule.test(await code(file))) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it('core/ never opens a file for writing', async () => {
    const write =
      /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdtemp|rm|rmdir|unlink|rename|utimes|truncate|copyFile|cp|chmod|chown|symlink|link)\s*\(/;
    // `open(path, 'r')` is the only mode allowed; w/a/r+ would be a write handle, and a
    // handle or stream that is written to is just as much a write.
    const writeHandle = /\bopen\s*\([^)]*['"](?:w\+?|a\+?|r\+)['"]|\b(?:handle|file|stream|fd)\.write\s*\(/i;
    const offenders: string[] = [];
    for (const file of await sourceFiles(join(SRC, 'core'))) {
      const body = await code(file);
      if (write.test(body) || writeHandle.test(body)) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it('the renderer never touches node builtins or Electron directly', async () => {
    const rule = importsAny(`${NODE_BUILTINS}|${ELECTRON}`, { subpaths: true });
    const offenders: string[] = [];
    for (const file of await sourceFiles(join(SRC, 'renderer'))) {
      const body = await code(file);
      if (rule.test(body) || /\brequire\s*\(/.test(body) || /\bprocess\.(env|cwd)\b/.test(body)) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('nothing anywhere opens a network connection or a listening socket (N1)', async () => {
    const rule = importsAny(NETWORK_MODULES);
    const inlineNetwork = /\bnew\s+WebSocket\b|\bnew\s+EventSource\b|\bfetch\s*\(|\bXMLHttpRequest\b|sendBeacon\s*\(/;
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const body = await code(file);
      if (rule.test(body) || inlineNetwork.test(body)) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it('every renderer window is locked down (contextIsolation, no nodeIntegration)', async () => {
    // Comment-stripped: a rule that a comment can satisfy is not a rule.
    const body = await code(join(SRC, 'main', 'windows.ts'));
    expect(body).toMatch(/contextIsolation:\s*true/);
    expect(body).toMatch(/nodeIntegration:\s*false/);
    expect(body).toMatch(/webviewTag:\s*false/);
    // No second window may opt back in.
    expect(body).not.toMatch(/contextIsolation:\s*false/);
    expect(body).not.toMatch(/nodeIntegration:\s*true/);
    expect(body).not.toMatch(/webviewTag:\s*true/);
    // Exactly one place builds web preferences, so the assertions above cover every window.
    expect(body.match(/new BrowserWindow\(/g) ?? []).toHaveLength(
      (body.match(/webPreferences:\s*this\.webPreferences\(\)/g) ?? []).length,
    );
  });

  it('the preload exposes a fixed method list, not a channel passthrough', async () => {
    const body = await code(join(SRC, 'main', 'preload.ts'));
    expect(body).toMatch(/contextBridge\.exposeInMainWorld/);
    // Exposing the module itself would hand the renderer arbitrary channels.
    expect(body).not.toMatch(/exposeInMainWorld\([^,]+,\s*(ipcRenderer|require)/);
    // Every channel must be a constant from the IPC contract or a `cc:` literal. The one
    // allowed variable is the parameter of the file-local `subscribe` helper, which is not
    // part of the exposed object — asserted separately below.
    expect(body).not.toMatch(/ipcRenderer\.(?:invoke|send|on|off)\s*\(\s*(?!IPC\.|['"]cc:|channel\b)/);
    expect(body).not.toMatch(/^\s*subscribe:/m);
  });

  it('the ide lock parser reads only pid, workspaceFolders and ideName', async () => {
    const body = await code(join(SRC, 'core', 'adapters', 'claude', 'ide.ts'));
    // `authToken` must not appear in code at all — not read, not deleted, not logged.
    expect(body).not.toMatch(/authToken/);
    // And no spread of the parsed object, which would carry unknown fields through.
    expect(body).not.toMatch(/\.\.\.raw/);
  });
});
