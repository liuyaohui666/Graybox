# Graybox team project library implementation plan

> **For agentic workers:** Use subagent-driven-development for implementation and independent review. User approved implementation and local/cloud update on 2026-10-08.

**Goal:** Make Graybox a shared idea backlog and project experience library with priorities, reusable tags, structured retrospectives, discussion and a distributable Codex Skill.

**Architecture:** Extend existing PostgreSQL/Fastify command, revision, audit and idempotency infrastructure. Preserve experiments as legacy project history. Web and Tauri share the project workflow; CLI/MCP use the same commands.

**Tech Stack:** Existing TypeScript, React, Zod, PostgreSQL, Fastify, Tauri and MCP; no new dependency required.

## Global constraints

- All projects visible to the entire current team from creation. Agent project scopes still apply.
- Creator and owner can edit project metadata and append retrospectives; every human member can comment. Agents act as their owning human and retain explicit project scopes.
- Preserve all existing projects, experiments, evidence, activities, credentials, environment UUID and existing server projects.
- Lifecycle `todo|in_progress|completed|paused` independent of retrospective outcome `success|partial|failure|inconclusive`. Priority `high|medium|low`.
- Multiple tags per project; searchable shared catalog; create or select existing; whitespace/case-normalized duplicates reuse canonical tag; removal affects association only.
- Retrospectives contain title, goal, approach, result, verification, failures, reusable, lessons, next_steps, outcome, custom_sections. Custom sections are bounded title/content pairs. No fabricated evidence.
- No major visual redesign; usable controls now, layout/theme redesign follows later.
- Cloud update only after backup, local integration/build and review. Preserve old release and rollback procedure. Do not print credentials.

## Task 1: Domain/API and migrations

Files: packages/contracts/src/index.ts; packages/core/src/service.ts (focused helpers permitted); apps/api/src/app.ts; db/migrations/003_project_library.sql; packages/db/src/migrate.ts; scripts/build-cloud.mjs; tests/integration/project-library.test.ts.

- [x] Red tests: create default todo/medium; priority ordering; multi-tag normalization, shared catalog retention and tag filter; other member read/comment but no project mutation; scoped agent isolation; stale revision/idempotent retry; structured report bounds, author identity; undo with new children; migration preserves legacy rows and backfills creator from original audit.
- [x] Extend project create/update with lifecycle, priority, tags; return creator_id, creator_name, can_edit. Existing status remains compatible. Legacy active maps to in_progress, paused to paused, archived to completed; new projects default todo.
- [x] Add GET /v1/tags (workspace_id optional, q optional), GET /v1/projects?tag=NAME, GET /v1/projects/:id/retrospectives, GET /v1/projects/:id/comments. Preserve data envelope.
- [x] Add `retrospective_create` command {project_id,title,goal,approach,result,verification,failures,reusable,lessons,next_steps,outcome,custom_sections:[{title,content}]} and `comment_create` {project_id,body}. Both use existing envelope and expected_revision on parent project; responses include id, project_id, author identity and new project_revision. Reports immutable; new attempts are separate reports.
- [x] Shared tag catalog and immutable report/comment tables receive minimal runtime grants; replayable migration and package migration list include 003.
- [x] Integrate audit and undo or explicitly fail closed with actionable reason for unsupported new operations; never partially undo a batch or orphan children.
- [x] Run focused integration tests, regression and typecheck; commit and write task report.

## Task 2: Web/desktop workflow

Files: apps/desktop/src/main.tsx; model.ts; new project-library.tsx/model helpers as needed; styles.css; tests/unit/project-library-model.test.ts; frontend component tests as supported.

- [x] Red tests for priority sorting, status/outcome independent presentation, tag search/select/create dedupe and new command formation.
- [x] Home prioritized todo/in_progress and recent project experience; project library search and clickable tag filtering; project details editable metadata, multiple tags, reports, comments and collapsible legacy history.
- [x] Creation only requires title; metadata can be added later. Tags searchable existing choices plus explicit new-tag action; remove association. Project detail accessible from home/list and after creation.
- [x] Structured manual report form plus custom sections; comments and authors displayed. Use API can_edit to hide unauthorized metadata/report operations; all team members can comment.
- [x] Retain login/team/Agent management, activity and recovery controls; all writes use commandRetry/writeSafety stable retry keys. Guard profile changes, refresh races and repeated submissions; preserve unsent input on failed requests.
- [x] Verify typecheck, component/model tests and cloud web build; commit and write task report.

## Task 3: CLI/MCP, Skill and delivery

Files: packages/client/src/client.ts; packages/local-context/src/binding.ts; apps/cli/src/commands.ts; apps/mcp/src/tools.ts; skills/graybox/SKILL.md; skills/graybox/references/project-retrospective.md; tests/integration/clients.test.ts or project-library-clients.test.ts; README.md; ops/cloud update tooling as needed.

- [x] Red tests for bound project report/comment creation, tag listing, wrong project rejection, retries and MCP exposure.
- [x] Add CLI `retrospective create|list`, `comment create|list`, `tag list`; MCP `retrospective_create`, `retrospective_list`, `comment_create`, `comment_list`, `tag_list`; use exact API envelopes and explicit cwd binding. Avoid fragile discriminated-union numeric indexing for new commands.
- [x] Skill documents user-triggered project recap, standard fields, custom sections, evidence limits, reading existing tags, explicit project binding, retry/conflict recovery and per-user pairing. Package portable client runtime and Skill installation instructions without secrets or modifying global user settings.
- [x] Run full suite/typecheck/native build, independent review and representative browser plus MCP/CLI flow using isolated test identities.
- [x] Back up cloud database; deploy new immutable release and additive migration; verify authenticated project flow and old records, unauthenticated rejection, old server service continuity; rebuild local desktop/start scripts/source+server+Skill archives and hashes.

## Acceptance

Create an idea with high priority and two tags; another identity finds it by existing tag; owner records a failed attempt with reusable code location and lessons through the Skill-compatible tool; other identity comments; reload preserves data. Duplicate tags and write retries create no duplicate records. Existing history remains accessible. Human UI redesign/acceptance is separate.

## Extension: roles and avatars (2026-10-08)
User requested compact owner/member naming and personal avatars, with avatar-only attribution suitable for the three-person team. Implement before this release: additive avatar storage, own-human upload/reset, bounded raster validation, default avatars, accessible compact attribution across activity/projects/reports/comments/members; preserve IDs, existing names/data and Agent indicators. Reuse existing authenticated APIs, database and browser raster decoding; no storage provider or new dependency. Brief: .superpowers/sdd/project-library/task-4-brief.md.
