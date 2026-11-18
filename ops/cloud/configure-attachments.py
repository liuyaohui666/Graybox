#!/usr/bin/env python3
"""Prepare only existing Graybox storage/config before upgrade.py snapshots them.

Run the reviewed staged release's script as root. No database/account changes.
Root-private config backups remain available after success or rollback.
"""
from contextlib import contextmanager
import hashlib
import json
import os
import pathlib
import re
import subprocess
import time
import urllib.request

ROOT=pathlib.Path('/opt/graybox')
STATE=pathlib.Path('/var/lib/graybox')
TARGETS={'unit':pathlib.Path('/etc/systemd/system/graybox.service'),'nginx':pathlib.Path('/etc/nginx/sites-available/graybox.conf'),'runtime':pathlib.Path('/etc/graybox/runtime.env')}

def run(args):
    result=subprocess.run(args,text=True,capture_output=True,check=False)
    if result.returncode:raise RuntimeError('Command failed: '+args[0]+' (exit '+str(result.returncode)+')')
    return result.stdout.strip()

def runtime_env(old):
    return '\n'.join(line for line in old.splitlines() if not line.startswith('GRAYBOX_ATTACHMENT_DIR='))+'\nGRAYBOX_ATTACHMENT_DIR=/var/lib/graybox/attachments\n'

def validate_templates(unit,nginx):
    listens=re.findall(r'\blisten\s+([^;]+);',nginx)
    if listens!=['8443 ssl'] or 'proxy_pass http://127.0.0.1:4318;' not in nginx or 'root /opt/graybox/current/web;' not in nginx:
        raise ValueError('Only the dedicated Graybox listener may be configured')
    writes=re.findall(r'^ReadWritePaths=(.*)$',unit,re.M)
    if writes!=['/var/lib/graybox/attachments'] or 'ProtectSystem=strict' not in unit or 'User=graybox' not in unit or 'Group=graybox' not in unit or 'ExecStart=/opt/graybox/node/bin/node /opt/graybox/current/server.mjs' not in unit:
        raise ValueError('Only the attachment directory may become writable')

def atomic_write(path,content,mode,uid=None,gid=None):
    pending=path.with_name(path.name+'.attachments-pending')
    created=False
    try:
        with open(pending,'xb') as handle:
            created=True
            os.chmod(pending,mode)
            if uid is not None:os.chown(pending,uid,gid)
            handle.write(content);handle.flush();os.fsync(handle.fileno())
        pending.replace(path)
        if os.name!='nt':
            fd=os.open(path.parent,os.O_RDONLY)
            try:os.fsync(fd)
            finally:os.close(fd)
    finally:
        if created and pending.exists():pending.unlink()

def restore(saved):
    for target,record in saved.items():
        atomic_write(target,record['backup'].read_bytes(),record['mode'],record['uid'],record['gid'])

@contextmanager
def config_recovery(saved):
    try:yield
    except Exception:
        failed=[]
        for label,operation in [('stop',lambda:run(['systemctl','stop','graybox.service'])),('restore',lambda:restore(saved)),('daemon-reload',lambda:run(['systemctl','daemon-reload'])),('nginx-test',lambda:run(['nginx','-t'])),('nginx-reload',lambda:run(['systemctl','reload','nginx'])),('start',lambda:run(['systemctl','start','graybox.service']))]:
            try:operation()
            except Exception:failed.append(label)
        print(json.dumps({'configuration':'failed','rollback_failed_stages':failed}))
        raise

def baseline():
    return run(['systemctl','show','meeting-assistant-public.service','postgresql@16-main.service','-p','Id','-p','MainPID','-p','ActiveState','-p','ActiveEnterTimestamp'])

def old_site():
    return run(['curl','--resolve','api.qingsuworks.top:443:127.0.0.1','-sS','--max-time','10','-o','/dev/null','-w','%{http_code}','https://api.qingsuworks.top/'])

def unrelated_nginx():
    own=TARGETS['nginx'].resolve()
    return {str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in pathlib.Path('/etc/nginx').rglob('*') if path.is_file() and path.resolve()!=own}

def health():
    with urllib.request.urlopen('http://127.0.0.1:4318/v1/health',timeout=3) as response:return json.load(response)['data']

