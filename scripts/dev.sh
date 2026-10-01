#!/usr/bin/env bash
# تشغيل حصيف كاملاً على جهازك بأمر واحد:  ./scripts/dev.sh
# يحتاج: Docker Desktop، Python 3.12+، Node 20+
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null || { echo "✗ $1 غير مثبت. $2"; exit 1; }; }
need docker  "ثبّت Docker Desktop من docker.com وشغّله."
need python3 "ثبّت Python من python.org (الإصدار 3.12 أو أحدث)."
need node    "ثبّت Node.js من nodejs.org (الإصدار 20 أو أحدث)."

mkdir -p logs
exec > >(tee logs/setup.log) 2>&1
echo "① تشغيل قاعدة البيانات و Redis…"
docker compose up -d --wait

echo "② تجهيز الخادم…"
cd apps/api
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -e ".[dev]"
[ -f .env ] || cp .env.example .env
.venv/bin/python -m pytest -q
.venv/bin/python -m scripts.seed
cd ../..

echo "③ تجهيز الواجهتين…"
npm install --silent
for a in client admin; do [ -f "apps/$a/.env.local" ] || cp "apps/$a/.env.example" "apps/$a/.env.local"; done

echo
echo "✓ جاهز. افتح:"
echo "   واجهة العميل:   http://localhost:3000"
echo "   لوحة الإدارة:   http://localhost:3001"
echo "   توثيق الواجهة:  http://localhost:8000/docs"
echo "   (للإيقاف: Ctrl+C)"
echo

# السجلات تُكتب أيضاً في مجلد logs/ ليقرأها Claude عند التشخيص
mkdir -p logs
trap 'kill 0' EXIT
(cd apps/api && .venv/bin/uvicorn haseef.main:app --reload --port 8000 2>&1 | tee ../../logs/api.log) &
(cd apps/api && .venv/bin/celery -A haseef.worker worker -B -P threads -c 4 -l info 2>&1 | tee ../../logs/worker.log) &
npm run dev:client 2>&1 | tee logs/client.log &
npm run dev:admin 2>&1 | tee logs/admin.log &
wait
