#!/usr/bin/env bash
# يُنشئ قاعدة اختبار نظيفة، يطبّق كل الـ migrations ثم يشغّل كل ملفات *_test.sql.
set -euo pipefail
PSQL=${PSQL:-psql}
DB=${TEST_DB:-haseef_test}
DIR="$(cd "$(dirname "$0")" && pwd)"
$PSQL -v ON_ERROR_STOP=1 -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
for f in "$DIR"/../migrations/*.sql; do $PSQL -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"; done
for t in "$DIR"/*_test.sql; do
  echo "== $(basename "$t")"
  $PSQL -v ON_ERROR_STOP=1 -q -t -d "$DB" -f "$t" | grep -E "passed" || { echo "FAILED: $t"; exit 1; }
done
