# Team member pages, agreement and inbox implementation plan

> For agentic workers: use subagent-driven-development with one implementer, then independent review. Continue the user's already-authorized local and cloud update; no further design permission gate is needed.

**Goal:** Let the three teammates discover one another's work and respond with agreement/comments that reach the project owner.

**Architecture:** Reuse Graybox people/avatar/project/comment APIs and the existing PostgreSQL transaction/idempotency boundary. Add only agreement state and recipient-owned notifications. A todo project is the existing idea representation; member pages filter by creator_id, with todo under 想法 and other lifecycles under 主导项目. Keep the existing stack and deploy via the reviewed immutable updater.

**Tech stack:** React, Tauri, Fastify, PostgreSQL 16/18, TypeScript, Vitest. No new service or dependency.

## Global constraints

- Fixed account and project-specific owner/member remain as implemented by 5d74164. No global-role bypass, account switcher, ownership transfer, or data rewrite.
- All projects and ideas remain visible to the team. Member profile shows public name/avatar/project statistics only; no username, credentials or global permission labels.
- Team space displays each active member's avatar with name below. Clicking opens a details card with an explicit 进入主页 action. Member home contains their ideas and led projects, with navigation to actual project detail.
- Add human agreement per project (ideas use the same entity). One human counts once; setting true/false is idempotent, owner cannot agree with own work, agents cannot express a human opinion. UI says 赞同/已赞同 and allows cancellation.
- Comment behavior remains available to every authorized teammate including agents under existing rules; comments and their notification commit atomically. No notification to oneself. Another human/agent commenting on a project notifies that project's owner, with actor human + Agent attribution as applicable.
- First agreement by a human creates one notification per project/actor lifetime; cancel/re-agree never spams new notifications. Cancellation changes current count/state; inbox records the historical event.
- Inbox is private to the authenticated human, with unread count, list, mark read, mark visible messages read, and project navigation. Reject Agent access. Do not accept an arbitrary recipient_id from client. Mark-all UI sends current visible IDs so newly arrived items are not accidentally marked read.
- New notifications only for post-upgrade interactions. Existing rows/comments are preserved and no historical messages are synthesized.
- Poll every 15 seconds and on focus; stop on unmount/account/session change. UI shows recoverable errors and disables overlapping writes. Preserve existing drafts, retry safety, unknown-outcome protection, avatar menu, narrow-screen support and project metadata conflict rules.
- No emails, OS push, realtime service, friend accounts, or new cloud exposure. Notification is in-app.
- Ship combined release 0.3.0 with local/cloud builds, migrations included in builder and explicit migration callers/tests, docs updated. Do not confuse application version with dependency versions.
- Only one integration suite at a time, guarded graybox_test. Implementer never changes graybox_dev, cloud or browser; parent handles real acceptance/deploy. Keep unrelated services untouched.

## Reuse evidence and decisions

