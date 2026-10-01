from __future__ import annotations

from ..config import Settings
from .base import ConsoleSender, MessageSender
from .whatsapp import MetaCloudWhatsApp, UnifonicWhatsApp


def build_senders(s: Settings) -> dict[str, MessageSender]:
    if s.whatsapp_provider == "meta":
        if not (s.meta_phone_number_id and s.meta_access_token):
            raise RuntimeError("HASEEF_META_PHONE_NUMBER_ID و HASEEF_META_ACCESS_TOKEN مطلوبان")
        wa: MessageSender = MetaCloudWhatsApp(s.meta_phone_number_id, s.meta_access_token, s.whatsapp_template_lang)
    elif s.whatsapp_provider == "unifonic":
        if not (s.unifonic_app_sid and s.unifonic_sender):
            raise RuntimeError("HASEEF_UNIFONIC_APP_SID و HASEEF_UNIFONIC_SENDER مطلوبان")
        wa = UnifonicWhatsApp(s.unifonic_app_sid, s.unifonic_sender, s.whatsapp_template_lang)
    else:
        wa = ConsoleSender()
    # البريد: ConsoleSender حتى يُختار مزوّد بريد داخل المملكة (المرحلة 3).
    return {"WHATSAPP": wa, "EMAIL": ConsoleSender()}
