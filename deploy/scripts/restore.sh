#!/usr/bin/env bash
# استعادة قاعدة البيانات من نسخة:  deploy/scripts/restore.sh backups/haseef-db-YYYYMMDD-HHMM.dump
# يوقف الخدمات، يستبدل البيانات الحالية بالكامل، ثم يعيد التشغيل.
set -euo pipefail
cd "$(dirname "$0")/.."
f="${1:?حدد ملف النسخة}"; [ -f "$f" ] || { echo "الملف غير موجود: $f"; exit 1; }
read -r -p "ستُستبدل كل بيانات الإنتاج الحالية بـ $f. اكتب «استعادة» للمتابعة: " ok
[ "$ok" = "استعادة" ] || { echo "أُلغيت"; exit 1; }
C="docker compose -f docker-compose.prod.yml"
scripts/backup.sh || true                      # نسخة من الوضع الحالي قبل الاستبدال
$C stop api worker beat
$C exec -T db pg_restore -U haseef_owner -d haseef --clean --if-exists --no-owner < "$f"
$C --profile release run --rm release          # يعيد ضبط كلمات مرور الأدوار ويكمل أي تحديث ناقص
$C up -d api worker beat
echo "تمت الاستعادة من $f"
