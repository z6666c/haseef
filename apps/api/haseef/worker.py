"""عمّال Celery والجدولة. التشغيل:
    celery -A haseef.worker worker -l info
    celery -A haseef.worker beat   -l info
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab
from sqlalchemy import text

from .config import get_settings
from .db import platform_tx
from .messaging import build_senders
from .services import alerts_service, score_service

s = get_settings()
celery = Celery("haseef", broker=s.redis_url, backend=s.redis_url)
celery.conf.update(timezone="Asia/Riyadh", enable_utc=True, task_acks_late=True,
                   worker_prefetch_multiplier=1)

celery.conf.beat_schedule = {
    "plan-alerts-nightly":   {"task": "haseef.plan_alerts",      "schedule": crontab(hour=1, minute=0)},
    "send-due-alerts":       {"task": "haseef.send_due_alerts",  "schedule": crontab(minute="*/5")},
    "recompute-scores":      {"task": "haseef.recompute_scores", "schedule": crontab(hour=2, minute=0)},
    "labor-tasks-daily":     {"task": "haseef.labor_tasks",      "schedule": crontab(hour=0, minute=30)},
    "tax-tasks-daily":       {"task": "haseef.tax_tasks",        "schedule": crontab(hour=0, minute=40)},
    "attendance-purge":      {"task": "haseef.attendance_purge", "schedule": crontab(hour=3, minute=15)},
    "installment-reminders": {"task": "haseef.remind_installments", "schedule": crontab(hour=s.alert_send_hour, minute=10)},
}


@celery.task(name="haseef.plan_alerts")
def plan_alerts() -> int:
    with platform_tx() as conn:
        return alerts_service.plan_alerts(conn, send_hour=s.alert_send_hour)


@celery.task(name="haseef.send_due_alerts")
def send_due_alerts() -> int:
    return alerts_service.send_due_alerts(platform_tx, build_senders(s))


@celery.task(name="haseef.remind_installments")
def remind_installments() -> int:
    from .services import installments_service
    return installments_service.send_due_reminders(platform_tx, build_senders(s), f"{s.client_base_url}/billing")


@celery.task(name="haseef.labor_tasks")
def labor_tasks() -> int:
    # قبل تخطيط التنبيهات الليلي (01:00) لتدخل مهام الشهر الجديد في التنبيهات من أول يوم.
    from .services import governance_service, labor_service
    return labor_service.ensure_all(platform_tx, governance_service.riyadh_today())


@celery.task(name="haseef.tax_tasks")
def tax_tasks() -> int:
    from .services import governance_service, tax_service
    return tax_service.ensure_all(platform_tx, governance_service.riyadh_today())


@celery.task(name="haseef.attendance_purge")
def attendance_purge() -> int:
    from .routers.attendance import purge_coordinates
    with platform_tx() as conn:
        return purge_coordinates(conn)


@celery.task(name="haseef.recompute_scores")
def recompute_scores() -> int:
    # الحالات المشتقة من التاريخ تتغير يومياً حتى دون أي تعديل من العميل.
    with platform_tx() as conn:
        org_ids = conn.execute(text("SELECT id FROM organizations WHERE is_active")).scalars().all()
    for org_id in org_ids:
        with platform_tx() as conn:
            score_service.recompute(conn, org_id)
    return len(org_ids)
