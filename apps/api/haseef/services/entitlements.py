"""ميزات الباقة الفعّالة للمنشأة (تُقرأ داخل معاملة المنشأة نفسها)."""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import Connection, text

FEATURE_LABEL = {
    "GOVERNANCE": "الحوكمة", "PDPL": "حماية البيانات الشخصية",
    "MULTI_ENTITY": "المنشآت المتعددة والفروع", "BOARD_REPORTS": "تقارير مجلس الإدارة",
}


def org_plan(conn: Connection, org_id: UUID | str) -> dict:
    row = conn.execute(text("""
        SELECT s.plan_tier, pl.name_ar AS plan_name, COALESCE(pl.features, '{}') AS features,
               pl.monthly_whatsapp_alerts, s.ends_at, s.billing_status, s.billing_cycle
        FROM subscriptions s JOIN plans pl ON pl.tier = s.plan_tier
        WHERE s.org_id = :o AND s.billing_status IN ('TRIAL','ACTIVE','PAST_DUE') AND now() BETWEEN s.starts_at AND s.ends_at
        LIMIT 1"""), {"o": str(org_id)}).mappings().one_or_none()
    return dict(row) if row else {"plan_tier": None, "plan_name": None, "features": [], "monthly_whatsapp_alerts": 0,
                                  "ends_at": None, "billing_status": None, "billing_cycle": None}


def has_feature(conn: Connection, org_id: UUID | str, feature: str) -> bool:
    return feature in set(org_plan(conn, org_id)["features"])


def require_feature(conn: Connection, org_id: UUID | str, feature: str) -> None:
    if not has_feature(conn, org_id, feature):
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED,
                            f"ميزة «{FEATURE_LABEL.get(feature, feature)}» متاحة في باقة كبار العملاء")