def main():
    if os.geteuid()!=0:raise SystemExit('Run as root')
    source=pathlib.Path(__file__).resolve().parent.parent
    if not (source/'release.json').is_file() or not (ROOT/'current').is_symlink() or STATE.is_symlink() or not STATE.is_dir():raise RuntimeError('Existing installation and reviewed staged release required')
    for target in TARGETS.values():
        if target.is_symlink() or not target.is_file() or target.stat().st_uid!=0:raise RuntimeError('Expected root-owned regular Graybox configuration')
    import pwd
    account=pwd.getpwnam('graybox')
    unit=(source/'ops/graybox.service').read_text(encoding='utf8')
    nginx=(source/'ops/graybox.nginx.conf').read_text(encoding='utf8')
    validate_templates(unit,nginx)
    existing=TARGETS['nginx'].read_text(encoding='utf8')
    if re.findall(r'\blisten\s+([^;]+);',existing)!=['8443 ssl']:raise RuntimeError('Existing listener is outside scoped update')
    attachments=STATE/'attachments'
    if attachments.is_symlink() or (attachments.exists() and not attachments.is_dir()):raise RuntimeError('Unexpected attachment path')
    os.umask(0o077)
    import fcntl
    with open(STATE/'upgrade.lock','a') as lock:
        os.chmod(lock.name,0o600)
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('Another Graybox operation is in progress') from None
        before,site,hashes,expected=baseline(),old_site(),unrelated_nginx(),health()
        if expected.get('mode')!='cloud':raise RuntimeError('Expected active cloud API')
        stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+str(os.getpid())
        backup=STATE/('attachment-config-'+stamp);backup.mkdir(mode=0o700)
        saved={}
        for key,target in TARGETS.items():
            info=target.stat();private=backup/key
            atomic_write(private,target.read_bytes(),0o600)
            saved[target]={'backup':private,'mode':info.st_mode&0o777,'uid':info.st_uid,'gid':info.st_gid}
        manifest={str(target):{**{key:value for key,value in record.items() if key!='backup'},'backup':record['backup'].name} for target,record in saved.items()}
        atomic_write(backup/'manifest.json',json.dumps(manifest,indent=2).encode(),0o600)
        state_info=STATE.stat();prior_attachment=attachments.stat() if attachments.exists() else None
        try:
            with config_recovery(saved):
                run(['systemctl','stop','graybox.service'])
                attachments.mkdir(mode=0o700,exist_ok=True)
                os.chown(attachments,account.pw_uid,account.pw_gid);os.chmod(attachments,0o700)
                os.chown(STATE,0,account.pw_gid);os.chmod(STATE,0o710)
                atomic_write(TARGETS['unit'],unit.encode(),0o644,0,0)
                atomic_write(TARGETS['nginx'],nginx.encode(),0o644,0,0)
                atomic_write(TARGETS['runtime'],runtime_env(saved[TARGETS['runtime']]['backup'].read_text()).encode(),0o640,0,account.pw_gid)
                run(['systemd-analyze','verify',str(TARGETS['unit'])]);run(['nginx','-t'])
                run(['systemctl','daemon-reload']);run(['systemctl','start','graybox.service'])
                for _ in range(20):
                    try:
                        if health()==expected:break
                    except (OSError,ValueError):pass
                    time.sleep(1)
                else:raise RuntimeError('Graybox did not recover its previous identity')
                run(['systemctl','reload','nginx'])
                if baseline()!=before or old_site()!=site or unrelated_nginx()!=hashes:raise RuntimeError('Unrelated server invariant changed')
        except Exception:
            # Retain newly created storage, never remove potentially uploaded data.
            os.chown(STATE,state_info.st_uid,state_info.st_gid);os.chmod(STATE,state_info.st_mode&0o777)
            if prior_attachment:os.chown(attachments,prior_attachment.st_uid,prior_attachment.st_gid);os.chmod(attachments,prior_attachment.st_mode&0o777)
            raise
        print(json.dumps({'configuration':'ready','backup':str(backup),'attachments':str(attachments),'unrelated_services_preserved':True}))

if __name__=='__main__':
    try:main()
    except Exception:raise SystemExit('Attachment configuration failed; inspect root-private backup and sanitized rollback stages') from None
