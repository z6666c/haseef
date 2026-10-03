#!/usr/bin/env bash
# نشر أو تحديث حصيف على الخادم:  deploy/scripts/deploy.sh
#   1) يسحب آخر نسخة من main   2) يبني الصور   3) نسخة احتياطية قبل التحديث
#   4) خطوة الإصدار (المخطط والمحتوى)   5) يشغّل الخدمات   6) يتحقق من الصحة
set -euo pipefail
cd "$(dirname "$0")/.."                     # مجلد deploy
[ -f .env ] || { echo "deploy/.env غير موجود. أنشئه: scripts/gen-secrets.sh > .env"; exit 1; }
chmod 600 .env
C="docker compose -f docker-compose.prod.yml"

if [ "${SKIP_PULL:-0}" != "1" ]; then git -C .. pull --ff-only; fi
export HASEEF_VERSION="$(git -C .. rev-parse --short HEAD)"
sed -i "s/^HASEEF_VERSION=.*/HASEEF_VERSION=$HASEEF_VERSION/" .env

echo "== بناء الصور ($HASEEF_VERSION)"
$C build

echo "== قاعدة البيانات"
$C up -d db redis
until $C exec -T db pg_isready -U haseef_owner -d haseef >/dev/null 2>&1; do sleep 2; done
if $C exec -T db psql -U haseef_owner -d haseef -tAc "SELECT to_regclass('public.organizations')" | grep -q organizations; then
  echo "== نسخة احتياطية قبل التحديث"; scripts/backup.sh
fi

echo "== خطوة الإصدار"
$C --profile release run --rm release

echo "== تشغيل الخدمات"
$C up -d --remove-orphans api worker beat client admin caddy

echo "== فحص الصحة"
for i in $(seq 1 30); do
  if $C exec -T api python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=3)" 2>/dev/null; then
    echo "تم النشر: $HASEEF_VERSION"; $C ps; exit 0; fi
  sleep 2
done
echo "الخادم لم يستجب. السجلات:"; $C logs --tail 80 api; exit 1
