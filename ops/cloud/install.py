#!/usr/bin/env python3
"""First deployment only. Run as root from the reviewed unpacked release.
Creates ONLY Graybox roles/database/service. Does not open cloud firewall rules.
"""
import hashlib, json, os, pathlib, secrets, shutil, subprocess, tarfile, time, urllib.request

ROOT = pathlib.Path('/opt/graybox')
STATE = pathlib.Path('/var/lib/graybox')
ETC = pathlib.Path('/etc/graybox')
RELEASE = pathlib.Path(__file__).resolve().parent.parent
STAMP = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
NODE_HASH = '55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742'

def run(args, data=None):
    result = subprocess.run(args, input=data, text=True, capture_output=True, check=False)
    if result.returncode:
        # Input may contain generated DB passwords: never echo it or pg error context.
        raise RuntimeError('Command failed: ' + args[0] + ' (exit ' + str(result.returncode) + ')')
    return result.stdout.strip()

def sql(statement, db='postgres'):
    return run(['runuser','-u','postgres','--','psql','-X','-v','ON_ERROR_STOP=1','-At','-d',db], statement)

def service_baseline():
    return run(['systemctl','show','meeting-assistant-public.service','postgresql@16-main.service','-p','Id','-p','MainPID','-p','ActiveState','-p','ActiveEnterTimestamp'])

def old_site():
    return run(['curl','--resolve','api.qingsuworks.top:443:127.0.0.1','-sS','--max-time','10','-o','/dev/null','-w','%{http_code}','https://api.qingsuworks.top/'])

def private_write(path, text):
    with open(path, 'x', encoding='utf8') as f:
        os.chmod(path, 0o600)
        f.write(text)

if os.geteuid() != 0: raise SystemExit('Run as root')
if not (RELEASE/'release.json').is_file(): raise SystemExit('Reviewed release required')
if any(p.exists() for p in [ROOT,ETC,STATE,pathlib.Path('/etc/systemd/system/graybox.service'),pathlib.Path('/etc/nginx/sites-available/graybox.conf'),pathlib.Path('/etc/nginx/sites-enabled/graybox.conf')]):
    raise SystemExit('Graybox target exists: inspect it; this installer never overwrites or retries a partial deployment automatically')
if sql("SELECT rolname FROM pg_roles WHERE rolname IN ('graybox_admin','graybox_auth','graybox_runtime'); SELECT datname FROM pg_database WHERE datname='graybox_cloud';"):
    raise SystemExit('Graybox DB/role names already exist; refusing to reuse silently')
if subprocess.run(['getent','passwd','graybox'],stdout=subprocess.DEVNULL).returncode==0:
    raise SystemExit('Linux user graybox already exists')
for line in run(['ss','-lntH']).splitlines():
    if line.split()[3].rsplit(':',1)[-1] in ('4318','8443'): raise SystemExit('Target port already in use')
before = service_baseline()
status = old_site()
run(['nginx','-t'])
nginx_files = {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in pathlib.Path('/etc/nginx').rglob('*') if p.is_file()}
os.umask(0o077)
STATE.mkdir(mode=0o700); ETC.mkdir(mode=0o700); ROOT.mkdir(mode=0o755)
os.chmod(ROOT,0o755)
private_write(STATE/'preflight.json',json.dumps({'services':before,'old_https_status':status,'nginx':nginx_files},indent=2))
with tarfile.open(STATE/'nginx-before.tar.gz','w:gz') as tar: tar.add('/etc/nginx',arcname='nginx')
archive=ROOT/'node.tar.xz'
urllib.request.urlretrieve('https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz',archive)
if hashlib.sha256(archive.read_bytes()).hexdigest()!=NODE_HASH: raise RuntimeError('Official Node checksum mismatch')
with tarfile.open(archive,'r:xz') as tar: tar.extractall(ROOT,filter='data')
# data_filter drops directory modes, so umask077 otherwise makes Node root-only.
for directory, dirs, files in os.walk(ROOT/'node-v24.18.0-linux-x64'):
    os.chmod(directory,0o755)
    for name in files:
        path=pathlib.Path(directory)/name
        if not path.is_symlink(): os.chmod(path,0o755 if path.stat().st_mode & 0o111 else 0o644)
(ROOT/'node').symlink_to(ROOT/'node-v24.18.0-linux-x64',target_is_directory=True)
run(['useradd','--system','--home-dir',str(STATE),'--no-create-home','--shell','/usr/sbin/nologin','graybox'])
attachments=STATE/'attachments'
attachments.mkdir(mode=0o700)
run(['chown','root:graybox',str(STATE)])
os.chmod(STATE,0o710) # service may traverse; preflight/backups remain root-private
run(['chown','graybox:graybox',str(attachments)])
os.chmod(attachments,0o700)
run(['runuser','-u','graybox','--',str(ROOT/'node/bin/node'),'--version'])
passwords={role:secrets.token_hex(32) for role in ('graybox_admin','graybox_auth','graybox_runtime')}
for role,pw in passwords.items():
    sql(f"CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT {6 if role=='graybox_runtime' else 2} PASSWORD '{pw}'; ALTER ROLE {role} SET statement_timeout='10s'; ALTER ROLE {role} SET lock_timeout='5s';")
