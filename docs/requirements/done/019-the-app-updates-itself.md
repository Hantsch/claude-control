---
id: 019
title: The app updates itself
status: done # draft -> ready -> in-progress -> done
created: 2026-09-08
---

## Requirement

Shipping a fix does not put it on the user's machine. The app is a single portable EXE the user
put somewhere themselves ([electron-builder.yml](../../electron-builder.yml): `target: portable`,
`publish: null`), and [README.md:24](../../README.md) tells them so in as many words: *"There is
no auto-update — watch the releases page, or the repository, for a new version."* So the release
pipeline is complete on the producing side — CI derives the version, builds the EXE, writes
`SHA256SUMS.txt` and creates the GitHub release ([scripts/ci-release.ps1](../../scripts/ci-release.ps1))
— and stops one step short of the only place it matters. A tray app that runs all day is exactly
the kind of program whose user never goes looking for a releases page.

What the user should get: they start the app, and it is the current version. Not a page to watch,
not a download to redo, not a file to overwrite by hand. The check and the fetch happen on their
own; the moment the running app is replaced is the next start it does anyway, so a session is
never interrupted for it.

**This changes a documented product property, deliberately.** N1 in
[CONCEPT.md:47](../CONCEPT.md) is "no outbound requests by default — the opt-in
exact-context-window lookup is the sole exception". An update check is a second outbound path,
and unlike the first one it is not something the user switched on. The concept, the README's
"What it does not do" list ([README.md:57](../../README.md)) and the Settings → Diagnostics text
([SettingsView.tsx:514](../../src/renderer/components/SettingsView.tsx)) all state the old
promise and have to state the new one instead — the app must not claim in its own UI that it
sends nothing while it is checking for updates. Story
[005](done/005-exact-context-windows.md) already walked this exact line for the context-window
table: opt-in, one bounded request, a named URL shown in Settings, every failure path silent.
This story asks for the same discipline applied to a path that is on by default.

The distribution model stays portable — decided with the user on 2026-09-08, over the
alternative of switching to an NSIS installer so `electron-updater` could be used. That library
does not support the portable target at all, so the mechanism here is the app's own: read the
GitHub releases API, compare against `app.getVersion()`, download the release's portable EXE,
verify it against the release's `SHA256SUMS.txt`, and swap the file the user actually launched
(`PORTABLE_EXECUTABLE_FILE`, the stable path [toast-protocol.ts:138](../../src/main/toast-protocol.ts)
already prefers over the temp `process.execPath`) — not the temp extraction dir. The EXE is
unsigned, so the checksum is not a nicety: it is the only thing standing between "update" and
"run whatever the network handed us".

## Acceptance Criteria

- [x] **AC1** — Starting a version older than the latest GitHub release results in that release's
      EXE being downloaded and staged, without the user doing anything
- [x] **AC2** — A download is verified against the release's `SHA256SUMS.txt` before it counts as
      staged; a mismatch discards it and leaves the installed app untouched
- [x] **AC3** — The staged update is applied at a start of the app, and the running session is
      never interrupted to apply it — the app does not quit or restart itself to update
- [x] **AC4** — After the update is applied, the app runs from the same path the user launched
      before (their portable EXE is replaced in place, not left beside a second copy), and
      `app.getVersion()` reports the new version
- [x] **AC5** — Starting the latest version performs the check and does nothing else: no
      download, no staged file, no UI change
- [x] **AC6** — Every failure — no network, GitHub unreachable or rate-limiting, malformed
      response, missing asset, failed checksum, unwritable EXE path — leaves a working app at the
      current version and never blocks or delays startup
- [x] **AC7** — The user can see the update state (current version, last check, what is staged,
      why the last attempt failed) and can turn the whole thing off, in Settings
- [x] **AC8** — With updates turned off, the app makes no outbound request for them at all
- [x] **AC9** — The app's own statements about network use are true again: concept N1, the
      README's "What it does not do", and the Settings → Diagnostics text describe the update
      check as it is actually built
- [x] **AC10** — A dev run (`npm run dev`, unpackaged) never downloads or replaces anything

## Open Questions

