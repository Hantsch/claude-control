/**
 * The opt-in self-update source (story 019, D3): check, download, verify, stage.
 *
 * The second — and last — module in the app that opens an outbound connection, and the second
 * under `core/` that writes a file. Both exceptions are renegotiated by name in
 * `test/unit/boundaries.test.ts` rather than by widening the rules, exactly as story 005 did
 * for `context/windowSource.ts`, whose fetch/cache/policy shape this mirrors.
 *
 * Two hard limits keep the exception honest: nothing is requested while `settings.updates.enabled`
 * is false, and the only paths ever written or deleted live under `<dataDir>/updates/`, where
 * `dataDir` comes from the caller. No Claude-Code-owned path is nameable from here at all.
 *
 * **The security-critical part is the verify/stage boundary.** The EXE is unsigned, so the
 * SHA256 in the release's `SHA256SUMS.txt` is the only thing standing between "update" and "run
 * whatever the network handed us". Three rules protect it:
 *
 *  1. **Nothing unverified ever reaches the disk.** The download is hashed in memory and
 *     compared against the sums file *before* a single byte is written. A mismatch discards the
 *     buffer and returns; the previous stage and the installed app are never touched (AC2).
 *  2. **What is written is verified again from disk** before it is staged, so a truncated or
 *     partially-failed write cannot become a stage either.
 *  3. **Staging fails closed.** The manifest — the only thing that makes a file count as staged
 *     — is removed *before* the new exe is moved in and written back only once it is in place.
 *     A crash anywhere in between leaves "no stage", never a manifest describing a file that
 *     isn't the one it names.
 *
 * The asset name from the release payload is used *only* as a lookup key into the parsed sums
 * map; it never becomes a path. The staged file's name is a fixed constant, so a hostile release
 * payload cannot name a location on this disk.
 *
 * Time policy, both checks in `refresh()` (no ceiling — unlike a context-window table there is
 * nothing to keep serving stale):
 *   - **cadence** — at most one real check per calendar day. A later start on the same day is
 *     served from the persisted result of the first one.
 *   - **backoff** — a failed attempt is not repeated for 30 min, so being offline costs one
 *     attempt per half hour rather than one per start or per tick.
 *
 * `{ force: true }` (the Settings button) bypasses both. Nothing here throws, nothing can hang
 * and nothing can grow without bound: every request is bounded by an abort *and* by a byte cap
 * enforced while the body is read, and it may only be sent to a host on GitHub's allowlist.
 * Every failure path — HTTP error, offline, malformed JSON, missing asset, an asset URL
 * pointing off GitHub, an oversized body, rate limiting, unwritable staging dir, checksum
 * mismatch — ends in `status()` reporting `lastOutcome: 'failed'` with a reason (AC6).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isUpdateAvailable, parseSha256Sums, portableExeUrl, releaseTag, sumsFileUrl, sha256For } from './releaseInfo.ts';

/** The release this app updates from. Named in Settings, not hidden. */
export const RELEASES_LATEST_URL = 'https://api.github.com/repos/Hantsch/claude-control/releases/latest';

/** Everything this module owns lives in this one directory under the caller's data dir. */
export const UPDATES_DIR = 'updates';
/** Fixed names: nothing from the network ever names a path on this disk. */
export const STAGED_EXE_FILE = 'staged.exe';
export const STAGED_MANIFEST_FILE = 'staged.json';
export const DOWNLOAD_TMP_FILE = 'download.tmp';
export const CHECK_FILE = 'check.json';

/** Bumped only when a persisted shape changes; an unknown version is ignored, not migrated. */
export const STAGE_VERSION = 1;
export const CHECK_VERSION = 1;

/** The API and the small sums file: a 10 s bound, mirroring `windowSource.ts`. */
const FETCH_TIMEOUT_MS = 10_000;
/** The exe body is tens of megabytes; the same 10 s would abort every honest download. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
/** A sanity bound on what we are willing to pull into memory. Today's exe is ~100 MB. */
const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;
/** The release JSON and the sums file are kilobytes; nothing legitimate comes close to this. */
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
/** A failed attempt is not repeated inside this window — brief, not a full day. */
export const CHECK_BACKOFF_MS = 30 * 60 * 1000;

