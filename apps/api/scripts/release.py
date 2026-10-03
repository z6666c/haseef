"""خطوة النشر قبل تشغيل الإصدار الجديد (في الإنتاج HASEEF_AUTO_MIGRATE=false):

  1. يضبط كلمات مرور دوري قاعدة البيانات من متغيرات البيئة (لا تُكتب في أي ملف بالمستودع).
  2. يطبّق تحديثات المخطط db/migrations بالترتيب.
  3. يضيف المحتوى المرجعي الجديد (المعايير والالتزامات والمكتبة) دون المساس بما عدّله الفريق.

    python -m scripts.release
"""

from __future__ import annotations

import logging
import os
import sys

from sqlalchemy import create_engine

from haseef.config import get_settings
from haseef.migrate import migrate

log = logging.getLogger("release")


def set_role_passwords() -> None:
    pw = {"haseef_app": os.environ.get("HASEEF_DB_APP_PASSWORD"), "haseef_platform": os.environ.get("HASEEF_DB_PLATFORM_PASSWORD")}
    if not all(pw.values()):
        log.info("role passwords: not provided, unchanged")
        return
    engine = create_engine(get_settings().database_url_migrate)
    with engine.connect() as c:
        raw = c.connection.driver_connection
        raw.autocommit = True
        for role, value in pw.items():
            if raw.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)).fetchone():
                # ALTER ROLE لا يقبل معاملات مربوطة؛ نقتبس القيمة بأمان عبر quote_literal في قاعدة البيانات
                lit = raw.execute("SELECT quote_literal(%s)", (value,)).fetchone()[0]
                raw.execute(f"ALTER ROLE {role} PASSWORD {lit}")
    log.info("role passwords: set")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    applied = migrate()
    log.info("migrations applied: %s", applied or "none")
    set_role_passwords()                 # بعد التحديثات: 0001 هي التي تنشئ الدورين في قاعدة جديدة
    from haseef.db import platform_tx
    from haseef.services.catalog_service import sync_catalog
    with platform_tx() as conn:
        log.info("catalog: %s", sync_catalog(conn))
    return 0


if __name__ == "__main__":
    sys.exit(main())
