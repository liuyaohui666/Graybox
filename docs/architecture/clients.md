# CLI, MCP and local/cloud project context

The CLI and MCP use the same strict API command contract and context resolver. They authenticate as distinct seeded local agents or paired cloud agents. The API owns revisions, evidence snapshots, provenance, idempotency and undo decisions.

## Trusted personal configuration

Default: `<Graybox installation>/.local/client.json`, anchored to the installed source rather than the caller's working directory. Set `GRAYBOX_CLIENT_CONFIG` to an **absolute**, trusted personal configuration path to use another installation. A repository binding cannot provide this path, API endpoint or token.

```json
{
  "version": 1,
  "environments": [{
    "environment_id": "PERSISTENT-ENVIRONMENT-UUID",
    "endpoint": "http://127.0.0.1:4318",
    "credentials_file": "C:/ABSOLUTE/Graybox/.local/credentials.json",
    "agent_id": "SEEDED-AGENT-UUID"
  }]
}
```

Replace UUID placeholders with metadata returned by `auth list` / `auth status`. Tokens remain in the private seed credential file; configuration stores only its absolute location and selected agent UUID. Multiple environments are permitted, but duplicate environment UUIDs are rejected. Endpoints must be numeric loopback HTTP origins (`127.0.0.1` or `[::1]`); DNS names, remote origins, URL userinfo, paths and queries are rejected. Redirects are disabled. Requests time out after eight seconds and are never automatically replayed. An uncertain write must be retried with its **original body and original idempotency key**.

The credentials JSON is an ignored local demonstration seed, never an exchange format. Do not paste it into the conversation or commit it. CLI/MCP do not read human tokens, accept actor fields, or impersonate a human. `GET /v1/me` must confirm the selected agent and owning human before contextual operations.

## Repository context

Committed `.graybox/project.json`:

```json
{"version":1,"environment_id":"ENVIRONMENT-UUID","workspace_id":"WORKSPACE-UUID","project_id":"PROJECT-UUID"}
```

Ignored, worktree-specific `.graybox/local.json`:

```json
{"version":1,"active_experiment_id":"EXPERIMENT-UUID"}
```

Both schemas reject additional fields. `active_experiment_id:null` means none. Every contextual command requires an existing **explicit absolute `cwd`**. The resolver normalizes real paths, walks upward to the current Git/worktree root (filesystem root outside Git), and chooses the nearest binding only if all discovered bindings agree. Conflicting nested bindings produce `BINDING_AMBIGUOUS`. It does not scan siblings or guess from process cwd. Git worktrees have their own root and local active state.

Before contextual reads/writes, health must match the persistent environment UUID, `/me` must match the configured agent, the bound project must match the workspace in the binding and seed credentials, and any active experiment must belong to the project. A stale active experiment blocks normal operations. `experiment clear` or an explicit `experiment activate --id` repairs that local selection while still checking environment, identity and project.

`project bind` only verifies an existing project. It does not create records or silently overwrite another binding. A different existing binding requires `--replace`. Binding and activation append the exact local ignore rule to Git's `info/exclude`; outside Git they append to `.gitignore`. Existing ignore text and unrelated files are preserved. Share the binding, not local active state or trusted credentials.

## CLI

From the installation, use `pnpm cli ...` or `node --import tsx apps/cli/src/main.ts ...`. `help` returns structured usage. Success is one JSON line `{data:...}`; error is `{error:{code,message,status}}` and exit code 1. No token is printed. `mcp serve` uses protocol stdout instead.

