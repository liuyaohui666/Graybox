# Graybox M1 local API

Base URL `http://127.0.0.1:4318`. All routes except health require `Authorization: Bearer <local token>`. Credentials come from ignored `.local/credentials.json`; these are local demonstration credentials only. No cloud authentication exists. API start requires `GRAYBOX_MODE=local` and binds loopback.

Success is `{data: ...}`. Failure is `{error:{code,message,details?}}` with 400 validation, 401 authentication, 403 scope, 404 missing, 409 concurrency/idempotency/undo conflict. Actor fields are never accepted from clients. UUIDs, times, revisions and experiment versions are server generated. Revisions start at 1.

Single-entity reads and experiment/series reference lookups return identical `NOT_FOUND`/404 for absent and inaccessible records. Scope is applied to the SQL lookup before existence/revision checks. Mutation transactions refresh the complete credential identity and project scope after acquiring the domain lock; a trusted fixed SQL lookup holds a credential row share lock through commit, while the runtime role has no credential UPDATE privilege. Cached idempotency results also check the current authority against stored server-owned project IDs before returning private snapshots; authorized closed-batch retries remain identical.

## Read routes

- `GET /v1/health` → `{data:{environment_id,mode:"local"}}`.
- `GET /v1/me` → `{data:{credential_id,human_id,agent_id,kind,project_ids}}`; `project_ids:null` means all projects.
- `GET /v1/workspaces` → array of `{id,name}`.
- `GET /v1/projects` → array of project objects.
- `GET /v1/projects/:id` → project.
- `GET /v1/experiments?project_id=<uuid>` → experiment array.
- `GET /v1/experiments/:id` → experiment with `evidence` and `submissions` arrays.
- `GET /v1/activity?entity_id=<uuid>&batch_id=<uuid>` → immutable activity array, filtered by accessible projects.

Projects: `{id,revision,deleted_at,created_at,updated_at,name,description,workspace_id,status,repo_url?}`.
Experiments: `{id,revision,deleted_at,created_at,updated_at,project_id,series_id,version,name,goal,status,summary,change_summary,based_on?}`. Initial status `idea`; review status `waiting_for_review`.

## Commands

`POST /v1/commands` body `{type,idempotency_key:<uuid>,batch_id:<uuid>,session_id?:<uuid>,expected_revision?:<positive integer>,payload:{...}}`. Result `data` is the resulting project or experiment. Same principal/key/canonical body returns the original result, even after batch closure. Different body returns `IDEMPOTENCY_MISMATCH`. Batch first successful operation creates it; owner is the credential; maximum 50 operations / 30 minutes. Submission closes it.

| type | payload |
|---|---|
| `project_create` | `{workspace_id,name,description?,status?:"active"\|"paused"\|"archived",repo_url?}` |
| `project_update` | `{id,name?,description?,status?,repo_url?}`; expected_revision required |
| `experiment_create` | `{project_id,series_id? ,series_name?,name,goal,based_on?}`; exactly one series identifier/name |
| `experiment_update` | `{id,name?,goal?,summary?,change_summary?,status?:"experimenting"}`; expected_revision required; status only idea/waiting_for_review → experimenting |
| `evidence_append` | `{experiment_id,type,source_kind,result,details}`; expected_revision required |
| `review_submit` | `{experiment_id,reviewers?:[human UUID...]}`; expected_revision required; creates immutable snapshot of goal/summary/change_summary/evidence/commits and waiting state |

Evidence type is `git|build|test|launch|metric|change`; source_kind is `agent_reported|local_collector|ci`; result is `passed|failed|not_run|inconclusive`. Strict details:

- git: `{commits:[{sha:<7-64 hex>,message?:string}],repo_url?:url}`
- build/test/launch: `{command:string,summary:string,exit_code?:integer}`
- metric: `{name:string,value:number,unit?:string}`
- change: `{summary:string,files?:[string]}`

Evidence includes id, experiment_id, project_id, batch_id, created_at and immutable typed fields. Submission includes id, experiment_id, project_id, batch_id, created_at, reviewers and snapshot. The system records reported results; it does not run or independently verify commands.

## Undo

`POST /v1/batches/:id/preview` body `{}` closes batch and returns `{data:{batch_id,batch_revision,preview_token,expires_at,changes:[{entity_type,entity_id,project_id,before,after,expected_revision}]}}`.

`POST /v1/batches/:id/undo` body `{expected_batch_revision:<integer>,preview_token:<string>,idempotency_key:<uuid>}` → `{data:{batch_id,compensation_batch_id,undone:true}}`. Preview lifetime five minutes; batch undo lifetime 30 days. All entities/dependencies rechecked transactionally. Any later write or external child rejects the whole batch. Creation undo soft deletes; update undo restores allowed business fields and increments revisions. Evidence/submissions remain immutable and receive tombstones in compensation data. Original activities remain unchanged. Agents may undo only their own authorized batches.

Undo checks each entity's earliest batch baseline revision against every other-batch activity. Interleaved A → B → A writes are rejected even when A owns the final current revision. The same conservative check runs during preview and execution, with rejection committing no compensation or partial restoration.

## Entrypoints

`npx tsx packages/db/src/migrate.ts` uses GRAYBOX_MIGRATION_DATABASE_URL. `npx tsx packages/db/src/seed.ts` initializes local users/agents/tokens and representative demonstration data. `npx tsx apps/api/src/main.ts` starts API. `npx vitest run tests/integration/backend.test.ts` uses only guarded `graybox_test` database, GRAYBOX_TEST_DATABASE_URL / GRAYBOX_TEST_ADMIN_URL.

The seed file shape is `{mode:"local-demonstration-only",workspace_id,humans:[{id,name,role,token}],agents:[{id,human_id,name,token,project_ids:null}]}`. It contains exactly three human tokens and one distinct agent token per human. Windows setup removes inherited file ACLs and grants only the current OS user. Test-only restricted agent exists only in isolated test fixtures. Seed reruns preserve credentials and existing data. Never return this file or tokens to browser JavaScript, logs, reports, or Git.

Reusable function entrypoints: `migrate(pool)`; `seedDatabase(adminPool,includeRestricted=true)` for isolated fixtures; `seedDemonstration(runtimePool,workspaceId,agentToken)`; `buildApp({pool,mode:"local"})`; `Service.authenticate(token)`, `command(principal,body)`, `preview(principal,batchId)`, `undo(principal,batchId,body)`. No failure-injection HTTP endpoint exists; rollback tests install a trigger using the isolated administrator connection.

Undo previews are signed with a process-only secret. Restarting the API invalidates outstanding previews, requiring a new preview. Compensation batches cannot themselves be automatically undone; original business commands remain in the append-only activity stream. Soft-deleted creations and tombstoned evidence/submissions are excluded from reads; original evidence/submission snapshots remain in PostgreSQL.

M1 serializes domain writes with PostgreSQL transaction advisory lock; this trades throughput for deterministic parent/child locking and atomic undo. Source: [PostgreSQL transaction advisory locks](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS), [Fastify errors](https://fastify.dev/docs/latest/Reference/Errors/).
