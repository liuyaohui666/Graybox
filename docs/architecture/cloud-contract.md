# M1.5 self-hosted contract (2026-10-07)

User approved reusing existing Tencent server with isolated Graybox service/database. Supabase is superseded for this phase. UI redesign deferred. Preserve local demo mode. Existing meeting assistant must not be modified/restarted/exposed more broadly. No global PostgreSQL upgrade or configuration changes.

Cloud API: existing envelopes `{data:T}` / `{error:{code,message}}`, `/v1` prefix, strict JSON, bearer credentials. Cloud mode accepts only expiring real credentials linked to enabled users, never local seeded demo credentials. Existing Core authoritative revalidation must include expiry and member status under write lock. Use 256-bit random opaque tokens hashed in DB, Node scrypt password hashes per OWASP (N=131072,r=8,p=1,maxmem sufficient). Authentication rate limit and bounded concurrent password hashing. No public registration. Session lifetime 7 days, Agent lifetime 90 days. Single team, 1 owner and max 2 members. Account usernames 3-40 ASCII letters/digits/._- normalized lowercase; passwords 15-128 characters. No SMTP dependency for initial invitation-code login.

## Public routes

- `POST /v1/auth/login {username,password}` -> `{token,expires_at,profile:{id,name,role},environment_id,workspace_id}`. Generic incorrect-login response.
- `POST /v1/auth/redeem {code,username,password,name}` -> same login response. Codes random >=32 bytes, stored hash only, one-time, expire after 24h; owner initialization creates one owner code offline, no first-user-claims-owner endpoint. Member invitations created by owner. Accepting invitation reserves/validates 3-active-member cap atomically.
- `POST /v1/auth/pair/start {name}` -> `{device_code,user_code,expires_at}`. Expire after 10min. Separate random high entropy device and human code; limit active pairs.
- `POST /v1/auth/pair/poll {device_code}` -> `{status:'pending'}` or `{status:'approved',token,expires_at,agent_id,human_id,workspace_id,environment_id}`. Successful credential retrieval consumes pair once. Lost retrieval requires new pair; UI should explain.

## Human routes (bearer)

- `GET /v1/auth/me` -> `{profile:{id,name,role},expires_at}`.
- `POST /v1/auth/logout {}` -> `{ok:true}` revokes current credential.
- `GET /v1/members` -> `[{id,name,role,disabled_at}]` human only.
- `POST /v1/members/invite {}` -> `{code,expires_at}` owner only.
- `POST /v1/members/:id/disable {}` -> `{ok:true}` owner only, cannot disable owner; revoke all that member's credentials.
- `POST /v1/agents/pair/approve {user_code,project_ids:null|string[]}` -> `{ok:true}` human only; validate project ownership/existence; binds actual requesting human.
- `GET /v1/agents` -> `[{id,human_id,name,revoked_at,project_ids,expires_at}]` own agents; owner sees all.
- `POST /v1/agents/:id/revoke {}` -> `{ok:true}` own or owner.

## Client / deployment boundary

Health returns `{environment_id,mode:'local'|'cloud'}`. Remote endpoints must be HTTPS origins configured by user outside repository; local numeric loopback HTTP remains only for local/test. Never redirect credentials. Native human sessions kept in process memory for initial pilot, login again after exit (avoid plaintext persistence); API bearer token never returned to renderer. Browser cloud uses same-origin API with in-memory bearer only for pilot; no localStorage. API may serve built React with safe static handler and restrictive CSP; desktop app supports configuring endpoint, login, redeem, member invitation, and Agent approval. Any repository binding cannot supply endpoint/token. CLI pairs against explicit trusted HTTPS endpoint and writes private Agent-only config (POSIX0600 / restrictive Windows ACL); it cannot load human tokens. Authenticated default identity is single user, no cloud role switcher.

Deployment: API on loopback 4318; independent Linux user graybox, `/opt/graybox` release dirs, `/etc/graybox` secrets, `/var/lib/graybox` backups/state. Dedicated database graybox_cloud + roles graybox_admin, graybox_runtime (verify no collisions). systemd memory cap 640M and CPUQuota=50%; pool max4; existing PG16 untouched. Inspect current Nginx and TLS host before adding a new separate virtual host/port. Preserve existing firewall restrictions. Actual exposure/credential entry requiring user action is deferred until tested concrete deployment available.

## Implementation ledger

- [ ] Backend auth, migration, bootstrap tooling; regression and adversarial integration tests.
- [ ] Native/browser login, account/membership/pair controls; build and bridge tests.
- [ ] CLI/MCP remote environment + Agent pairing; existing local tests retained.
- [ ] Cloud packaging, health/resources/backup/rollback; deploy isolated loopback, verify old app baseline.
- [ ] Independent code review, fixes, end-to-end cloud acceptance; disclose any human/device gates remaining.

References checked: https://nodejs.org/api/crypto.html ; https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html ; https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html . Node's crypto is reused for primitives; application membership and opaque session lifecycle integrate into existing Core. No copied third-party auth service or new external account required.
