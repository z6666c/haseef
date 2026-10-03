#!/usr/bin/env bash
# أول مدير عام بعد النشر الأول:  deploy/scripts/create-admin.sh ops@haseef.sa "اسم المدير"
set -euo pipefail
[ -n "${GITHUB_ACTIONS:-}" ] && trap 'echo "::error::${BASH_SOURCE[0]}:$LINENO: $BASH_COMMAND"' ERR
cd "$(dirname "$0")/.."
docker compose -f docker-compose.prod.yml run --rm --no-deps api python -m scripts.create_admin --email "${1:?البريد}" --name "${2:?الاسم}" "${@:3}"
