/**
 * Applying a staged update at launch (story 019, D4) — the one place the app writes to the
 * user's own EXE, so every case below is about what is on disk afterwards.
 *
 * Electron is faked (`app.quit`/`app.relaunch` are spies that must stay untouched, `Notification`
 * records what it was asked to show) and the "install" is a temp dir: a fake portable exe plus
 * the `<userData>/updates/` stage `updateSource.ts` would have written. The real `node:fs` does
 * the work, wrapped where a test needs a specific step to fail.
 *
 * The AC-named cases below are the acceptance tests the story lists for AC3/AC4/AC6/AC10.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelfUpdateFs } from '../../src/main/selfUpdate.ts';

/** Never called by anything in this module — AC3 is exactly that claim. */
const quit = vi.fn();
const relaunch = vi.fn();
/** Every toast the module asked Electron to show. */
const shown: { title: string; body: string }[] = [];

vi.mock('electron', () => ({
  app: { quit, relaunch, isPackaged: true },
  Notification: class {
    static isSupported(): boolean {
      return true;
    }
    private readonly options: { title?: string; body?: string };
    constructor(options: { title?: string; body?: string }) {
      this.options = options;
    }
    show(): void {
      shown.push({ title: this.options.title ?? '', body: this.options.body ?? '' });
    }
  },
}));

const { APPLIED_MARKER_FILE, APPLIED_VERSION, OLD_EXE_SUFFIX, applyStagedUpdate, selfUpdateTarget, showAppliedNotice } =
  await import('../../src/main/selfUpdate.ts');
const { STAGED_EXE_FILE, STAGED_MANIFEST_FILE, STAGE_VERSION, UPDATES_DIR } = await import(
  '../../src/core/updates/updateSource.ts'
);

const OLD_EXE = Buffer.from('the exe the user launched (1.0.0)');
const NEW_EXE = Buffer.from('the exe that was downloaded and verified (1.3.0)');
const NEW_SHA = createHash('sha256').update(NEW_EXE).digest('hex');
const CURRENT_VERSION = '1.0.0';
const STAGED_VERSION = 'v1.3.0';

let root: string;
let target: string;
let updatesDir: string;
let stagedExe: string;
let manifestFile: string;
let markerFile: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cc-selfupdate-'));
  target = join(root, 'ClaudeControl.exe');
  updatesDir = join(root, 'userData', UPDATES_DIR);
  stagedExe = join(updatesDir, STAGED_EXE_FILE);
  manifestFile = join(updatesDir, STAGED_MANIFEST_FILE);
  markerFile = join(updatesDir, APPLIED_MARKER_FILE);
  env = { PORTABLE_EXECUTABLE_FILE: target };
  mkdirSync(updatesDir, { recursive: true });
  writeFileSync(target, OLD_EXE);
  quit.mockClear();
  relaunch.mockClear();
  shown.length = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The stage exactly as `UpdateSource.stage()` leaves it: the exe, then its manifest. */
function stage(bytes = NEW_EXE, sha256 = NEW_SHA, releaseVersion = STAGED_VERSION): void {
  writeFileSync(stagedExe, bytes);
  writeFileSync(
    manifestFile,
    `${JSON.stringify({
      version: STAGE_VERSION,
      releaseVersion,
      assetName: 'ClaudeControl-1.3.0-portable.exe',
      sha256,
      stagedAt: Date.UTC(2026, 8, 8),
    })}\n`,
  );
}

function apply(overrides: { env?: NodeJS.ProcessEnv; isPackaged?: boolean; fs?: SelfUpdateFs; currentVersion?: string } = {}) {
  return applyStagedUpdate({
    env: overrides.env ?? env,
    isPackaged: overrides.isPackaged ?? true,
    updatesDir,
    currentVersion: overrides.currentVersion ?? CURRENT_VERSION,
    now: () => Date.UTC(2026, 8, 9),
    ...(overrides.fs ? { fs: overrides.fs } : {}),
  });
}

function notice(overrides: { env?: NodeJS.ProcessEnv; isPackaged?: boolean; swappedThisRun?: boolean } = {}) {
  return showAppliedNotice({
    env: overrides.env ?? env,
    isPackaged: overrides.isPackaged ?? true,
    updatesDir,
    swappedThisRun: overrides.swappedThisRun ?? false,
  });
}

/** Real `node:fs`, with one hook that can refuse a specific operation. */
function failingFs(fail: (op: 'rename' | 'write' | 'unlink', path: string, to?: string) => boolean): SelfUpdateFs {
  const refuse = (op: string, path: string): never => {
    throw Object.assign(new Error(`${op} refused for ${path}`), { code: 'EPERM' });
  };
  return {
    existsSync,
    readFileSync: (path) => readFileSync(path),
    writeFileSync: (path, data) => {
      if (fail('write', path)) refuse('write', path);
      writeFileSync(path, data);
    },
    renameSync: (from, to) => {
      if (fail('rename', from, to)) refuse('rename', from);
      renameSync(from, to);
    },
    unlinkSync: (path) => {
      if (fail('unlink', path)) refuse('unlink', path);
      unlinkSync(path);
    },
  };
}

