/**
 * `scripts/ci-release.ps1` against a throwaway repo with a bare origin and stubbed `npm` / `gh`,
 * so nothing real is built, pushed or published. The fixture exposes the stub log, env overrides
 * for the `gh` exit codes and a runner returning `{ code, output }`.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

// One stub for both tools: logs "<tool> <args>"; `npm run package` leaves the artifact the
// script expects; the exit codes of `gh release view|create` come from the environment.
const STUB = `import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [name, ...args] = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, name + ' ' + args.join(' ') + '\\n');
if (name === 'npm' && args.join(' ') === 'run package') {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  mkdirSync('release', { recursive: true });
  writeFileSync(path.join('release', 'ClaudeControl-' + version + '-portable.exe'), 'stub exe');
}
if (name === 'gh') {
  const sub = args.slice(0, 2).join(' ');
  if (sub === 'release view') process.exit(Number(process.env.STUB_GH_VIEW_EXIT ?? 0));
  if (sub === 'release create') process.exit(Number(process.env.STUB_GH_CREATE_EXIT ?? 0));
}
`;

interface Fixture {
  dir: string;
  clone: string;
  origin: string;
  logPath: string;
  /** Lines the stubs logged, e.g. `npm test`, `npm run package`, `gh release create ...`. */
  log(): string[];
  git(...args: string[]): string;
  commit(message: string): void;
  run(args?: string[], env?: Record<string, string>): { code: number | null; output: string };
}

const fixtures: Fixture[] = [];

function makeFixture(): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-release-'));
  const origin = path.join(dir, 'origin.git');
  const clone = path.join(dir, 'clone');
  const bin = path.join(dir, 'bin');
  const logPath = path.join(dir, 'stub.log');
  writeFileSync(logPath, '');

  const git = (...args: string[]): string => {
    const r = spawnSync('git', args, { cwd: clone, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  };

  spawnSync('git', ['init', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  mkdirSync(clone);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('remote', 'add', 'origin', origin);

  mkdirSync(path.join(clone, 'scripts'));
  for (const f of ['ci-release.ps1', 'plan-release.ps1', 'release.ps1']) {
    cpSync(path.join(repoRoot, 'scripts', f), path.join(clone, 'scripts', f));
  }
  writeFileSync(path.join(clone, 'package.json'), JSON.stringify({ name: 'claude-control', version: '1.0.0' }, null, 2) + '\n');
  writeFileSync(
    path.join(clone, 'package-lock.json'),
    JSON.stringify(
      { name: 'claude-control', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'claude-control', version: '1.0.0' } } },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(
    path.join(clone, 'CHANGELOG.md'),
    '# Changelog\n\n## Unreleased\n\n- Something new.\n\n## 1.0.0 — 2026-01-01\n\n- First release.\n',
  );
  git('add', '-A');
  git('commit', '-m', 'chore: initial');
  git('tag', '-a', 'v1.0.0', '-m', 'claude-control 1.0.0');
  // -u: like a CI checkout, main tracks origin/main, so the script's bare `git push` has a target.
  git('push', '-u', '--follow-tags', 'origin', 'main');

  mkdirSync(bin);
  writeFileSync(path.join(bin, 'stub.mjs'), STUB);
  for (const name of ['npm', 'gh']) {
    writeFileSync(path.join(bin, `${name}.cmd`), `@node "%~dp0stub.mjs" ${name} %*\r\n`);
  }

  const shell = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).error ? 'powershell' : 'pwsh';

  const fixture: Fixture = {
    dir,
    clone,
    origin,
    logPath,
    log: () => readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean),
    git,
    commit(message) {
      git('commit', '--allow-empty', '-m', message);
    },
    run(args = [], env = {}) {
      const r = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/ci-release.ps1', ...args], {
        cwd: clone,
        encoding: 'utf8',
        env: { ...process.env, ...env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, STUB_LOG: logPath },
      });
      return { code: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    },
  };
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const f of fixtures.splice(0)) rmSync(f.dir, { recursive: true, force: true });
});

