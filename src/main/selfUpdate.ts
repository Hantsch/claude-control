/**
 * Applying a staged update at launch (story 019, D4) — the only place in the app that writes
 * to the user's own EXE.
 *
 * The swap runs *before* `app.requestSingleInstanceLock()` ([index.ts:37](./index.ts)) and does
 * exactly one thing: it replaces the file on disk. It never quits, never relaunches, never asks
 * (AC3). The session doing it keeps running the code it already loaded into memory, so
 * `app.getVersion()` still reports the old version for the rest of this run — the *next* start
 * is the one that boots the new file (AC4). That is the whole reason no restart is needed.
 *
 * Four rules keep this from being dangerous:
 *
 *  1. **It only ever runs from a packaged, portable install.** `app.isPackaged` and
 *     `PORTABLE_EXECUTABLE_FILE` (the same pair `toast-protocol.ts:138` already prefers over the
 *     temp `process.execPath`) must both hold. A dev run or an unpackaged run returns before
 *     touching a single path (AC10) — there is no code path here that can name a file in a
 *     checkout.
 *  2. **The stage is untrusted until re-verified here.** `updateSource.ts` verified it twice at
 *     download time, but time has passed and the file has sat on disk since. The manifest is
 *     re-read, its shape re-validated and the exe re-hashed against it before anything moves.
 *     A mismatch discards the stage instead of installing it (AC2's spirit, at the second door).
 *  3. **The old exe is never gone before the new one is in place**, and never lost if the move
 *     fails: aside → in → *rollback on failure*. Between those two renames the target path is
 *     briefly empty; if the second step throws for any reason, the first one is undone, so the
 *     failure mode is "still on the old version", never "no app at all" (AC6). A cross-volume
 *     copy counts as one of those reasons unless it hashes back correctly from disk.
 *  4. **Nothing here throws and nothing here blocks.** Every step is synchronous by necessity
 *     (it has to finish before the lock), so the only work done before a stage is even known to
 *     exist is one `existsSync` and a small JSON read. The 100 MB hash only happens when there
 *     really is a stage to apply — i.e. once, on the start that consumes it.
 *
 * The swap consumes the stage: the staged file is moved out of `<userData>/updates/`, so the
 * next start finds nothing to apply and the hash is not paid again.
 *
 * The one-time "Updated to vX.Y.Z" toast is the other half. The swapping session cannot show it
 * — it does not know its own new version — so the swap leaves an `applied.json` marker and the
 * *following* start shows it and deletes it. Both halves live in one process only in the sense
 * that {@link showAppliedNotice} runs after `whenReady()` in the same run that
 * {@link applyStagedUpdate} may have swapped; that run passes `swappedThisRun`, and the notice
 * skips itself. The marker is what carries the news to the next process.
 */

import { Notification } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isUpdateAvailable } from '../core/updates/releaseInfo.ts';
import { STAGED_EXE_FILE, STAGED_MANIFEST_FILE, STAGE_VERSION } from '../core/updates/updateSource.ts';

/** The marker the swap leaves behind, read once by the *next* start. */
export const APPLIED_MARKER_FILE = 'applied.json';
/** Bumped only when the marker's shape changes; an unknown version is ignored, not migrated. */
export const APPLIED_VERSION = 1;
/** Where the replaced exe is parked while the new one moves in. Deleted best-effort after. */
export const OLD_EXE_SUFFIX = '.old';

/**
 * How often the background tick asks `UpdateSource.refresh()` to reconsider. The real cadence
 * is one check per calendar day and lives inside that class, so this only has to be fine enough
 * that a machine left running crosses midnight without waiting for a restart.
 */
export const UPDATE_CHECK_TICK_MS = 60 * 60 * 1000;

/** The slice of `node:fs` this module uses, so a test can drive it without a real EXE. */
export interface SelfUpdateFs {
  existsSync(path: string): boolean;
  readFileSync(path: string): Buffer;
  writeFileSync(path: string, data: string | Buffer): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
}

const NODE_FS: SelfUpdateFs = { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync };

/** What both entry points need to decide whether they may run at all, and where to look. */
export interface SelfUpdateHost {
  /** `process.env` — read for `PORTABLE_EXECUTABLE_FILE` only. */
  env: NodeJS.ProcessEnv;
  /** `app.isPackaged`. */
  isPackaged: boolean;
  /** `<userData>/updates` — the same directory `UpdateSource` owns. */
  updatesDir: string;
  /** Defaults to `node:fs`. */
  fs?: SelfUpdateFs;
}

export interface ApplyStagedUpdateOptions extends SelfUpdateHost {
  /** `app.getVersion()` — the version of the exe that is actually running right now. */
  currentVersion: string;
  now?: () => number;
}

