#!/usr/bin/env bash
# نسخة احتياطية مضغوطة لقاعدة البيانات وملفات المكتبة، مع حذف ما تجاوز BACKUP_KEEP_DAYS.
# يُجدول يومياً عبر cron (انظر docs/DEPLOY.md). الاستعادة: scripts/restore.sh <الملف>
set -euo pipefail
[ -n "${GITHUB_ACTIONS:-}" ] && trap 'echo "::error::${BASH_SOURCE[0]}:$LINENO: $BASH_COMMAND"' ERR
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
C="docker compose -f docker-compose.prod.yml"
mkdir -p backups && chmod 700 backups
stamp="$(TZ=Asia/Riyadh date +%Y%m%d-%H%M)"
db="backups/haseef-db-$stamp.dump"
files="backups/haseef-files-$stamp.tar.gz"

$C exec -T db pg_dump -U haseef_owner -d haseef -Fc --no-owner > "$db"
$C run --rm --no-deps -T --entrypoint tar api czf - -C /app storage > "$files" 2>/dev/null || true
[ -s "$db" ] || { echo "فشل النسخ: الملف فارغ"; rm -f "$db"; exit 1; }
echo "نسخة: $db ($(du -h "$db" | cut -f1))"

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  docker run --rm -v "$PWD/backups:/b:ro" -e AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" -e AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
    amazon/aws-cli --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "/b/$(basename "$db")" "s3://$BACKUP_S3_BUCKET/db/" --only-show-errors
  echo "رُفعت إلى التخزين الخارجي"
fi
find backups -name 'haseef-*' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
