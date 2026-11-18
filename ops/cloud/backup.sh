#!/bin/bash
set -euo pipefail
umask 077
test "$(id -u)" = 0
dest=/var/lib/graybox/backups
install -d -m 700 "$dest"
base="graybox-$(date -u +%Y%m%dT%H%M%SZ)-$$"
name="$base.dump"
attachments="$base.attachments.tar.gz"
test -d /var/lib/graybox/attachments
test ! -L /var/lib/graybox/attachments
runuser -u postgres -- pg_dump -Fc graybox_cloud > "$dest/$name.partial"
pg_restore --list "$dest/$name.partial" >/dev/null
# Immutable files exist durably before any metadata commit. Copy after the DB
# snapshot: extra later files are harmless; no referenced file can be missing.
tar -czf "$dest/$attachments.partial" --exclude='attachments/*.tmp' -C /var/lib/graybox attachments
tar -tzf "$dest/$attachments.partial" >/dev/null
mv -- "$dest/$name.partial" "$dest/$name"
mv -- "$dest/$attachments.partial" "$dest/$attachments"
sha256sum "$dest/$name" > "$dest/$name.sha256"
sha256sum "$dest/$attachments" > "$dest/$attachments.sha256"
printf '{"database":"%s","attachments":"%s","format":1}\n' "$name" "$attachments" > "$dest/$base.manifest.json.partial"
mv -- "$dest/$base.manifest.json.partial" "$dest/$base.manifest.json"
sha256sum "$dest/$base.manifest.json" > "$dest/$base.manifest.json.sha256"
printf 'Backup pair written: %s\n' "$dest/$base.manifest.json"
# No automatic deletion. This local copy needs off-host export for disaster recovery.