| Command | Required options / behavior |
| --- | --- |
| `auth list` | Optional `--credentials ABS`; lists seeded agent UUID/name/human/workspace only |
| `auth init` | `--credentials ABS --agent-id UUID`; optional `--endpoint LOOPBACK`, `--replace`; validates health and `/me`, merges environment mapping |
| `auth status` | Checks all configured environment/agent mappings; no repository needed |
| `project bind` | `--cwd ABS --input binding.json`; optional explicit `--replace` |
| `project get` | `--cwd ABS`; optional `--id` must equal bound project |
| `project create` | `--cwd ABS --input command.json`; unbound cwd additionally requires `--environment-id UUID`; creates in trusted seed workspace |
| `project update` | `--cwd ABS --input command.json`; targets bound project |
| `status`, `context` | `--cwd ABS`; optional `--git`; active experiment optional |
| `experiment create`, `experiment update` | `--cwd ABS --input command.json`; explicit experiment project must match binding |
| `experiment get` | `--cwd ABS`; `--id UUID` or selected active experiment |
| `experiment activate`, `experiment clear` | `--cwd ABS`; activate additionally `--id UUID`; changes ignored local selection only |
| `evidence append`, `review submit` | `--cwd ABS --input command.json`; explicit experiment and expected revision |
| `activity list` | `--cwd ABS`; optional `--entity-id UUID`, `--batch-id UUID`; only bound project rows returned |
| `undo preview` | `--cwd ABS --batch-id UUID`; closes eligible batch, returns signed five-minute preview |
| `undo execute` | `--cwd ABS --batch-id UUID --input undo.json`; requires preview token, batch revision, stable key |
| `doctor` | `--cwd ABS`; verifies API/config/identity/project/active experiment and returns paths/check names |
| `mcp serve` | Starts stdio server; each subsequent tool requires its own explicit cwd |

Complex command inputs use the **whole** API envelope, with caller-supplied UUIDs. Example:

```json
{
  "type":"experiment_create",
  "idempotency_key":"STABLE-OPERATION-UUID",
  "batch_id":"STABLE-BATCH-UUID",
  "payload":{"project_id":"BOUND-PROJECT-UUID","series_name":"Local client validation","name":"CLI/MCP roundtrip","goal":"Observe an actual protocol roundtrip"}
}
```

Updates/evidence/submission additionally include `expected_revision` as the server's current positive integer. `session_id` is optional. Evidence details are strictly typed by `type`; see [API contract](api-contract.md). Reviews enter `waiting_for_review`; agents cannot set a rating, accepted/validated state or human judgment.

Undo execution input:

```json
{"expected_batch_revision":2,"preview_token":"TOKEN-FROM-THIS-AGENT-PREVIEW","idempotency_key":"STABLE-UNDO-UUID"}
```

Undo checks that every accessible batch activity belongs to the explicit bound project, then delegates token/owner/revision/dependency checks to the API. Execution and exact same-key replay use a narrow context path: explicit strict binding, trusted environment/agent/workspace, and authenticated immutable batch activities. A live project still has its workspace checked. If undo deleted the project, its immutable server-owned project activity must prove the same project/workspace; a deleted active experiment does not block this execution path. Normal writes retain all live context checks. Rebind to a newly created project before undoing its creation. A batch spanning multiple projects is deliberately refused by this local contextual adapter. No partial compensation is attempted.

## MCP tools and host configuration

The server uses official `@modelcontextprotocol/server` 2.3.1 and stdio transport; integration uses its matching official Client 2.3.1. Schemas are versioned shared-contract fields rather than arbitrary patches. Advertised and implemented tools:

| Tool | Input beyond mandatory `cwd` |
| --- | --- |
| `context_resolve` | Optional `include_git` |
| `entity_get` | `entity_type:project|experiment`, optional `id` |
| `project_write` | Shared project_create/project_update command envelope |
| `experiment_create` | Shared experiment_create envelope, including literal `type` |
| `experiment_update` | Shared experiment_update envelope, including literal `type` |
| `evidence_append` | Shared evidence_append envelope and explicit typed details |
| `review_submit` | Shared review_submit envelope |
| `activity_list` | Optional `entity_id`, `batch_id` |
| `batch_undo` | `action:preview|execute`, `batch_id`; execute also token, revision and stable key |

