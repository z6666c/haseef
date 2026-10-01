"""مزوّدو الواتساب. القوالب الثلاثة (license_expiring / license_expired / policy_review_due)
يجب اعتمادها لدى Meta من فئة Utility قبل الإرسال؛ القالب يحمل 6 متغيرات بالترتيب
الموضح في domain/alerts.py.

ملاحظة: نقاط النهاية وبنية الطلب هنا تتبع وثائق المزوّدين العامة؛ تُراجَع مقابل
حساب Unifonic/Meta الفعلي عند الربط، فقد تختلف حسب نوع الحساب.
"""

from __future__ import annotations

import httpx

from .base import SendError

_RETRYABLE = {408, 429, 500, 502, 503, 504}


def _raise_for(resp: httpx.Response, provider: str) -> None:
    if resp.status_code >= 400:
        raise SendError(f"{provider} HTTP {resp.status_code}: {resp.text[:300]}",
                        retryable=resp.status_code in _RETRYABLE)


class MetaCloudWhatsApp:
    """WhatsApp Cloud API مباشرة من Meta."""

    name = "META"

    def __init__(self, phone_number_id: str, access_token: str, lang: str = "ar",
                 api_version: str = "v21.0", client: httpx.Client | None = None):
        self._url = f"https://graph.facebook.com/{api_version}/{phone_number_id}/messages"
        self._headers = {"Authorization": f"Bearer {access_token}"}
        self._lang = lang
        self._client = client or httpx.Client(timeout=15)

    def send(self, to: str, template: str, variables: list[str]) -> tuple[str, str]:
        body = {
            "messaging_product": "whatsapp",
            "to": to.lstrip("+"),
            "type": "template",
            "template": {
                "name": template,
                "language": {"code": self._lang},
                "components": [{
                    "type": "body",
                    "parameters": [{"type": "text", "text": v} for v in variables],
                }],
            },
        }
        try:
            resp = self._client.post(self._url, json=body, headers=self._headers)
        except httpx.HTTPError as e:
            raise SendError(f"META network error: {e}") from e
        _raise_for(resp, self.name)
        messages = resp.json().get("messages") or [{}]
        return self.name, messages[0].get("id", "")


class UnifonicWhatsApp:
    """Unifonic (مزوّد محلي سعودي) — يُفضَّل لإقامة البيانات وسهولة الفوترة بالريال."""

    name = "UNIFONIC"

    def __init__(self, app_sid: str, sender: str, lang: str = "ar",
                 base_url: str = "https://apis.unifonic.com/v1/messages", client: httpx.Client | None = None):
        self._url = base_url
        self._headers = {"PublicId": app_sid}
        self._sender = sender
        self._lang = lang
        self._client = client or httpx.Client(timeout=15)

    def send(self, to: str, template: str, variables: list[str]) -> tuple[str, str]:
        body = {
            "recipient": {"contact": to, "channel": "whatsapp"},
            "content": {
                "type": "template",
                "name": template,
                "language": {"code": self._lang},
                "components": [{
                    "type": "body",
                    "parameters": [{"type": "text", "text": v} for v in variables],
                }],
            },
            "sender": self._sender,
        }
        try:
            resp = self._client.post(self._url, json=body, headers=self._headers)
        except httpx.HTTPError as e:
            raise SendError(f"UNIFONIC network error: {e}") from e
        _raise_for(resp, self.name)
        return self.name, str(resp.json().get("messageId", ""))
