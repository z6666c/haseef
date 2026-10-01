#!/usr/bin/env bash
# يفتح رابطين عامين مؤقتين للتطبيق ولوحة التحكم عبر Cloudflare (مجاناً، بلا حساب).
# الشرط: المشروع شغّال (scripts/dev.sh) في نافذة أخرى.
# الروابط تعمل ما دام هذا الأمر شغّالاً والجهاز متصلاً، وتتغير مع كل تشغيل.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared غير مثبّت. ثبّته بالأمر:  brew install cloudflared  ثم أعد تشغيل هذا الأمر."
  exit 1
fi
for port in 3000 3001; do
  if ! curl -s -o /dev/null "http://localhost:$port"; then
    echo "المنفذ $port لا يعمل. شغّل المشروع أولاً:  ./scripts/dev.sh"
    exit 1
  fi
done

mkdir -p logs
: > logs/tunnel-client.log
: > logs/tunnel-admin.log
cloudflared tunnel --no-autoupdate --url http://localhost:3000 > logs/tunnel-client.log 2>&1 &
P1=$!
cloudflared tunnel --no-autoupdate --url http://localhost:3001 > logs/tunnel-admin.log 2>&1 &
P2=$!
trap 'kill $P1 $P2 2>/dev/null; echo; echo "أُغلق الرابطان."' EXIT INT TERM

url_of() { grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$1" | head -1; }
echo "جارٍ فتح الروابط…"
for _ in $(seq 1 30); do
  C=$(url_of logs/tunnel-client.log || true); A=$(url_of logs/tunnel-admin.log || true)
  [ -n "$C" ] && [ -n "$A" ] && break
  sleep 1
done

echo
echo "════════════════════════════════════════════"
echo "  تطبيق العملاء:  ${C:-تعذّر — راجع logs/tunnel-client.log}"
echo "  لوحة التحكم:    ${A:-تعذّر — راجع logs/tunnel-admin.log}"
echo "════════════════════════════════════════════"
echo
echo "  حسابات الدخول الحالية (تتغير مع كل تشغيل للمشروع):"
sed -n '/حسابات التطوير/,/^$/p' logs/setup.log 2>/dev/null | tail -n +2 | sed 's/^/  /' || true
echo "  أرسل رابط تطبيق العملاء مع حساب تجريبي فقط."
echo "  لا ترسل رابط لوحة التحكم إلا لفريق حصيف."
echo "  للإغلاق: Ctrl+C"
wait
