#!/usr/bin/env bash
# تجهيز خادم Ubuntu 22.04/24.04 جديد لحصيف (يُشغَّل مرة واحدة بصلاحية root):
#   curl -fsSL https://raw.githubusercontent.com/z6666c/haseef/main/deploy/scripts/bootstrap.sh | sudo bash
# يثبّت Docker وجدار الحماية والتحديثات الأمنية التلقائية، وينسخ المستودع إلى /opt/haseef،
# ويجدول النسخ الاحتياطي اليومي. لا يشغّل المنصة: املأ deploy/.env ثم شغّل deploy.sh.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "شغّله بصلاحية root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

timedatectl set-timezone Asia/Riyadh || true
apt-get update -q
apt-get install -yq ca-certificates curl git ufw unattended-upgrades fail2ban openssl
dpkg-reconfigure -f noninteractive unattended-upgrades

if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q && apt-get install -yq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
# سجلات الحاويات محدودة الحجم
[ -f /etc/docker/daemon.json ] || echo '{"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"5"}}' > /etc/docker/daemon.json
systemctl restart docker

ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable

[ -d /opt/haseef/.git ] || git clone https://github.com/z6666c/haseef.git /opt/haseef
cd /opt/haseef/deploy
[ -f .env ] || { scripts/gen-secrets.sh > .env; chmod 600 .env; echo "أُنشئ deploy/.env بأسرار عشوائية: راجع النطاق والبريد فيه."; }

# نسخة احتياطية يومياً 03:30 بتوقيت الرياض
echo "30 3 * * * root /opt/haseef/deploy/scripts/backup.sh >> /var/log/haseef-backup.log 2>&1" > /etc/cron.d/haseef-backup

echo
echo "تم تجهيز الخادم. الخطوات التالية:"
echo "  1) وجّه سجلات DNS (A) لـ haseef.sa و app. و admin. و www. إلى عنوان هذا الخادم"
echo "  2) راجع /opt/haseef/deploy/.env"
echo "  3) /opt/haseef/deploy/scripts/deploy.sh"
echo "  4) /opt/haseef/deploy/scripts/create-admin.sh <البريد> \"<الاسم>\""
