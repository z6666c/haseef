"""تطبيق تحديثات قاعدة البيانات تلقائياً (db/migrations/*.sql) بالترتيب.

  * يحفظ ما طُبِّق في جدول schema_migrations، فلا يُطبَّق ملف مرتين.
  * قاعدة أُنشئت قبل وجود هذا المُطبِّق (من docker-entrypoint) تُعتبر وصلت إلى 0003.
  * قفل استشاري يمنع تطبيقين متزامنين (إعادة تحميل الخادم مثلاً).
  * كل ملف في معاملة مستقلة: إن فشل لا يُسجَّل، ويبقى الخادم يعمل على المخطط السابق.

في الإنتاج يُشغَّل كخطوة نشر صريحة (HASEEF_AUTO_MIGRATE=false في الخادم نفسه).
"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import create_engine

from .config import get_settings

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "db" / "migrations"
BASELINE = ("0001_init.sql", "0002_alert_views.sql", "0003_manual_reminders.sql")
LOCK_KEY = 7_420_130   # رقم ثابت للقفل الاستشاري


def migrate() -> list[str]:
    s = get_settings()
    engine = create_engine(s.database_url_migrate, pool_pre_ping=True)
    applied_now: list[str] = []
    with engine.connect() as sa_conn:
        raw = sa_conn.connection.driver_connection   # اتصال psycopg خام: يقبل عدة أوامر في ملف واحد
        raw.autocommit = True
        raw.execute("SELECT pg_advisory_lock(%s)", (LOCK_KEY,))
        try:
            raw.execute("""CREATE TABLE IF NOT EXISTS schema_migrations (
                               name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())""")
            done = {r[0] for r in raw.execute("SELECT name FROM schema_migrations").fetchall()}
            if not done and raw.execute("SELECT to_regclass('public.organizations')").fetchone()[0]:
                for name in BASELINE:
                    raw.execute("INSERT INTO schema_migrations (name) VALUES (%s) ON CONFLICT DO NOTHING", (name,))
                done = set(BASELINE)
                log.info("migrations: baselined existing database at %s", BASELINE[-1])

            for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                if path.name in done:
                    continue
                log.info("migrations: applying %s", path.name)
                with raw.transaction():
                    raw.execute(path.read_text(encoding="utf-8"))
                    raw.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
                applied_now.append(path.name)
        finally:
            raw.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))
    engine.dispose()
    if applied_now:
        log.info("migrations: applied %s", ", ".join(applied_now))
    return applied_now
