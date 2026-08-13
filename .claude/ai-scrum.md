# AI Scrum — Project Profile

<!--
  Managed by the ai-scrum plugin. Safe to edit by hand — `/ai-scrum:setup` only
  rewrites values you confirm, and never touches your `## Notes`.

  This file holds FACTS the workflow commands need verbatim (verify commands, paths,
  branch strategy). Project RULES and architecture guardrails stay in CLAUDE.md —
  the commands read both.
-->

ai-scrum-version: 2.0.0
project: claude-control

## Verify

Commands the build step runs before a story may be called done. Use `none` when a
step does not exist in this project.

build: npm run build
test: npm test
lint: none
typecheck: npm run typecheck

## Conventions

doc-language: en <!-- language for generated artifacts: stories, sprint reviews, concepts -->
requirements-path: docs/requirements
sprints-path: docs/sprints
roadmap-path: docs/ROADMAP.md
concepts-path: docs/concepts
systems-path: docs/systems
story-id-format: NNN <!-- three digits + slug, e.g. 042-npc-haggling.md -->
sprint-id-format: SNN <!-- e.g. S07 -->

## Branching

branch-base: main <!-- branch a sprint is cut from -->
sprint-branch-pattern: sprint/{id}
auto-commit-per-story: true <!-- /ai-scrum:sprint commits once per story ON THE SPRINT BRANCH only -->
protected-branches: main <!-- never commit here, never push, never merge -->

## Acceptance

ui-acceptance-required: true
<!--
  true  = P1 applies: every user-facing capability needs a real path through the
          actual UI. An acceptance or test-plan step for a user action that requires
          a console command or a direct internal call is a story gap, not a valid
          test. Pure engine/backend stories without a UI are exempt.
-->

live-smoke-required: true
<!--
  true  = P2 applies: for a story with visible UI, a green build/test run is not
          enough — the real flow must be driven through the running app before the
          story may be set to done. If the session cannot do that, the story stays
          in-progress and is handed over as "built, acceptance pending".
-->

live-smoke-how: npm run dev (electron-vite dev) to launch the tray app, then drive/inspect it via src/cli/index.ts and log/file inspection — no browser automation available for the Electron tray UI (window + native tray), so acceptance is manual observation guided by CLI output.

## Context to read before coding

Files every implementation and review agent must read before touching code.
Keep this short — it is pasted into every subagent prompt.

- <no CLAUDE.md yet in this project — add it here once one exists>

## Notes

<!-- Free text. Never overwritten by setup/update. Project quirks worth knowing. -->
