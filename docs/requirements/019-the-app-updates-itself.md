---
id: 019
title: The app updates itself
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — Starting a version older than the latest GitHub release results in that release's
      EXE being downloaded and staged, without the user doing anything
- [ ] **AC2** — A download is verified against the release's `SHA256SUMS.txt` before it counts as
      staged; a mismatch discards it and leaves the installed app untouched
- [ ] **AC3** — The staged update is applied at a start of the app, and the running session is
      never interrupted to apply it — the app does not quit or restart itself to update
- [ ] **AC4** — After the update is applied, the app runs from the same path the user launched
      before (their portable EXE is replaced in place, not left beside a second copy), and
      `app.getVersion()` reports the new version
- [ ] **AC5** — Starting the latest version performs the check and does nothing else: no
      download, no staged file, no UI change
- [ ] **AC6** — Every failure — no network, GitHub unreachable or rate-limiting, malformed
      response, missing asset, failed checksum, unwritable EXE path — leaves a working app at the
      current version and never blocks or delays startup
- [ ] **AC7** — The user can see the update state (current version, last check, what is staged,
      why the last attempt failed) and can turn the whole thing off, in Settings
- [ ] **AC8** — With updates turned off, the app makes no outbound request for them at all
- [ ] **AC9** — The app's own statements about network use are true again: concept N1, the
      README's "What it does not do", and the Settings → Diagnostics text describe the update
      check as it is actually built
- [ ] **AC10** — A dev run (`npm run dev`, unpackaged) never downloads or replaces anything

## Open Questions

- **What is "at a start"?** AC3 says the swap happens at a start, but the app that has to be
  replaced is the one doing the replacing. Two shapes: a detached helper that waits for our exit
  and swaps before relaunching (so "next start" is immediate and the app comes back on its own),
  or a swap performed at the *beginning* of the next launch, before the single-instance lock,
  with no relaunch at all. The second is simpler and never resurrects an app the user quit on
  purpose; the first gets the update in sooner. Decide before refine — it determines whether a
  helper script/process exists at all.
- **Is there anything to show, or is silent really silent?** The chosen behaviour is "silent,
  applied at next start". Whether the user is told *at all* that they were updated — a one-time
  tray/toast line after a swap, or nothing beyond the Settings panel of AC7 — is a product call.
  Silently changing the version of a running app is defensible for a tray monitor and indefensible
  for anything that holds user data; this holds none.
- **How often is the check?** Every start is the literal reading of the requirement, but a tray
  app that autostarts may start once a week or twenty times a day. Story 005 solved the same
  problem with a cache plus a floor and a ceiling (`REFRESH_CADENCE_MS`,
  [windowSource.ts](../../src/core/context/windowSource.ts)) — reuse that shape, or accept one
  request per start?
- **Prereleases and downgrades.** `/releases/latest` skips prereleases, which is probably right,
  but the comparison also has to decide what happens when the installed version is *newer* than
  the latest release (a local build, or a release that was pulled). Never downgrade, presumably —
  state it.
- **Rate limits.** Unauthenticated GitHub API is 60 requests/hour per IP. A single check per start
  cannot realistically hit that, but it is shared with everything else on the user's IP, so a 403
  is a normal outcome and not an error worth surfacing loudly. Confirm that reading is intended.
- **Where does the download live?** A partially downloaded or staged EXE has to sit somewhere that
  survives a quit but is not the app dir the user might have on a synced folder or a USB stick.
  `app.getPath('userData')` is where settings and the model-window cache already live; confirm,
  and decide what cleans up an abandoned staging file.
- **Does the release pipeline change?** The mechanism reads the release assets that
  `ci-release.ps1` already produces, so possibly nothing changes. But `SHA256SUMS.txt`'s format
  (`<hash> *<name>`, written at [ci-release.ps1:133](../../scripts/ci-release.ps1)) becomes a
  contract the app parses — if that is to be relied on, it wants a test on the producing side too,
  not only in the client.
- **Default on or off?** The requirement says the app updates itself, which means on by default,
  which is what breaks N1. Worth one explicit confirmation from the user, because "off by default"
  would keep the concept intact and make the whole feature nearly pointless — the honest reading is
  that N1 changes, not that the feature hides behind a switch.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
