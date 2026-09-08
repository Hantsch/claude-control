/**
 * The architectural rules from §3, enforced rather than asserted in a comment:
 *
 *  - **`core/` never imports Electron.** This is what makes the state machine testable with
 *    plain Node and fixture files, and it is the rule that quietly rots first.
 *  - **The renderer never reaches the filesystem.** It receives finished view models over
 *    IPC; the preload is the entire surface.
 *  - **N1: no network.** No HTTP server, no client, no socket, anywhere.
 *  - **N2: nothing under `core/` opens a file for writing.**
 *
 * Story 005 renegotiated N1 and N2 for exactly ONE file — the opt-in model-window source —
 * and story 019 added a second, the opt-in update source. Both exceptions are single named
 * paths, not directories, and each is paid for by its own rule further down this file, which
 * pins what that one file may do.
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

/**
 * The two files allowlisted out of N1 (`fetch(`) and N2 (the cache write / the update
 * staging): story 005's model-window source and story 019's update source. Paths, not
 * prefixes — `core/context/` and `core/updates/` as a whole stay under both rules.
 */
const WINDOW_SOURCE = join('core', 'context', 'windowSource.ts');
const UPDATE_SOURCE = join('core', 'updates', 'updateSource.ts');
const NETWORK_FS_ALLOWLIST = [WINDOW_SOURCE, UPDATE_SOURCE];

/** N1's inline forms, split so the allowlist can forgive `fetch(` and nothing else. */
const INLINE_FETCH = /\bfetch\s*\(/;
const INLINE_OTHER_NETWORK = /\bnew\s+WebSocket\b|\bnew\s+EventSource\b|\bXMLHttpRequest\b|sendBeacon\s*\(/;

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
      // The allowlisted writers (005 D3, 019 D3) — each pinned by its own rule below.
      if (NETWORK_FS_ALLOWLIST.includes(relative(SRC, file))) continue;
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
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      const body = await code(file);
      // Only `fetch(`, and only in the two allowlisted files (005 D3, 019 D3); every other
      // inline form, and every network module import, still applies to them too.
      const inline =
        INLINE_OTHER_NETWORK.test(body) || (INLINE_FETCH.test(body) && !NETWORK_FS_ALLOWLIST.includes(rel));
      if (rule.test(body) || inline) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('the one allowlisted network+writing module stays inside its exception (005 D3)', async () => {
    const body = await code(join(SRC, WINDOW_SOURCE));

    // 1. The global `fetch` and nothing else: no network module in any import form, and
    //    exactly one call site, against the one URL the story named.
    expect(importsAny(NETWORK_MODULES).test(body)).toBe(false);
    expect(INLINE_FETCH.test(body)).toBe(true);
    expect(body.match(/\bfetch\s*\(/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/fetch\(MODEL_WINDOWS_URL,/);
    expect(body).toMatch(
      /MODEL_WINDOWS_URL =\s*'https:\/\/raw\.githubusercontent\.com\/BerriAI\/litellm\/main\/model_prices_and_context_window\.json'/,
    );
    // And it cannot hang: the request is bounded by an abort.
    expect(body).toMatch(/new AbortController\(\)/);
    expect(body).toMatch(/signal: controller\.signal/);

    // 2. It writes exactly one path, and that path is rooted in the caller-supplied data
    //    dir. No Claude-Code-owned location is even nameable here — read-only stays absolute.
    expect(body).not.toMatch(/claudeDir|claudeHome|claudeRoot|\.claude\b/i);
    expect(body).toMatch(/this\.file = join\(dataDir, MODEL_WINDOWS_FILE\)/);
    expect(body.match(/writeFileSync\s*\(/g) ?? []).toHaveLength(1);
    expect(body.match(/renameSync\s*\(/g) ?? []).toHaveLength(1);
    expect(body.match(/mkdirSync\s*\(/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/writeFileSync\(temp,/);
    expect(body).toMatch(/renameSync\(temp, this\.file\)/);
    expect(body).toMatch(/mkdirSync\(dirname\(this\.file\)/);
    // No other filesystem verb: no delete, no chmod, no second file.
    expect(body).not.toMatch(/\b(rm|rmdir|unlink|chmod|chown|symlink|copyFile|appendFileSync|createWriteStream)\s*\(/);
  });

  it('the second allowlisted network+writing module stays inside its exception (019 D3)', async () => {
    const body = await code(join(SRC, UPDATE_SOURCE));

    // 1. The global `fetch` and nothing else: no network module in any import form, and a
    //    single bounded call site all three requests (API, sums, exe) go through.
    expect(importsAny(NETWORK_MODULES).test(body)).toBe(false);
    expect(body.match(/\bfetch\s*\(/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/fetch\(url, \{/);
    expect(body).toMatch(/new AbortController\(\)/);
    expect(body).toMatch(/signal: controller\.signal/);
    // Against the one endpoint the story named, and only it.
    expect(body).toMatch(
      /RELEASES_LATEST_URL =\s*'https:\/\/api\.github\.com\/repos\/Hantsch\/claude-control\/releases\/latest'/,
    );
    expect(body.match(/https?:\/\//g) ?? []).toHaveLength(1);

    // 2. Every path it writes or deletes is rooted in `<dataDir>/updates/`, whose name comes
    //    from the caller. No Claude-Code-owned location is nameable — read-only stays absolute.
    expect(body).not.toMatch(/claudeDir|claudeHome|claudeRoot|\.claude\b/i);
    expect(body).toMatch(/this\.dir = join\(dataDir, UPDATES_DIR\)/);
    for (const field of ['exeFile', 'manifestFile', 'tmpFile', 'checkFile']) {
      expect(body).toMatch(new RegExp(`this\\.${field} = join\\(this\\.dir, [A-Z_]+\\)`));
    }
    const targets = [...body.matchAll(/\b(?:writeFileSync|renameSync|mkdirSync|unlinkSync)\s*\(\s*([^,)]+)/g)].map(
      (match) => match[1]?.trim(),
    );
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((target) => !/^(?:this\.\w+|temp|file)$/.test(target ?? ''))).toEqual([]);

    // 3. Deleting goes through one helper, and only ever with one of this class's own paths —
    //    no name from the network can become something this module removes.
    expect(body.match(/\bunlinkSync\s*\(/g) ?? []).toHaveLength(1);
    const discarded = [...body.matchAll(/this\.discard\(\s*([^)]+?)\s*\)/g)].map((match) => match[1]);
    expect(discarded.length).toBeGreaterThan(0);
    expect(discarded.filter((arg) => !/^(?:this\.\w+|`\$\{this\.\w+\}\.tmp`)$/.test(arg ?? ''))).toEqual([]);
    // The staged file's name is a constant, never taken from the release payload.
    expect(body).toMatch(/STAGED_EXE_FILE = 'staged\.exe'/);

    // 4. The verify/stage boundary: the download is hashed and compared before anything is
    //    written, and exactly one call site moves a file into the staged exe's path.
    expect(body).toMatch(/createHash\('sha256'\)/);
    expect(body).toMatch(/if \(actual !== expected\)/);
    expect(body.match(/renameSync\(this\.tmpFile, this\.exeFile\)/g) ?? []).toHaveLength(1);
    // No other filesystem verb: no directory walk, no chmod, no copy, no recursive remove.
    expect(body).not.toMatch(/\b(rm|rmdir|readdir|readdirSync|chmod|chown|symlink|copyFile|createWriteStream)\s*\(/);
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