- ~~**What is "at a start"?**~~ answered → Decisions
- ~~**Is there anything to show, or is silent really silent?**~~ answered → Decisions
- ~~**How often is the check?**~~ answered → Decisions
- ~~**Prereleases and downgrades.**~~ answered → Decisions
- ~~**Rate limits.**~~ answered → Decisions
- ~~**Where does the download live?**~~ answered → Decisions
- ~~**Does the release pipeline change?**~~ answered → Decisions
- ~~**Default on or off?**~~ answered → Decisions

## Decisions

- **(User)** Off by default, opt-in only. The requirement's literal "on by default" reading is
  not taken — N1 gains a **second** named opt-in exception (alongside the exact-context-window
  lookup) instead of losing its default-off guarantee. Mirrors story 005's discipline exactly:
  opt-in, one bounded request while it's on, named in Settings.
- **(User)** Swap mechanism: at the very start of the next manual launch, **before**
  `app.requestSingleInstanceLock()` ([index.ts:37](../../src/main/index.ts)) — no detached
  helper process, no relaunch. The session performing the swap keeps running as the version it
  already loaded into memory; only the *file on disk* changes. `app.getVersion()` therefore
  reports the new version starting with the **following** start, once Electron itself loads the
  swapped file — not the same session that did the swap. This satisfies AC3 (no self-restart)
  and AC4 (same path, new version on next read) without contradiction.
- **(User)** One-time notice: a toast ("Updated to vX.Y.Z") shown once, on the first start that
  is actually *running* the new version — driven by a small marker file the swap step leaves
  behind, checked and deleted right after. Never shown on the swap's own start, since that
  session is still running the old code and doesn't know its own new version yet.
- **(User)** Cadence: at most once per calendar day. First start of the day performs the real
  check; every later start that day is served from the cached result. Shape mirrors
  `windowSource.ts`'s ceiling/cadence/backoff policy
  ([windowSource.ts:41-47](../../src/core/context/windowSource.ts)), sized down to a single
  day-cadence + a short failure backoff (no ceiling needed — there is nothing to keep serving
  stale, unlike a context-window table).
- Prereleases/downgrades: `GET /releases/latest` already skips prereleases. The comparison
  additionally never proposes an update when the installed version is ≥ the latest release's
  (semver compare) — no downgrades, ever, including "installed is a local/newer build."
- Rate limits: a 403/429 from the GitHub API is just one more entry in AC6's failure list —
  silent, backed off like any other failure, never surfaced as an alarming error.
- Staging location: `<userData>/updates/`, next to `settings.json` and `model-windows.json`. A
  leftover partial download from a crashed attempt is discarded on the next construct; only one
  staged version is ever kept (a newer stage replaces an older one).
- Release pipeline: yes, it changes. `SHA256SUMS.txt`'s format
  (`<hash> *<name>`, [ci-release.ps1:133](../../scripts/ci-release.ps1)) becomes a contract the
  app parses, so `ci-release.ps1` gains a self-check that the file it just wrote matches that
  exact format — a producing-side regression then fails the release instead of silently breaking
  every client.

## Plan

Order: reword the promise and add the (inert) setting first, then the pure logic, then the two
risky I/O pieces (network+stage, then disk-swap-at-launch), then wiring/UI, then the release-side
self-check — mirrors story 005's sequencing.

1. **D1 — Promise + setting (no network yet).** `updates: { enabled: boolean }` (default `false`)
   in `settings.ts`; reword the absolute "no network requests" claims in `README.md`,
   `docs/CONCEPT.md` N1, the `SettingsView.tsx` Diagnostics footer, and the stale N1 comment in
   `main/index.ts:48-50`, to name *two* opt-in exceptions.
2. **D2 — Pure release logic (`core/updates/releaseInfo.ts`, new).** Semver compare (never
   downgrade), `SHA256SUMS.txt` line parser, GitHub release JSON → asset URL extraction for the
   portable exe + sums file. No IO.
3. **D3 — Fetch, download, verify, stage (`core/updates/updateSource.ts`, new).** Mirrors
   `windowSource.ts`'s fetch/cache/policy shape: 10 s-aborted `fetch` of `/releases/latest`, day
   cadence + failure backoff, download the exe asset into `<userData>/updates/`, verify its
   SHA256 against the parsed sums file, stage on match / discard on mismatch. Never throws, no
   request while disabled. Widen `boundaries.test.ts`'s allowlist to this file, same shape as
   005's D3 note.