sql('CREATE DATABASE graybox_cloud OWNER graybox_admin TEMPLATE template0;')
sql('REVOKE CONNECT ON DATABASE graybox_cloud FROM PUBLIC; GRANT CONNECT ON DATABASE graybox_cloud TO graybox_admin,graybox_runtime,graybox_auth;')
sql('BEGIN; SET LOCAL ROLE graybox_admin;\n'+(RELEASE/'db/001_m1.sql').read_text()+'\n'+(RELEASE/'db/002_cloud_auth.sql').read_text()+'\n'+(RELEASE/'db/003_project_library.sql').read_text()+'\n'+(RELEASE/'db/004_personal_avatars.sql').read_text()+'\n'+(RELEASE/'db/005_team_social.sql').read_text()+'\n'+(RELEASE/'db/006_profile_name.sql').read_text()+'\n'+(RELEASE/'db/007_collaboration.sql').read_text()+'\n'+(RELEASE/'db/008_attachments.sql').read_text()+'\nCOMMIT;','graybox_cloud')
def url(role): return f'postgresql://{role}:{passwords[role]}@127.0.0.1:5432/graybox_cloud'
private_write(ETC/'runtime.env','GRAYBOX_MODE=cloud\nGRAYBOX_ATTACHMENT_DIR=/var/lib/graybox/attachments\nGRAYBOX_DATABASE_URL='+url('graybox_runtime')+'\nGRAYBOX_AUTH_DATABASE_URL='+url('graybox_auth')+'\n')
private_write(ETC/'migration.env','GRAYBOX_MIGRATION_DATABASE_URL='+url('graybox_admin')+'\n')
run(['chown','root:graybox',str(ETC),str(ETC/'runtime.env')]); os.chmod(ETC,0o750);os.chmod(ETC/'runtime.env',0o640)
release_path=ROOT/'releases'/STAMP
shutil.copytree(RELEASE,release_path)
for directory,dirs,files in os.walk(ROOT/'releases'):
    os.chmod(directory,0o755)
    for name in files: os.chmod(pathlib.Path(directory)/name,0o644)
(ROOT/'current').symlink_to(release_path,target_is_directory=True)
# Offline bootstrap writes one invitation, never an owner password.
# Node resolves import.meta.url through symlinks; use the real entry path so its
# direct-execution guard matches process.argv[1] and actually runs bootstrap.
bootstrap=run([str(ROOT/'node/bin/node'),'--env-file='+str(ETC/'migration.env'),str(release_path/'bootstrap.mjs')])
json.loads(bootstrap)
private_write(ETC/'owner-invitation.json',bootstrap+'\n')
shutil.copyfile(RELEASE/'ops/graybox.service','/etc/systemd/system/graybox.service')
os.chmod('/etc/systemd/system/graybox.service',0o644)
run(['systemctl','daemon-reload']);run(['systemctl','enable','--now','graybox.service'])
for attempt in range(15):
    try:
        with urllib.request.urlopen('http://127.0.0.1:4318/v1/health',timeout=2) as r: health=json.load(r)
        break
    except (OSError,ValueError): time.sleep(1)
else: raise RuntimeError('Graybox health failed; existing services unchanged, inspect graybox journal')
if health['data']['mode']!='cloud': raise RuntimeError('Wrong API mode')
shutil.copyfile(RELEASE/'ops/graybox.nginx.conf','/etc/nginx/sites-available/graybox.conf')
os.chmod('/etc/nginx/sites-available/graybox.conf',0o644)
pathlib.Path('/etc/nginx/sites-enabled/graybox.conf').symlink_to('/etc/nginx/sites-available/graybox.conf')
run(['nginx','-t']);run(['systemctl','reload','nginx'])
tls=run(['curl','--resolve','api.qingsuworks.top:8443:127.0.0.1','-fsS','--max-time','10','https://api.qingsuworks.top:8443/v1/health'])
if json.loads(tls)['data']!=health['data']: raise RuntimeError('TLS environment mismatch')
if service_baseline()!=before or old_site()!=status: raise RuntimeError('Original service baseline changed; inspect before continuing')
for filename,digest in nginx_files.items():
    if hashlib.sha256(pathlib.Path(filename).read_bytes()).hexdigest()!=digest: raise RuntimeError('Original Nginx file changed')
report={'health':health,'old_services_unchanged':True,'old_https_status':status,'release':str(release_path),'firewall_changed':False,'owner_initialized':False}
private_write(STATE/'deployment-result.json',json.dumps(report,indent=2))
print(json.dumps(report))
