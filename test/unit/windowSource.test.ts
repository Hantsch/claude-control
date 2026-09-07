/**
 * The opt-in window source (story 005, D3): the app's only outbound request, its cache file
 * and the three time policies that keep a failing network from costing one request per tick.
 * `fetch` is stubbed and the clock is injected — nothing here touches the real network.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_WINDOWS_CACHE_VERSION,
  MODEL_WINDOWS_FILE,
  MODEL_WINDOWS_URL,
  REFRESH_BACKOFF_MS,
  REFRESH_CADENCE_MS,
  REFRESH_CEILING_MS,
  WindowSource,
  type ModelWindowCache,
} from '../../src/core/context/windowSource.ts';

const PAYLOAD = {
  'anthropic/claude-opus-5': { max_input_tokens: 200_000, input_cost_per_token: 0.000015 },
  'anthropic/claude-opus-5[1m]': { max_input_tokens: 1_000_000 },
  'no-window-here': { max_output_tokens: 4096 },
};

const START = Date.UTC(2026, 7, 22, 12, 0, 0);

let dir: string;
let clock: number;
const originalFetch = globalThis.fetch;

/** A stub that answers the litellm URL with `payload`; returns the spy for call assertions. */
function stubFetch(response: () => Response | Promise<Response>) {
  const spy = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response());
  globalThis.fetch = spy as unknown as typeof globalThis.fetch;
  return spy;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function source(options: { enabled?: boolean } = {}) {
  return new WindowSource(dir, { enabled: options.enabled ?? true, now: () => clock });
}

async function writeCache(cache: Partial<ModelWindowCache>): Promise<void> {
  await writeFile(join(dir, MODEL_WINDOWS_FILE), JSON.stringify(cache, null, 2), 'utf8');
}

