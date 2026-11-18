# Dark workbench implementation plan

> For agentic workers: use subagent-driven-development for the isolated board and styling tasks, then review the integrated change before delivery.

**Goal:** Deliver the approved B dark interface with direct Chinese labels to cloud and the cloud desktop client.

**Architecture:** Preserve React state, API contracts, write/navigation guards and native bridge. Add a pure three-column project board fed by current projects and confirmed retrospective IDs. Replace the light workbench stylesheet with the approved dark tokens. No database migrations or sample data in production.

**Tech stack:** Existing React/TypeScript/CSS, Vite, Tauri, Fastify.

## Global constraints
- Use B's dark canvas #181d24, sidebar #11161c, cards #242b34, borders #3a4552, readable text #e3e9ee, muted #a8b4c2, accent #a3bdb2.
- No decorative English, welcome slogans, fabricated content, fake counts or online statuses. Keep brand/technical names when genuinely needed and existing owner/member roles, as previously requested.
- No changes to permissions, commands, identity, database or cloud API behavior.
- All project lifecycles remain accessible, including paused and completed without a report. A completed project is not automatically described as reviewed. Label third column “完成与复盘”; show “已复盘” only if the API supplied a report for it.
- High priority sorts first within each stage, stable for ties. Tags and names wrap safely. Existing navigation/write locks remain effective.
- Keep project details, member pages, profile/avatar controls, comments, notifications, authentication and management readable in dark mode.
- Local edition stays removed; package cloud client only. Never replace/kill an app with possible drafts just to upgrade: use a versioned new executable and repoint the shortcut.

## Task 1: Real project board
Files: create `apps/desktop/src/project-board.tsx`, `project-board-model.ts`, focused tests. Modify only the home rendering and retrospective loading in `project-library.tsx`.
Interface: `ProjectBoard({projects,reviewedIds,locked,open}:{projects:Project[];reviewedIds:Set<string>;locked:boolean;open:(id:string)=>void})`. CSS classes `project-board`, `board-column`, `board-heading`, `board-count`, `board-card`, `board-card-meta`, `board-card-title`, `board-card-description`, `board-card-tags`, `board-card-footer`, `board-empty`, `board-reviewed`; use existing `project-priority priority-*`, `project-state state-*`, Attribution.
- [ ] Test grouping: todo → ideas; in_progress and paused → active, preserve paused label; completed → done, preserve report distinction; unfamiliar status must not disappear. Test high/medium/low order without mutating input.
- [ ] Implement pure grouping and render real counts and data, accessible native button cards with disabled=locked.
- [ ] Replace home priority list with board, retain recent actual reports below. Track all fetched report project IDs before slicing recent list; reset on identity change and avoid stale responses.
- [ ] Run focused model/render tests. No integration database startup is needed.

## Task 2: Dark visual system
Files: `apps/desktop/src/workbench.css` only. Inspect old `styles.css` and every JSX form/dialog before styling. Reuse approved B in `../outputs/Graybox-ui-directions/index.html`.
- [ ] Replace light override theme with dark tokens, sidebar and main/toolbar surfaces, comfortable 14px content, compact Chinese headings, visible semantic statuses, focus and disabled styles.
- [ ] Style agreed board classes, three desktop columns, stacked narrow layout. Preserve all existing legacy detail/list/avatar/form selectors and responsive behavior.
- [ ] Cover native selects via color-scheme:dark, overlays, authentication and fixed controls; remove white backgrounds inherited from legacy styles.
- [ ] Validate layout with the integrated rendered app, not screenshots of the static preview alone.

## Task 3: Integration, verification and delivery
Files: `main.tsx` label/layout changes, small `cloud-ui.tsx` copy adjustment as necessary, manifests/launcher script version0.3.3, approved spec and delivery evidence.
- [ ] Main heading “项目”; action “新建想法”; member strip compact; navigation uses literal labels. Keep meaningful error feedback.
- [ ] Run typecheck and all DB-free unit tests once integrated. Build cloud web/API and native GUI desktop.
- [ ] Serve an isolated demo fixture against the actual built frontend for browser verification of empty/populated states, project/member/profile/message entrypoints and narrow layout. Fixture has no production credential or writes.
- [ ] Review the complete diff; fix important issues with focused verification.
- [ ] Stage unique0.3.3 cloud archive and versioned desktop exe; retain rollback files. Update through existing checked cloud updater, validate rows and unrelated services preserved, HTTPS health and served asset hashes match.
- [ ] Capture actual dark frontend and cloud completion evidence; repoint cloud-only shortcut. Report unverified login/friend-device layers honestly.

## Progress
User approved B and direct Chinese copy before implementation. Base: 1e90a17. Tasks pending.
