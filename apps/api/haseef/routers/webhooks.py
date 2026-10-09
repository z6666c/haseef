"""ويبهوك واتساب (Meta Cloud API) لبوت الموظفين: التحقق من الاشتراك، والتحقق من توقيع كل طلب، ثم الرد داخل نافذة 24 ساعة."""

from __future__ import annotations

import hashlib
import hmac
import logging

from fastapi import APIRouter, HTTPException, Request, Response, status

from ..config import get_settings
from ..db import platform_tx
from ..messaging import build_senders
from ..services import bot_service

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
log = logging.getLogger(__name__)


@router.get("/whatsapp")
def verify(request: Request):
    q = request.query_params
    s = get_settings()
    if q.get("hub.mode") == "subscribe" and s.meta_verify_token and hmac.compare_digest(q.get("hub.verify_token", ""), s.meta_verify_token):
        return Response(q.get("hub.challenge", ""), media_type="text/plain")
    raise HTTPException(status.HTTP_403_FORBIDDEN, "رمز التحقق غير صحيح")


def _signature_ok(secret: str | None, raw: bytes, header: str | None) -> bool:
    if not secret:
        return get_settings().env != "production"           # التوقيع إلزامي في الإنتاج
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[7:])


def parse_messages(payload: dict) -> list[dict]:
    """يستخرج الرسائل النصية: [{phone, body, name}]."""
    out = []
    for entry in payload.get("entry", []) or []:
        for ch in entry.get("changes", []) or []:
            v = ch.get("value") or {}
            names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in v.get("contacts", []) or []}
            for m in v.get("messages", []) or []:
                if m.get("type") == "text" and m.get("from"):
                    out.append({"phone": "+" + m["from"].lstrip("+"), "body": (m.get("text") or {}).get("body", "")[:1000],
                                "name": names.get(m["from"])})
                elif m.get("type") == "button" and m.get("from"):
                    out.append({"phone": "+" + m["from"].lstrip("+"), "body": (m.get("button") or {}).get("text", "")[:100],
                                "name": names.get(m["from"])})
    return out


@router.post("/whatsapp")
async def inbound(request: Request):
    raw = await request.body()
    if not _signature_ok(get_settings().meta_app_secret, raw, request.headers.get("X-Hub-Signature-256")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "توقيع غير صالح")
    try:
        payload = await request.json()
    except Exception:
        return {"ok": True}
    sender = build_senders(get_settings())["WHATSAPP"]
    for m in parse_messages(payload):
        try:
            with platform_tx() as c:
                reply = bot_service.process_inbound(c, phone=m["phone"], body=m["body"], profile_name=m["name"])
            if reply:
                sender.send_text(m["phone"], reply)
        except Exception:                                    # رسالة فاشلة لا توقف بقية الدفعة (Meta تعيد الإرسال عند غير 200)
            log.exception("bot inbound failed")
    return {"ok": True}