function readCache(): ModelWindowCache {
  return JSON.parse(readFileSync(join(dir, MODEL_WINDOWS_FILE), 'utf8')) as ModelWindowCache;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cc-window-source-'));
  clock = START;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe('WindowSource — cold fetch', () => {
  it('fetches, keeps only the windows and writes the cache atomically', async () => {
    const spy = stubFetch(() => jsonResponse(PAYLOAD));
    const src = source();

    const status = await src.refresh();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(MODEL_WINDOWS_URL);
    expect(status.lastOutcome).toBe('ok');
    expect(status.entryCount).toBe(2);
    expect(status.fetchedAt).toBe(START);
    expect(status.ageMs).toBe(0);
    expect(status.stale).toBe(false);
    expect(status.lastError).toBeUndefined();

    const cache = readCache();
    expect(cache.version).toBe(MODEL_WINDOWS_CACHE_VERSION);
    expect(cache.source).toBe(MODEL_WINDOWS_URL);
    expect(cache.fetchedAt).toBe(START);
    expect(cache.windows).toEqual({ 'anthropic/claude-opus-5': 200_000, 'anthropic/claude-opus-5[1m]': 1_000_000 });
    // Temp file from the temp+rename write is gone.
    expect(existsSync(`${src.path}.tmp`)).toBe(false);

    expect(src.lookupWindow('claude-opus-5[1m]')).toBe(1_000_000);
  });

  it('passes an abort signal so a dead connection cannot hang the caller', async () => {
    const spy = stubFetch(() => jsonResponse(PAYLOAD));
    const src = source();
    await src.refresh();
    expect(spy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('makes no request at all while the setting is off', async () => {
    const spy = stubFetch(() => jsonResponse(PAYLOAD));
    const src = source({ enabled: false });

    const status = await src.refresh({ force: true });

    expect(spy).not.toHaveBeenCalled();
    expect(status.enabled).toBe(false);
    expect(status.lastOutcome).toBe('never');
    expect(existsSync(src.path)).toBe(false);
  });
});

describe('WindowSource — cache and policy', () => {
  it('serves a cache inside the ceiling without fetching', async () => {
    const fetchedAt = START - 24 * 60 * 60 * 1000;
    await writeCache({
      version: MODEL_WINDOWS_CACHE_VERSION,
      fetchedAt,
      source: MODEL_WINDOWS_URL,
      windows: { 'anthropic/claude-opus-5': 200_000 },
    });
    const spy = stubFetch(() => jsonResponse(PAYLOAD));
    const src = source();

    const status = await src.refresh();

    expect(spy).not.toHaveBeenCalled();
    expect(status.lastOutcome).toBe('never');
    expect(status.entryCount).toBe(1);
    expect(status.fetchedAt).toBe(fetchedAt);
    expect(status.ageMs).toBe(24 * 60 * 60 * 1000);
    expect(status.stale).toBe(false);
    expect(src.lookupWindow('claude-opus-5')).toBe(200_000);
  });

  it('force fetches even when nothing is due', async () => {
    await writeCache({
      version: MODEL_WINDOWS_CACHE_VERSION,
      fetchedAt: START - 1000,
      source: MODEL_WINDOWS_URL,
      windows: { 'anthropic/claude-opus-5': 200_000 },
    });
    const spy = stubFetch(() => jsonResponse(PAYLOAD));
    const src = source();

    const status = await src.refresh({ force: true });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(status.lastOutcome).toBe('ok');
    expect(status.fetchedAt).toBe(START);
    expect(status.entryCount).toBe(2);
  });

  it('refreshes a cache past the 7-day ceiling, but keeps using it until then', async () => {
    const fetchedAt = START - REFRESH_CEILING_MS - 1;
    await writeCache({
      version: MODEL_WINDOWS_CACHE_VERSION,
      fetchedAt,
      source: MODEL_WINDOWS_URL,
      windows: { 'anthropic/claude-opus-5': 111 },
    });
    const src = source();

    // Stale is still served — a window does not rot the way a price does.
    expect(src.status().stale).toBe(true);
    expect(src.lookupWindow('claude-opus-5')).toBe(111);

    const spy = stubFetch(() => jsonResponse(PAYLOAD));
    const status = await src.refresh();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(status.stale).toBe(false);
    expect(status.fetchedAt).toBe(START);
  });

  it('does not evaluate the due-check more often than every 6 h, even once the backoff is over', async () => {
    await writeCache({
      version: MODEL_WINDOWS_CACHE_VERSION,
      fetchedAt: START - REFRESH_CEILING_MS - 1,
      source: MODEL_WINDOWS_URL,
      windows: { 'anthropic/claude-opus-5': 200_000 },
    });
    const spy = stubFetch(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')));
    const src = source();

    await src.refresh(); // due (past the ceiling): one attempt, which fails
    expect(spy).toHaveBeenCalledTimes(1);

    clock += REFRESH_BACKOFF_MS + 1; // backoff over, cadence not: still no second check
    await src.refresh();
    await src.refresh();
    expect(spy).toHaveBeenCalledTimes(1);

    clock = START + REFRESH_CADENCE_MS + 1; // cadence over, and still past the ceiling
    await src.refresh();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed fetch for an hour, but a forced refresh ignores the backoff', async () => {
    const spy = stubFetch(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')));
    const src = source();

    // Forced (the Settings toggle) — fails, and must not consume the background cadence.
    await src.refresh({ force: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(src.status().lastOutcome).toBe('failed');

    // A background tick inside the hour is refused by the backoff, not by the cadence.
    clock += REFRESH_BACKOFF_MS - 1;
    await src.refresh();
    expect(spy).toHaveBeenCalledTimes(1);

    // The toggle can always try again, backoff or not.
    await src.refresh({ force: true });
    expect(spy).toHaveBeenCalledTimes(2);

    // And once both the hour and the 6 h cadence are up, the background check tries again.
    clock = START + REFRESH_CADENCE_MS + REFRESH_BACKOFF_MS;
    await src.refresh();
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe('WindowSource — failure paths never throw', () => {
  it('reports an HTTP error without throwing and writes no cache', async () => {
    const spy = stubFetch(() => new Response('nope', { status: 500, statusText: 'Server Error' }));
    const src = source();

    const status = await src.refresh();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(status.lastOutcome).toBe('failed');
    expect(status.lastError).toContain('500');
    expect(status.entryCount).toBe(0);
    expect(status.fetchedAt).toBeNull();
    expect(status.lastAttemptAt).toBe(START);
    expect(existsSync(src.path)).toBe(false);
    expect(src.lookupWindow('claude-opus-5')).toBeNull();
  });

  it('reports an offline fetch rejection and keeps the previous cache', async () => {
    await writeCache({
      version: MODEL_WINDOWS_CACHE_VERSION,
      fetchedAt: START - REFRESH_CEILING_MS - 1,
      source: MODEL_WINDOWS_URL,
      windows: { 'anthropic/claude-opus-5': 222 },
    });
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    const src = source();

    const status = await src.refresh();

    expect(status.lastOutcome).toBe('failed');
    expect(status.lastError).toContain('fetch failed');
    // The stale table survived the failed refresh and is still usable.
    expect(status.entryCount).toBe(1);
    expect(status.stale).toBe(true);
    expect(src.lookupWindow('claude-opus-5')).toBe(222);
  });

  it('treats a corrupt or foreign cache file as no cache', async () => {
    await writeFile(join(dir, MODEL_WINDOWS_FILE), '{ not json', 'utf8');
    expect(source().status().entryCount).toBe(0);

    await writeCache({ version: 99, fetchedAt: START, source: MODEL_WINDOWS_URL, windows: { a: 1 } });
    expect(source().status().entryCount).toBe(0);

    await writeCache({ version: MODEL_WINDOWS_CACHE_VERSION, fetchedAt: START, source: '', windows: {} });
    expect(source().status().entryCount).toBe(0);
  });

  it('rejects a payload with no usable windows rather than caching an empty table', async () => {
    stubFetch(() => jsonResponse({ 'no-window-here': { max_output_tokens: 4096 } }));
    const src = source();

    const status = await src.refresh();

    expect(status.lastOutcome).toBe('failed');
    expect(status.entryCount).toBe(0);
    expect(existsSync(src.path)).toBe(false);
  });

  it('joins a concurrent refresh instead of firing a second request', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = stubFetch(async () => {
      await gate;
      return jsonResponse(PAYLOAD);
    });
    const src = source();

    const both = Promise.all([src.refresh({ force: true }), src.refresh({ force: true })]);
    release?.();
    const [a, b] = await both;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(a.lastOutcome).toBe('ok');
    expect(b.lastOutcome).toBe('ok');
  });
});
