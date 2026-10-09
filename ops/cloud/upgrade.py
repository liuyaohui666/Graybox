#!/usr/bin/env python3
"""Upgrade an existing Graybox installation. No account/bootstrap/firewall changes."""
import hashlib
from contextlib import contextmanager
import json
import os
import pathlib
import re
import shutil
import subprocess
import time
import urllib.request


def checked_release(path, root):
    resolved = path.resolve(strict=True)
    releases = (root / 'releases').resolve(strict=True)
    if resolved.parent != releases or not resolved.is_dir():
        raise ValueError('Release must be a direct directory inside the Graybox releases root')
    return resolved


def preserves(before, after):
    if isinstance(before, dict):
        return isinstance(after, dict) and all(k in after and preserves(v, after[k]) for k, v in before.items())
    return before == after


def migration_files(directory):
    files = sorted(directory.glob('*.sql'))
    if not files or any(not re.fullmatch(r'[0-9]{3}_[a-z0-9_]+\.sql', p.name) or p.is_symlink() for p in files):
        raise ValueError('Invalid migration manifest')
    return files


def run(args, data=None):
    result = subprocess.run(args, input=data, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError('Command failed: ' + args[0] + ' (exit ' + str(result.returncode) + ')')
    return result.stdout.strip()


def sql(statement):
    return run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', 'graybox_cloud'], statement)


def services():
    return run(['systemctl', 'show', 'meeting-assistant-public.service', 'postgresql@16-main.service', '-p', 'Id', '-p', 'MainPID', '-p', 'ActiveState', '-p', 'ActiveEnterTimestamp'])


def old_site():
    return run(['curl', '--resolve', 'api.qingsuworks.top:443:127.0.0.1', '-sS', '--max-time', '10', '-o', '/dev/null', '-w', '%{http_code}', 'https://api.qingsuworks.top/'])


def nginx_hashes():
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in pathlib.Path('/etc/nginx').rglob('*') if p.is_file()}


def snapshot():
    result = {}
    # Snapshot is root-private and never printed. Existing values must survive additions.
    tables = sql("SELECT tablename FROM pg_tables WHERE schemaname='graybox' ORDER BY tablename;").splitlines()
    for table in tables:
        if not re.fullmatch(r'[a-z_]+', table):
            raise RuntimeError('Unexpected table identifier')
        rows = json.loads(sql(f"SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM graybox.{table} t;"))
        # Canonical multiset identity is independent of query order, including idless tables.
        counts = {}
        for row in rows:
            key = json.dumps(row, sort_keys=True, separators=(',', ':'))
            counts[key] = counts.get(key, 0) + 1
        result[table] = counts
    return result


def private_json(path, data):
    with open(path, 'x', encoding='utf8') as handle:
        os.chmod(path, 0o600)
        json.dump(data, handle, ensure_ascii=False, indent=2)


def health():
    with urllib.request.urlopen('http://127.0.0.1:4318/v1/health', timeout=3) as response:
        return json.load(response)['data']


def switch(root, target):
    pending = root / 'current-upgrade'
    if pending.exists() or pending.is_symlink():
        raise RuntimeError('Pending release link exists; inspect previous operation')
    pending.symlink_to(target, target_is_directory=True)
    pending.replace(root / 'current')


@contextmanager
def upgrade_lock(path=pathlib.Path('/var/lib/graybox/upgrade.lock')):
    import fcntl
    with open(path, 'a') as handle:
        os.chmod(path, 0o600)
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another Graybox upgrade is in progress') from None
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def wait_health(expected):
    for _ in range(20):
        try:
            if health() == expected:
                return
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(1)
    raise RuntimeError('API health verification failed')


@contextmanager
def recovery(root, old, before_health):
    try:
        yield
    except Exception as original:
        failures = []
        for label, action in [
            ('stop', lambda: run(['systemctl', 'stop', 'graybox.service'])),
            ('switch', lambda: switch(root, old)),
            ('start', lambda: run(['systemctl', 'start', 'graybox.service'])),
            ('health', lambda: wait_health(before_health)),
        ]:
            try:
                action()
            except Exception:
                failures.append(label)
        # Never expose command output, row values, or exception messages.
        print(json.dumps({'upgrade': 'failed', 'rollback': 'recovered' if not failures else 'incomplete',
                          'rollback_failed_stages': failures}))
        original.add_note('Graybox rollback: ' + ('recovered' if not failures else 'incomplete: ' + ','.join(failures)))
        raise


