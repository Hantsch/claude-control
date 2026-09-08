# Contributing

## Project status

**v1 released.** Phases 1 and 2 are complete and Phase 3 (accuracy & breadth) is in progress —
see [docs/ROADMAP.md](docs/ROADMAP.md) for where each milestone stands.

- [docs/CONCEPT.md](docs/CONCEPT.md) — the design this was built to
- [docs/RESEARCH.md](docs/RESEARCH.md) — the measured facts about Claude Code's on-disk data
- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) — where each concept section lives in the
  code, and the decisions taken where the concept left a choice open
- [docs/ROADMAP.md](docs/ROADMAP.md) — the one source of status and planning; the open stories
  live in [docs/requirements/](docs/requirements/)
- [CHANGELOG.md](CHANGELOG.md) — what changed per release

## Development

Node 22+ required.

```powershell
npm install

npm run cli            # print the live session list and exit
npm run cli -- --watch # keep printing status changes
npm run dev            # run the tray app with hot reload
npm run package        # build release\ClaudeControl-<version>-portable.exe

npm test               # vitest over core/ with fixtures, including the N2/N4/N5 checks
npm run typecheck      # tsc for the Node side and the renderer
npm run icons          # rebuild assets/icons from the art in output/imagegen (Python + Pillow)
```

Useful flags when starting the app from a terminal:

```powershell
ClaudeControl.exe --show            # open the main window immediately
ClaudeControl.exe --show history    # …on the History tab
ClaudeControl.exe --show popover    # open the tray popover
```

```
src/
├─ core/        pure TypeScript; never imports Electron
│  ├─ adapters/claude/   the only code that knows Claude Code's files and JSONL schema
│  ├─ registry/          sessions/*.json + PID/procStart liveness
│  ├─ state/             state machine, context pressure, subagent tree, aggregation
│  ├─ store/             SessionStore behind a repository interface
│  └─ watch/             chokidar with a 250 ms trailing debounce
├─ main/        Electron: tray, toasts, window focus, IPC, settings
├─ renderer/    React; a pure view, no filesystem access
├─ shared/      the IPC contract
└─ cli/         the command-line printout
```

`npm test` includes the three non-functional checks from CONCEPT.md §10: a status change is
observed within 2 s of an append (N4), the live tier resolves in under 2 s against a
synthetic ~250 MB / 300-file tree (N5), and no file's content, size or mtime changes after a
full pipeline run (N2).

### Releasing

Merging a PR into `main` releases — there is no separate publish step.
[`.github/workflows/release.yml`](.github/workflows/release.yml) derives the version from the
commit messages (Conventional Commits — `feat:` minor, `<type>!:`/`BREAKING CHANGE` major,
`chore:`/`docs:`/`ci:`/`test:`/`style:`/`build:` no release, anything else patch), bumps
`package.json`, builds the portable EXE and publishes a GitHub release with the EXE and its
checksum attached. A merge whose commits are all no-release types releases nothing.

The very first release is the one case with no tag to derive from, so it ships whatever version
`package.json` already carries, verbatim and unbumped. Every release after that is derived.

The notes come from the `## Unreleased` section of [CHANGELOG.md](CHANGELOG.md), and a release
with an empty section fails rather than shipping without notes. `npm run typecheck`, `npm test`
and a full `npm run package` run on every PR, so the artifact is known to build before `main`
promises it.

```powershell
pwsh -File scripts/plan-release.ps1   # what would the next merge release, and why
pwsh -File scripts/check-notes.ps1    # the PR gate's verdict, locally
pwsh -File scripts/release.ps1 -Bump minor   # bump + open a changelog section by hand
```
