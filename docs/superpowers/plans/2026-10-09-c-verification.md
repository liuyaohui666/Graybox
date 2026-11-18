# Graybox 0.4.0 verification

- Full Vitest suite: 32 files, 246 tests passed. TypeScript typecheck passed.
- Web/cloud/client bundles built; Windows Tauri debug GUI executable built. Skill validator passed with UTF-8 Python.
- Real browser with isolated graybox_test PostgreSQL and actual Fastify/Service: independent idea create/read, experiment start with project and immutable idea source, experiment edit/read, merge submit, profile nickname save/read, project agreement/comment save/read and activity avatars checked. No browser errors observed. Test API stopped; isolated PostgreSQL stopped.
- Cloud archive SHA256: 71cbbbe2132f3627a23d8cdca9638a699be50af7c1a9932ec50111a6eeb17602.
- Tencent command exit 0. Linux upgrade guard tests 11/11 passed; simulated failure messages are test output. Release /opt/graybox/releases/20261008T173024Z-library; previous /opt/graybox/releases/20261008T134515Z-library.
- Upgrade evidence: old_data_preserved, old_services_unchanged and nginx_unchanged true. All historical row counts retained. Additive collaboration tables initially empty.
- Public HTTPS health/environment UUID verified, exact deployed index and hashed assets match reviewed release. New unauthenticated routes return 401.
- Windows cloud shortcut points to VBS and 0.4.0 GUI binary; launched process responding. Diagnostic CMD updated to 0.4.0. Native window visual readback unavailable, friend-device use unverified.
- Skill source and distribution zip updated. No global Codex configuration or credentials changed; installation/pairing follows packaged instructions.
- Browser screenshot outputs/Graybox-0.4.0-browser-check.png contains isolated fixtures, not production data. User reports successful login; controlled IAB remains at login and Edge has no Graybox tab, so presumed desktop login is human-reported and its native visual contents remain unavailable to tools. No credentials requested in chat.