def migration_transaction(files):
    prefix = r"""BEGIN;
SET LOCAL ROLE graybox_admin;
SELECT pg_advisory_xact_lock(77321);
CREATE TEMP TABLE before_data(table_name text, row_data jsonb) ON COMMIT DROP;
CREATE FUNCTION pg_temp.retains(before_value jsonb, after_value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $guard$
DECLARE item record;
BEGIN
 IF jsonb_typeof(before_value) = 'object' THEN
  IF jsonb_typeof(after_value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_each(before_value) LOOP
   IF NOT (after_value ? item.key) OR NOT pg_temp.retains(item.value, after_value -> item.key) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
 END IF;
 RETURN before_value IS NOT DISTINCT FROM after_value;
END $guard$;
DO $capture$
DECLARE tab record;
BEGIN
 FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname = 'graybox' LOOP
  EXECUTE format('INSERT INTO before_data SELECT %L, to_jsonb(t) FROM graybox.%I t', tab.tablename, tab.tablename);
 END LOOP;
END $capture$;
"""
    suffix = r"""
CREATE TEMP TABLE after_data(row_id bigint GENERATED ALWAYS AS IDENTITY, table_name text, row_data jsonb) ON COMMIT DROP;
DO $verify$
DECLARE tab record; item record; matching bigint;
BEGIN
 FOR tab IN SELECT DISTINCT table_name FROM before_data LOOP
  EXECUTE format('INSERT INTO after_data(table_name, row_data) SELECT %L, to_jsonb(t) FROM graybox.%I t', tab.table_name, tab.table_name);
 END LOOP;
 -- Each original row consumes one distinct matching current row. This cannot
 -- silently reuse a row when idless records or nested subsets overlap.
 FOR item IN SELECT table_name, row_data FROM before_data ORDER BY table_name, length(row_data::text) DESC, row_data::text LOOP
  SELECT row_id INTO matching FROM after_data
   WHERE table_name = item.table_name AND pg_temp.retains(item.row_data, row_data)
   ORDER BY row_data::text, row_id LIMIT 1;
  IF matching IS NULL THEN RAISE EXCEPTION 'Existing data preservation failed'; END IF;
  DELETE FROM after_data WHERE row_id = matching;
 END LOOP;
END $verify$;
COMMIT;
"""
    return prefix + '\n'.join(p.read_text(encoding='utf8') for p in files) + suffix


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run as root')
    with upgrade_lock():
        perform_upgrade()


def perform_upgrade():
    if os.geteuid() != 0:
        raise SystemExit('Run as root')
    root, state = pathlib.Path('/opt/graybox'), pathlib.Path('/var/lib/graybox')
    source = pathlib.Path(__file__).resolve().parent.parent
    if not (root / 'current').is_symlink() or not (source / 'release.json').is_file():
        raise SystemExit('Existing installation and reviewed staged release required')
    old = checked_release(root / 'current', root)
    before_health, baseline, site, nginx = health(), services(), old_site(), nginx_hashes()
    if before_health['mode'] != 'cloud':
        raise RuntimeError('Expected cloud environment')
    for name in ['server.mjs', 'web/index.html']:
        if not (source / name).is_file():
            raise RuntimeError('Incomplete release')
    migration_files(source / 'db')
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    target = root / 'releases' / (stamp + '-library')
    if target.exists():
        raise RuntimeError('Release destination already exists')
    shutil.copytree(source, target)
    for directory, _, files in os.walk(target):
        os.chmod(directory, 0o755)
        for name in files:
            os.chmod(pathlib.Path(directory) / name, 0o644)
    checked_release(target, root)
    migrations = migration_files(target / 'db')
    # Keep old hashed web assets for clients that loaded the previous index just before upgrade.
    if (old / 'web/assets').is_dir():
        for asset in (old / 'web/assets').iterdir():
            dest = target / 'web/assets' / asset.name
            if asset.is_file() and not dest.exists():
                shutil.copyfile(asset, dest)
    run([str(root / 'node/bin/node'), '--check', str(target / 'server.mjs')])
    os.umask(0o077)
    report_path = state / ('upgrade-' + stamp + '.json')
    with recovery(root, old, before_health):
        run(['systemctl', 'stop', 'graybox.service'])
        before = snapshot()
        private_json(state / ('upgrade-' + stamp + '-before.json'), before)
        backup = run(['bash', str(old / 'ops/backup.sh')])
        sql(migration_transaction(migrations))
        after = snapshot()
        switch(root, target)
        run(['systemctl', 'start', 'graybox.service'])
        wait_health(before_health)
        tls = json.loads(run(['curl', '--resolve', 'api.qingsuworks.top:8443:127.0.0.1', '-fsS', '--max-time', '10', 'https://api.qingsuworks.top:8443/v1/health']))['data']
        if tls != before_health or services() != baseline or old_site() != site or nginx_hashes() != nginx:
            raise RuntimeError('Deployment or existing-service invariant failed')
        report = {'release': str(target), 'previous_release': str(old), 'health': tls, 'backup': backup, 'old_data_preserved': True, 'old_services_unchanged': True, 'nginx_unchanged': True, 'tables_before': {k: sum(v.values()) for k, v in before.items()}, 'tables_after': {k: sum(v.values()) for k, v in after.items()}}
        private_json(report_path, report)
        print(json.dumps({k: v for k, v in report.items() if k not in {'backup', 'health'}}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Graybox upgrade failed; inspect sanitized state and private recovery evidence') from None
