/**
 * The opt-in update source (story 019, D3): the app's second outbound request, the
 * download/verify/stage boundary that an unsigned EXE hangs on, and the day-cadence policy.
 * `fetch` is stubbed, the clock is injected and staging happens in a temp dir — nothing here
 * touches the real network or the real user data dir.
 *
 * The AC-named cases below are the acceptance tests the story lists for AC1/2/5/6/8.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECK_BACKOFF_MS,
  DOWNLOAD_TMP_FILE,
  RELEASES_LATEST_URL,
  STAGED_EXE_FILE,
  STAGED_MANIFEST_FILE,
  STAGE_VERSION,
  UPDATES_DIR,
  UpdateSource,
} from '../../src/core/updates/updateSource.ts';

const EXE_NAME = 'ClaudeControl-1.3.0-portable.exe';
const DOWNLOAD_BASE = 'https://github.com/Hantsch/claude-control/releases/download/v1.3.0';
const EXE_URL = `${DOWNLOAD_BASE}/${EXE_NAME}`;
const SUMS_URL = `${DOWNLOAD_BASE}/SHA256SUMS.txt`;

const EXE_BYTES = Buffer.from('pretend this is a portable exe');
const EXE_SHA = createHash('sha256').update(EXE_BYTES).digest('hex');
/** The exact producing format from `ci-release.ps1:133`. */
const SUMS_BODY = `${EXE_SHA} *${EXE_NAME}\n`;

const RELEASE = {
  tag_name: 'v1.3.0',
  assets: [
    { name: EXE_NAME, browser_download_url: EXE_URL },
    { name: 'SHA256SUMS.txt', browser_download_url: SUMS_URL },
  ],
};

const START = Date.UTC(2026, 8, 8, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

let dir: string;
let clock: number;
const originalFetch = globalThis.fetch;

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => handler(String(url)));
  globalThis.fetch = spy as unknown as typeof globalThis.fetch;
  return spy;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

/** A stub serving a complete, consistent v1.3.0 release; each part is individually overridable. */
function stubRelease(overrides: { release?: unknown; sums?: string; exe?: Buffer } = {}) {
  return stubFetch((url) => {
    if (url === RELEASES_LATEST_URL) return jsonResponse(overrides.release ?? RELEASE);
    if (url === SUMS_URL) return new Response(overrides.sums ?? SUMS_BODY, { status: 200 });
    if (url === EXE_URL) return new Response(overrides.exe ?? EXE_BYTES, { status: 200 });
    return new Response('not found', { status: 404 });
  });
}

/** The same release, with the exe (or the sums file) published under a different URL. */
function releaseWithAssetUrls(exeUrl: string, sumsUrl = SUMS_URL) {
  return {
    tag_name: 'v1.3.0',
    assets: [
      { name: EXE_NAME, browser_download_url: exeUrl },
      { name: 'SHA256SUMS.txt', browser_download_url: sumsUrl },
    ],
  };
}

function source(options: { enabled?: boolean; currentVersion?: string; dataDir?: string } = {}) {
  return new UpdateSource(options.dataDir ?? dir, {
    enabled: options.enabled ?? true,
    currentVersion: options.currentVersion ?? '1.0.0',
    now: () => clock,
  });
}

function stagePath(name: string, base = dir): string {
  return join(base, UPDATES_DIR, name);
}