export interface NoticeOptions extends SelfUpdateHost {
  /** True when {@link applyStagedUpdate} swapped in *this* process — then the toast waits. */
  swappedThisRun: boolean;
  /** Defaults to a plain Electron `Notification`, mirroring `notifier.ts:77-85`. */
  notify?: (title: string, body: string) => void;
}

/** What a completed swap reports back, so the caller can suppress this run's toast. */
export interface AppliedUpdate {
  /** The release tag that is now on disk, e.g. `v1.3.0` — not what this session is running. */
  version: string;
  /** The user's own exe path that was replaced. */
  target: string;
}

/** On-disk shape of `<userData>/updates/applied.json`. */
interface AppliedMarker {
  version: number;
  appliedVersion: string;
  appliedAt: number;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The gate, and the only source of the path this module may write to: the exe the user actually
 * double-clicked. Returns null — meaning "do nothing at all" — unless the app is both packaged
 * and the portable target, so `npm run dev` and an unpackaged run never reach any of the code
 * below (AC10). Mirrors `protocolClientTarget`'s check in `toast-protocol.ts`.
 */
export function selfUpdateTarget(env: NodeJS.ProcessEnv, isPackaged: boolean): string | null {
  if (!isPackaged) return null;
  const portableExe = env.PORTABLE_EXECUTABLE_FILE;
  return portableExe ? portableExe : null;
}

/**
 * Applies a verified staged update to the launched exe, or does nothing.
 *
 * Call it before `app.requestSingleInstanceLock()`. Returns the applied update, or null when
 * there was nothing to apply or anything at all went wrong — it never throws and never quits or
 * relaunches (AC3, AC6). On every failure path the exe at the target path is the one that was
 * there before.
 */
export function applyStagedUpdate(options: ApplyStagedUpdateOptions): AppliedUpdate | null {
  const target = selfUpdateTarget(options.env, options.isPackaged);
  if (target === null) return null;

  const fs = options.fs ?? NODE_FS;
  const now = options.now ?? (() => Date.now());
  const parked = `${target}${OLD_EXE_SUFFIX}`;

  try {
    // A previous swap could not delete this while the app it belonged to was still running.
    // Dropping it here is what keeps "no second copy beside it" true from the next start on.
    discard(fs, parked);

    const manifest = readManifest(fs, join(options.updatesDir, STAGED_MANIFEST_FILE));
    if (manifest === null) return null;

    const stagedExe = join(options.updatesDir, STAGED_EXE_FILE);
    if (!fs.existsSync(stagedExe)) return null;

    // Never downgrade, ever — including onto a locally-newer build the user put there by hand.
    // The stage is useless in that case, so it is dropped rather than re-hashed on every start.
    if (!isUpdateAvailable(options.currentVersion, manifest.releaseVersion)) {
      discardStage(fs, options.updatesDir);
      return null;
    }

    // Door two: the bytes on disk are hashed again, right now, against the manifest that
    // describes them. Whatever happened to that file since staging, only a file that still
    // matches is allowed near the user's exe.
    const bytes = fs.readFileSync(stagedExe);
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) {
      discardStage(fs, options.updatesDir);
      return null;
    }

    // Nothing to replace — the launcher's path is gone. Not our business to create it.
    if (!fs.existsSync(target)) return null;

    // The swap itself. Windows lets a running exe be renamed but not deleted or overwritten,
    // which is exactly why the old one is moved aside instead of written over.
    fs.renameSync(target, parked);
    try {
      moveIn(fs, stagedExe, target, bytes, manifest.sha256);
    } catch {
      // The target path must never be left empty: put the old exe back and stay on it (AC6).
      try {
        fs.renameSync(parked, target);
      } catch {
        // Nothing left to try. The old exe is still on disk under `.old`, not destroyed.
      }
      return null;
    }

    // Written before the cleanup below, so a crash in it still leaves the news for the next
    // start. Everything from here on is best-effort: the swap has already succeeded.
    writeMarker(fs, options.updatesDir, manifest.releaseVersion, now());
    // The manifest described a file that is no longer in the staging dir; drop both halves so
    // nothing looks staged any more.
    discardStage(fs, options.updatesDir);
    // Fails while the previous instance still has the old exe mapped. That is fine — the very
    // first line of the next swap-check deletes it.
    discard(fs, parked);

    return { version: manifest.releaseVersion, target };
  } catch {
    // Anything unforeseen: the running app is untouched and startup continues unbothered.
    return null;
  }
}

/**
 * Shows the one-time "Updated to vX.Y.Z" toast, once, on the first start that is actually
 * *running* the new version — then deletes the marker so it never fires again.
 *
 * Call it after `whenReady()`. Returns the version it announced, or null. Never throws.
 */
