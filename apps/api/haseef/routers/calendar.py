"""مزامنة المواعيد مع تقويم جوجل وأوتلوك والآيفون: رابط سري (ICS) لكل منشأة يُنشأ ويُلغى من حصيف.

الرمز يُعرض مرة واحدة عند الإنشاء ويُخزَّن مجزّأً. أسماء الموظفين لا تخرج للتقويم الخارجي إلا باختيار صريح.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import text

from ..config import get_settings
from ..db import platform_tx
from ..deps import Tenant, get_tenant
from ..domain.ics import build
from ..services import governance_service as gs
from .compliance import _audit

router = APIRouter(tags=["calendar"])


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _url(token: str) -> str:
    return f"{get_settings().api_public_url}/v1/public/calendar/{token}.ics"


@router.get("/calendar/feed")
def feed_status(t: Tenant = Depends(get_tenant)):
    row = t.conn.execute(text("SELECT include_people, created_at FROM calendar_feeds")).mappings().one_or_none()
    return {"active": row is not None, **(dict(row) if row else {}), "can_manage": t.role in ("ORG_ADMIN", "COMPLIANCE_OFFICER")}


class FeedIn(BaseModel):
    include_people: bool = False


@router.post("/calendar/feed", status_code=201)
def create_feed(body: FeedIn, t: Tenant = Depends(get_tenant)):
    """ينشئ رابطاً جديداً (ويُبطل السابق إن وجد)."""
    t.require("ORG_ADMIN", "COMPLIANCE_OFFICER")
    token = secrets.token_urlsafe(24)
    t.conn.execute(text("""
        INSERT INTO calendar_feeds (org_id, token_hash, include_people, created_by) VALUES (:o, :h, :p, :u)
        ON CONFLICT (org_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, include_people = EXCLUDED.include_people,
            created_by = EXCLUDED.created_by, created_at = now()"""),
        {"o": t.org_id, "h": _hash(token), "p": body.include_people, "u": t.principal.user_id})
    _audit(t.conn, t, "CREATE", "calendar_feed", None, body.model_dump())
    return {"url": _url(token), "include_people": body.include_people}


@router.delete("/calendar/feed", status_code=204)
def delete_feed(t: Tenant = Depends(get_tenant)):
    t.require("ORG_ADMIN", "COMPLIANCE_OFFICER")
    t.conn.execute(text("DELETE FROM calendar_feeds"))
    _audit(t.conn, t, "DELETE", "calendar_feed", None)


@router.get("/public/calendar/{token}.ics")
def public_feed(token: str):
    if len(token) > 64:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "غير موجود")
    today = gs.riyadh_today()
    with platform_tx() as c:
        f = c.execute(text("""SELECT f.org_id, f.include_people, o.name FROM calendar_feeds f JOIN organizations o ON o.id = f.org_id
                              WHERE f.token_hash = :h AND o.is_active"""), {"h": _hash(token)}).mappings().one_or_none()
        if f is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "غير موجود")
        events = [dict(r) for r in c.execute(text("""
            SELECT target_type, target_id, title, due_date, link FROM v_alert_targets
            WHERE org_id = :o AND enabled AND due_date BETWEEN :a AND :b"""),
            {"o": f["org_id"], "a": today - timedelta(days=90), "b": today + timedelta(days=550)}).mappings()]
    body = build(f["name"], events, include_people=f["include_people"])
    return Response(body, media_type="text/calendar; charset=utf-8",
                    headers={"Cache-Control": "private, max-age=900", "Content-Disposition": 'inline; filename="haseef.ics"'})