/** Everything sitting next to the launched exe — the place a "second copy" would show up. */
async function besideTheExe(): Promise<string[]> {
  return (await readdir(root)).sort();
}

describe('applyStagedUpdate', () => {
  it('a staged update replaces the exe at its original path with no second copy left behind', async () => {
    stage();

    const applied = apply();

    expect(applied).toEqual({ version: STAGED_VERSION, target });
    // Same path the user launched, now holding the new bytes (AC4).
    expect(readFileSync(target)).toEqual(NEW_EXE);
    // Nothing beside it: no `.old` parked copy, no second exe, nothing but the data dir.
    expect(await besideTheExe()).toEqual(['ClaudeControl.exe', 'userData']);
    expect(existsSync(`${target}${OLD_EXE_SUFFIX}`)).toBe(false);
    // And the stage is consumed, so the next start has nothing to re-apply.
    expect(existsSync(stagedExe)).toBe(false);
    expect(existsSync(manifestFile)).toBe(false);
    expect(JSON.parse(readFileSync(markerFile, 'utf8')) as unknown).toMatchObject({
      version: APPLIED_VERSION,
      appliedVersion: STAGED_VERSION,
    });
  });

  it('the swap runs once before the lock and never calls quit or relaunch', () => {
    stage();

    const applied = apply();
    // Whatever else happens, the session that swapped keeps running: it is the caller that
    // reaches `app.requestSingleInstanceLock()` next, not a restart (AC3).
    expect(applied).not.toBeNull();
    // Once: a second start finds the stage consumed and does nothing.
    expect(apply()).toBeNull();
    expect(readFileSync(target)).toEqual(NEW_EXE);

    notice({ swappedThisRun: true });
    notice();

    expect(quit).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('moves the staged file in even when a rename across volumes is impossible', async () => {
    stage();

    // `EXDEV`: the portable exe on one volume, `%APPDATA%` on another — the normal case for
    // this distribution, and it must still end with one file at the target path.
    const applied = apply({ fs: failingFs((op, from) => op === 'rename' && from === stagedExe) });

    expect(applied).not.toBeNull();
    expect(readFileSync(target)).toEqual(NEW_EXE);
    expect(await besideTheExe()).toEqual(['ClaudeControl.exe', 'userData']);
    expect(existsSync(stagedExe)).toBe(false);
  });

  it('deletes a parked old exe a previous swap could not remove', () => {
    writeFileSync(`${target}${OLD_EXE_SUFFIX}`, OLD_EXE);

    expect(apply()).toBeNull();

    expect(existsSync(`${target}${OLD_EXE_SUFFIX}`)).toBe(false);
    expect(readFileSync(target)).toEqual(OLD_EXE);
  });

  it('never downgrades onto a build that is already newer than the stage', () => {
    stage();

    expect(apply({ currentVersion: '2.0.0' })).toBeNull();

    expect(readFileSync(target)).toEqual(OLD_EXE);
    // The stage can never apply to this install, so it is dropped rather than re-hashed on
    // every single start.
    expect(existsSync(stagedExe)).toBe(false);
    expect(existsSync(manifestFile)).toBe(false);
  });
});

describe('a failed swap leaves the original exe untouched and does not throw', () => {
  it('when the manifest is missing', () => {
    writeFileSync(stagedExe, NEW_EXE);

    expect(() => apply()).not.toThrow();

    expect(readFileSync(target)).toEqual(OLD_EXE);
    expect(existsSync(markerFile)).toBe(false);
  });

  it('when the manifest is unreadable or the wrong shape', () => {
    stage();
    writeFileSync(manifestFile, '{ this is not json');

    expect(apply()).toBeNull();
    expect(readFileSync(target)).toEqual(OLD_EXE);

    writeFileSync(manifestFile, JSON.stringify({ version: STAGE_VERSION, releaseVersion: STAGED_VERSION }));

    expect(apply()).toBeNull();
    expect(readFileSync(target)).toEqual(OLD_EXE);
    expect(existsSync(markerFile)).toBe(false);
  });

  it('when the staged file no longer matches the hash it was staged with', () => {
    stage();
    // Tampered with, or corrupted, since staging: verified once by D3 is not verified now.
    writeFileSync(stagedExe, Buffer.from('something else entirely'));

    expect(apply()).toBeNull();

    expect(readFileSync(target)).toEqual(OLD_EXE);
    expect(existsSync(markerFile)).toBe(false);
    // A stage that cannot be trusted is discarded, not left to be reconsidered.
    expect(existsSync(stagedExe)).toBe(false);
    expect(existsSync(manifestFile)).toBe(false);
  });

  it('when the running exe cannot be renamed aside', () => {
    stage();

    const applied = apply({ fs: failingFs((op, from) => op === 'rename' && from === target) });

    expect(applied).toBeNull();
    expect(readFileSync(target)).toEqual(OLD_EXE);
    expect(existsSync(`${target}${OLD_EXE_SUFFIX}`)).toBe(false);
    expect(existsSync(markerFile)).toBe(false);
  });

  it('when the cross-volume copy lands corrupted, by hashing it back and rolling the old one back', async () => {
    stage();

    // `EXDEV` sends the swap down the copy fallback, and that copy is the one step here that
    // creates bytes rather than moving verified ones. This write half-lands (a full disk, a
    // dying drive): re-reading it is the only thing between that and a corrupt exe where the
    // user's app used to be.
    const truncating: SelfUpdateFs = {
      existsSync,
      readFileSync: (path) => readFileSync(path),
      writeFileSync: (path, data) => {
        writeFileSync(path, path === target ? (data as Buffer).subarray(0, 8) : data);
      },
      renameSync: (from, to) => {
        if (from === stagedExe) throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
        renameSync(from, to);
      },
      unlinkSync,
    };

    const applied = apply({ fs: truncating });

    expect(applied).toBeNull();
    // Not the half-written new exe, and not a gap where the exe should be: the old one, back.
    expect(readFileSync(target)).toEqual(OLD_EXE);
    expect(await besideTheExe()).toEqual(['ClaudeControl.exe', 'userData']);
    expect(existsSync(markerFile)).toBe(false);
    // The stage itself was never in question, so it is still there for the next start to retry.
    expect(readFileSync(stagedExe)).toEqual(NEW_EXE);
  });

  it('when the new exe cannot be moved into place, by rolling the old one back', async () => {
    stage();

    // Both ways in fail: the rename *and* the copy fallback. The target path was empty for a
    // moment — the rollback is the only thing that puts the user's app back.
    const applied = apply({
      fs: failingFs((op, from) => (op === 'rename' && from === stagedExe) || (op === 'write' && from === target)),
    });

    expect(applied).toBeNull();
    expect(readFileSync(target)).toEqual(OLD_EXE);
    expect(await besideTheExe()).toEqual(['ClaudeControl.exe', 'userData']);
    expect(existsSync(markerFile)).toBe(false);
  });
});

describe('the one-time notice', () => {
  it('waits for the start that is actually running the new version', () => {
    // Start A: swaps the file, and is still the old build in memory.
    expect(apply()).toBeNull();
    stage();
    const applied = apply();
    expect(applied).not.toBeNull();

    notice({ swappedThisRun: true });
    expect(shown).toEqual([]);
    // The marker is what carries the news across the process boundary.
    expect(existsSync(markerFile)).toBe(true);

    // Start B: the new file is what Electron loaded, so this is the run that announces it.
    expect(notice()).toBe(STAGED_VERSION);
    expect(shown).toEqual([{ title: 'Claude Control', body: 'Updated to v1.3.0' }]);
    expect(existsSync(markerFile)).toBe(false);

    // Start C and every start after: nothing.
    expect(notice()).toBeNull();
    expect(shown).toHaveLength(1);
  });

  it('drops a marker it cannot make sense of without showing anything', () => {
    writeFileSync(markerFile, JSON.stringify({ version: 999, appliedVersion: 'v9.9.9' }));

    expect(notice()).toBeNull();

    expect(shown).toEqual([]);
    expect(existsSync(markerFile)).toBe(false);
  });
});

describe('an unpackaged or non-portable run never checks or swaps', () => {
  it('does nothing at all when the app is not packaged', () => {
    stage();
    writeFileSync(markerFile, JSON.stringify({ version: APPLIED_VERSION, appliedVersion: STAGED_VERSION, appliedAt: 1 }));

    // The gate index.ts arms the periodic `updateSource.refresh()` on: null means no
    // `UpdateSource` is constructed and no timer is ever started (AC10).
    expect(selfUpdateTarget(env, false)).toBeNull();
    expect(apply({ isPackaged: false })).toBeNull();
    expect(notice({ isPackaged: false })).toBeNull();

    expect(readFileSync(target)).toEqual(OLD_EXE);
    expect(readFileSync(stagedExe)).toEqual(NEW_EXE);
    expect(existsSync(markerFile)).toBe(true);
    expect(shown).toEqual([]);
    expect(quit).not.toHaveBeenCalled();
  });

  it('does nothing at all when the run is not the portable target', () => {
    stage();
    writeFileSync(markerFile, JSON.stringify({ version: APPLIED_VERSION, appliedVersion: STAGED_VERSION, appliedAt: 1 }));
    const noPortable: NodeJS.ProcessEnv = {};

    expect(selfUpdateTarget(noPortable, true)).toBeNull();
    expect(apply({ env: noPortable })).toBeNull();
    expect(notice({ env: noPortable })).toBeNull();

    expect(readFileSync(target)).toEqual(OLD_EXE);
    expect(readFileSync(stagedExe)).toEqual(NEW_EXE);
    expect(existsSync(markerFile)).toBe(true);
    expect(shown).toEqual([]);
    expect(quit).not.toHaveBeenCalled();
  });
});