/** What the last check did. `'never'` = none attempted yet, in this process or a previous one. */
export type UpdateOutcome = 'ok' | 'failed' | 'never';

/** On-disk description of the staged update. Without it, a file in the dir is not a stage. */
export interface StagedManifest {
  version: number;
  /** The release tag the staged exe came from, e.g. `v1.3.0`. */
  releaseVersion: string;
  /** The asset name it was published under — for display, never used as a path. */
  assetName: string;
  /** Lowercase hex SHA256 that was verified before staging. D4 re-verifies against it. */
  sha256: string;
  stagedAt: number;
}

/** A staged manifest plus the absolute path of the file it describes. */
export interface StagedUpdate extends StagedManifest {
  file: string;
}

/** Persisted result of the last check, so a later start on the same day does not re-check. */
interface CheckRecord {
  version: number;
  checkedAt: number;
  outcome: 'ok' | 'failed';
  latestVersion: string | null;
  error?: string;
}

/**
 * Everything Settings and Diagnostics need to render
 * "Updates: on · 1.0.0 · latest 1.3.0 · staged v1.3.0 · checked 2 h ago · last check ok/failed".
 */
export interface UpdateStatus {
  /** The opt-in setting. While false, no request is made at all (AC8). */
  enabled: boolean;
  /** What is installed — `app.getVersion()`, passed in by the caller. */
  currentVersion: string;
  /** The latest release tag seen by the last successful check, or null when none succeeded. */
  latestVersion: string | null;
  /** True only when `latestVersion` is a genuine upgrade over `currentVersion` — no downgrades. */
  updateAvailable: boolean;
  /**
   * The verified update waiting on disk, or null when there is none. Reports what is actually
   * on disk regardless of `enabled`, so Diagnostics stays truthful after the setting is turned
   * off; whether it is *applied* is D4's gate, not this field.
   */
  staged: StagedUpdate | null;
  /** Epoch ms of the last check attempt (this process or a persisted earlier one). */
  checkedAt: number | null;
  /** Outcome of that attempt. */
  lastOutcome: UpdateOutcome;
  /** Short reason for the last failure; absent while the last attempt succeeded. */
  lastError?: string;
  /** The URL that would be requested — Settings names it explicitly. */
  source: string;
}

export interface UpdateSourceOptions {
  /** `app.getVersion()`. Defaults to `'0.0.0'`, which is never newer than anything. */
  currentVersion?: string;
  /** Mirrors `settings.updates.enabled`. Defaults to false: off until asked. */
  enabled?: boolean;
  /** Injectable clock, mirroring `WindowSource`'s. */
  now?: () => number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'request timed out';
    return error.message || error.name;
  }
  return String(error);
}

/** Local-calendar-day equality — the cadence is "once a day", not "every 24 h". */
function sameCalendarDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/**
 * The asset's published name, taken from the last segment of its download URL. Used *only* as
 * a key into the parsed `SHA256SUMS.txt` map — never as a filesystem path.
 */
function assetNameFrom(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * The only hosts an asset may be fetched from: GitHub itself and its asset CDN, which is where
 * `browser_download_url` legitimately points (`github.com/<owner>/<repo>/releases/download/…`,
 * redirecting to a `*.githubusercontent.com` object).
 */
const TRUSTED_ASSET_HOSTS = ['github.com', 'githubusercontent.com'];

/**
 * Whether an asset URL out of the release payload may be requested at all.
 *
 * Every byte this module downloads is named by JSON that came off the network, so "it is TLS to
 * api.github.com" only covers the *first* request. An allowlist makes the rest explicit: TLS,
 * and a host that is GitHub's — never plain http, never a look-alike host, and never a
 * `user@host` URL whose authority is not what it reads like.
 */
function isTrustedAssetUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return TRUSTED_ASSET_HOSTS.some((trusted) => host === trusted || host.endsWith(`.${trusted}`));
}