Tool business failures set `isError:true` and return the structured JSON error envelope in text content. SDK-level malformed schema inputs return the SDK's protocol validation error text. Stdio stdout is exclusively protocol traffic; sanitized startup diagnostics use stderr. The optional Git collector invokes bounded `execFile('git',args,{cwd})`, with no shell or file scanning, and returns root/branch/HEAD. Each command overrides `core.fsmonitor=false`. It does not run worktree-content status/diff or traverse submodules: even ordinary status can execute repository clean filters. This metadata is observation, not attached evidence.

A safe **project-scoped** configuration template is in [skills/graybox/config.toml.example](../../skills/graybox/config.toml.example). It has absolute placeholders and no tokens. Replace the Node, tsx loader, server and trusted config paths for your installation. No global MCP registration or user-setting change is performed by the implementation. Official references: [TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk), [MCP SDK documentation](https://ts.sdk.modelcontextprotocol.io/v2/).

## Verification boundary

`tests/unit/local-context.test.ts` covers numeric loopback/redirect/no replay/timeout/redaction, explicit cwd, strict and ambiguous bindings, environment/workspace/active-experiment mismatch, Chinese/space paths, Git worktrees, stale-selection repair and nonexecution of configured fsmonitor/clean filters. `tests/integration/clients.test.ts` uses only guarded `graybox_test`, an ephemeral Fastify loopback API, real CLI subprocesses, and official MCP Client → stdio subprocess → API → PostgreSQL. It verifies all three seeded agent identities/provenance, stable-key retry, conflict, immutable submission, eligible undo and exact execution replay after project/active-experiment deletion, including removed-authority rejection. Subprocesses receive Vitest cancellation signals; multi-subprocess tests have focused 10–15 second budgets and isolated binding/identity files.

Run `pnpm typecheck` and `pnpm test` using root `fileParallelism:false` because backend and client fixtures reset the same isolated schema. No development database is reset. These results establish SDK transport and actual API/database behavior. The main task separately exercised the real Codex host and records that observed result in its M1 acceptance evidence; user approval and human review remain separate from automated checks.
## Cloud Agent pairing

Local loopback configurations remain compatible. Cloud mappings additionally set mode to cloud, require HTTPS origins, and keep config and credentials outside Git repositories. Repository bindings still supply only UUIDs. Completion validates cloud health/environment UUID, Agent UUID, owning human UUID and accessible workspace before saving. Context repeats those checks and validates project/experiment ownership. Expiry is checked locally; revocation and member disable are enforced by the API.

Set GRAYBOX_CLIENT_CONFIG to an absolute personal path outside repositories. Pairing accepts --config ABS for the same path. The installation .local default is refused for cloud because it is inside this repository.

Run auth pair --endpoint https://YOUR-GRAYBOX-HOST --name "My Agent" --config ABS. The CLI prints the short user code to stderr, waits for desktop human approval, and polls every three seconds for at most ten minutes. Ctrl+C/SIGTERM interrupts; each request times out after eight seconds. CLI/MCP have no human login/token options.

For noninteractive tools run auth pair-start with those options, have the human approve its user_code, then auth pair-complete --config ABS. Pending completion returns status pending; run it again after approval. Existing mappings require --replace before consuming a pair. Device codes are saved privately and never printed. Credential retrieval consumes the pair once: lost retrieval or persistence requires starting a fresh pair and revoking the abandoned Agent in desktop.

Credentials use a strict cloud-agent file with environment/workspace UUIDs, expiry and one Agent identity/token. Config stores its path and Agent UUID. Writes use private temporary directories, POSIX directory 0700/file 0600, or Windows inheritance removal and current-user-only full-control ACL before writing secret content. Final files retain that ACL. Redirects are refused; credentials never forward. No global Codex host configuration is edited.

Unit cloud-client tests cover HTTPS origin restrictions, public pairing without bearer headers, Agent persistence and redirect rejection. Integration cloud-clients tests exercise real PostgreSQL bootstrap/redeem/pending/approval, private config, project context, malicious binding endpoint rejection and revocation. Their HTTPS fetch adapter delegates to actual Fastify injection; deployed TLS, endpoint reachability and desktop human approval remain separate acceptance layers. Existing local-context and real CLI/MCP integration tests remain applicable.
