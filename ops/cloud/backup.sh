#!/bin/bash
set -euo pipefail
umask 077
test "$(id -u)" = 0
dest=/var/lib/graybox/backups
install -d -m 700 "$dest"
name="graybox-$(date -u +%Y%m%dT%H%M%SZ).dump"
runuser -u postgres -- pg_dump -Fc graybox_cloud > "$dest/$name.partial"
pg_restore --list "$dest/$name.partial" >/dev/null
mv -- "$dest/$name.partial" "$dest/$name"
sha256sum "$dest/$name" > "$dest/$name.sha256"
printf 'Backup written: %s\n' "$dest/$name"
# No automatic deletion. This local copy needs off-host export for disaster recovery.
