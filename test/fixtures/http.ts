import { vi } from 'vitest';

/** Installs a global `fetch` answering via `handler`; pair with `vi.unstubAllGlobals()` in afterEach. */
export function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init));
  vi.stubGlobal('fetch', spy);
  return spy;
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}
