import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
const read=(name:string)=>readFile(new URL(`../../ops/cloud/${name}`,import.meta.url),'utf8');
test('service only grants durable attachment directory write access',async()=>{
 const service=await read('graybox.service');expect(service).toContain('ProtectSystem=strict');expect(service).toContain('ReadWritePaths=/var/lib/graybox/attachments');expect(service).toContain('GRAYBOX_ATTACHMENT_DIR=/var/lib/graybox/attachments');
 const install=await read('install.py');expect(install).toContain("os.chmod(STATE,0o710)");expect(install).toContain("os.chmod(attachments,0o700)");expect(install).toContain("'root:graybox',str(STATE)");
});
test('upload limits belong only to exact Graybox upload route and private blob previews fit app CSP',async()=>{
 const nginx=await read('graybox.nginx.conf');expect(nginx).toContain('listen 8443 ssl');expect(nginx).toContain('client_max_body_size 256k;');expect(nginx).toMatch(/location = \/v1\/attachments\/upload\s*\{[^}]*client_max_body_size 50m;[^}]*proxy_read_timeout 90s;[^}]*proxy_send_timeout 90s;/s);
 expect(nginx).toContain('img-src \'self\' data: blob:');expect(nginx).toContain('media-src \'self\' blob:');expect(nginx).toContain('frame-src \'self\'');expect(nginx).not.toContain("script-src 'self' blob:");
});
test('backup verifies database and attachment archives before writing completion manifest',async()=>{
 const backup=await read('backup.sh');expect(backup).toContain('umask 077');expect(backup).toContain('pg_dump -Fc graybox_cloud');expect(backup).toContain('.attachments.tar.gz');expect(backup).toContain('tar -tzf');expect(backup).toContain('manifest.json');expect(backup.indexOf('pg_dump')).toBeLessThan(backup.indexOf('tar -czf'));expect(backup.indexOf('tar -tzf')).toBeLessThan(backup.indexOf('manifest.json'));
});
