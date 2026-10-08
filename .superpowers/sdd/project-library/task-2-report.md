# Task 2: Web and desktop project library

Implemented the functional project workflow using existing React, request, commandRetry and writeSafety infrastructure. No dependency, backend or database change. Major visual redesign remains deferred.

## Delivered behavior

- Home shows high/medium/low prioritized todo/in_progress projects and recent project retrospectives. Library searches names/descriptions/tags and filters with clickable tags.
- Title-only creation opens the new project's details. Creator identity and lifecycle/priority are visible separately from report outcome. API can_edit controls metadata and retrospective editing; comments remain available to team humans.
- Detail supports metadata, searchable shared tag catalog objects, selection, explicit new tag creation and association removal. Metadata saves all tags together. Catalog entries are retained by the backend. Detail tags open the filtered library.
- Reports expose Chinese labels for all standard sections, four independent outcomes, up to twenty custom sections, authors and Agent attribution. Comments retain authors/Agent attribution. Failed requests preserve draft input; successful writes clear only their own form.
- Existing experiment detail/evidence/review, activity/undo, login/team/Agent and recovery controls remain accessible. Project detail contains collapsible legacy experiments and Codex project/workspace IDs.
- UI package, Cargo package/lock and Tauri version are 0.2.0; document/native title is Graybox · 团队创意与经验.

## Concurrency and retry

All new writes call the existing send function, preserving stable command envelopes and commandRetry/writeSafety semantics. Report/comment expected_revision targets the current parent project; ambiguous retries retain the original revision and keys. Synchronous submission locks prevent double clicks before React busy state commits. Global navigation/profile changes and detail exit are blocked while writes are pending/ambiguous.

Profile/selection generations and read sequence IDs reject stale detail responses. Parent refresh has its own sequence guard. Fifteen-second reads update server state without overwriting dirty metadata drafts or advancing their stored base revision. A newer server revision is visibly marked; the draft remains intact on revision conflict, with an explicit discard-and-reload action. Report/comment forms remain mounted on failed requests and retain text. Refresh after successful writes reports failures as saved-but-not-refreshed rather than encouraging duplicate submission.

## Bridge route validation

Vite and native route validators now separate pathname and query validation. GET /v1/tags and bounded UTF-8 encoded Chinese query values are supported. Encoded path traversal, arbitrary routes/hosts/methods, invalid percent encoding and control characters remain rejected. Native auth/member/Agent routes stay precise. No credential output.

## Validation

- Red: four model/path tests initially failed to import absent helpers. New Rust library query test failed because encoded Chinese GET /v1/tags was rejected.
- Green: installed tsc.cmd --noEmit passed; six unit files / 45 tests passed (model/path, static component entry rendering, existing retry/write safety/auth/model coverage).
- Cloud vite.cmd build --config apps/desktop/vite.config.ts passed, 24 modules, bundle generated.
- cargo test passed five regular native tests. Explicitly invoked ignored local bridge test passed using the already running local API and credential file; verified public profiles omit tokens, /v1/me and actual encoded Chinese /v1/tags request both return API data.
- The Codex pnpm wrapper initially ran an automatic existing-lockfile install/policy check and registry waits. No dependencies changed. Subsequent commands used installed .bin entrypoints; an initial stale typecheck failure from old home comparisons was fixed before final checks.

## Boundaries

Parent performs real browser interaction acceptance and independent review. This task's component tests verify static initial entry rendering, not interactive browser behavior. Native bridge exercised the live API, but a packaged Tauri client has not been launched or visually accepted. No production deployment or reset of the main database. Current recent-report view reads reports per project; it is appropriate for the existing small team and should later use a bounded server feed if the backlog becomes large.

## Independent review fixes (2026-10-08)

Addressed all four findings in task-2-review.md. Legacy experiment controls and navigation handlers now synchronously block exits during active or unresolved writes. Metadata, report, custom-section and comment controls freeze while busy or ambiguous; discard is also blocked. The original payload is cloned and retained independently of disabled form controls, so the matching submit button remains enabled after an ambiguous failure and retries the exact saved payload/revision. Successful or definitive rejection releases the snapshot. Tag filter state now belongs to App and detail-tag callbacks navigate to projects; the filter survives library remount and no longer depends on local setState ordering. Fieldset wrappers preserve existing form spacing without a redesign.

TDD/validation commands run from graybox:
- `node_modules/.bin/vitest.cmd run tests/unit/library-write-guard.test.ts`: red, missing guard helper import before implementation.
- `node_modules/.bin/vitest.cmd run tests/unit/library-write-guard.test.ts tests/unit/project-library-model.test.ts tests/unit/project-library-render.test.ts tests/unit/desktop-retry.test.ts`: green, 4 files / 12 tests (before final snapshot mutation test).
- `node_modules/.bin/tsc.cmd --noEmit`: passed after final changes.
- `node_modules/.bin/vitest.cmd run tests/unit`: passed after final changes, 7 files / 49 tests. New tests cover synchronous navigation exclusion, unresolved navigation, saved payload/revision retry despite missing disabled form fields, independent custom-section snapshot and definitive rejection release.
- `node_modules/.bin/vite.cmd build --config apps/desktop/vite.config.ts`: passed after final changes, 25 modules; index-DvROPcwt.js 264.12 kB (gzip 81.92 kB).

Unit tests verify guard/retry logic and initial component rendering. Parent performs actual browser interaction and delayed/ambiguous recovery acceptance after this commit. No backend/database changes or browser-created project edits by this worker.


## Final browser finding fixes (2026-10-08)

Accepted global navigation now advances a library mount generation, including same-page Home/Projects clicks. Blocked busy/synchronous/ambiguous navigation leaves the generation unchanged; periodic refresh never advances it. App retains tag filter state, and project creation still navigates before setting the returned ID for detail auto-opening.

App profile refresh failures now have their own read-error state. Latest sequence/current identity checks apply to both success and failure. A healthy current refresh clears only this read error; write/recovery errors remain. Read failures are handled inside refresh so a successful command followed by a failed read cannot be mislabeled as a failed write. The global reread button also preserves an existing operation error.

Validation: new helper import first failed red; minimal pre-fix helper then reproduced 4 behavioral failures (generation, stale resolve/reject, changed-profile callbacks). Final focused tests passed 5 files / 18 tests; pnpm typecheck passed; pnpm build:web passed (26 modules). Controlled deferred promises exercise stale completion ordering. No backend/client/cloud/user-data changes. Parent reruns actual browser navigation, creation/tag retention and outage/retry acceptance after this commit; this worker has not claimed interactive acceptance.