/** A previously staged, verified v1.1.0 — the state AC2 says a bad download must not disturb. */
async function writePriorStage(): Promise<{ bytes: Buffer; manifest: string }> {
  const bytes = Buffer.from('the previously verified stage');
  const manifest = `${JSON.stringify(
    {
      version: STAGE_VERSION,
      releaseVersion: 'v1.1.0',
      assetName: 'ClaudeControl-1.1.0-portable.exe',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      stagedAt: START - DAY_MS,
    },
    null,
    2,
  )}\n`;
  await mkdir(join(dir, UPDATES_DIR), { recursive: true });
  await writeFile(stagePath(STAGED_EXE_FILE), bytes);
  await writeFile(stagePath(STAGED_MANIFEST_FILE), manifest, 'utf8');
  return { bytes, manifest };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cc-update-source-'));
  clock = START;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe('UpdateSource — checking and staging', () => {
  it('a newer release is downloaded, verified, and staged without any caller action', async () => {
    const spy = stubRelease();
    const src = source({ currentVersion: '1.0.0' });

    const status = await src.refresh();

    // The release API, the sums file and the exe — in that order, nothing else.
    expect(spy.mock.calls.map((call) => String(call[0]))).toEqual([RELEASES_LATEST_URL, SUMS_URL, EXE_URL]);
    expect(status.lastOutcome).toBe('ok');
    expect(status.lastError).toBeUndefined();
    expect(status.currentVersion).toBe('1.0.0');
    expect(status.latestVersion).toBe('v1.3.0');
    expect(status.updateAvailable).toBe(true);
    expect(status.checkedAt).toBe(START);

    expect(status.staged).not.toBeNull();
    expect(status.staged?.releaseVersion).toBe('v1.3.0');
    expect(status.staged?.assetName).toBe(EXE_NAME);
    expect(status.staged?.sha256).toBe(EXE_SHA);
    expect(status.staged?.stagedAt).toBe(START);
    expect(status.staged?.file).toBe(stagePath(STAGED_EXE_FILE));

    // The staged bytes are byte-for-byte what was served, and no partial download is left.
    expect(readFileSync(stagePath(STAGED_EXE_FILE))).toEqual(EXE_BYTES);
    expect(existsSync(stagePath(DOWNLOAD_TMP_FILE))).toBe(false);
    // Everything this module touched stays inside `<dataDir>/updates/`.
    expect(await readdir(dir)).toEqual([UPDATES_DIR]);
    // And `stagedUpdate()` — D4's entry point — agrees with `status()`.
    expect(src.stagedUpdate()).toEqual(status.staged);
  });

  it('a checksum mismatch discards the download and leaves the previous stage/installed app untouched', async () => {
    const prior = await writePriorStage();
    // A well-formed sums file that simply does not describe these bytes: the tampered case.
    const spy = stubRelease({ sums: `${'0'.repeat(64)} *${EXE_NAME}\n` });
    const src = source({ currentVersion: '1.0.0' });

    const before = src.status();
    expect(before.staged?.releaseVersion).toBe('v1.1.0');

    const status = await src.refresh();

    expect(spy).toHaveBeenCalledTimes(3);
    expect(status.lastOutcome).toBe('failed');
    expect(status.lastError).toContain('checksum mismatch');

    // The previous stage is bit-for-bit what it was — file and manifest alike.
    expect(status.staged).toEqual(before.staged);
    expect(status.staged?.releaseVersion).toBe('v1.1.0');
    expect(readFileSync(stagePath(STAGED_EXE_FILE))).toEqual(prior.bytes);
    expect(readFileSync(stagePath(STAGED_MANIFEST_FILE), 'utf8')).toBe(prior.manifest);

    // The rejected bytes reached no path at all: no partial, no orphan, nothing outside the dir.
    expect(existsSync(stagePath(DOWNLOAD_TMP_FILE))).toBe(false);
    expect((await readdir(join(dir, UPDATES_DIR))).sort()).toEqual(
      ['check.json', STAGED_EXE_FILE, STAGED_MANIFEST_FILE].sort(),
    );
    expect(await readdir(dir)).toEqual([UPDATES_DIR]);

    // And a fresh process reading that disk still sees only the old, verified stage.
    expect(source().status().staged?.releaseVersion).toBe('v1.1.0');
  });

  it('already on the latest version makes no download and changes no state', async () => {
    const spy = stubRelease();
    const src = source({ currentVersion: '1.3.0' });

    const status = await src.refresh();

    // The check happens — and stops there: only the release API was asked.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toBe(RELEASES_LATEST_URL);
    expect(status.lastOutcome).toBe('ok');
    expect(status.latestVersion).toBe('v1.3.0');
    expect(status.updateAvailable).toBe(false);
    expect(status.staged).toBeNull();
    expect(existsSync(stagePath(STAGED_EXE_FILE))).toBe(false);
    expect(existsSync(stagePath(STAGED_MANIFEST_FILE))).toBe(false);
    expect(existsSync(stagePath(DOWNLOAD_TMP_FILE))).toBe(false);
  });

  it('never proposes a downgrade, even from a local build newer than the latest release', async () => {
    const spy = stubRelease();
    const status = await source({ currentVersion: '2.0.0' }).refresh();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(status.lastOutcome).toBe('ok');
    expect(status.updateAvailable).toBe(false);
    expect(status.staged).toBeNull();
  });

  it('makes no request while disabled', async () => {
    const spy = stubRelease();
    const src = source({ enabled: false, currentVersion: '1.0.0' });

    const status = await src.refresh({ force: true });

    expect(spy).not.toHaveBeenCalled();
    expect(status.enabled).toBe(false);
    expect(status.lastOutcome).toBe('never');
    expect(status.latestVersion).toBeNull();
    expect(status.updateAvailable).toBe(false);
    expect(status.staged).toBeNull();
    // Not even a directory: a disabled update source leaves no trace on disk.
    expect(existsSync(join(dir, UPDATES_DIR))).toBe(false);
  });

  it('does not download a release it has already staged', async () => {
    const spy = stubRelease();
    const src = source({ currentVersion: '1.0.0' });
    await src.refresh();
    expect(spy).toHaveBeenCalledTimes(3);

    clock += DAY_MS;
    const status = await src.refresh();

    // Day two re-checks, finds the same release already on disk and downloads nothing.
    expect(spy).toHaveBeenCalledTimes(4);
    expect(status.lastOutcome).toBe('ok');
    expect(status.staged?.stagedAt).toBe(START);
  });

  it('accepts an asset published on GitHub’s release CDN', async () => {
    // `browser_download_url` legitimately points at either host, so the allowlist below must
    // not be narrower than GitHub actually is.
    const cdnUrl = `https://release-assets.githubusercontent.com/github-production-release-asset/1/${EXE_NAME}`;
    const spy = stubFetch((url) => {
      if (url === RELEASES_LATEST_URL) return jsonResponse(releaseWithAssetUrls(cdnUrl));
      if (url === SUMS_URL) return new Response(SUMS_BODY, { status: 200 });
      if (url === cdnUrl) return new Response(EXE_BYTES, { status: 200 });
      return new Response('not found', { status: 404 });
    });

    const status = await source({ currentVersion: '1.0.0' }).refresh();

    expect(spy.mock.calls.map((call) => String(call[0]))).toEqual([RELEASES_LATEST_URL, SUMS_URL, cdnUrl]);
    expect(status.lastOutcome).toBe('ok');
    expect(status.staged?.releaseVersion).toBe('v1.3.0');
    expect(readFileSync(stagePath(STAGED_EXE_FILE))).toEqual(EXE_BYTES);
  });

  // The asset URLs are strings out of a JSON payload: `api.github.com`'s certificate says
  // nothing about where they point. Each of these is fetched by nobody.
  it.each([
    ['plain http', `http://github.com/Hantsch/claude-control/releases/download/v1.3.0/${EXE_NAME}`],
    ['a look-alike host', `https://github.com.evil.example/releases/download/v1.3.0/${EXE_NAME}`],
    ['a host smuggled past userinfo', `https://github.com@evil.example/${EXE_NAME}`],
    ['an unrelated host', `https://evil.example/${EXE_NAME}`],
    ['a non-URL', 'javascript:alert(1)'],
  ])('refuses an exe asset URL using %s, without requesting it', async (_name, exeUrl) => {
    const spy = stubFetch((url) => {
      if (url === RELEASES_LATEST_URL) return jsonResponse(releaseWithAssetUrls(exeUrl));
      if (url === SUMS_URL) return new Response(SUMS_BODY, { status: 200 });
      return new Response(EXE_BYTES, { status: 200 });
    });

    const status = await source({ currentVersion: '1.0.0' }).refresh();

    // The release API and nothing else: the check stops before either asset is requested.
    expect(spy.mock.calls.map((call) => String(call[0]))).toEqual([RELEASES_LATEST_URL]);
    expect(status.lastOutcome).toBe('failed');
    expect(status.lastError).toContain('outside GitHub');
    expect(status.staged).toBeNull();
    expect(existsSync(stagePath(STAGED_EXE_FILE))).toBe(false);
  });

  it('refuses a sums file URL outside GitHub too, without requesting it', async () => {
    const spy = stubFetch((url) =>
      url === RELEASES_LATEST_URL
        ? jsonResponse(releaseWithAssetUrls(EXE_URL, 'https://evil.example/SHA256SUMS.txt'))
        : new Response(SUMS_BODY, { status: 200 }),
    );

    const status = await source({ currentVersion: '1.0.0' }).refresh();

    expect(spy.mock.calls.map((call) => String(call[0]))).toEqual([RELEASES_LATEST_URL]);
    expect(status.lastOutcome).toBe('failed');
    expect(status.lastError).toContain('outside GitHub');
    expect(status.staged).toBeNull();
  });

  it('stops reading a body that outgrows the size limit, content-length or not', async () => {
    // A `content-length` nobody sent read as `Number('') === 0` and sailed straight past the
    // pre-check, so an unmeasured body was pulled into memory whole before anything noticed.
    // The cap is enforced *while* reading now: this stream is never asked for the rest of its
    // chunks. It stands in for the exe download, which goes through the same read.
    const chunk = new Uint8Array(1024 * 1024);
    let served = 0;
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) {
        served += 1;
        if (served > 64) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const spy = stubFetch((url) => {
      if (url === RELEASES_LATEST_URL) return jsonResponse(RELEASE);
      if (url === SUMS_URL) return new Response(oversized, { status: 200 });
      return new Response('not found', { status: 404 });
    });

    const status = await source({ currentVersion: '1.0.0' }).refresh();

    expect(status.lastOutcome).toBe('failed');
    expect(status.lastError).toContain('size limit');
    expect(served).toBeLessThan(64);
    // Cut off there: the exe was never requested and nothing reached the disk.
    expect(spy.mock.calls.map((call) => String(call[0]))).toEqual([RELEASES_LATEST_URL, SUMS_URL]);
    expect(status.staged).toBeNull();
    expect(existsSync(stagePath(STAGED_EXE_FILE))).toBe(false);
  });
});

describe('UpdateSource — day cadence and backoff', () => {
  it('performs one real check per calendar day, later starts included', async () => {
    const spy = stubRelease({ release: { tag_name: 'v1.0.0', assets: [] } });
    const src = source({ currentVersion: '1.0.0' });

    await src.refresh();
    expect(spy).toHaveBeenCalledTimes(1);

    // Same day, same process — and same day, a fresh process reading the persisted result.
    clock += 6 * 60 * 60 * 1000;
    await src.refresh();
    await source({ currentVersion: '1.0.0' }).refresh();
    expect(spy).toHaveBeenCalledTimes(1);

    // Next day: one more.
    clock = START + DAY_MS;
    await source({ currentVersion: '1.0.0' }).refresh();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // The IPC handler behind the Settings "Check now" button (story 019, D5) always calls
  // `refresh({ force: true })` — this is what makes that button do something even right
  // after a same-day check already succeeded, rather than silently no-opping like a plain
  // background `refresh()` would.
  it('force re-checks the same day even after an earlier check already succeeded', async () => {
    const spy = stubRelease({ release: { tag_name: 'v1.0.0', assets: [] } });
    const src = source({ currentVersion: '1.0.0' });

    await src.refresh();
    expect(spy).toHaveBeenCalledTimes(1);

    clock += 60 * 1000;
    const status = await src.refresh({ force: true });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(status.lastOutcome).toBe('ok');
    expect(status.checkedAt).toBe(clock);
  });

  it('backs off briefly after a failure instead of hammering the API, and force ignores it', async () => {
    const spy = stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    const src = source({ currentVersion: '1.0.0' });

    await src.refresh();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(src.status().lastOutcome).toBe('failed');

    // Inside the backoff nothing is retried — including by a fresh process on the same day.
    clock += CHECK_BACKOFF_MS - 1;
    await src.refresh();
    await source({ currentVersion: '1.0.0' }).refresh();
    expect(spy).toHaveBeenCalledTimes(1);

    // The Settings button can always try again.
    await src.refresh({ force: true });
    expect(spy).toHaveBeenCalledTimes(2);

    // And once the (brief, not day-long) backoff is over, the background check retries.
    clock += CHECK_BACKOFF_MS + 1;
    await src.refresh();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('joins a concurrent refresh instead of firing a second check', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = stubFetch(async (url) => {
      await gate;
      return url === RELEASES_LATEST_URL
        ? jsonResponse({ tag_name: 'v1.0.0', assets: [] })
        : new Response('no', { status: 404 });
    });
    const src = source({ currentVersion: '1.0.0' });

    const both = Promise.all([src.refresh({ force: true }), src.refresh({ force: true })]);
    release?.();
    const [a, b] = await both;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(a.lastOutcome).toBe('ok');
    expect(b.lastOutcome).toBe('ok');
  });
});

describe('UpdateSource — leftovers from a crashed attempt', () => {
  it('discards an abandoned partial download on construct', async () => {
    await mkdir(join(dir, UPDATES_DIR), { recursive: true });
    await writeFile(stagePath(DOWNLOAD_TMP_FILE), 'half an exe', 'utf8');
    await writeFile(stagePath(`${STAGED_MANIFEST_FILE}.tmp`), '{ half', 'utf8');

    const src = source();

    expect(existsSync(stagePath(DOWNLOAD_TMP_FILE))).toBe(false);
    expect(existsSync(stagePath(`${STAGED_MANIFEST_FILE}.tmp`))).toBe(false);
    expect(src.status().staged).toBeNull();
  });

  it('treats a half-written stage as no stage at all, in either direction', async () => {
    // An exe with no manifest can never be verified, so it is not a stage — and is dropped.
    await mkdir(join(dir, UPDATES_DIR), { recursive: true });
    await writeFile(stagePath(STAGED_EXE_FILE), EXE_BYTES);
    expect(source().status().staged).toBeNull();
    expect(existsSync(stagePath(STAGED_EXE_FILE))).toBe(false);

    // A manifest with no exe describes nothing, so it goes too.
    await writeFile(stagePath(STAGED_MANIFEST_FILE), JSON.stringify({ version: STAGE_VERSION }), 'utf8');
    expect(source().status().staged).toBeNull();
    expect(existsSync(stagePath(STAGED_MANIFEST_FILE))).toBe(false);

    // As does a manifest whose hash is not a hash.
    await writeFile(stagePath(STAGED_EXE_FILE), EXE_BYTES);
    await writeFile(
      stagePath(STAGED_MANIFEST_FILE),
      JSON.stringify({
        version: STAGE_VERSION,
        releaseVersion: 'v9.9.9',
        assetName: 'x.exe',
        sha256: 'not-a-hash',
        stagedAt: START,
      }),
      'utf8',
    );
    expect(source().status().staged).toBeNull();
  });
});

describe('UpdateSource — every network/checksum/disk failure path never throws', () => {
  /** Each case names how it breaks and how the stub should behave; none may throw out. */
  const cases: {
    name: string;
    error: string;
    stub: () => ReturnType<typeof stubFetch>;
    /** Prepares the case's own data dir, e.g. by making the staging path unwritable. */
    prepare?: (caseDir: string) => Promise<void>;
  }[] = [
    {
      name: 'HTTP error from the release API',
      error: '500',
      stub: () => stubFetch(() => new Response('nope', { status: 500, statusText: 'Server Error' })),
    },
    {
      name: 'GitHub rate limiting',
      error: '403',
      stub: () => stubFetch(() => new Response('rate limited', { status: 403, statusText: 'Forbidden' })),
    },
    {
      name: 'too many requests',
      error: '429',
      stub: () => stubFetch(() => new Response('slow down', { status: 429 })),
    },
    {
      name: 'malformed JSON body',
      error: '',
      stub: () => stubFetch(() => new Response('{ not json', { status: 200 })),
    },
    {
      name: 'a payload with no tag',
      error: 'tag_name',
      stub: () => stubFetch(() => jsonResponse({ assets: [] })),
    },
    {
      name: 'a release with no portable exe asset',
      error: 'portable exe asset',
      stub: () =>
        stubRelease({
          release: { tag_name: 'v1.3.0', assets: [{ name: 'SHA256SUMS.txt', browser_download_url: SUMS_URL }] },
        }),
    },
    {
      name: 'a release with no SHA256SUMS.txt asset',
      error: 'SHA256SUMS.txt asset',
      stub: () =>
        stubRelease({ release: { tag_name: 'v1.3.0', assets: [{ name: EXE_NAME, browser_download_url: EXE_URL }] } }),
    },
    {
      name: 'a sums file that does not list the exe',
      error: 'no hash for',
      stub: () => stubRelease({ sums: `${EXE_SHA} *SomethingElse.exe\n` }),
    },
    {
      name: 'an unparseable sums file',
      error: 'no hash for',
      stub: () => stubRelease({ sums: '<html>404</html>' }),
    },
    {
      name: 'a checksum mismatch',
      error: 'checksum mismatch',
      stub: () => stubRelease({ exe: Buffer.from('a tampered binary') }),
    },
    {
      name: 'an empty download',
      error: 'empty',
      stub: () => stubRelease({ exe: Buffer.alloc(0) }),
    },
    {
      name: 'the network being offline',
      error: 'fetch failed',
      stub: () => stubFetch(() => Promise.reject(new TypeError('fetch failed'))),
    },
    {
      name: 'an aborted request',
      error: 'timed out',
      stub: () =>
        stubFetch(() => {
          const aborted = new Error('The operation was aborted');
          aborted.name = 'AbortError';
          return Promise.reject(aborted);
        }),
    },
    {
      name: 'an unwritable staging path',
      error: '',
      stub: () => stubRelease(),
      // A plain file where the updates directory belongs: staging cannot create it.
      prepare: async (caseDir) => {
        await writeFile(join(caseDir, UPDATES_DIR), 'not a directory', 'utf8');
      },
    },
  ];

  it.each(cases)('$name lands in lastOutcome failed without throwing', async ({ error, stub, prepare }) => {
    const caseDir = join(dir, 'case');
    await mkdir(caseDir, { recursive: true });
    await prepare?.(caseDir);
    const spy = stub();

    // Construction and refresh both have to survive it; neither may reject.
    const src = source({ dataDir: caseDir, currentVersion: '1.0.0' });
    const status = await src.refresh();

    expect(spy).toHaveBeenCalled();
    expect(status.lastOutcome).toBe('failed');
    expect(status.lastError).toBeTruthy();
    if (error) expect(status.lastError).toContain(error);
    expect(status.checkedAt).toBe(START);
    // Nothing was staged, and no unverified leftovers were kept.
    expect(status.staged).toBeNull();
    expect(existsSync(join(caseDir, UPDATES_DIR, STAGED_EXE_FILE))).toBe(false);
    expect(existsSync(join(caseDir, UPDATES_DIR, DOWNLOAD_TMP_FILE))).toBe(false);
    // And the status call itself is safe to make again.
    expect(() => src.status()).not.toThrow();
  });
});
