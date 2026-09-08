/**
 * Pure release logic for the self-update mechanism (story 019, D2).
 *
 * No IO of its own — callers fetch the GitHub Releases API and `SHA256SUMS.txt` and hand the
 * raw strings/JSON to the functions here. Nothing in this module throws: malformed input
 * yields `null`/`false`/an empty map, never an exception, since later deliverables (the
 * downloader, the swap) build their own error handling around these results.
 */

/** Parsed `major.minor.patch`, ignoring any pre-release/build metadata suffix. */
interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parses a version string, tolerating an optional leading `v` (as in a GitHub tag) and any
 * trailing pre-release/build metadata (e.g. `-beta.1`, `+build5`), which is ignored. Returns
 * `null` when the string does not start with `<number>.<number>.<number>`.
 */
function parseSemver(version: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

/**
 * True when `candidate` (a release tag/version from GitHub) is a genuine upgrade over
 * `installed` (from `app.getVersion()`). Equal or older — including a locally-newer-than-latest
 * dev build — is never treated as an update. Either string failing to parse yields `false`.
 */
export function isUpdateAvailable(installed: string, candidate: string): boolean {
  const from = parseSemver(installed);
  const to = parseSemver(candidate);
  if (!from || !to) return false;
  if (to.major !== from.major) return to.major > from.major;
  if (to.minor !== from.minor) return to.minor > from.minor;
  return to.patch > from.patch;
}

/** filename → lowercase hex sha256, as parsed from a `SHA256SUMS.txt` file's content. */
export type Sha256Sums = Record<string, string>;

/**
 * Parses the content of a `SHA256SUMS.txt` file written by `scripts/ci-release.ps1` (`:133`):
 * one line per file, `<64-hex-hash> *<filename>`. Lines that don't match that shape are
 * skipped rather than throwing. Returns an empty map for empty/malformed input.
 */
export function parseSha256Sums(content: string): Sha256Sums {
  const sums: Sha256Sums = {};
  if (typeof content !== 'string') return sums;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([0-9a-fA-F]{64}) \*(.+)$/.exec(line);
    if (!match) continue;
    const hash = match[1];
    const name = match[2];
    if (!hash || !name) continue;
    sums[name] = hash.toLowerCase();
  }
  return sums;
}

/** Looks up the expected hash for `filename` in a parsed sums map. `null` when absent. */
export function sha256For(sums: Sha256Sums, filename: string): string | null {
  return sums[filename] ?? null;
}

/** Minimal shape read from a GitHub `/releases/latest` API response. */
export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  assets: GitHubReleaseAsset[];
}

/** Matches `ClaudeControl-<anything>-portable.exe`, e.g. `ClaudeControl-1.3.0-portable.exe`. */
const PORTABLE_EXE_NAME_PATTERN = /^ClaudeControl-.+-portable\.exe$/;

const SUMS_FILE_NAME = 'SHA256SUMS.txt';

/** Finds an asset in `release.assets` whose `name` matches `pattern`, or `null` if none does. */
function findAssetUrl(release: unknown, matches: (name: string) => boolean): string | null {
  if (!release || typeof release !== 'object') return null;
  const assets = (release as Partial<GitHubRelease>).assets;
  if (!Array.isArray(assets)) return null;
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object') continue;
    const { name, browser_download_url: url } = asset as Partial<GitHubReleaseAsset>;
    if (typeof name === 'string' && typeof url === 'string' && matches(name)) return url;
  }
  return null;
}

/**
 * Extracts the download URL for the portable exe asset (named like
 * `ClaudeControl-<version>-portable.exe`) from a parsed `/releases/latest` payload. `null`
 * when the payload is malformed or no such asset is present — never throws.
 */
export function portableExeUrl(release: unknown): string | null {
  return findAssetUrl(release, (name) => PORTABLE_EXE_NAME_PATTERN.test(name));
}

/**
 * Extracts the download URL for `SHA256SUMS.txt` from a parsed `/releases/latest` payload.
 * `null` when the payload is malformed or no such asset is present — never throws.
 */
export function sumsFileUrl(release: unknown): string | null {
  return findAssetUrl(release, (name) => name === SUMS_FILE_NAME);
}

/** The release's tag (e.g. `v1.3.0`), or `null` when the payload is malformed. */
export function releaseTag(release: unknown): string | null {
  if (!release || typeof release !== 'object') return null;
  const tag = (release as Partial<GitHubRelease>).tag_name;
  return typeof tag === 'string' && tag.length > 0 ? tag : null;
}
