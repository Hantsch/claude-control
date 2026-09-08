/**
 * Pure release logic: semver compare, SHA256SUMS.txt parsing, asset URL extraction
 * (story 019, D2).
 */

import { describe, expect, it } from 'vitest';
import {
  isUpdateAvailable,
  parseSha256Sums,
  portableExeUrl,
  releaseTag,
  sha256For,
  sumsFileUrl,
} from '../../src/core/updates/releaseInfo.ts';

describe('isUpdateAvailable', () => {
  it('is false when the candidate is older', () => {
    expect(isUpdateAvailable('1.3.0', 'v1.2.0')).toBe(false);
  });

  it('is false when the candidate equals the installed version', () => {
    expect(isUpdateAvailable('1.3.0', 'v1.3.0')).toBe(false);
    expect(isUpdateAvailable('1.3.0', '1.3.0')).toBe(false);
  });

  it('is true when the candidate is newer', () => {
    expect(isUpdateAvailable('1.2.9', 'v1.3.0')).toBe(true);
    expect(isUpdateAvailable('1.2.9', '2.0.0')).toBe(true);
  });

  it('never treats a locally-newer-than-latest build as an update', () => {
    expect(isUpdateAvailable('2.0.0', 'v1.9.9')).toBe(false);
  });

  it('returns false, not throw, for malformed version strings', () => {
    expect(isUpdateAvailable('not-a-version', 'v1.0.0')).toBe(false);
    expect(isUpdateAvailable('1.0.0', 'not-a-version')).toBe(false);
    expect(isUpdateAvailable('', '')).toBe(false);
  });
});

describe('parseSha256Sums', () => {
  it('parses a line in the exact producing format written by ci-release.ps1:133', () => {
    const content =
      'a3f5c1e9b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6 *ClaudeControl-1.3.0-portable.exe\n';
    const sums = parseSha256Sums(content);
    expect(sums['ClaudeControl-1.3.0-portable.exe']).toBe(
      'a3f5c1e9b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6',
    );
    expect(sha256For(sums, 'ClaudeControl-1.3.0-portable.exe')).toBe(
      'a3f5c1e9b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6',
    );
  });

  it('returns null from sha256For when the filename is absent', () => {
    const sums = parseSha256Sums(
      'a3f5c1e9b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6 *ClaudeControl-1.3.0-portable.exe\n',
    );
    expect(sha256For(sums, 'nope.exe')).toBeNull();
  });

  it('skips malformed lines instead of throwing', () => {
    const content = ['not a valid line', '', 'zz *bad-hash.exe'].join('\n');
    expect(parseSha256Sums(content)).toEqual({});
  });
});

describe('release asset URL extraction', () => {
  const validRelease = {
    tag_name: 'v1.3.0',
    assets: [
      {
        name: 'ClaudeControl-1.3.0-portable.exe',
        browser_download_url: 'https://example.com/ClaudeControl-1.3.0-portable.exe',
      },
      {
        name: 'SHA256SUMS.txt',
        browser_download_url: 'https://example.com/SHA256SUMS.txt',
      },
    ],
  };

  it('extracts the portable exe url by pattern, not exact name', () => {
    expect(portableExeUrl(validRelease)).toBe('https://example.com/ClaudeControl-1.3.0-portable.exe');
  });

  it('extracts the sums file url', () => {
    expect(sumsFileUrl(validRelease)).toBe('https://example.com/SHA256SUMS.txt');
  });

  it('extracts the release tag', () => {
    expect(releaseTag(validRelease)).toBe('v1.3.0');
  });

  it('returns null (not throw) when the exe asset is missing', () => {
    const missingExe = {
      tag_name: 'v1.3.0',
      assets: [{ name: 'SHA256SUMS.txt', browser_download_url: 'https://example.com/SHA256SUMS.txt' }],
    };
    expect(portableExeUrl(missingExe)).toBeNull();
  });

  it('returns null for missing/malformed payloads without throwing', () => {
    expect(portableExeUrl(null)).toBeNull();
    expect(portableExeUrl(undefined)).toBeNull();
    expect(portableExeUrl({})).toBeNull();
    expect(portableExeUrl({ assets: 'not-an-array' })).toBeNull();
    expect(sumsFileUrl({})).toBeNull();
    expect(releaseTag({})).toBeNull();
    expect(releaseTag(null)).toBeNull();
  });
});