/**
 * Reads a response body chunk by chunk, refusing to hold more than `maxBytes` of it at once.
 *
 * The cap is enforced *while* reading rather than after: `content-length` is a claim the sender
 * does not have to make and does not have to keep, so a body with no header at all — or a
 * dishonest one — must not be able to pull an unbounded amount into this process's memory.
 */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const body = response.body;
  if (body === null) throw new Error('response body was empty');
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('response exceeds the size limit');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    // Stop the transfer rather than leaving a socket draining bytes nobody will look at.
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, total);
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Validates a parsed manifest. Anything unexpected yields null, i.e. "nothing is staged". */
function readManifestShape(raw: unknown): StagedManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<StagedManifest>;
  if (candidate.version !== STAGE_VERSION) return null;
  const { releaseVersion, assetName, sha256, stagedAt } = candidate;
  if (typeof releaseVersion !== 'string' || releaseVersion.length === 0) return null;
  if (typeof assetName !== 'string' || assetName.length === 0) return null;
  if (typeof sha256 !== 'string' || !HEX64.test(sha256)) return null;
  if (typeof stagedAt !== 'number' || !Number.isFinite(stagedAt) || stagedAt <= 0) return null;
  return { version: STAGE_VERSION, releaseVersion, assetName, sha256, stagedAt };
}

/** Validates a parsed check record. Anything unexpected yields null, i.e. "never checked". */
function readCheckShape(raw: unknown): CheckRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<CheckRecord>;
  if (candidate.version !== CHECK_VERSION) return null;
  const { checkedAt, outcome, latestVersion, error } = candidate;
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt) || checkedAt <= 0) return null;
  if (outcome !== 'ok' && outcome !== 'failed') return null;
  const record: CheckRecord = {
    version: CHECK_VERSION,
    checkedAt,
    outcome,
    latestVersion: typeof latestVersion === 'string' && latestVersion.length > 0 ? latestVersion : null,
  };
  if (typeof error === 'string' && error.length > 0) record.error = error;
  return record;
}

export class UpdateSource {
  private readonly dir: string;
  private readonly exeFile: string;
  private readonly manifestFile: string;
  private readonly tmpFile: string;
  private readonly checkFile: string;
  private readonly currentVersion: string;
  private readonly now: () => number;
  private enabled: boolean;
  private staged: StagedUpdate | null = null;
  private latestVersion: string | null = null;
  private checkedAt: number | null = null;
  private lastOutcome: UpdateOutcome = 'never';
  private lastError: string | undefined;
  private inflight: Promise<void> | null = null;

  constructor(dataDir: string, options: UpdateSourceOptions = {}) {
    this.dir = join(dataDir, UPDATES_DIR);
    this.exeFile = join(this.dir, STAGED_EXE_FILE);
    this.manifestFile = join(this.dir, STAGED_MANIFEST_FILE);
    this.tmpFile = join(this.dir, DOWNLOAD_TMP_FILE);
    this.checkFile = join(this.dir, CHECK_FILE);
    this.currentVersion = options.currentVersion ?? '0.0.0';
    this.now = options.now ?? (() => Date.now());
    this.enabled = options.enabled ?? false;
    // A crashed previous attempt leaves a partial download behind; it is never a stage, so it
    // is dropped rather than resumed. Purely local — no request is made, enabled or not.
    this.cleanup();
    this.staged = this.readStaged();
    const check = this.readCheck();
    if (check) {
      this.checkedAt = check.checkedAt;
      this.lastOutcome = check.outcome;
      this.latestVersion = check.latestVersion;
      this.lastError = check.error;
    }
  }

  /** The directory this class owns — the only place it ever writes or deletes. */
  get path(): string {
    return this.dir;
  }

  /** Follows the setting. Turning it off does not discard a stage, only future checks. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** The verified update waiting on disk, or null. D4's entry point for the launch-time swap. */
  stagedUpdate(): StagedUpdate | null {
    return this.staged;
  }

  status(): UpdateStatus {
    const status: UpdateStatus = {
      enabled: this.enabled,
      currentVersion: this.currentVersion,
      latestVersion: this.latestVersion,
      updateAvailable: this.latestVersion !== null && isUpdateAvailable(this.currentVersion, this.latestVersion),
      staged: this.staged,
      checkedAt: this.checkedAt,
      lastOutcome: this.lastOutcome,
      source: RELEASES_LATEST_URL,
    };
    if (this.lastError !== undefined) status.lastError = this.lastError;
    return status;
  }

