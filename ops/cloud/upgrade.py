#!/usr/bin/env python3
"""Upgrade an existing Graybox installation. No account/bootstrap/firewall changes."""
import hashlib
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
        result[table] = {str(row['id'] if 'id' in row else (str(row.get('credential_id', '')) + ':' + str(row.get('key', index)))): row for index, row in enumerate(rows)}
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


def main():
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
    migrations = migration_files(source / 'db')
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
    # Keep old hashed web assets for clients that loaded the previous index just before upgrade.
    if (old / 'web/assets').is_dir():
        for asset in (old / 'web/assets').iterdir():
            dest = target / 'web/assets' / asset.name
            if asset.is_file() and not dest.exists():
                shutil.copyfile(asset, dest)
    run([str(root / 'node/bin/node'), '--check', str(target / 'server.mjs')])
    os.umask(0o077)
    report_path = state / ('upgrade-' + stamp + '.json')
    switched = False
    run(['systemctl', 'stop', 'graybox.service'])
    try:
        before = snapshot()
        private_json(state / ('upgrade-' + stamp + '-before.json'), before)
        backup = run(['bash', str(old / 'ops/backup.sh')])
        sql('BEGIN; SET LOCAL ROLE graybox_admin; SELECT pg_advisory_xact_lock(77321);\n' + '\n'.join(p.read_text(encoding='utf8') for p in migrations) + '\nCOMMIT;')
        after = snapshot()
        if not preserves(before, after):
            raise RuntimeError('Existing data changed unexpectedly during additive migration')
        switch(root, target)
        switched = True
        run(['systemctl', 'start', 'graybox.service'])
        for _ in range(20):
            try:
                if health() == before_health:
                    break
            except (OSError, ValueError):
                pass
            time.sleep(1)
        else:
            raise RuntimeError('New API health failed')
        tls = json.loads(run(['curl', '--resolve', 'api.qingsuworks.top:8443:127.0.0.1', '-fsS', '--max-time', '10', 'https://api.qingsuworks.top:8443/v1/health']))['data']
        if tls != before_health or services() != baseline or old_site() != site or nginx_hashes() != nginx:
            raise RuntimeError('Deployment or existing-service invariant failed')
        report = {'release': str(target), 'previous_release': str(old), 'health': tls, 'backup': backup, 'old_data_preserved': True, 'old_services_unchanged': True, 'nginx_unchanged': True, 'tables_before': {k: len(v) for k, v in before.items()}, 'tables_after': {k: len(v) for k, v in after.items()}}
        private_json(report_path, report)
        print(json.dumps(report))
    except Exception:
        if switched:
            run(['systemctl', 'stop', 'graybox.service'])
            switch(root, old)
        run(['systemctl', 'start', 'graybox.service'])
        # Retain backup, additive schema and both releases; never destroy data on failure.
        raise


if __name__ == '__main__':
    main()