- Existing PeopleProvider, Avatar, Attribution, project creator_id, comment_create command, writeSafety and Tauri request bridge supply the core route.
- Existing polling meets this three-person team's needs. Adding Novu (https://github.com/novuhq/novu, checked 2026-10-08) would introduce an independent communication platform for just two event types; no integration chosen.
- PostgreSQL 16 INSERT/ON CONFLICT (https://www.postgresql.org/docs/16/sql-insert.html, checked 2026-10-08) supports atomic unique-key deduplication. Use UNIQUE/PK with transactional insert; no in-memory notification source of truth.
- Representative trial: two real isolated-test credentials create opposite-owned projects, B agrees/comments on A's idea; only A gets one corresponding unread event, retry does not duplicate; privacy, cancellation and read-state persistence verified before UI expansion.

## Task 1: Full vertical slice

Files: add db/migrations/005_team_social.sql, a focused core social module if useful, apps/desktop/src/team-space.tsx and social models/state, tests/integration/team-social.test.ts and meaningful UI-state/bridge tests. Modify core service/API, project-library/main/avatars/platform as required, Tauri main.rs allowlist, build-cloud and ALL explicit migration enumerations, documentation/release metadata.

- [x] Inspect request, transaction, test fixture, native allowlist and migration enumeration interfaces. Preserve the global lock/authoritative-principal discipline and existing command receipt semantics.
- [x] Write failing integration scenarios: actual owner/member inverted roles, public member data, scoped reads, one like per human, self/Agent denial, cancel/re-agree behavior, cross-account inbox isolation and no forged-recipient/read-all, no self-comment alert, successful comment replay creates only one notification, rollback leaves neither side effect, revocation and deleted project behavior, persisted read-state. Run focused suite red.
- [x] Implement migration using two tables: project_agreements(project_id,user_id,active,created_at,updated_at, primary key(project_id,user_id)); notifications(id,recipient_id,actor_id,agent_id nullable,project_id,kind agreement/comment,comment_id nullable,created_at,read_at nullable), with appropriate foreign keys, recipient/time index and unique source constraints. Grant runtime minimum SELECT/INSERT/UPDATE privileges, not DELETE. Migration additive/idempotent and deployable under graybox_admin.
- [x] API contract: GET /v1/projects/:id/agreement returns {count,agreed,can_agree}; POST same path accepts strict {agreed:boolean} (set state; no toggle). GET /v1/notifications returns {items,unread_count}; POST /v1/notifications/read accepts strict {ids: uuid[]} maximum 100; acts only on recipient current human and returns read state/count. People endpoint excludes disabled users and includes no auth/private data; reuse creator-filtered authorized project reads for member home. Response item fields sufficient: id, project_id, project_name, actor_id, actor_name, agent_id, kind, comment preview if useful, created_at, read_at. Agent calls denied for people/agreement mutation/inbox; use existing scope checks for project reads/writes.
- [x] Wire comment notification inside existing comment command transaction after insert; do not duplicate on receipt replay. For likes use authoritative authenticated transaction and unique insert, store persistent inactive state on cancel so re-agree has a known prior history. No client-supplied actor/recipient. Agreement should not invalidate project metadata revision; ensure undo of project creation cannot hide another person's agreement without reporting dependency/conflict.
- [x] UI: shared TeamSpace member strip in home/team project space; name below avatar, details dialog, 进入主页. Dedicated member home shows biography-free actual data and empty states; split creator projects by lifecycle todo vs others. Opening project and back navigation preserve correct entry state and respect pending-write gates. Add accessible notification entry with unread badge always reachable on narrow screens, readable inbox and mark-read controls. Navigate from message to correct project. Existing page titles should indicate member home/messages clearly.
- [x] Project/idea detail agreement control with count, pressed state and disabled self state; pending/error/retry retains intended target on unknown transport outcome (POST set-state permits safe retry). Existing comments remain; after successful interaction refresh appropriate count and owner inbox via polling. Prevent stale session responses and overlapping navigation/write races. Reuse rather than duplicate avatar/profile presentations.
- [x] Add frontend tests for member filtering and empty state; actual rendered avatar/name/detail/home entry; inbox unread and navigation; agreement target-state retry, failure recovery; native allowlist accepts only intended new routes and methods. Manual browser acceptance remains parent responsibility.
- [x] Run focused green, full serialized Vitest, typecheck, cloud/client builders and native bridge unit tests. Capture exact commands/counts and red/green evidence. No test-only weakened permissions or discarded concurrency assertions.
- [x] Update README, API contract, Skill project collaboration explanation and application version 0.3.0 (package, Rust root lock/package, tauri, display/MCP/client manifest). Commit and write .superpowers/sdd/team-social-report.md with caveats, changed interfaces, validation and parent migration instructions.

## Task 2: Review and delivery (parent)

- [x] Read-only independent review of full phase 73a34a0..final, including identity and social changes with evidence packages. Fix blockers with focused verification, then rereview.
- [x] Main local backup already catalog-validated before identity; migrate additive schema, restart only own API. Verify real role reversal, agreement/comment/inbox and native bridge. Use test fixtures locally; no invented cloud users.
- [x] Browser inspect member strip/card/home, own vs other's project, reaction, comment notification/unread/read/project navigation, avatar menu and 390px layout. Save screenshots. Stop/read/retry behavior where new code makes it consequential.
- [x] Build native and packaged clients, stage checksum-verified cloud tar. Run existing ops/cloud/upgrade.py with backups/data preservation/unrelated service checks. Verify public HTTPS served bytes and anonymous API 401. Fresh authenticated cloud UI only if session available; never claim unperformed login/cross-device checks.
- [x] Deliver 0.3.0 Windows/Skill/source/server artifacts + hash + usage/evidence files. Keep prior archives. Relaunch local native. Report exact tested boundaries and pending actual friend-device use.

## Delivery evidence

Completed on 2026-10-08. Implementation 93f2026, independent combined review PASS. Parent final 209/209 Node tests, bundled clients 13/13, native build and real API bridge passed. Actual browser member/profile/agreement/outage retry/comment/inbox/read/tag/narrow workflows verified. Cloud release `/opt/graybox/releases/20261008T024719Z-library`, preserved all original rows and unrelated services/Nginx; HTTPS assets exactly match. New cloud login page loaded, authenticated 0.3 account UI requires the original user to log in. Real friend devices and real Codex-host pairing remain unverified. Deliverables and full boundaries: sibling outputs/Graybox-0.3-validation.json.