4. **D4 — Apply at launch (`main/selfUpdate.ts`, new + `main/index.ts` wiring).** Before the
   single-instance lock: if packaged, portable (`PORTABLE_EXECUTABLE_FILE` set — reuse
   `toast-protocol.ts:138`'s check), and a valid staged update exists, re-verify its hash and
   swap it into the launched exe's path (rename current aside, move staged in, best-effort
   cleanup), leaving an "applied" marker. After `whenReady()`: if that marker exists, show the
   one-time toast and delete it. The periodic `updateSource.refresh()` call (mirroring
   `index.ts:157-164`'s `windowSource` block) is itself gated on packaged+portable — a dev run
   never checks or swaps anything (AC10).
5. **D5 — IPC surface.** `UpdateStatus` type + a `refreshUpdateCheck` channel in `shared/ipc.ts`,
   handler in `main/ipc.ts` (mirror `refreshModelWindows` at `ipc.ts:118-123`), method in
   `preload.ts`, `DiagnosticsInfo.updates`.
6. **D6 — Settings UI.** An "Updates" section mirroring "Context windows"
   (`SettingsView.tsx:451-467`) with the enable checkbox, and a Diagnostics state line mirroring
   the "Exact context windows" row (`:497-506`): current version, last check, staged version or
   none, last failure reason.
7. **D7 — Release-side self-check.** `ci-release.ps1` reads back its own `SHA256SUMS.txt`
   immediately after writing it and asserts the `<64-hex> *<exeName>` shape, failing the release
   on drift.

## Deliverables

- [x] **D1 — Promise + inert setting.** `updates: { enabled: boolean }` (default `false`) in
      [settings.ts](../../src/core/model/settings.ts) incl. `mergeSettings` guard; reworded
      wording in [README.md](../../README.md) ("What it does not do" + the "no auto-update" line
      near the Download section), [docs/CONCEPT.md](../CONCEPT.md) (N1), the Diagnostics footer
      in [SettingsView.tsx:512-517](../../src/renderer/components/SettingsView.tsx), and the N1
      comment in [main/index.ts:48-50](../../src/main/index.ts) — all naming *two* opt-in
      exceptions (context windows, updates), not one. *Accept:* `mergeSettings({})` yields
      `updates.enabled: false`; a unit test asserts the field; a wording test (new
      `test/unit/networkPromiseWording.test.ts`) asserts the old absolute phrase is gone from
      README/CONCEPT/the Diagnostics footer and the new two-exception wording is present.
- [x] **D2 — Pure release logic (`src/core/updates/releaseInfo.ts`, new).** Semver compare with a
      never-downgrade rule; `SHA256SUMS.txt` parser for the exact `<hash> *<name>` shape written
      by `ci-release.ps1:133`; asset-URL extraction from a `/releases/latest` JSON payload for
      `ClaudeControl-<version>-portable.exe` and `SHA256SUMS.txt`. No IO, no bundled data.
      *Accept:* `test/unit/releaseInfo.test.ts` covers older/equal/newer/local-newer-than-latest,
      a fixture `SHA256SUMS.txt` line in the producing format, and a missing-asset payload → null.
- [x] **D3 — Fetch, download, verify, stage (`src/core/updates/updateSource.ts`, new).** 10 s
      abort like `windowSource.ts`; day-cadence + failure backoff (no ceiling); downloads the
      release exe into `<dataDir>/updates/`, verifies SHA256 against D2's parser, stages on
      match, discards on mismatch (leaving any previous stage/the installed app untouched);
      cleans up an abandoned partial download on construct; `status()` mirrors
      `ModelWindowStatus`'s shape (enabled, currentVersion, latestVersion, updateAvailable,
      staged, checkedAt, lastOutcome, lastError). Never throws, never requests while disabled.
      Widen `test/unit/boundaries.test.ts`'s allowlist to this file. *Accept:*
      `test/unit/updateSource.test.ts` (stubbed `fetch`, fake clock, temp dir) covers: newer
      release → staged; already latest → no download/no state change (AC5); disabled → no
      request at all (AC8); checksum mismatch → discarded, prior state untouched (AC2); HTTP
      error / malformed JSON / missing asset / offline / unwritable staging path → all land in
      `lastOutcome: 'failed'`, none throw (AC6); a green `boundaries.test.ts`.
