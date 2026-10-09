# Durable incremental sync

## Exact flow

1. Resolve explicit absolute cwd, read current target and `sync_status {cwd}`. Restore pending receipts first. Last verified checkpoint is per environment, workspace, project, human, agent, real cwd and selected project/idea/experiment.
2. Collect accessible work after checkpoint, retaining source IDs. Read target revision and existing content. Missing history is a disclosed gap, never invented evidence.
3. Construct one shared command per intended operation with stable UUID `idempotency_key`, `batch_id`, optional `session_id`, and `expected_revision` on updates. Save `sync_prepare {cwd,operation_id,through,command}`. operation_id is another stable UUID identifying the local intent; through is the last covered accessible source locator.
4. `sync_execute {cwd,operation_id}` reads the saved body, sends it, and reads the exact immutable server activity snapshot. Only a matching entity ID + snapshot advances checkpoint. Multiple operations use their own stable keys and cursor. Use a checkpoint cursor covering only work actually represented by that operation; do not claim an entire multi-operation report complete after its first command.
5. On timeout/failure/mismatch inspect status and repeat the same operation_id. The journal preserves pending intent and prior checkpoint. A definitive exact-replay REVISION_CONFLICT or BATCH_CLOSED response preserves a rejected receipt and leaves the checkpoint unchanged; read current server state, then prepare a corrected NEW operation/key. Authentication, scope, validation, transport and read-back failures remain pending because they do not prove the original write uncommitted. Never silently edit saved intent. A lost execute result after local verification is safe: the verified local receipt returns without writing again.

Private journals reside beside trusted personal client config under sync-receipts, outside cloud repositories; no tokens/endpoints/human sessions are stored. They contain intended business command bodies and read-back receipts. Files use mode 0600 when supported, fsync-before-rename and an exclusive writer lock. A crash may leave a lock: inspect whether its writer still exists and remove only the exact stale lock with explicit user recovery authorization; never erase journals. A corrupt/oversized journal blocks writes for recovery. No daemon and no hidden access to host chat history.

## CLI equivalents

```powershell
pnpm cli context --cwd C:\absolute\project --git
pnpm cli idea get --cwd C:\absolute\project --id UUID
pnpm cli idea list --cwd C:\absolute\project
pnpm cli experiment list --cwd C:\absolute\project
pnpm cli idea activate --cwd C:\absolute\project --id UUID
pnpm cli idea clear --cwd C:\absolute\project
pnpm cli collaboration get --cwd C:\absolute\project --input target.json
pnpm cli sync status --cwd C:\absolute\project
pnpm cli sync prepare --cwd C:\absolute\project --input prepared.json
pnpm cli sync execute --cwd C:\absolute\project --id OPERATION_UUID
pnpm cli command execute --cwd C:\absolute\project --input command.json
```

Portable distribution substitutes `node runtime/client.mjs` for `pnpm cli`. `target.json` is `{ "entity_type":"idea", "id":"UUID" }`. prepared.json is `{ "operation_id":"UUID", "through":"accessible-chat-id:turn-12", "command":{...} }`. For direct shared commands use command_execute `{cwd,command}`; it does not automatically advance a sync checkpoint.

## Collaboration command payloads

All commands use existing shared envelopes and UUID validation. All except creation require expected_revision.

| type | payload |
|---|---|
| idea_create | name, body, project_id optional UUID/null; null means independent |
| idea_update | id, optional name/body/project_id; preserve omitted fields |
| entity_join | entity_type idea/experiment, entity_id |
| entity_branch | entity_type, entity_id, optional name; retains source revision and author |
| entity_comment | entity_type, entity_id, body |
| merge_submit | entity_type, entity_id, selected_fields from name/body/goal/summary/change_summary |
| merge_resolve | id, decision accept/reject/partial, optional selected_fields, expected_target_revision |

experiment_create still requires exactly one series_id or series_name. experiment_create/update add progress todo/in_progress/completed/paused, priority high/medium/low, outcome inconclusive/success/partial/failure. These fields do not replace review status. Branch content/permissions and requests are returned by entity_get/collaboration_get. Only entity leader resolves merge, and partial adoption selects submitted fields. Human agreement and private notifications stay in the human UI.

## Example intent

“同步这次结果” with an active experiment and an older verified cursor: read accessible intervening turns/Git/test logs, recover a pending exact write if present, then append actual evidence or update progress for that experiment. If this turn only describes a standalone new idea, explicitly create it with project_id null and report its UUID; do not link it merely because a project is bound.