export function showAppliedNotice(options: NoticeOptions): string | null {
  if (selfUpdateTarget(options.env, options.isPackaged) === null) return null;
  // This run's own swap wrote the marker minutes ago and this process is still the old build:
  // it would announce a version it is not running. The marker stays for the next start.
  if (options.swappedThisRun) return null;

  const fs = options.fs ?? NODE_FS;
  const notify = options.notify ?? showNotification;
  const file = join(options.updatesDir, APPLIED_MARKER_FILE);

  try {
    if (!fs.existsSync(file)) return null;
    const marker = readMarker(fs, file);
    // Deleted before the toast, not after: a notification that fails to show is a missed
    // notice, while a marker that survives is a toast on every start forever.
    discard(fs, file);
    if (marker === null) return null;
    notify('Claude Control', `Updated to ${withV(marker.appliedVersion)}`);
    return marker.appliedVersion;
  } catch {
    return null;
  }
}

/**
 * Moves the staged file onto the target path. A plain rename is the cheap case; it fails with
 * `EXDEV` when the user keeps their portable exe on a different volume than `%APPDATA%`, which
 * is entirely normal for this distribution. The fallback writes the bytes that were hashed a
 * moment ago — the same verified content, no second trip to the network or the disk.
 *
 * A rename moves bytes that were already verified; a *write* creates new ones, and a write that
 * only half lands would leave a corrupt exe where the user's app was. So the fallback re-reads
 * what it wrote and hashes it again, exactly as `updateSource.ts:stage()` does after its own
 * write. Throwing here is the point: it puts the caller on the rollback path, which restores
 * the old exe rather than leaving a broken one behind.
 */
function moveIn(fs: SelfUpdateFs, stagedExe: string, target: string, bytes: Buffer, sha256: string): void {
  try {
    fs.renameSync(stagedExe, target);
    return;
  } catch {
    // Different volumes: copy instead, then prove the copy.
  }
  fs.writeFileSync(target, bytes);
  if (createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== sha256) {
    throw new Error('the copied exe did not match its checksum after writing');
  }
}

/** The staged manifest, re-validated from disk. Anything unexpected means "nothing is staged". */
function readManifest(fs: SelfUpdateFs, file: string): { releaseVersion: string; sha256: string } | null {
  try {
    if (!fs.existsSync(file)) return null;
    const raw: unknown = JSON.parse(fs.readFileSync(file).toString('utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as { version?: unknown; releaseVersion?: unknown; sha256?: unknown };
    if (candidate.version !== STAGE_VERSION) return null;
    const { releaseVersion, sha256 } = candidate;
    if (typeof releaseVersion !== 'string' || releaseVersion.length === 0) return null;
    if (typeof sha256 !== 'string' || !HEX64.test(sha256)) return null;
    return { releaseVersion, sha256 };
  } catch {
    return null;
  }
}

/** The applied marker, validated the same way. */
function readMarker(fs: SelfUpdateFs, file: string): AppliedMarker | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file).toString('utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Partial<AppliedMarker>;
    if (candidate.version !== APPLIED_VERSION) return null;
    const { appliedVersion, appliedAt } = candidate;
    if (typeof appliedVersion !== 'string' || appliedVersion.length === 0) return null;
    if (typeof appliedAt !== 'number' || !Number.isFinite(appliedAt)) return null;
    return { version: APPLIED_VERSION, appliedVersion, appliedAt };
  } catch {
    return null;
  }
}

/** Best-effort — a marker we cannot write only costs the toast, never the update. */
function writeMarker(fs: SelfUpdateFs, updatesDir: string, appliedVersion: string, at: number): void {
  const marker: AppliedMarker = { version: APPLIED_VERSION, appliedVersion, appliedAt: at };
  try {
    fs.writeFileSync(join(updatesDir, APPLIED_MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`);
  } catch {
    // Not a failed update.
  }
}

/** Drops both halves of a stage. Only ever called on paths inside `<userData>/updates/`. */
function discardStage(fs: SelfUpdateFs, updatesDir: string): void {
  discard(fs, join(updatesDir, STAGED_MANIFEST_FILE));
  discard(fs, join(updatesDir, STAGED_EXE_FILE));
}

/** Best-effort delete. A file we cannot remove is never a reason to fail or to throw. */
function discard(fs: SelfUpdateFs, file: string): void {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // Locked by a still-running instance, most likely. Cleaned up on a later start.
  }
}

/** `1.3.0` and `v1.3.0` both read as `v1.3.0` in the toast. */
function withV(version: string): string {
  return version.startsWith('v') || version.startsWith('V') ? version : `v${version}`;
}

/** The default notifier: the plain toast shape from `notifier.ts:77-85`, without the buttons. */
function showNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, silent: true, timeoutType: 'default' }).show();
}