- [x] **D4 — Apply at launch (`src/main/selfUpdate.ts`, new; wiring in
      [main/index.ts](../../src/main/index.ts)).** A function run before
      `app.requestSingleInstanceLock()` (`index.ts:37`) that, only when `app.isPackaged` and
      `process.env.PORTABLE_EXECUTABLE_FILE` is set, re-verifies and swaps a valid staged update
      into the launched exe's path (rename current aside → move staged in → best-effort cleanup),
      leaving an "applied" marker; any failure at any step leaves the running exe untouched and
      never throws. After `whenReady()`, alongside the existing `windowSource` scheduling block
      (`index.ts:152-164`), an equivalent block calls `updateSource.refresh()` on the day cadence
      — itself gated on the same packaged+portable check, so a dev run never checks or downloads
      either (AC10) — and, separately, checks the "applied" marker once to fire the one-time
      toast (plain `Notification`, mirroring `notifier.ts:77-85`) and delete it. *Accept:*
      `test/unit/selfUpdate.test.ts` (injected fs/paths, no real Electron boot) covers: a valid
      stage is swapped into the target path with no second copy left behind and no
      quit/relaunch call made anywhere in the path (AC3/AC4); an unreadable manifest / re-verify
      mismatch / failed rename leaves the original exe untouched and doesn't throw (AC6); the
      packaged+portable gate blocks the swap, the periodic check, and the toast check alike when
      either condition is false (AC10).
- [x] **D5 — IPC surface.** `UpdateStatus` type + `refreshUpdateCheck` channel in
      [shared/ipc.ts](../../src/shared/ipc.ts); handler in
      [main/ipc.ts](../../src/main/ipc.ts) mirroring `refreshModelWindows` (`ipc.ts:118-123`);
      method in [main/preload.ts](../../src/main/preload.ts); `DiagnosticsInfo.updates`.
      *Accept:* the handler calls `updateSource.refresh({ force: true })` and resolves with the
      outcome, covered by extending `updateSource.test.ts` or a thin `ipc.test.ts` case if one
      exists for `refreshModelWindows`.
