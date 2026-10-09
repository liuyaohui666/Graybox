# 0.3.2 connection recovery hotfix — 2026-10-08

## Failure and change

The local profile editor reported an uncertain save because PostgreSQL and the API had stopped. PostgreSQL logged a backend termination with Windows status `0xC000013A` and a fast shutdown; the API logged an unhandled idle-pool `ECONNRESET`.

- Start PostgreSQL through `start-postgres.ps1` using a separate hidden Windows console. Wait for the direct pg_ctl process, not its descendant process tree. The existing desktop shortcut uses this helper through `start-local.ps1`.
- Handle idle connection errors on both application and authentication pools. pg-pool removes the failed client before emitting this event; a later query can reconnect. Log only the pool label and bounded error code, never the attached client or credentials. Connection acquisition has a five-second timeout.
- This does not automatically restart a stopped database. The launcher starts it on the next launch. No UI or native binary changes were necessary.

## Verification

- Production-process regression failed before the API fix (process exited) and passed afterward: terminate only the isolated test process's idle PostgreSQL connection, observe the process survive, request health, and save a nickname.
- Focused recovery and avatar integration tests: 9 passed. Type checking and cloud bundle build passed.
- A disposable PostgreSQL cluster on loopback port 55440 remained queryable after the hidden launcher exited; it was then stopped. Normal parent exit did not reproduce the original console-control termination, so this is startup/lifetime evidence, not a full reproduction of explicit console close.
- Static review found no blocking issue. The new regression directly exercises the local/domain pool; the cloud/auth pool uses the same handling but was not independently fault-injected.
- Local services were restarted with the fix. Health confirmed environment `[内部验证标识省略]`. The user's existing desktop process and pending nickname draft were left open.
- Cloud archive SHA-256: `c5620a9853db5a81b946805c3b23dd22435430f508537132b6ce512a164dafa6`. Archive: `../outputs/Graybox-0.3.2-connection-recovery.tar.gz`.
- Cloud upgrade completed at 21:45 CST, release `/opt/graybox/releases/20261008T134515Z-library`, previous release `/opt/graybox/releases/20261008T033815Z-library`. The unchanged updater passed its 11 tests and verified existing rows, unrelated services, and Nginx remained unchanged.
- HTTPS health confirmed cloud environment `[内部验证标识省略]`; served frontend assets matched the package; anonymous protected requests returned 401.

At final readback the user's local nickname was still the original value. The requested draft “羊咩” was not written on the user's behalf. The remaining acceptance step is retrying that save in the already-open desktop window. Cloud authenticated UI and a friend's device were not exercised for this hotfix.
