# claude-control — project rules

Setup and contribution flow: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Test lanes

| Lane | Trigger | Runs | Blocks | Budget |
| --- | --- | --- | --- | --- |
| Story | `/build` (local) | `npm test` (whole suite) | the story | ≤ 30 s |
| PR | `.github/workflows/validate.yml` | typecheck, `npm test`, check-notes, package | the merge | `npm test` ≤ 30 s |
| Release | `.github/workflows/release.yml` | plan; only when a release is due (or a tag lacks its release, recovered by a re-run): `npm test`, then ci-release | the release | `npm test` ≤ 30 s; 0 s when nothing releases |
| Perf | `npm run test:perf` locally, plus `.github/workflows/perf.yml` (weekly schedule + workflow_dispatch) | N4/N5 strict 2 s budgets, `fileParallelism: false` | nothing; reports | none (non-blocking) |

Budgets are targets from one local measurement (7.99 s); exceeding one opens a story, nothing enforces it.

A test in `npm test` never compares elapsed time against a number; a speed budget goes to `test/perf/`, cost is proven by counting (bytes, calls).

Flaky tests: see the [flake policy](.claude/commands/sprint.md#phase-2b--regression-gate-mandatory-after-the-last-story-before-the-review).
