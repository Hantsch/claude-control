import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../src/shared/ipc.ts';

const h = vi.hoisted(() => ({
  handled: new Set<string>(),
  invoked: new Set<string>(),
  subscribed: new Set<string>(),
  exposed: { api: undefined as Record<string, unknown> | undefined },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string) => h.handled.add(channel) },
  ipcRenderer: {
    invoke: (channel: string) => {
      h.invoked.add(channel);
      return Promise.resolve();
    },
    on: (channel: string) => h.subscribed.add(channel),
    off: () => undefined,
  },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, unknown>) => {
      h.exposed.api = api;
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
  app: {},
  clipboard: {},
  shell: {},
}));

const dirPath = (rel: string): string =>
  new URL(rel, import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const read = (dir: string): string =>
  sourceFiles(dir)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

describe('ipc wiring', () => {
  it('every bridge method the renderer calls is exposed by the preload and handled in main', async () => {
    const rendererSource = read(dirPath('../../src/renderer'));
    const methods = [
      ...new Set([...rendererSource.matchAll(/\bapi\.(\w+)\s*\(/g)].map((m) => m[1]!)),
    ];
    expect(methods.length, 'renderer scan found too few bridge calls').toBeGreaterThanOrEqual(20);

    await import('../../src/main/preload.ts');
    const { registerIpc } = await import('../../src/main/ipc.ts');
    registerIpc({} as never);

    const api = h.exposed.api!;
    for (const method of methods) {
      expect(typeof api[method], `preload does not expose ${method}`).toBe('function');
      const fn = api[method] as (...args: unknown[]) => unknown;
      try {
        // A rejection or throw from one call must not hide the other methods' channels.
        const result = method.startsWith('on') ? fn(() => undefined) : fn();
        await Promise.resolve(result).catch(() => undefined);
      } catch {
        // ignored on purpose, see above
      }
    }

    expect([...h.invoked].filter((c) => !h.handled.has(c))).toEqual([]);
  });

  it('every channel the renderer subscribes to is sent by main', () => {
    const mainSource = read(dirPath('../../src/main'));
    const sent = new Set<string>();
    for (const m of mainSource.matchAll(/webContents\.send\(\s*'(cc:[^']+)'/g)) sent.add(m[1]!);
    for (const m of mainSource.matchAll(/\bbroadcast\(\s*IPC\.(\w+)/g)) {
      const channel = (IPC as Record<string, unknown>)[m[1]!];
      if (typeof channel === 'string') sent.add(channel);
    }

    expect(h.subscribed.size, 'no subscriptions recorded').toBeGreaterThan(0);
    expect([...h.subscribed].filter((c) => !sent.has(c))).toEqual([]);
  });
});