- [x] **D6 — Settings UI.** An "Updates" section in
      [SettingsView.tsx](../../src/renderer/components/SettingsView.tsx) mirroring "Context
      windows" (`:451-467`): enable checkbox, hint text naming the cadence and that it's the
      second (and only other) network request; a Diagnostics state line mirroring the "Exact
      context windows" row (`:497-506`) — current version, last check, staged version or "none",
      last failure reason, "off — no network requests" when disabled. The status-line formatting
      is extracted into a pure function (mirroring 005's `contextProvenance.ts` follow-up) so it
      is unit-testable without a component-testing library. *Accept:*
      `test/unit/updateStatusLine.test.ts` (or similarly named) covers the on/off/staged/failed
      text variants (AC7).
- [x] **D7 — Release-side self-check.** [ci-release.ps1](../../scripts/ci-release.ps1) reads back
      `SHA256SUMS.txt` right after writing it (`:133`) and throws (failing the release) if it
      doesn't match `^[0-9a-f]{64} \*.+$` with the expected exe name and hash. *Accept:* a
      deliberately corrupted write in a local dry run fails the script; the real format continues
      to pass.

**AC coverage:** AC1 → D3 + D5 · AC2 → D3 · AC3 → D4 · AC4 → D4 · AC5 → D3 · AC6 → D3 + D4 ·
AC7 → D6 · AC8 → D3 (+ D1 default) · AC9 → D1 · AC10 → D4.

## Model Hints

- `D3 → deliverable-hard` — downloads and disk-stages an executable verified only by a checksum;
  a bug in the compare/discard logic is a security regression (AC2 fails silently: an unverified
  binary would look "staged"), not just a UX one. Same family of risk as 005's D3 but higher
  stakes than a JSON table.
- `D4 → deliverable-hard` — swaps the app's own running executable before the single-instance
  lock even runs; a wrong sequencing here either corrupts the install (AC4), leaves a second copy
  beside it (AC4), or — worst case — the swap logic runs in a dev checkout because the
  packaged/portable guard is wrong (AC10). Startup must also never block on any of this (AC6).
- All other Ds: default tier (pure/bounded logic, wiring that mirrors an existing pattern
  closely, or a one-file script check).
- `Review: → story-review-hard` — changes a documented product promise (N1) a second time, adds
  the app's first executable-download-and-swap path, and touches core/IPC/renderer/main/release
  script. A cheap review checks the diff; this needs someone checking the checksum and swap logic
  actually can't be tricked into installing something unverified.

## Acceptance Tests

`ui-acceptance-required: true` and the profile's `e2e: none` — there is no browser/Electron
automation harness in this repo, and building one is out of scope for this story (it would be its
own infrastructure story). Every criterion below is therefore covered one level down, by unit
tests against the core/main modules with the network, filesystem and Electron primitives faked —
named here as the gap this leaves, not silently turned into a manual step.

- AC1 → unit `test/unit/updateSource.test.ts` › "a newer release is downloaded, verified, and
  staged without any caller action"
- AC2 → unit `test/unit/updateSource.test.ts` › "a checksum mismatch discards the download and
  leaves the previous stage/installed app untouched"
- AC3 → unit `test/unit/selfUpdate.test.ts` › "the swap runs once before the lock and never calls
  quit or relaunch"
- AC4 → unit `test/unit/selfUpdate.test.ts` › "a staged update replaces the exe at its original
  path with no second copy left behind"
- AC5 → unit `test/unit/updateSource.test.ts` › "already on the latest version makes no download
  and changes no state"
- AC6 → unit `test/unit/updateSource.test.ts` › "every network/checksum/disk failure path never
  throws" + unit `test/unit/selfUpdate.test.ts` › "a failed swap leaves the original exe untouched
  and does not throw"
- AC7 → unit `test/unit/updateStatusLine.test.ts` › "status line covers on/off/staged/failed
  text" (Settings toggle persistence itself covered by D1's settings test)
- AC8 → unit `test/unit/updateSource.test.ts` › "makes no request while disabled"
- AC9 → unit `test/unit/networkPromiseWording.test.ts` › "README/CONCEPT/Diagnostics name both
  opt-in exceptions and no longer claim an absolute promise"
- AC10 → unit `test/unit/selfUpdate.test.ts` › "an unpackaged or non-portable run never checks or
  swaps"
- **Gap (named, not silently manual):** none of the above proves that starting the real portable
  EXE built by CI actually performs the swap and keeps running — that would need a real
  Electron-launch harness this repo doesn't have. Carry this into the sprint review as a known
  residue of `e2e: none`, same as every other user-facing story until that harness exists.

## Done

**Summary.** The app now checks GitHub releases once per calendar day (opt-in, off by default),
downloads and SHA256-verifies the portable EXE, and stages it under `<userData>/updates/`. A
staged update is swapped into the launched EXE's own path right before the single-instance lock
on the next manual start — never a self-restart — with a one-time "Updated to vX.Y.Z" toast on
the following start that actually runs the new code. Settings gained an "Updates" toggle and a
Diagnostics status line; N1, the README and the Diagnostics footer now name two opt-in network
exceptions instead of one. `ci-release.ps1` self-checks the `SHA256SUMS.txt` format it writes.

**Commit message:**
```
019: app checks GitHub releases, verifies, and self-updates on next launch
```

**Verification:**
- `npm run build`, `npm test` (499/499, 31 files), `npm run typecheck` — all green, run once
  after the review-fix cycle.
- `e2e: none` per the project profile — no browser/Electron-launch harness exists; every
  criterion is covered one level down by unit tests against core/main with network, filesystem
  and Electron primitives faked. Named gap (unchanged from the story's own `## Acceptance Tests`
  section): no test proves the real CI-built portable EXE performs the swap end-to-end — carry
  into the sprint review as `e2e: none` residue.
- AC → test mapping, as verified:
  - AC1 → `test/unit/updateSource.test.ts` › "a newer release is downloaded, verified, and
    staged without any caller action" — passed
  - AC2 → `test/unit/updateSource.test.ts` › "a checksum mismatch discards the download and
    leaves the previous stage/installed app untouched" — passed
  - AC3 → `test/unit/selfUpdate.test.ts` › "the swap runs once before the lock and never calls
    quit or relaunch" — passed
  - AC4 → `test/unit/selfUpdate.test.ts` › "a staged update replaces the exe at its original
    path with no second copy left behind" — passed
  - AC5 → `test/unit/updateSource.test.ts` › "already on the latest version makes no download
    and changes no state" — passed
  - AC6 → `test/unit/updateSource.test.ts` › "every network/checksum/disk failure path never
    throws" + `test/unit/selfUpdate.test.ts` › "a failed swap leaves the original exe untouched
    and does not throw" — both passed
  - AC7 → `test/unit/updateStatusLine.test.ts` › on/off/staged/failed text variants — passed
  - AC8 → `test/unit/updateSource.test.ts` › "makes no request while disabled" — passed
  - AC9 → `test/unit/networkPromiseWording.test.ts` › README/CONCEPT/Diagnostics name both
    opt-in exceptions, no absolute claim survives anywhere in CONCEPT.md — passed
  - AC10 → `test/unit/selfUpdate.test.ts` › "an unpackaged or non-portable run never checks or
    swaps" — passed
  - **Manual residue:** none. **Named e2e gap:** see above (not manual — no harness exists yet).
- **Code review:** two rounds, `story-review-hard` tier.
  - Round 1 verdict: **FAIL** — AC9 failed (stale single-exception prose survived in
    `docs/CONCEPT.md` alongside an already-updated N1 row; the wording-guard test didn't cover
    that specific sentence). Also flagged four confirmed hardening issues in the security-critical
    D3/D4 paths: a same-session redundant re-download after a swap (main/index.ts used the stale
    in-memory `app.getVersion()` instead of the just-applied version), an unbounded in-memory
    read when a hostile response omits `content-length`, no scheme/host allowlist on asset
    download URLs from the release JSON, and a missing re-hash after the EXDEV cross-volume
    fallback write in the swap path.
  - Fix cycle: `docs/CONCEPT.md` prose reworded to name both exceptions; the wording test's
    stale-phrase list extended with the exact removed string; `main/index.ts` gained an
    `installedVersion()` helper so a just-swapped session doesn't re-check against its stale
    in-memory version; `updateSource.ts` gained a streaming, incrementally-capped read
    (`readCapped`) and a genuine host/scheme allowlist (`isTrustedAssetUrl`, not a substring
    check) for both asset URLs; `selfUpdate.ts`'s EXDEV fallback now re-reads and re-hashes the
    written target, rolling back on mismatch. 10 new/extended test cases added across
    `updateSource.test.ts` and `selfUpdate.test.ts`.
  - Round 2 verdict: **PASS** — all five items independently re-verified against the actual code
    and real (non-mocked) test behavior; no regressions; `npm test`/`npm run typecheck` green on
    the reviewer's own run; diff confined to story-scope files (the ~90 other modified files in
    the working tree are pre-existing LF→CRLF churn, not this story's content).
  - Non-blocking residual notes from round 2 (deliberately left unfixed): `installedVersion()`
    has no automated coverage — this repo has no `main/index.ts` unit-test harness at all (it
    boots Electron at import time), consistent with the story's own named `e2e: none` gap;
    `isTrustedAssetUrl` validates only the initial GitHub URL, not any redirect target — accepted
    because the SHA256 gate independently covers the actual integrity threat regardless of which
    host ultimately served the bytes; a double-failure case (rollback rename itself failing after
    an EXDEV re-verify mismatch) is documented in code as the deliberate last-resort branch.
  - 2 of the allowed 3 review-fix cycles used.
- **Pre-existing tree hygiene note (not this story's doing, not fixed here):** the working tree
  has ~90 files differing only by LF→CRLF line-ending churn, unrelated to story 019's ~12
  content-changed files. Flagged for whoever commits, not addressed as part of this story.