describe('ci-release test gate', () => {
  it('a docs-only push releases nothing and runs no tests', () => {
    const fx = makeFixture();
    fx.commit('docs: reword the readme');

    const { code, output } = fx.run(['-DryRun']);

    expect(code, output).toBe(0);
    expect(output).toContain('nothing to release');
    expect(fx.log().filter((l) => l === 'npm test')).toEqual([]);
  });

  it('a due release runs the suite once before anything is committed', () => {
    const fx = makeFixture();
    fx.commit('feat: add a thing');

    const { code, output } = fx.run(['-DryRun']);

    expect(code, output).toBe(0);
    const log = fx.log();
    expect(log.filter((l) => l === 'npm test')).toHaveLength(1);
    expect(log.indexOf('npm test')).toBeLessThan(log.indexOf('npm run package'));
    expect(output).toContain('=== test ===');
    expect(output.indexOf('=== test ===')).toBeLessThan(output.indexOf('[dry-run] git commit'));
  });

  it('the release workflow leaves testing to the script and says why', () => {
    const workflow = readFileSync(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
    expect(workflow).not.toContain('npm test');

    const lines = readFileSync(path.join(repoRoot, 'scripts/ci-release.ps1'), 'utf8').split(/\r?\n/);
    const testAt = lines.findIndex((l) => /^\s*&\s*npm test\b/.test(l));
    const gitAt = lines.findIndex((l) => /Invoke-Git @\(/.test(l));
    // The plan's bump=none exit is the last "nothing to release" before the tests; the earlier one is the tag-at-HEAD path.
    let nothingAt = -1;
    lines.forEach((l, i) => {
      if (i < testAt && l.includes('nothing to release')) nothingAt = i;
    });
    expect(lines.slice(nothingAt - 3, nothingAt + 1).some((l) => /bump -eq 'none'/.test(l))).toBe(true);
    expect(testAt).toBeGreaterThan(nothingAt);
    expect(testAt).toBeLessThan(gitAt);
    expect(lines.slice(testAt - 3, testAt).some((l) => /merge/i.test(l))).toBe(true);
  });
});

/** HEAD is the release commit of 1.1.0, tagged and pushed - what a run leaves behind once the tag is out. */
function tagRelease(fx: Fixture): void {
  const pkg = { name: 'claude-control', version: '1.1.0' };
  writeFileSync(path.join(fx.clone, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync(
    path.join(fx.clone, 'package-lock.json'),
    JSON.stringify({ ...pkg, lockfileVersion: 3, packages: { '': pkg } }, null, 2) + '\n',
  );
  writeFileSync(
    path.join(fx.clone, 'CHANGELOG.md'),
    '# Changelog\n\n## Unreleased\n\n## 1.1.0 — 2026-02-01\n\n- A new thing.\n\n## 1.0.0 — 2026-01-01\n\n- First release.\n',
  );
  fx.git('add', '-A');
  fx.git('commit', '-m', 'chore(release): 1.1.0 [skip ci]');
  fx.git('tag', '-a', 'v1.1.0', '-m', 'claude-control 1.1.0');
  fx.git('push', '--follow-tags');
}

describe('ci-release with a tag at HEAD', () => {
  it('a tag whose release creation failed is published by re-running the job', () => {
    const fx = makeFixture();
    fx.commit('feat: add a thing');

    const failed = fx.run([], { STUB_GH_CREATE_EXIT: '1' });
    expect(failed.code, failed.output).not.toBe(0);
    const originGit = (...args: string[]) => fx.git(`--git-dir=${fx.origin}`, ...args);
    expect(originGit('tag', '--list', 'v1.1.0').trim()).toBe('v1.1.0');
    expect(originGit('log', '-1', '--format=%s', 'main').trim()).toBe('chore(release): 1.1.0 [skip ci]');

    // Exactly the push the script performs, parsed from it.
    const pushCall = readFileSync(path.join(repoRoot, 'scripts/ci-release.ps1'), 'utf8').match(/Invoke-Git @\('push'((?:,\s*'[^']*')*)\)/);
    expect(pushCall, 'push call not found in ci-release.ps1').not.toBeNull();
    const pushArgs = ['push', ...[...(pushCall![1] ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '')];
    const originBefore = fx.git('ls-remote', 'origin');
    const repush = spawnSync('git', pushArgs, { cwd: fx.clone, encoding: 'utf8' });
    expect(repush.status, repush.stderr).toBe(0);
    expect(fx.git('ls-remote', 'origin')).toBe(originBefore);

    const head = fx.git('rev-parse', 'HEAD');
    const originTags = fx.git('ls-remote', '--tags', 'origin');
    const logBefore = fx.log().length;

    const { code, output } = fx.run([], { STUB_GH_VIEW_EXIT: '1', STUB_GH_CREATE_EXIT: '0' });

    expect(code, output).toBe(0);
    expect(output).toContain('=== recover ===');
    expect(output).toContain('notes from CHANGELOG: ## 1.1.0');
    const log = fx.log().slice(logBefore);
    expect(log.filter((l) => l === 'npm test')).toEqual([]);
    expect(log.filter((l) => l === 'npm run package')).toHaveLength(1);
    expect(log.filter((l) => l.startsWith('gh release create '))).toHaveLength(1);
    expect(log.filter((l) => l.startsWith('gh release create v1.1.0 '))).toHaveLength(1);
    expect(fx.git('rev-parse', 'HEAD')).toBe(head);
    expect(fx.git('ls-remote', '--tags', 'origin')).toBe(originTags);
  });

  it("recovery in a dry run names the path and prints the version's notes heading", () => {
    const fx = makeFixture();
    tagRelease(fx);

    const { code, output } = fx.run(['-DryRun'], { STUB_GH_VIEW_EXIT: '1' });

    expect(code, output).toBe(0);
    expect(output).toContain('=== recover ===');
    expect(output).toContain('notes from CHANGELOG: ## 1.1.0');
    expect(output).toContain('[dry-run] gh release create v1.1.0');
    expect(output).toContain('- A new thing.');
  });

  it('a tag that already has its release is left alone', () => {
    const fx = makeFixture();
    tagRelease(fx);

    const { code, output } = fx.run([], { STUB_GH_VIEW_EXIT: '0' });

    expect(code, output).toBe(0);
    expect(output).toContain('v1.1.0 is already released');
    const log = fx.log();
    expect(log).toContain('gh release view v1.1.0');
    expect(log.filter((l) => l.startsWith('npm'))).toEqual([]);
    expect(log.filter((l) => l.startsWith('gh release create'))).toEqual([]);
  });
});