  /**
   * Evaluates the policy and, if a check is due, performs it. Resolves with the resulting
   * status; never rejects. Awaiting it is optional — startup schedules it and walks away.
   */
  async refresh(options: { force?: boolean } = {}): Promise<UpdateStatus> {
    // AC8's hard gate: the single place a check can start, and it starts with the setting.
    if (!this.enabled) return this.status();

    // A second caller joins the attempt already running rather than starting a parallel one.
    if (this.inflight) {
      await this.inflight;
      return this.status();
    }

    const at = this.now();
    if (options.force !== true && this.checkedAt !== null) {
      // One real check per calendar day; a later start today is served from what it found.
      if (this.lastOutcome === 'ok' && sameCalendarDay(this.checkedAt, at)) return this.status();
      // A failure backs off briefly rather than for the rest of the day.
      if (this.lastOutcome === 'failed' && at - this.checkedAt < CHECK_BACKOFF_MS) return this.status();
    }

    this.inflight = this.attempt();
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
    return this.status();
  }

  /** One bounded attempt. Swallows everything into `lastOutcome`/`lastError` (AC6). */
  private async attempt(): Promise<void> {
    try {
      const body = await this.request(
        RELEASES_LATEST_URL,
        'application/vnd.github+json',
        FETCH_TIMEOUT_MS,
        MAX_METADATA_BYTES,
      );
      const release: unknown = JSON.parse(body.toString('utf8'));
      const tag = releaseTag(release);
      if (tag === null) throw new Error('release payload has no tag_name');
      this.latestVersion = tag;

      // AC5: equal, or a locally-newer build — nothing is downloaded and no state is touched.
      if (!isUpdateAvailable(this.currentVersion, tag)) {
        this.succeed();
        return;
      }
      // Nor is anything downloaded twice: the stage from an earlier check is already this one.
      if (this.staged !== null && this.staged.releaseVersion === tag) {
        this.succeed();
        return;
      }

      const exeUrl = portableExeUrl(release);
      if (exeUrl === null) throw new Error(`release ${tag} has no portable exe asset`);
      const sumsUrl = sumsFileUrl(release);
      if (sumsUrl === null) throw new Error(`release ${tag} has no SHA256SUMS.txt asset`);
      // Both URLs came out of a JSON payload, so where they point is checked before either is
      // requested. A payload naming somewhere else is as malformed as one naming nothing.
      for (const url of [exeUrl, sumsUrl]) {
        if (!isTrustedAssetUrl(url)) throw new Error(`release ${tag} names an asset URL outside GitHub: ${url}`);
      }
      const assetName = assetNameFrom(exeUrl);
      if (assetName === null) throw new Error('could not read the asset name from its download URL');

      const sums = parseSha256Sums(
        (await this.request(sumsUrl, 'text/plain', FETCH_TIMEOUT_MS, MAX_METADATA_BYTES)).toString('utf8'),
      );
      const expected = sha256For(sums, assetName);
      if (expected === null) throw new Error(`SHA256SUMS.txt lists no hash for ${assetName}`);

      // Bounded while it is read, not after — see `readCapped`.
      const bytes = await this.request(exeUrl, 'application/octet-stream', DOWNLOAD_TIMEOUT_MS, MAX_DOWNLOAD_BYTES);
      if (bytes.length === 0) throw new Error('downloaded asset was empty');

      // The whole security boundary, in one place: the bytes are hashed in memory and compared
      // *before* anything is written, so a mismatch never puts an unverified executable on this
      // disk at all — and cannot touch the previous stage or the installed app (AC2).
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expected) {
        throw new Error(`checksum mismatch for ${assetName}: expected ${expected}, got ${actual}`);
      }

      this.stage(bytes, expected, { tag, assetName });
      this.succeed();
    } catch (error) {
      // Any failure at all: the previous state — staged or not — survives untouched.
      this.fail(errorMessage(error));
    }
  }

  /**
   * One bounded request: bounded in time by the abort, and in size by `maxBytes`. The body is
   * read *inside* both bounds, so neither a stalled nor an oversized download can outlive them;
   * every `fetch` in this module goes through here.
   */
  private async request(url: string, accept: string, timeoutMs: number, maxBytes: number): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept, 'user-agent': 'claude-control' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
      }
      // A declared length over the cap saves the transfer entirely, but a missing or unreadable
      // one proves nothing — which is why this is an optimisation and the read below is the
      // guard. (`Number('')` is 0, so trusting this header alone let an unmeasured body past.)
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new Error('response exceeds the size limit');
      }
      return await readCapped(response, maxBytes);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Puts verified bytes on disk as *the* staged update, replacing any older stage.
   *
   * Ordered to fail closed. The manifest is what makes a file count as staged, so it is dropped
   * first and written back last: a crash at any point in between leaves "nothing is staged",
   * never a manifest pointing at a file it does not describe. Throwing is fine — `attempt`
   * turns it into `lastOutcome: 'failed'`, and `this.staged` is already null by then.
   */
  private stage(bytes: Buffer, sha256: string, release: { tag: string; assetName: string }): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.tmpFile, bytes);

    // Verified again, this time from disk: a truncated or partially-failed write must not
    // become a stage either. Only a file that still hashes correctly is ever moved into place.
    const written = createHash('sha256').update(readFileSync(this.tmpFile)).digest('hex');
    if (written !== sha256) {
      this.discard(this.tmpFile);
      throw new Error('staged file did not match its checksum after writing');
    }

    this.discard(this.manifestFile);
    this.staged = null;
    renameSync(this.tmpFile, this.exeFile);

    const manifest: StagedManifest = {
      version: STAGE_VERSION,
      releaseVersion: release.tag,
      assetName: release.assetName,
      sha256,
      stagedAt: this.now(),
    };
    const temp = `${this.manifestFile}.tmp`;
    writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    renameSync(temp, this.manifestFile);
    this.staged = { ...manifest, file: this.exeFile };
  }

  private succeed(): void {
    this.checkedAt = this.now();
    this.lastOutcome = 'ok';
    this.lastError = undefined;
    this.writeCheck();
  }

  private fail(reason: string): void {
    this.checkedAt = this.now();
    this.lastOutcome = 'failed';
    this.lastError = reason;
    this.writeCheck();
  }

  /** Drops the artefacts a crashed attempt can leave behind. Never a reason to fail. */
  private cleanup(): void {
    this.discard(this.tmpFile);
    this.discard(`${this.manifestFile}.tmp`);
    this.discard(`${this.checkFile}.tmp`);
  }

  /** Best-effort delete of one of this class's own paths. */
  private discard(file: string): void {
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      // A file we cannot remove is not a reason to fail a check.
    }
  }

  /**
   * The stage as it exists on disk. A manifest without its exe, or an exe without a valid
   * manifest, is not a stage — both halves are dropped so nothing unverifiable lingers.
   */
  private readStaged(): StagedUpdate | null {
    const manifest = this.readJson(this.manifestFile, readManifestShape);
    if (!manifest) {
      this.discard(this.manifestFile);
      this.discard(this.exeFile);
      return null;
    }
    if (!existsSync(this.exeFile)) {
      this.discard(this.manifestFile);
      return null;
    }
    return { ...manifest, file: this.exeFile };
  }

  private readCheck(): CheckRecord | null {
    return this.readJson(this.checkFile, readCheckShape);
  }

  /** A missing or unreadable file is simply "not there" — never a reason to fail construction. */
  private readJson<T>(file: string, shape: (raw: unknown) => T | null): T | null {
    try {
      if (!existsSync(file)) return null;
      return shape(JSON.parse(readFileSync(file, 'utf8')) as unknown);
    } catch {
      return null;
    }
  }

  /** Atomic temp + rename, mirroring `windowSource.ts`. A failed write is not a failed check. */
  private writeCheck(): void {
    const record: CheckRecord = {
      version: CHECK_VERSION,
      checkedAt: this.checkedAt ?? this.now(),
      outcome: this.lastOutcome === 'failed' ? 'failed' : 'ok',
      latestVersion: this.latestVersion,
    };
    if (this.lastError !== undefined) record.error = this.lastError;
    try {
      mkdirSync(this.dir, { recursive: true });
      const temp = `${this.checkFile}.tmp`;
      writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      renameSync(temp, this.checkFile);
    } catch {
      // The cadence record is a convenience; losing it only costs an extra check.
    }
  }
}
