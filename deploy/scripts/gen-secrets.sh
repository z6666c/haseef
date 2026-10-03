#!/usr/bin/env bash
# يطبع ملف .env جاهزاً بأسرار عشوائية قوية. الاستخدام:
#   deploy/scripts/gen-secrets.sh > deploy/.env && chmod 600 deploy/.env
set -euo pipefail
rand() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"$1"; }
sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand 40)|" \
    -e "s|^HASEEF_DB_APP_PASSWORD=.*|HASEEF_DB_APP_PASSWORD=$(rand 40)|" \
    -e "s|^HASEEF_DB_PLATFORM_PASSWORD=.*|HASEEF_DB_PLATFORM_PASSWORD=$(rand 40)|" \
    -e "s|^HASEEF_JWT_SECRET=.*|HASEEF_JWT_SECRET=$(rand 64)|" \
    "$(dirname "$0")/../.env.example"
